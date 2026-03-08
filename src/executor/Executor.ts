import { config } from '../config';
import { eventBus } from '../events/EventBus';
import type { ActionItem, ExecutorErrorCode, ExecutorResult } from '../types';
import { mapExecutorFailure } from './failureMapping';
import { resolveSkill as resolveSkillFromRegistry } from './SkillRegistry';
import type {
  ExecutorDependencies,
  SkillExecutionOutcome,
} from './types';

class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Execution exceeded timeout budget (${timeoutMs}ms)`);
  }
}

function isActionItemValid(actionItem: ActionItem | null | undefined): actionItem is ActionItem {
  if (!actionItem) {
    return false;
  }

  if (typeof actionItem.skill !== 'string' || actionItem.skill.trim().length === 0) {
    return false;
  }

  if (typeof actionItem.params !== 'object' || actionItem.params === null) {
    return false;
  }

  return Number.isFinite(actionItem.expectedDurationSeconds) && actionItem.expectedDurationSeconds > 0;
}

function normalizeOutcome(raw: SkillExecutionOutcome): SkillExecutionOutcome {
  if (raw.success) {
    return {
      success: true,
      errorCode: null,
      errorMessage: null,
      stateChanges: raw.stateChanges ?? {},
    };
  }

  return {
    success: false,
    errorCode: raw.errorCode ?? 'invalid_state',
    errorMessage: raw.errorMessage ?? 'Skill returned an unsuccessful result without details',
    stateChanges: raw.stateChanges ?? {},
  };
}

function failureResult(
  actionItem: ActionItem,
  startedAtMs: number,
  now: () => number,
  errorCode: ExecutorErrorCode,
  errorMessage: string,
): ExecutorResult {
  return {
    actionItem,
    success: false,
    errorCode,
    errorMessage,
    durationMs: Math.max(0, now() - startedAtMs),
    stateChanges: {},
    metadata: {
      attempt: 1,
      timedOut: errorCode === 'timed_out',
      completedAtMs: now(),
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function executeAction(
  actionItem: ActionItem,
  dependencies: ExecutorDependencies = {},
): Promise<ExecutorResult> {
  const now = dependencies.now ?? Date.now;
  const startedAtMs = now();
  const bus = dependencies.eventBus ?? eventBus;
  const timeoutMsForSkill = dependencies.timeoutMsForSkill
    ?? ((skill: string) => config.executor.perSkillTimeoutMs[skill] ?? config.executor.defaultTimeoutMs);

  const emitResult = (result: ExecutorResult): ExecutorResult => {
    try {
      bus.emit('executor:result', result);
    } catch {
      // Event emission failures should not break executor contract.
    }
    return result;
  };

  if (!isActionItemValid(actionItem)) {
    return emitResult(
      failureResult(
        actionItem,
        startedAtMs,
        now,
        'invalid_state',
        'Malformed action item payload',
      ),
    );
  }

  const resolveSkill = dependencies.resolveSkill ?? resolveSkillFromRegistry;
  const handler = resolveSkill(actionItem.skill);

  if (!handler) {
    return emitResult(
      failureResult(
        actionItem,
        startedAtMs,
        now,
        'invalid_state',
        'Unknown skill request',
      ),
    );
  }

  try {
    const raw = await withTimeout(
      handler(actionItem, { attempt: 1, startedAtMs }),
      timeoutMsForSkill(actionItem.skill, actionItem),
    );
    const normalized = normalizeOutcome(raw);

    return emitResult({
      actionItem,
      success: normalized.success,
      errorCode: normalized.errorCode,
      errorMessage: normalized.errorMessage,
      durationMs: Math.max(0, now() - startedAtMs),
      stateChanges: normalized.stateChanges,
      metadata: {
        attempt: 1,
        timedOut: false,
        completedAtMs: now(),
      },
    });
  } catch (error: unknown) {
    if (error instanceof TimeoutError) {
      return emitResult(
        failureResult(
          actionItem,
          startedAtMs,
          now,
          'timed_out',
          error.message,
        ),
      );
    }

    const mapped = (dependencies.mapFailure ?? ((value: unknown) => mapExecutorFailure(value)))(error, actionItem);
    return emitResult(
      failureResult(
        actionItem,
        startedAtMs,
        now,
        mapped.errorCode,
        mapped.errorMessage,
      ),
    );
  }
}
