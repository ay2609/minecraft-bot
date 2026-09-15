import type OpenAI from 'openai';
import type { TypedEventBus } from '../events/EventBus';
import type { WorkingMemory } from '../memory/WorkingMemory';
import { MODEL_B_SYSTEM_PROMPT } from './systemPrompts';
import { TacticalOutputSchema } from './tacticalSchema';
import type { FireworksLLMClient } from './FireworksLLMClient';
import type { ActionItem, ActionQueue, ExecutorResult, PerceptionSnapshot } from '../types';
import type { PlannerContextBundle } from '../perception/types';

export interface TacticalConfig {
  watchdogIntervalMs: number;           // Default: 35000 (> longest skill timeout of 20s)
  consecutiveFailureThreshold: number;  // Default: 3
  churnOpsThreshold: number;            // Default: 5 queue ops = "large rewrite"
  churnWindowSize: number;              // Default: 3 consecutive large-rewrite cycles
  churnCooldownMs: number;              // Default: 30000 cooldown after churn escalation
}

export const DEFAULT_TACTICAL_CONFIG: TacticalConfig = {
  watchdogIntervalMs: 35000,
  consecutiveFailureThreshold: 3,
  churnOpsThreshold: 5,
  churnWindowSize: 3,
  churnCooldownMs: 30000,
};

function toPreview(value: unknown, maxChars = 420): string {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return '{}';
    }
    return serialized.length > maxChars ? `${serialized.slice(0, maxChars)}...` : serialized;
  } catch {
    return '[unserializable]';
  }
}

function applyQueueOps(
  baseActions: ActionItem[],
  queueOps: Array<{
    op: 'append' | 'prepend' | 'insert' | 'delete' | 'clear';
    action?: ActionItem;
    index?: number;
  }>,
): ActionItem[] {
  const actions = [...baseActions];

  for (const queueOp of queueOps) {
    if (queueOp.op === 'clear') {
      actions.length = 0;
      continue;
    }

    if (queueOp.op === 'append' && queueOp.action) {
      actions.push(queueOp.action);
      continue;
    }

    if (queueOp.op === 'prepend' && queueOp.action) {
      actions.unshift(queueOp.action);
      continue;
    }

    if (queueOp.op === 'insert' && queueOp.action && typeof queueOp.index === 'number') {
      const index = Math.max(0, Math.min(actions.length, queueOp.index));
      actions.splice(index, 0, queueOp.action);
      continue;
    }

    if (queueOp.op === 'delete' && typeof queueOp.index === 'number') {
      if (queueOp.index >= 0 && queueOp.index < actions.length) {
        actions.splice(queueOp.index, 1);
      }
    }
  }

  return actions;
}

export class TacticalPlanner {
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private recentChurnCounts: number[] = [];
  private lastChurnEscalationAt = 0;
  private latestContextBundle: PlannerContextBundle | null = null;
  private latestPerceptionSnapshot: PerceptionSnapshot | null = null;

  // Named class property arrow functions — used in BOTH start() and stop() so
  // events.off() receives the same reference that events.on() registered.
  private readonly handleExecutorResult = (result: ExecutorResult): void => {
    void this.onExecutorResult(result);
  };

  private readonly handleContextReady = (bundle: PlannerContextBundle): void => {
    this.latestContextBundle = bundle;
  };

  private readonly handlePerceptionUpdated = (snapshot: PerceptionSnapshot): void => {
    this.latestPerceptionSnapshot = snapshot;
  };

  private readonly handleStrategicPlanReady = (): void => {
    void this.triggerTactical('plan-ready');
  };

  constructor(
    private readonly llmClient: FireworksLLMClient,
    private readonly workingMemory: WorkingMemory,
    private readonly events: TypedEventBus,
    private readonly tacticalConfig: TacticalConfig = DEFAULT_TACTICAL_CONFIG,
  ) {}

  start(): void {
    this.events.on('executor:result', this.handleExecutorResult);
    this.events.on('planner:context-ready', this.handleContextReady);
    this.events.on('perception:updated', this.handlePerceptionUpdated);
    this.events.on('strategic:plan-ready', this.handleStrategicPlanReady);
    this.resetWatchdog();
  }

  stop(): void {
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    // Uses the same named property references registered in start() — correctly removes listeners
    this.events.off('executor:result', this.handleExecutorResult);
    this.events.off('planner:context-ready', this.handleContextReady);
    this.events.off('perception:updated', this.handlePerceptionUpdated);
    this.events.off('strategic:plan-ready', this.handleStrategicPlanReady);
  }

  private resetWatchdog(): void {
    if (this.watchdogTimer !== null) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      void this.triggerTactical('watchdog');
    }, this.tacticalConfig.watchdogIntervalMs);
  }

  private async onExecutorResult(result: ExecutorResult): Promise<void> {
    this.resetWatchdog();

    // Immediate escalation for invalid_state regardless of consecutive count
    if (result.errorCode === 'invalid_state') {
      this.events.emit('escalate:to-strategic', {
        reason: 'invalid_state failure requires immediate escalation',
        consecutiveFailures: this.consecutiveFailures + 1,
      });
      this.consecutiveFailures = 0;
      return;
    }

    if (result.success) {
      this.consecutiveFailures = 0;

      // Fast-path: if there is still queued work after a successful action,
      // skip another Model B round trip and let the runtime queue fast-path continue.
      const pendingQueue = this.workingMemory.getSnapshot().actionQueue;
      if (pendingQueue && pendingQueue.actions.length > 0 && !pendingQueue.needsRevalidation) {
        console.log(
          `[TacticalPlanner] fast-path skipping model call (remaining=${pendingQueue.actions.length} subgoal=${pendingQueue.subgoalId})`,
        );
        return;
      }
    } else {
      // Record failure details into WorkingMemory BEFORE triggerTactical() so
      // ContextAssembler picks them up in the next planner:context-ready bundle.
      this.workingMemory.recordFailure({
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        skill: result.actionItem.skill,
        timestampMs: Date.now(),
      });

      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.tacticalConfig.consecutiveFailureThreshold) {
        this.events.emit('escalate:to-strategic', {
          reason: `Consecutive failure threshold reached (${this.consecutiveFailures} failures)`,
          consecutiveFailures: this.consecutiveFailures,
        });
        this.consecutiveFailures = 0;
        return;
      }
    }

    await this.triggerTactical('executor-result');
  }

  private async triggerTactical(trigger: 'executor-result' | 'watchdog' | 'plan-ready'): Promise<void> {
    const triggerStartedAtMs = Date.now();
    const memSnapshot = this.workingMemory.getSnapshot();
    const contextBundle = this.latestContextBundle;
    const perception = this.latestPerceptionSnapshot;
    const activeSubgoal = memSnapshot.activePlan?.subgoals.find((subgoal) => subgoal.id === memSnapshot.activeSubgoalId) ?? null;
    const queueForModel = memSnapshot.actionQueue
      ? {
          ...memSnapshot.actionQueue,
          actions: memSnapshot.actionQueue.actions.slice(0, 3),
        }
      : null;
    const payload = {
      trigger,
      activeGoal: memSnapshot.activePlan?.goal ?? null,
      activeSubgoalId: memSnapshot.activeSubgoalId,
      activeSubgoal: activeSubgoal
        ? {
            id: activeSubgoal.id,
            description: activeSubgoal.description,
            requiredItems: activeSubgoal.requiredItems,
            expectedOutcome: activeSubgoal.expectedOutcome,
            timeoutSeconds: activeSubgoal.timeoutSeconds,
          }
        : null,
      allowedSkills: memSnapshot.activePlan?.allowedSkills ?? [],
      actionQueue: queueForModel,
      recentFailures: (memSnapshot.recentFailures ?? []).slice(-5),
      context: contextBundle
        ? {
            position: contextBundle.snapshot.position,
            currentAction: contextBundle.snapshot.currentAction,
            nearbyEntities: contextBundle.snapshot.nearbyEntities,
            nearbyBlocks: contextBundle.snapshot.nearbyBlocks,
            memory: contextBundle.memory,
          }
        : null,
      detailedPerception: perception
        ? {
            position: perception.position,
            nearbyBlocks: perception.nearbyBlocks.slice(0, 8),
            nearbyEntities: perception.nearbyEntities.slice(0, 8),
            health: perception.health,
            food: perception.food,
          }
        : null,
    };

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: MODEL_B_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify(payload),
      },
    ];

    console.log(`[TacticalPlanner] calling Model B (trigger=${trigger} subgoal=${memSnapshot.activeSubgoalId ?? 'none'})`);
    console.log(`[TacticalPlanner] input-preview ${toPreview(payload)}`);
    const llmStartedAtMs = Date.now();
    const llmResult = await this.llmClient.call(messages);
    const llmLatencyMs = Date.now() - llmStartedAtMs;
    console.log(`[TacticalPlanner] llm-latency trigger=${trigger} ms=${llmLatencyMs}`);

    if (!llmResult.ok) {
      // Structured failure — emit WAIT rather than crashing
      console.warn(
        `[TacticalPlanner] LLM call failed: kind=${llmResult.kind} attempt=${llmResult.attempt} msg=${llmResult.message} elapsedMs=${Date.now() - triggerStartedAtMs}`,
      );
      this.emitWaitQueue(memSnapshot.activeSubgoalId ?? 'none', llmResult.message);
      return;
    }
    console.log(`[TacticalPlanner] raw-output-preview ${toPreview(llmResult.data)}`);

    // Validate schema
    const parsed = TacticalOutputSchema.safeParse(llmResult.data);
    if (!parsed.success) {
      const diagnostics = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      console.warn(`[TacticalPlanner] Schema validation failed: ${diagnostics}`);
      this.emitWaitQueue(memSnapshot.activeSubgoalId ?? 'none', `Schema invalid: ${diagnostics}`);
      return;
    }

    const tacticalOutput = parsed.data;
    let resolvedActions = tacticalOutput.finalQueue as ActionItem[];
    if (resolvedActions.length === 0 && tacticalOutput.queueOps.length > 0) {
      resolvedActions = applyQueueOps(
        memSnapshot.actionQueue?.actions ?? [],
        tacticalOutput.queueOps as Array<{
          op: 'append' | 'prepend' | 'insert' | 'delete' | 'clear';
          action?: ActionItem;
          index?: number;
        }>,
      );
      console.warn(
        `[TacticalPlanner] finalQueue empty; applied queueOps fallback (resolvedActions=${resolvedActions.length})`,
      );
    }
    if (resolvedActions.length > 3) {
      resolvedActions = resolvedActions.slice(0, 3);
      console.warn('[TacticalPlanner] capped action queue to 3 items');
    }
    console.log(
      `[TacticalPlanner] parsed-output queueLen=${resolvedActions.length} ops=${tacticalOutput.queueOps.length} complete=${tacticalOutput.subgoalComplete} escalate=${tacticalOutput.escalate} elapsedMs=${Date.now() - triggerStartedAtMs}`,
    );

    // Check churn threshold
    this.recentChurnCounts.push(tacticalOutput.queueOps.length);
    if (this.recentChurnCounts.length > this.tacticalConfig.churnWindowSize) {
      this.recentChurnCounts.shift();
    }
    const allChurning =
      this.recentChurnCounts.length === this.tacticalConfig.churnWindowSize &&
      this.recentChurnCounts.every((c) => c >= this.tacticalConfig.churnOpsThreshold);
    const now = Date.now();
    if (allChurning && now - this.lastChurnEscalationAt > this.tacticalConfig.churnCooldownMs) {
      this.lastChurnEscalationAt = now;
      this.recentChurnCounts = [];
      this.events.emit('escalate:to-strategic', {
        reason: `Churn threshold: ${this.tacticalConfig.churnWindowSize} consecutive cycles with >= ${this.tacticalConfig.churnOpsThreshold} queue ops`,
        consecutiveFailures: this.consecutiveFailures,
      });
      return;
    }

    // Build and publish the queue
    const queue: ActionQueue = {
      subgoalId: memSnapshot.activeSubgoalId ?? 'none',
      actions: resolvedActions,
      reasoning: tacticalOutput.reasoning,
      subgoalComplete: tacticalOutput.subgoalComplete,
      escalate: tacticalOutput.escalate,
      escalateReason: tacticalOutput.escalateReason,
    };

    this.workingMemory.setActionQueue(queue);
    this.events.emit('tactical:queue-ready', queue);

    if (tacticalOutput.escalate) {
      this.events.emit('escalate:to-strategic', {
        reason: tacticalOutput.escalateReason ?? 'Model B requested escalation',
        consecutiveFailures: this.consecutiveFailures,
      });
    }
  }

  private emitWaitQueue(subgoalId: string, reason: string): void {
    const waitQueue: ActionQueue = {
      subgoalId,
      actions: [{ skill: 'WAIT', params: {}, expectedDurationSeconds: 5 }],
      reasoning: `Parse failure fallback: ${reason}`,
      subgoalComplete: false,
      escalate: false,
      escalateReason: null,
    };
    this.workingMemory.setActionQueue(waitQueue);
    this.events.emit('tactical:queue-ready', waitQueue);
  }
}
