# Phase 6: Strategic Planner and Autonomous Loop - Research

**Researched:** 2026-03-08
**Domain:** LLM-driven hierarchical planning, autonomous goal selection, trigger-driven strategic coordination
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Strategic Trigger Policy**
- Idle trigger: fire immediately when no active plan exists, but enforce cooldown to prevent rapid replan loops.
- Escalation trigger: `escalate:to-strategic` should trigger immediate strategic interruption.
- Plan-completion trigger: immediately plan the next goal once completion is confirmed.
- Survival trigger: any survival breach (low health, starvation risk, combat/death signals) should trigger immediate re-evaluation.
- Anti-spam requirement: survival-triggered loops must include throttling/debouncing safeguards.

**Autonomy Priority Policy**
- Default priority direction: survival first, then progression, then exploration.
- Guardrail: survival must not permanently dominate and stall progression/exploration; strategy should resume advancement when stable.
- Risk tolerance: balanced (not hyper-conservative, not reckless).
- Exploration policy: exploration should emerge naturally from progression context rather than being forced on a fixed cadence.
- Player chat impact: chat events escalate to strategic; Model A decides switch/defer and records that decision to avoid re-processing the same request repeatedly.

**Strategic-to-Tactical Handoff**
- New strategic plan arrival should use graceful replace: finish safe in-flight action, then replace remaining tactical queue.
- Partially completed subgoals should be revalidated and kept/discarded based on alignment with the new plan.
- Replan thrash control: use cooldown + cause tracking for duplicate trigger suppression.
- This throttle is provisional and may be relaxed later if it becomes a bottleneck.
- On chat-driven replan, persist trigger/decision/outcome and send concise acknowledgment when appropriate.

### Claude's Discretion
- Exact cooldown durations and dedupe windows for strategic trigger throttling.
- Heuristic details for deciding when stable-survival conditions allow progression priority to resume.
- Exact schema details for strategic decision records that prevent duplicate chat-request handling.
- Exact wording/conditions for concise chat acknowledgments.

### Deferred Ideas (OUT OF SCOPE)
- If strategic replan throttling becomes a bottleneck, revisit toward lighter/no throttling in a later iteration.
- Rich conversational behavior and broader player-interaction UX remain primarily a later-phase concern (Phase 8 scope).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLAN-03 | Model A (strategic loop) runs on discrete triggers (no active plan, escalation from Model B, plan completion, survival threshold); it chooses the current long-horizon goal, produces an ordered subgoal sequence with success and abort conditions, and hands off to Model B; outputs strict JSON | EventBus trigger channels already declared; GoalPlan and Subgoal types fully defined in types/index.ts; zod validation pattern established; FireworksLLMClient injectable and reusable |
| PLAN-04 | When the bot has no active goal and is not in a survival emergency, Model A autonomously selects the next objective based on current world state, memory, and progression heuristics (not just waits for a command) | PerceptionSnapshot health/food fields available for survival detection; WorkingMemory.activePlan null-check is the idle trigger; PlannerContextBundle carries episodic memory for progression heuristics |
</phase_requirements>

---

## Summary

Phase 6 completes the top half of the two-model hierarchy. Phases 1–5 built the infrastructure from the bottom up: memory, perception, executor, and the tactical loop (Model B). Phase 6 adds Model A — the strategic planner that selects long-horizon goals, decomposes them into ordered subgoal sequences, and hands them off to Model B without babysitting the execution.

The codebase is well-prepared for this phase. `GoalPlan` and `Subgoal` types are fully defined in `src/types/index.ts`. The `strategic:plan-ready` and `escalate:to-strategic` EventBus channels are already declared in `src/events/EventBus.ts`. `WorkingMemory` has `setPlan()`, `setActiveSubgoal()`, and `setActionQueue()` methods to anchor strategic state. `src/index.ts` already has a stub `onEscalateToStrategic` listener that is the insertion point for real strategic wiring. `FireworksLLMClient` is injectable (accepts a `callFn` stub) so Model A can reuse it directly with a different system prompt and Zod schema without any client-layer changes.

The primary design challenge is trigger management: four distinct trigger types (idle, escalation, plan-completion, survival) must be consolidated into a single StrategicPlanner class that debounces survival triggers, deduplicates escalations, enforces idle-replan cooldowns, and applies graceful queue replacement on handoff — without letting any single trigger category spam Model A or stall the tactical loop.

**Primary recommendation:** Build `StrategicPlanner` as a single class (mirroring `TacticalPlanner`'s structure) that owns all four trigger paths, a `StrategicConfig` block in `config.ts`, and a Zod schema for Model A's JSON output. Wire it into `src/index.ts` replacing the existing stub.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `openai` | 6.27.0 (installed) | LLM calls via `FireworksLLMClient` | Already in use for Model B — Model A reuses the same client class |
| `zod` | ^4.3.6 (installed) | Runtime validation of Model A JSON output | Established pattern from `tacticalSchema.ts` — validates `GoalPlan` shape |
| TypeScript + tsx | ^5.9.3 / ^4.21.0 (installed) | Type safety, CJS module target | Established project stack |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `setTimeout`/`clearTimeout` | built-in | Survival trigger debounce, idle cooldown timer | Same pattern as TacticalPlanner watchdog |
| EventBus singleton | N/A | All strategic trigger subscriptions and plan-ready emissions | Mandatory — all cross-layer communication goes through EventBus |
| `WorkingMemory` | N/A | Source of truth for active plan, subgoal, and queue state | Read for idle detection; write on plan handoff |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `FireworksLLMClient` for Model A | Separate HTTP client | No benefit — `FireworksLLMClient` accepts a `callFn` injection seam for testing; reuse directly |
| Single-class `StrategicPlanner` | Separate TriggerManager + PlannerCore | Unnecessary split — trigger logic is stateful and tightly coupled to planner state (cooldown timers, last-trigger-cause) |
| Zod schema for Model A output | Manual field checks | Structural error messages, TypeScript inference, consistent with Model B — use Zod |

**Installation:** No new packages needed. All required dependencies are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── planner/
│   ├── FireworksLLMClient.ts         # Existing — unchanged
│   ├── TacticalPlanner.ts            # Existing — unchanged
│   ├── StrategicPlanner.ts           # NEW: Model A class, all trigger paths
│   ├── strategicSchema.ts            # NEW: Zod schema for Model A JSON output
│   ├── systemPrompts.ts              # MODIFIED: add MODEL_A_SYSTEM_PROMPT export
│   ├── StrategicPlanner.test.ts      # NEW: unit tests for trigger policy, handoff
│   ├── strategicSchema.test.ts       # NEW: schema validation tests
│   ├── FireworksLLMClient.ts         # Existing
│   ├── TacticalPlanner.ts            # Existing
│   └── tacticalSchema.ts             # Existing
├── config.ts                         # MODIFIED: add strategic config block
└── index.ts                          # MODIFIED: replace stub with StrategicPlanner wiring
```

### Pattern 1: StrategicPlanner Class Structure

**What:** A class that subscribes to `escalate:to-strategic`, `bot:death`, and `bot:chat` events, polls `WorkingMemory` for the idle condition, runs Model A on discrete triggers, and emits `strategic:plan-ready`.

**When to use:** Instantiated once at startup alongside `TacticalPlanner`.

```typescript
// Source: mirrors TacticalPlanner pattern in src/planner/TacticalPlanner.ts
export class StrategicPlanner {
  private idleCooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStrategicTriggerAt = 0;
  private lastSurvivalTriggerAt = 0;
  private processedChatRequests = new Set<string>(); // dedupe by hash/id
  private latestContextBundle: PlannerContextBundle | null = null;

  // Named arrow function properties for safe events.off() deregistration
  private readonly handleEscalation = (payload: { reason: string; consecutiveFailures: number }): void => {
    void this.onEscalateToStrategic(payload);
  };
  private readonly handleContextReady = (bundle: PlannerContextBundle): void => {
    this.latestContextBundle = bundle;
  };
  private readonly handleBotChat = (payload: { username: string; message: string }): void => {
    void this.onBotChat(payload);
  };
  private readonly handleBotDeath = (payload: { cause: string; position: Vec3Like }): void => {
    void this.onBotDeath(payload);
  };
  private readonly handlePerceptionUpdated = (snapshot: PerceptionSnapshot): void => {
    void this.onPerceptionUpdated(snapshot);
  };

  constructor(
    private readonly llmClient: FireworksLLMClient,
    private readonly workingMemory: WorkingMemory,
    private readonly events: TypedEventBus,
    private readonly strategicConfig: StrategicConfig,
  ) {}

  start(): void {
    this.events.on('escalate:to-strategic', this.handleEscalation);
    this.events.on('planner:context-ready', this.handleContextReady);
    this.events.on('bot:chat', this.handleBotChat);
    this.events.on('bot:death', this.handleBotDeath);
    this.events.on('perception:updated', this.handlePerceptionUpdated);
    // Check for idle condition immediately on start (bot may have no plan from prior state)
    this.scheduleIdleCheck();
  }

  stop(): void {
    if (this.idleCooldownTimer !== null) {
      clearTimeout(this.idleCooldownTimer);
      this.idleCooldownTimer = null;
    }
    this.events.off('escalate:to-strategic', this.handleEscalation);
    this.events.off('planner:context-ready', this.handleContextReady);
    this.events.off('bot:chat', this.handleBotChat);
    this.events.off('bot:death', this.handleBotDeath);
    this.events.off('perception:updated', this.handlePerceptionUpdated);
  }
}
```

### Pattern 2: Four Trigger Paths with Deduplication

**What:** Each trigger type has its own cooldown or deduplication mechanism to prevent spam.

**Trigger inventory:**

| Trigger | EventBus source | Cooldown / Guard |
|---------|----------------|-----------------|
| Idle (no active plan) | `perception:updated` or plan handoff completion | `idleCooldownMs` (recommended: 5000ms); only fires if `activePlan === null` |
| Escalation from Model B | `escalate:to-strategic` | Global `strategicCooldownMs` (recommended: 10000ms); dedup by `reason + consecutiveFailures` |
| Survival breach | `perception:updated` health/food check | `survivalDebounceMs` (recommended: 15000ms); separate timer so survival doesn't block progression recovery |
| Chat escalation | `bot:chat` | Request ID/hash dedup via `processedChatRequests` Set; model decides switch/defer and persists outcome |

**Survival stability heuristic (Claude's discretion):**
- Enter survival mode when: `health <= 8` OR `food <= 4`
- Exit survival mode (allow progression priority to resume) when: `health >= 16` AND `food >= 14` for at least one full strategic cycle

**Idle cooldown recommendation (Claude's discretion):** 5000ms — long enough to avoid re-triggering during tactical plan delivery, short enough to feel responsive.

**Strategic global cooldown recommendation (Claude's discretion):** 10000ms — prevents escalation spam during rapid tactical churn.

### Pattern 3: Model A JSON Schema (Zod)

**What:** A Zod schema that validates the GoalPlan output plus a metadata envelope for strategic decision recording.

```typescript
// Source: GoalPlan type in src/types/index.ts
import { z } from 'zod';

const SubgoalSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  requiredItems: z.record(z.string(), z.number()),
  expectedOutcome: z.string(),
  maxAttempts: z.number().int().positive(),
  timeoutSeconds: z.number().positive(),
});

const GoalPlanSchema = z.object({
  goal: z.string(),
  goalRationale: z.string(),
  priority: z.enum(['survival', 'progression', 'exploration', 'social', 'construction']),
  subgoals: z.array(SubgoalSchema).min(1),
  successConditions: z.array(z.string()).min(1),
  abortConditions: z.array(z.string()).min(1),
  estimatedComplexity: z.enum(['low', 'medium', 'high']),
  allowedSkills: z.array(z.string()),
});

// Strategic output adds decision metadata around the plan
export const StrategicOutputSchema = z.object({
  reasoning: z.string(),
  triggerCause: z.string(),               // What caused this strategic cycle
  plan: GoalPlanSchema,
  chatDecision: z.object({               // null when not chat-triggered
    requestSummary: z.string(),
    decision: z.enum(['switch', 'defer']),
    responseMessage: z.string().nullable(), // null = no chat acknowledgment needed
  }).nullable(),
});

export type StrategicOutput = z.infer<typeof StrategicOutputSchema>;
```

### Pattern 4: Graceful Queue Replacement on Handoff

**What:** When `strategic:plan-ready` fires, the tactical loop should finish any safe in-flight action, then accept the new plan's subgoal sequence.

**How it works:**
1. `StrategicPlanner` emits `strategic:plan-ready` with the new `GoalPlan`.
2. `src/index.ts` handler (or a new `StrategicCoordinator`) receives the plan.
3. Handler calls `workingMemory.setPlan(plan)` to replace the active plan.
4. Handler calls `workingMemory.setActiveSubgoal(plan.subgoals[0].id)` to set the first subgoal.
5. Handler calls `workingMemory.setActionQueue(null)` to clear the stale queue.
6. The existing tactical loop's next `executor:result` or watchdog fire will build a fresh queue targeting the new subgoal.

**Why this is graceful:** `setActionQueue(null)` does not cancel the in-flight action — the executor completes its current skill. The next tactical cycle produces actions for the new goal. No explicit preemption is needed for the common case.

**Exception (survival or death handoff):** On `bot:death`, the executor is already stopped (mineflayer clears physics on death). In this case, call `workingMemory.clearExecutionTransients()` before setting the new plan to ensure no stale in-flight state remains.

### Pattern 5: Model A System Prompt Design

**What:** Model A's system prompt must explicitly encode the autonomy priority order, goal categories, subgoal schema, and chat decision structure.

**Key constraints to encode in prompt:**
- Priority: survival > progression > exploration
- Subgoal IDs must be unique strings (`sg-1`, `sg-2`, ...)
- `abortConditions` must be non-empty (at least one abort condition per plan)
- Chat trigger: always output `chatDecision` field when `triggerCause` contains "chat"
- Survival trigger: do not select survival priority if health >= 16 AND food >= 14
- Keep subgoal count low (2-4 per plan) — tactical loop handles fine-grained steps

**Progression goal sequence for Minecraft critical path:**
1. Gather wood (oak_log x 8) → craft planks → craft crafting_table
2. Craft wooden_pickaxe → mine stone (cobblestone x 12)
3. Craft stone_pickaxe → mine iron_ore
4. (Phase 7 adds recovery; Phase 6 just needs to reach stone tools)

### Anti-Patterns to Avoid

- **Polling WorkingMemory in a tight timer loop for idle detection:** Use `perception:updated` as the idle check trigger — the perception loop already fires at 1-2 Hz, which is sufficient idle detection cadence.
- **Emitting `strategic:plan-ready` without setting WorkingMemory first:** Always update `workingMemory.setPlan()` before emitting the event, so any subscriber that reads memory on the event sees consistent state.
- **Using `clearTimeout` on survival debounce inside escalation handler:** Keep survival timer and escalation cooldown separate — survival debounce is about snapshot-based health checks; escalation cooldown is about Model B escalation signals. Conflating them causes one to block the other.
- **Creating a new Set for processedChatRequests on every cycle:** The Set must persist across cycles. Bound it to prevent unbounded growth (e.g., max 50 entries; evict oldest when full).
- **Letting idle trigger fire while TacticalPlanner is still delivering the first queue after a plan handoff:** Use the `idleCooldownMs` grace period after each `strategic:plan-ready` emission to suppress the next idle trigger.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM API calls for Model A | Separate HTTP client | `FireworksLLMClient` (injectable, already tested) | Retry logic, error classification, and test seam already exist |
| JSON schema validation | Manual field checks on Model A output | `zod` with `StrategicOutputSchema.safeParse()` | Consistent with Model B; structural error messages; inferred types |
| Timer-based cooldown | Custom debounce class | `setTimeout`/`clearTimeout` + timestamp tracking | Same pattern as `TacticalPlanner` watchdog — no abstraction needed |
| Chat request deduplication | SQLite query per chat event | In-memory `Set<string>` with eviction | Chat volume is low; memory-resident dedup is sufficient; SQLite would add async complexity for no benefit |

**Key insight:** The StrategicPlanner's complexity is in trigger policy logic, not in infrastructure. Every infrastructure problem is already solved by existing project components.

---

## Common Pitfalls

### Pitfall 1: Survival Trigger Spam on Low Health

**What goes wrong:** `perception:updated` fires at 1-2 Hz. If `health <= 8`, the survival check fires Model A on every snapshot — producing a new strategic plan every second.

**Why it happens:** No debounce on the survival condition check.

**How to avoid:** Track `lastSurvivalTriggerAt` timestamp. Only fire survival trigger if `Date.now() - lastSurvivalTriggerAt > survivalDebounceMs` (recommend 15000ms). Reset `lastSurvivalTriggerAt` on every survival trigger fire (not on health recovery).

**Warning signs:** Multiple `strategic:plan-ready` events per second in logs.

### Pitfall 2: Idle Trigger Firing While Plan Handoff is Completing

**What goes wrong:** `strategic:plan-ready` fires. `workingMemory.setPlan()` is called. But the next `perception:updated` fires before the tactical loop produces its first queue, so `activePlan` appears set but `actionQueue` is null — the idle condition fires again.

**Why it happens:** Idle detection checks `activePlan === null`, but after a fresh plan handoff, there is a brief window where `activePlan` is set but `actionQueue` is null (not an idle state — just warming up).

**How to avoid:** After emitting `strategic:plan-ready`, start the idle cooldown timer (`idleCooldownMs`). Suppress idle checks during the cooldown window. When the first `executor:result` arrives on the new plan, cancel the cooldown (tactical loop is running).

**Warning signs:** Multiple strategic plans for the same goal in rapid succession.

### Pitfall 3: Escalation Deduplication Missing — Same Escalation Fires Twice

**What goes wrong:** TacticalPlanner emits `escalate:to-strategic` for the same failure twice (e.g., once for consecutive-failure threshold, then again on the next executor result before Model A has responded).

**Why it happens:** Multiple `escalate:to-strategic` events can arrive before Model A produces a plan (LLM call latency is 1-3 seconds). No deduplication at the strategic level.

**How to avoid:** After the first `escalate:to-strategic` is received, set a flag `strategicCallInProgress = true`. Ignore additional escalation events until the LLM call completes and a new plan is emitted. Reset the flag after `strategic:plan-ready` is emitted.

**Warning signs:** Two identical plans in succession in logs.

### Pitfall 4: Chat Decision Not Persisted — Same Request Processed Again

**What goes wrong:** A player sends "go mine some iron". Model A decides to defer (current survival goal takes priority). On the next perception cycle, `bot:chat` has already been replayed through the EventBus and triggers another strategic cycle for the same message.

**Why it happens:** EventBus chat events are not deduplicated at the subscriber level. The `bot:chat` event fires once, but the strategic planner doesn't remember it processed that request.

**How to avoid:** Generate a deterministic ID for each chat request: `"${payload.username}:${payload.message}:${Math.floor(Date.now() / 5000)}"` (5-second bucket). Store in `processedChatRequests` Set. Check before triggering. The 5-second bucket prevents re-processing of fast re-sends while not blocking legitimate follow-up messages.

**Warning signs:** Repeated identical strategic cycles with the same chat message in logs.

### Pitfall 5: GoalPlan Zod Validation Fails on Empty subgoals Array

**What goes wrong:** Model A occasionally outputs an empty `subgoals: []` array (e.g., when confused about what to do next). The plan appears valid JSON but produces a tactical loop with no subgoal to work on.

**Why it happens:** GoalPlan type allows empty subgoals array. Zod schema without `.min(1)` would accept it.

**How to avoid:** Use `z.array(SubgoalSchema).min(1)` on the subgoals field. An empty subgoals plan must be rejected and trigger a WAIT + re-escalation, not silently accepted.

**Warning signs:** Active plan with `activePlan.subgoals.length === 0` in WorkingMemory logs.

### Pitfall 6: Survival Priority Permanent Lock-in

**What goes wrong:** Health drops to 8, survival plan is triggered. Bot eats food, health recovers. But next strategic cycle still selects `priority: 'survival'` because the prompt includes recent episodic failures (fighting mobs) that look threatening.

**Why it happens:** Model A prompt context includes failure history but no explicit "stable" signal. Model A keeps selecting survival out of caution.

**How to avoid:** Include explicit stable-state signals in Model A's context: `isSurvivalStable: health >= 16 && food >= 14`. Encode in system prompt: "If isSurvivalStable is true, do NOT select priority: 'survival' unless a new threat is visible."

**Warning signs:** Priority always `survival` in plan logs even when health/food are high.

---

## Code Examples

Verified patterns from existing codebase:

### EventBus Subscription with Named Arrow Properties (no-floating-promises compliant)

```typescript
// Source: established pattern in src/planner/TacticalPlanner.ts lines 35-41
private readonly handleEscalation = (payload: { reason: string; consecutiveFailures: number }): void => {
  void this.onEscalateToStrategic(payload);
};
// Registered in start(), deregistered in stop() with same reference — correct off() behavior
this.events.on('escalate:to-strategic', this.handleEscalation);
// ...
this.events.off('escalate:to-strategic', this.handleEscalation);
```

### Reading WorkingMemory for Idle Detection

```typescript
// Source: WorkingMemory.getSnapshot() in src/memory/WorkingMemory.ts line 43
private checkIdleCondition(): void {
  const snapshot = this.workingMemory.getSnapshot();
  const isIdle = snapshot.activePlan === null;
  const inCooldown = this.idleCooldownTimer !== null;
  if (isIdle && !inCooldown && !this.strategicCallInProgress) {
    void this.triggerStrategic('idle');
  }
}
```

### Plan Handoff to WorkingMemory

```typescript
// Source: WorkingMemory API in src/memory/WorkingMemory.ts lines 47-63
private applyPlanHandoff(plan: GoalPlan): void {
  this.workingMemory.setPlan(plan);
  const firstSubgoal = plan.subgoals[0];
  if (firstSubgoal) {
    this.workingMemory.setActiveSubgoal(firstSubgoal.id);
  }
  this.workingMemory.setActionQueue(null);
  this.events.emit('strategic:plan-ready', plan);
  // Start idle suppression cooldown after handoff
  this.startIdleCooldown();
}
```

### Survival Condition Check from Snapshot

```typescript
// Source: PerceptionSnapshot fields in src/types/index.ts lines 30-31
private checkSurvivalCondition(snapshot: PerceptionSnapshot): void {
  const inSurvivalBreach = snapshot.health <= 8 || snapshot.food <= 4;
  const cooldownExpired = Date.now() - this.lastSurvivalTriggerAt > this.strategicConfig.survivalDebounceMs;
  if (inSurvivalBreach && cooldownExpired && !this.strategicCallInProgress) {
    this.lastSurvivalTriggerAt = Date.now();
    void this.triggerStrategic('survival');
  }
}
```

### Config Extension for Strategic Block

```typescript
// Source: config.ts pattern — add to Config interface and config object
strategic: {
  idleCooldownMs: number;           // Default: 5000 — suppress idle re-trigger after handoff
  strategicCooldownMs: number;      // Default: 10000 — global cooldown between strategic calls
  survivalDebounceMs: number;       // Default: 15000 — minimum interval between survival triggers
  survivalHealthThreshold: number;  // Default: 8
  survivalFoodThreshold: number;    // Default: 4
  stableHealthThreshold: number;    // Default: 16
  stableFoodThreshold: number;      // Default: 14
  chatDedupeBucketMs: number;       // Default: 5000 — bucket window for chat dedup
  chatDedupeMaxEntries: number;     // Default: 50
}
```

### Zod safeParse Pattern (matches TacticalPlanner)

```typescript
// Source: established pattern in src/planner/TacticalPlanner.ts lines 148-154
const parsed = StrategicOutputSchema.safeParse(llmResult.data);
if (!parsed.success) {
  const diagnostics = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  console.warn(`[StrategicPlanner] Schema validation failed: ${diagnostics}`);
  // Emit WAIT via TacticalPlanner (strategic just doesn't emit a plan — tactical will watchdog)
  return;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Timer-based replanning (replan every N seconds) | Discrete-trigger replanning (idle, escalation, completion, survival) | Phase 6 design | Eliminates unnecessary LLM calls during stable tactical execution |
| Model A calls Model B directly | Model A emits event; Model B subscribes independently | EventBus architecture decision (Phase 1) | Decoupling prevents circular imports and allows test isolation |
| Hard interrupt on new plan | Graceful replace (finish in-flight action) | Phase 6 context decision | Prevents executor mid-action corruption and movement mutex conflicts |

**Deprecated/outdated:**
- `onEscalateToStrategic` stub in `src/index.ts`: Phase 6 replaces this with real `StrategicPlanner` wiring.
- Comment "Phase 6 will handle this" in `src/index.ts` line 356: This is the primary insertion point.

---

## Open Questions

1. **TacticalPlanner subgoal-complete signal path**
   - What we know: `TacticalOutputSchema` includes `subgoalComplete: boolean`. `TacticalPlanner.triggerTactical()` emits `tactical:queue-ready` with the full queue. The queue includes `subgoalComplete` and `escalate` fields.
   - What's unclear: Does the current `index.ts` wiring forward the `subgoalComplete` signal to StrategicPlanner, or does StrategicPlanner need to subscribe to `tactical:queue-ready` directly to detect plan-completion?
   - Recommendation: StrategicPlanner subscribes to `tactical:queue-ready`, checks `queue.subgoalComplete`, advances `workingMemory.setActiveSubgoal()` to the next subgoal, and triggers Model A when all subgoals are complete (plan-completion trigger). This keeps the advancement logic in one place.

2. **Checkpoint persistence on plan handoff**
   - What we know: `WorkingMemory.commitCheckpoint()` exists and takes a `CheckpointRepository`. Phase 2 established that plan state survives restarts via checkpoint records.
   - What's unclear: Should StrategicPlanner call `commitCheckpoint()` after each plan handoff? If so, it needs a reference to `CheckpointRepository`.
   - Recommendation: Yes — commit a checkpoint immediately after setting the new plan in WorkingMemory. This ensures that if the process restarts mid-plan, it resumes from the strategic plan rather than starting blank. Pass `CheckpointRepository` to StrategicPlanner constructor or use the `memory.checkpoint` accessor from `InitializedMemory`.

3. **Model A max_tokens budget**
   - What we know: `FireworksLLMClient` currently sets `max_tokens: 1024`. GoalPlan output (4 subgoals with fields) is approximately 600-800 tokens. StrategicOutputSchema wraps GoalPlan with reasoning and chatDecision.
   - What's unclear: Whether 1024 is sufficient for Model A output, which is more verbose than Model B's queue ops.
   - Recommendation: Increase `max_tokens` to 2048 for Model A calls. Either pass it as a parameter to `FireworksLLMClient.call()` or instantiate a second `FireworksLLMClient` with a different configuration. The former is cleaner — add optional `maxTokens` param to `call()`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in runner (hand-rolled `assert()` + `async run()`) — established project pattern |
| Config file | None — tests run as standalone `npx tsx src/planner/StrategicPlanner.test.ts` |
| Quick run command | `npx tsx src/planner/StrategicPlanner.test.ts && npx tsc --noEmit` |
| Full suite command | `npx tsx src/planner/StrategicPlanner.test.ts && npx tsx src/planner/strategicSchema.test.ts && npx tsx src/planner/TacticalPlanner.test.ts && npx tsc --noEmit && npx eslint src --ext .ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAN-03 | `escalate:to-strategic` triggers Model A call | unit | `npx tsx src/planner/StrategicPlanner.test.ts` | Wave 0 |
| PLAN-03 | Idle condition (activePlan === null) triggers Model A | unit | `npx tsx src/planner/StrategicPlanner.test.ts` | Wave 0 |
| PLAN-03 | Survival breach (health <= 8) triggers Model A | unit | `npx tsx src/planner/StrategicPlanner.test.ts` | Wave 0 |
| PLAN-03 | Plan-completion (all subgoals done) triggers Model A | unit | `npx tsx src/planner/StrategicPlanner.test.ts` | Wave 0 |
| PLAN-03 | Model A emits `strategic:plan-ready` with valid GoalPlan | unit | `npx tsx src/planner/StrategicPlanner.test.ts` | Wave 0 |
| PLAN-03 | Survival trigger respects debounce (does not fire twice within window) | unit | `npx tsx src/planner/StrategicPlanner.test.ts` | Wave 0 |
| PLAN-03 | Escalation dedup: second escalation during in-progress call is ignored | unit | `npx tsx src/planner/StrategicPlanner.test.ts` | Wave 0 |
| PLAN-03 | GoalPlan with empty subgoals[] is rejected by schema | unit | `npx tsx src/planner/strategicSchema.test.ts` | Wave 0 |
| PLAN-03 | StrategicOutputSchema validates all required fields | unit | `npx tsx src/planner/strategicSchema.test.ts` | Wave 0 |
| PLAN-04 | WorkingMemory.activePlan = null triggers autonomy selection | unit | `npx tsx src/planner/StrategicPlanner.test.ts` | Wave 0 |
| PLAN-04 | Stable-survival context produces progression priority (not survival) | unit | `npx tsx src/planner/StrategicPlanner.test.ts` | Wave 0 |
| PLAN-03 + PLAN-04 | End-to-end: idle bot selects wood-gathering goal and tactical loop begins | smoke (live) | Manual / integration environment only | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsx src/planner/StrategicPlanner.test.ts && npx tsc --noEmit`
- **Per wave merge:** Full suite command above
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/planner/StrategicPlanner.ts` — the module under test
- [ ] `src/planner/StrategicPlanner.test.ts` — trigger policy, handoff, dedup, debounce tests
- [ ] `src/planner/strategicSchema.ts` — Zod schema for Model A output
- [ ] `src/planner/strategicSchema.test.ts` — schema validation boundary tests
- [ ] `src/planner/systemPrompts.ts` — add `MODEL_A_SYSTEM_PROMPT` export (file exists, needs modification)
- [ ] `src/config.ts` — add `strategic` config block (file exists, needs modification)
- [ ] `src/index.ts` — replace stub `onEscalateToStrategic` with `StrategicPlanner` wiring (file exists, needs modification)

---

## Sources

### Primary (HIGH confidence)
- `src/events/EventBus.ts` — confirmed: `strategic:plan-ready`, `escalate:to-strategic`, `bot:chat`, `bot:death`, `planner:context-ready`, `perception:updated` channels all declared
- `src/types/index.ts` — confirmed: `GoalPlan`, `Subgoal`, `ActionQueue`, `WorkingMemorySnapshot` types fully defined
- `src/memory/WorkingMemory.ts` — confirmed: `setPlan()`, `setActiveSubgoal()`, `setActionQueue()`, `clearExecutionTransients()`, `getSnapshot()` API surface
- `src/planner/TacticalPlanner.ts` — confirmed: named-arrow-property pattern, watchdog pattern, escalation emission, start/stop lifecycle
- `src/planner/FireworksLLMClient.ts` — confirmed: injectable `callFn` seam, `LLMResult` discriminant union, retry logic
- `src/planner/tacticalSchema.ts` — confirmed: Zod pattern for schema definition
- `src/config.ts` — confirmed: config block pattern; `tactical` block is the template for new `strategic` block
- `src/index.ts` — confirmed: stub listener at line 353-357 is the insertion point; wiring pattern for start/stop/off is established

### Secondary (MEDIUM confidence)
- Phase 5 RESEARCH.md — established Fireworks API patterns; `max_tokens: 1024` for Model B confirmed; Model A may need 2048
- `.planning/REQUIREMENTS.md` — PLAN-03 and PLAN-04 requirements text confirmed; RECV-01 through RECV-04 are Phase 7 (out of scope here)

### Tertiary (LOW confidence)
- Minecraft critical path (wood → stone tools) — based on game knowledge; should be encoded in MODEL_A_SYSTEM_PROMPT and verified against bot behavior in smoke test

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all dependencies confirmed present in project
- Architecture: HIGH — StrategicPlanner mirrors TacticalPlanner, patterns confirmed in source
- Trigger policy: HIGH — all EventBus channels confirmed; WorkingMemory API confirmed
- Pitfalls: HIGH — derived from existing codebase patterns and trigger policy logic; survival spam and idle re-trigger pitfalls are directly observable from code structure
- Model A prompt design: MEDIUM — Minecraft progression sequence is domain knowledge, not verified against live model behavior

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (config defaults are provisional; survival/stable thresholds may need tuning after live testing)
