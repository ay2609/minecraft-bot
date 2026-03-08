import type OpenAI from 'openai';
import type { TypedEventBus } from '../events/EventBus';
import type { WorkingMemory } from '../memory/WorkingMemory';
import { MODEL_B_SYSTEM_PROMPT } from './systemPrompts';
import { TacticalOutputSchema } from './tacticalSchema';
import type { FireworksLLMClient } from './FireworksLLMClient';
import type { ActionItem, ActionQueue, ExecutorResult } from '../types';
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

export class TacticalPlanner {
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private recentChurnCounts: number[] = [];
  private lastChurnEscalationAt = 0;
  private latestContextBundle: PlannerContextBundle | null = null;

  // Named class property arrow functions — used in BOTH start() and stop() so
  // events.off() receives the same reference that events.on() registered.
  private readonly handleExecutorResult = (result: ExecutorResult): void => {
    void this.onExecutorResult(result);
  };

  private readonly handleContextReady = (bundle: PlannerContextBundle): void => {
    this.latestContextBundle = bundle;
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

  private async triggerTactical(trigger: 'executor-result' | 'watchdog'): Promise<void> {
    const memSnapshot = this.workingMemory.getSnapshot();
    const contextBundle = this.latestContextBundle;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: MODEL_B_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          trigger,
          activeSubgoalId: memSnapshot.activeSubgoalId,
          actionQueue: memSnapshot.actionQueue,
          recentFailures: memSnapshot.recentFailures ?? [],
          context: contextBundle
            ? {
                position: contextBundle.snapshot.position,
                currentAction: contextBundle.snapshot.currentAction,
                nearbyEntities: contextBundle.snapshot.nearbyEntities,
                nearbyBlocks: contextBundle.snapshot.nearbyBlocks,
                memory: contextBundle.memory,
              }
            : null,
        }),
      },
    ];

    const llmResult = await this.llmClient.call(messages);

    if (!llmResult.ok) {
      // Structured failure — emit WAIT rather than crashing
      console.warn(`[TacticalPlanner] LLM call failed: kind=${llmResult.kind} attempt=${llmResult.attempt} msg=${llmResult.message}`);
      this.emitWaitQueue(memSnapshot.activeSubgoalId ?? 'none', llmResult.message);
      return;
    }

    // Validate schema
    const parsed = TacticalOutputSchema.safeParse(llmResult.data);
    if (!parsed.success) {
      const diagnostics = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      console.warn(`[TacticalPlanner] Schema validation failed: ${diagnostics}`);
      this.emitWaitQueue(memSnapshot.activeSubgoalId ?? 'none', `Schema invalid: ${diagnostics}`);
      return;
    }

    const tacticalOutput = parsed.data;

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
      actions: tacticalOutput.finalQueue as ActionItem[],
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
