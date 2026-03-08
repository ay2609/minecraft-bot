import type { ActionItem } from '../types';
import type { MovementRequest, SkillExecutionOutcome } from './types';

interface CoordinatorOptions {
  now?: () => number;
  pendingTtlMs: number;
}

interface QueuedRequest {
  request: MovementRequest;
  enqueuedAtMs: number;
  resolve: (outcome: SkillExecutionOutcome) => void;
}

interface ActiveRequest {
  actionItem: ActionItem;
  intent: MovementRequest['intent'];
  controller: AbortController;
  settleInterruptedByPreemption: boolean;
}

function interruptedOutcome(
  message: string,
  details: string,
  outcome: 'interrupted' | 'dropped' | 'preempted' = 'interrupted',
): SkillExecutionOutcome {
  return {
    success: false,
    errorCode: 'interrupted',
    errorMessage: message,
    stateChanges: {},
    movement: {
      outcome,
      details,
    },
  };
}

function timedOutOutcome(timeoutMs: number): SkillExecutionOutcome {
  return {
    success: false,
    errorCode: 'timed_out',
    errorMessage: `Movement request exceeded timeout budget (${timeoutMs}ms)`,
    stateChanges: {},
    movement: {
      outcome: 'timed_out',
      details: 'movement_timeout',
    },
  };
}

function thrownOutcome(): SkillExecutionOutcome {
  return {
    success: false,
    errorCode: 'route_blocked',
    errorMessage: 'Movement execution failed unexpectedly',
    stateChanges: {},
    movement: {
      outcome: 'interrupted',
      details: 'movement_execute_throw',
    },
  };
}

function normalizeOutcome(outcome: SkillExecutionOutcome): SkillExecutionOutcome {
  if (outcome.success) {
    return {
      ...outcome,
      movement: outcome.movement ?? {
        outcome: 'executed',
      },
    };
  }

  return {
    ...outcome,
    errorCode: outcome.errorCode ?? 'invalid_state',
    errorMessage: outcome.errorMessage ?? 'Movement execution failed',
    movement: outcome.movement ?? {
      outcome: outcome.errorCode === 'timed_out' ? 'timed_out' : 'interrupted',
    },
  };
}

export class MovementCoordinator {
  private readonly now: () => number;

  private readonly pendingTtlMs: number;

  private active: ActiveRequest | null = null;

  private pending: QueuedRequest | null = null;

  constructor(options: CoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.pendingTtlMs = options.pendingTtlMs;
  }

  requestMove(request: MovementRequest): Promise<SkillExecutionOutcome> {
    return new Promise<SkillExecutionOutcome>((resolve) => {
      if (!this.active) {
        this.startRequest(request, resolve);
        return;
      }

      if (request.intent === 'critical' && this.active.intent !== 'critical') {
        if (this.pending) {
          this.pending.resolve(
            interruptedOutcome(
              'Pending movement was replaced by a critical request',
              'replaced_by_critical',
              'dropped',
            ),
          );
        }

        this.pending = {
          request,
          enqueuedAtMs: this.now(),
          resolve,
        };

        this.active.settleInterruptedByPreemption = true;
        this.active.controller.abort();
        return;
      }

      if (this.pending) {
        this.pending.resolve(
          interruptedOutcome(
            'Pending movement request was replaced by a newer request',
            'pending_replaced',
            'dropped',
          ),
        );
      }

      this.pending = {
        request,
        enqueuedAtMs: this.now(),
        resolve,
      };
    });
  }

  private startRequest(request: MovementRequest, resolve: (outcome: SkillExecutionOutcome) => void): void {
    const controller = new AbortController();
    const activeRequest: ActiveRequest = {
      actionItem: request.actionItem,
      intent: request.intent,
      controller,
      settleInterruptedByPreemption: false,
    };

    this.active = activeRequest;

    void this.executeWithTimeout(request, controller.signal)
      .then((outcome) => {
        if (activeRequest.settleInterruptedByPreemption) {
          resolve(
            interruptedOutcome(
              'Movement request was preempted by a critical request',
              'preempted_by_critical',
              'preempted',
            ),
          );
          return;
        }

        resolve(outcome);
      })
      .finally(() => {
        if (this.active === activeRequest) {
          this.active = null;
        }

        this.maybeRunPending();
      });
  }

  private maybeRunPending(): void {
    if (this.active || !this.pending) {
      return;
    }

    const queued = this.pending;
    this.pending = null;

    if (this.now() - queued.enqueuedAtMs > this.pendingTtlMs) {
      queued.resolve(
        interruptedOutcome(
          'Pending movement request expired before execution',
          'stale_pending',
          'dropped',
        ),
      );
      return;
    }

    this.startRequest(queued.request, queued.resolve);
  }

  private async executeWithTimeout(request: MovementRequest, signal: AbortSignal): Promise<SkillExecutionOutcome> {
    const timeoutMs = request.timeoutMs;

    const timeoutPromise = new Promise<SkillExecutionOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (!signal.aborted) {
          resolve(timedOutOutcome(timeoutMs));
        }
      }, timeoutMs);

      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve(interruptedOutcome('Movement request was interrupted', 'aborted'));
        },
        { once: true },
      );
    });

    try {
      const executionPromise = request.execute(signal)
        .then((outcome) => normalizeOutcome(outcome))
        .catch(() => thrownOutcome());

      const outcome = await Promise.race([executionPromise, timeoutPromise]);

      if (outcome.errorCode === 'timed_out' && !signal.aborted) {
        this.active?.controller.abort();
      }

      return outcome;
    } catch {
      return thrownOutcome();
    }
  }
}
