import type OpenAI from 'openai';
import type { TypedEventBus } from '../events/EventBus';
import type { WorkingMemory } from '../memory/WorkingMemory';
import { MODEL_A_SYSTEM_PROMPT } from './systemPrompts';
import { StrategicOutputSchema } from './strategicSchema';
import type { StrategicOutput } from './strategicSchema';
import type { FireworksLLMClient } from './FireworksLLMClient';
import type { ActionQueue, GoalPlan, PerceptionSnapshot } from '../types';
import type { PlannerContextBundle } from '../perception/types';

// ──────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────

export interface StrategicConfig {
  idleCooldownMs: number;           // 5000 — suppress idle re-trigger after handoff
  strategicCooldownMs: number;      // 10000 — global minimum between strategic calls
  survivalDebounceMs: number;       // 15000 — minimum interval between survival triggers
  survivalHealthThreshold: number;  // 8
  survivalFoodThreshold: number;    // 4
  stableHealthThreshold: number;    // 16
  stableFoodThreshold: number;      // 14
  chatDedupeBucketMs: number;       // 5000 — time bucket for chat dedup
  chatDedupeMaxEntries: number;     // 50
}

export const DEFAULT_STRATEGIC_CONFIG: StrategicConfig = {
  idleCooldownMs: 5000,
  strategicCooldownMs: 10000,
  survivalDebounceMs: 15000,
  survivalHealthThreshold: 8,
  survivalFoodThreshold: 4,
  stableHealthThreshold: 16,
  stableFoodThreshold: 14,
  chatDedupeBucketMs: 5000,
  chatDedupeMaxEntries: 50,
};

// ──────────────────────────────────────────────────────────────
// StrategicPlanner
// ──────────────────────────────────────────────────────────────

export class StrategicPlanner {
  // Timers
  private idleCooldownTimer: ReturnType<typeof setTimeout> | null = null;

  // State
  private strategicCallInProgress = false;
  private lastSurvivalTriggerAt = 0;
  private readonly processedChatRequests = new Set<string>();
  private latestContextBundle: PlannerContextBundle | null = null;
  private latestPerceptionSnapshot: PerceptionSnapshot | null = null;

  // ── Named arrow property event handlers (for correct events.off() deregistration) ──

  private readonly handleEscalation = (payload: { reason: string; consecutiveFailures: number }): void => {
    if (this.strategicCallInProgress) {
      return;
    }
    void this.triggerStrategic(`escalation: ${payload.reason}`);
  };

  private readonly handleContextReady = (bundle: PlannerContextBundle): void => {
    this.latestContextBundle = bundle;
  };

  private readonly handlePerceptionUpdated = (snapshot: PerceptionSnapshot): void => {
    this.latestPerceptionSnapshot = snapshot;
    this.checkIdleCondition();
    this.checkSurvivalCondition(snapshot);
  };

  private readonly handleBotChat = (payload: { username: string; message: string }): void => {
    const bucket = Math.floor(Date.now() / this.strategicConfig.chatDedupeBucketMs);
    const requestId = `${payload.username}:${payload.message}:${bucket}`;

    if (this.processedChatRequests.has(requestId)) {
      return;
    }

    // Add to set, evict oldest entry if over max
    this.processedChatRequests.add(requestId);
    if (this.processedChatRequests.size > this.strategicConfig.chatDedupeMaxEntries) {
      const firstKey = this.processedChatRequests.values().next().value;
      if (firstKey !== undefined) {
        this.processedChatRequests.delete(firstKey);
      }
    }

    void this.triggerStrategic(`chat: ${payload.message}`);
  };

  private readonly handleBotDeath = (payload: { cause: string; position: { x: number; y: number; z: number } }): void => {
    this.workingMemory.clearExecutionTransients();
    void this.triggerStrategic(`death: ${payload.cause}`);
  };

  private readonly handleTacticalQueueReady = (queue: ActionQueue): void => {
    if (!queue.subgoalComplete) {
      return;
    }

    const snapshot = this.workingMemory.getSnapshot();
    const activePlan = snapshot.activePlan;

    if (activePlan === null) {
      // No active plan — nothing to advance
      return;
    }

    const subgoals = activePlan.subgoals;
    const currentIdx = subgoals.findIndex((sg) => sg.id === snapshot.activeSubgoalId);

    if (currentIdx === -1) {
      // Active subgoal not found in plan
      return;
    }

    const nextSubgoal = subgoals[currentIdx + 1];

    if (nextSubgoal !== undefined) {
      // Advance to next subgoal without calling LLM
      this.workingMemory.setActiveSubgoal(nextSubgoal.id);
    } else {
      // All subgoals complete — trigger strategic planning
      void this.triggerStrategic('plan-completion');
    }
  };

  constructor(
    private readonly llmClient: FireworksLLMClient,
    private readonly workingMemory: WorkingMemory,
    private readonly events: TypedEventBus,
    private readonly strategicConfig: StrategicConfig = DEFAULT_STRATEGIC_CONFIG,
  ) {}

  start(): void {
    this.events.on('escalate:to-strategic', this.handleEscalation);
    this.events.on('planner:context-ready', this.handleContextReady);
    this.events.on('perception:updated', this.handlePerceptionUpdated);
    this.events.on('bot:chat', this.handleBotChat);
    this.events.on('bot:death', this.handleBotDeath);
    this.events.on('tactical:queue-ready', this.handleTacticalQueueReady);

    // Check for idle condition on startup
    this.checkIdleCondition();
  }

  stop(): void {
    if (this.idleCooldownTimer !== null) {
      clearTimeout(this.idleCooldownTimer);
      this.idleCooldownTimer = null;
    }

    // Deregister using the same named references registered in start()
    this.events.off('escalate:to-strategic', this.handleEscalation);
    this.events.off('planner:context-ready', this.handleContextReady);
    this.events.off('perception:updated', this.handlePerceptionUpdated);
    this.events.off('bot:chat', this.handleBotChat);
    this.events.off('bot:death', this.handleBotDeath);
    this.events.off('tactical:queue-ready', this.handleTacticalQueueReady);
  }

  // ── Trigger methods ──────────────────────────────────────────

  private checkIdleCondition(): void {
    const snapshot = this.workingMemory.getSnapshot();
    if (
      snapshot.activePlan === null &&
      this.idleCooldownTimer === null &&
      !this.strategicCallInProgress
    ) {
      void this.triggerStrategic('idle');
    }
  }

  private checkSurvivalCondition(snapshot: PerceptionSnapshot): void {
    const {
      survivalHealthThreshold,
      survivalFoodThreshold,
      survivalDebounceMs,
    } = this.strategicConfig;

    const isSurvivalCondition =
      snapshot.health <= survivalHealthThreshold || snapshot.food <= survivalFoodThreshold;

    const debounceElapsed = Date.now() - this.lastSurvivalTriggerAt > survivalDebounceMs;

    if (isSurvivalCondition && debounceElapsed && !this.strategicCallInProgress) {
      this.lastSurvivalTriggerAt = Date.now();
      void this.triggerStrategic('survival');
    }
  }

  private startIdleCooldown(): void {
    if (this.idleCooldownTimer !== null) {
      clearTimeout(this.idleCooldownTimer);
    }
    this.idleCooldownTimer = setTimeout(() => {
      this.idleCooldownTimer = null;
    }, this.strategicConfig.idleCooldownMs);
  }

  private async triggerStrategic(cause: string): Promise<void> {
    this.strategicCallInProgress = true;

    const memSnapshot = this.workingMemory.getSnapshot();
    const contextBundle = this.latestContextBundle;
    const perceptionSnapshot = this.latestPerceptionSnapshot;
    const { stableHealthThreshold, stableFoodThreshold } = this.strategicConfig;

    const isSurvivalStable = perceptionSnapshot !== null
      ? perceptionSnapshot.health >= stableHealthThreshold &&
        perceptionSnapshot.food >= stableFoodThreshold
      : true;

    const userContext = {
      triggerCause: cause,
      activePlanGoal: memSnapshot.activePlan?.goal ?? null,
      activeSubgoalId: memSnapshot.activeSubgoalId,
      recentFailures: memSnapshot.recentFailures ?? [],
      perception: perceptionSnapshot
        ? {
            health: perceptionSnapshot.health,
            food: perceptionSnapshot.food,
            inventory: perceptionSnapshot.inventory,
            nearbyEntities: perceptionSnapshot.nearbyEntities,
          }
        : null,
      isSurvivalStable,
      memory: contextBundle
        ? {
            semantic: contextBundle.memory.semantic,
            episodic: contextBundle.memory.episodic,
          }
        : null,
    };

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: MODEL_A_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(userContext) },
    ];

    const llmResult = await this.llmClient.call(messages);

    if (!llmResult.ok) {
      console.warn(
        `[StrategicPlanner] LLM call failed: kind=${llmResult.kind} attempt=${llmResult.attempt} msg=${llmResult.message}`,
      );
      this.strategicCallInProgress = false;
      return;
    }

    const parsed = StrategicOutputSchema.safeParse(llmResult.data);
    if (!parsed.success) {
      const diagnostics = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      console.warn(`[StrategicPlanner] Schema validation failed: ${diagnostics}`);
      this.strategicCallInProgress = false;
      return;
    }

    const output: StrategicOutput = parsed.data;

    this.applyPlanHandoff(output.plan);

    // If chat decision includes a response message, emit a send_chat action via events
    if (output.chatDecision?.responseMessage) {
      // Emit as a synthetic action; consumers can handle as appropriate
      // Using bot:chat-reply pattern — no formal event channel for this yet
      console.log(`[StrategicPlanner] Chat response: ${output.chatDecision.responseMessage}`);
    }

    this.strategicCallInProgress = false;
  }

  private applyPlanHandoff(plan: GoalPlan): void {
    // Order: setPlan → setActiveSubgoal → setActionQueue(null) → emit strategic:plan-ready
    this.workingMemory.setPlan(plan);
    this.workingMemory.setActiveSubgoal(plan.subgoals[0].id);
    this.workingMemory.setActionQueue(null);
    this.events.emit('strategic:plan-ready', plan);
    this.startIdleCooldown();
  }
}
