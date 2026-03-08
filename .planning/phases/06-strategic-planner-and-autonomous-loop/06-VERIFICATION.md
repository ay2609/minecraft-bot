---
phase: 06-strategic-planner-and-autonomous-loop
verified: 2026-03-08T17:30:00Z
status: human_needed
score: 29/30 must-haves verified
re_verification: false
human_verification:
  - test: "Start bot and verify idle trigger fires within 30 seconds of spawn"
    expected: "Log line containing '[StrategicPlanner] trigger=idle' or similar; if FIREWORKS_API_KEY is set, a plan-ready log follows; if no key, a structured error log with no crash"
    why_human: "Requires a live Minecraft server connection and real bot:spawned lifecycle; cannot be verified without running the full stack"
  - test: "Confirm stub log is absent at runtime"
    expected: "The string '[StrategicPlanner stub] Escalation received' does NOT appear in any log output"
    why_human: "The stub is statically absent from the code (grep confirmed), but the human checkpoint in Plan 03 is the authoritative sign-off for runtime absence"
  - test: "Chat reply routing — StrategicPlanner chat response reaches the Minecraft server"
    expected: "When a player sends a chat message that triggers a strategic plan with chatDecision.responseMessage set, the bot responds in-game via bot.chat()"
    why_human: "The event wiring (strategic:chat-reply -> onStrategicChatReply -> bot.chat()) is present in index.ts but the round-trip requires a live server and a real LLM response with responseMessage populated"
---

# Phase 6: Strategic Planner and Autonomous Loop Verification Report

**Phase Goal:** Implement StrategicPlanner (Model A) that autonomously selects goals on discrete triggers (idle, escalation, survival, chat) and hands them to the tactical loop via WorkingMemory and strategic:plan-ready event.
**Verified:** 2026-03-08T17:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | StrategicOutputSchema accepts a valid GoalPlan envelope with reasoning and triggerCause fields | VERIFIED | strategicSchema.ts: StrategicOutputSchema includes reasoning, triggerCause, plan, chatDecision. Test 1 in strategicSchema.test.ts passes: valid VALID_OUTPUT passes safeParse. |
| 2  | StrategicOutputSchema rejects a plan with empty subgoals array | VERIFIED | GoalPlanSchema uses `z.array(SubgoalSchema).min(1)`. Test 2 passes: empty subgoals fails safeParse with path including 'subgoal'. |
| 3  | StrategicOutputSchema rejects a plan missing abortConditions | VERIFIED | GoalPlanSchema uses `z.array(z.string()).min(1)` for abortConditions. Test 3 passes. |
| 4  | MODEL_A_SYSTEM_PROMPT is exported from systemPrompts.ts and encodes survival > progression > exploration priority order | VERIFIED | systemPrompts.ts line 1: exported const MODEL_A_SYSTEM_PROMPT. Lines 26-28: 'survival ONLY when health <= 8 OR food <= 4', 'MUST NOT select priority: survival' when isSurvivalStable, 'Default priority when stable: progression'. |
| 5  | TypeScript compiles with no errors after adding strategicSchema.ts | VERIFIED | npx tsc --noEmit exits 0, no output. |
| 6  | Idle trigger fires when activePlan is null and no cooldown is active | VERIFIED | StrategicPlanner.ts checkIdleCondition(): checks activePlan === null, idleCooldownTimer === null, !strategicCallInProgress. Test idle-1 passes (plan emitted). |
| 7  | Idle trigger is suppressed for idleCooldownMs after a plan handoff | VERIFIED | applyPlanHandoff() calls startIdleCooldown() after emit. Test idle-3 passes: cooldown active suppresses re-trigger within window. |
| 8  | Escalation trigger is deduplicated — second escalate:to-strategic while strategicCallInProgress is true is ignored | VERIFIED | handleEscalation: returns early if strategicCallInProgress. Test esc-2 passes: callCount === 1. |
| 9  | Survival trigger fires when health <= 8 OR food <= 4 and survivalDebounceMs has elapsed | VERIFIED | checkSurvivalCondition(): checks health/food thresholds, debounce elapsed, !strategicCallInProgress. Tests surv-1 (health=6) and surv-3 (food=3) pass. |
| 10 | Survival trigger does not fire a second time within survivalDebounceMs | VERIFIED | lastSurvivalTriggerAt updated on trigger; debounce check prevents second call. Test surv-2 passes: callCount === 1 with survivalDebounceMs=5000. |
| 11 | Chat trigger generates a deterministic request ID using 5-second time bucket; same message within the bucket is not re-processed | VERIFIED | handleBotChat: requestId = `${username}:${message}:${bucket}` where bucket = Math.floor(Date.now() / chatDedupeBucketMs). Test chat-2 passes: callCount === 1. |
| 12 | On plan handoff, workingMemory.setPlan(), setActiveSubgoal(subgoals[0].id), setActionQueue(null) are called before strategic:plan-ready is emitted | VERIFIED | applyPlanHandoff(): setPlan, setActiveSubgoal, setActionQueue(null), emit in that order. Tests handoff-1, handoff-2, handoff-3 all pass (call order verified). |
| 13 | Model A output failing StrategicOutputSchema.safeParse does not crash — planner logs warning and returns | VERIFIED | triggerStrategic: on !parsed.success logs warning and returns without emitting. Test schema-1 passes: no plan emitted, no crash. |
| 14 | StrategicPlanner.stop() removes all EventBus listeners using the same named arrow-function references | VERIFIED | stop() calls events.off() with same named arrow properties (handleEscalation, handleContextReady, handlePerceptionUpdated, handleBotChat, handleBotDeath, handleTacticalQueueReady) registered in start(). Test stop-1 passes: callCount === 0 after stop(). |
| 15 | When tactical:queue-ready fires with subgoalComplete=true and remaining subgoals exist, activeSubgoal advances without a strategic LLM call | VERIFIED | handleTacticalQueueReady: finds nextSubgoal, calls workingMemory.setActiveSubgoal(nextSubgoal.id) with no LLM call. Test completion-1 passes: activeSubgoalId === 'sg-2', callCount === 0. |
| 16 | When tactical:queue-ready fires with subgoalComplete=true and no remaining subgoals, triggerStrategic is called with 'plan-completion' | VERIFIED | handleTacticalQueueReady: no nextSubgoal → void this.triggerStrategic('plan-completion'). Test completion-2 passes: callCount === 1, planEmitted. |
| 17 | config.ts has a strategic block with all StrategicConfig fields, each with env-var override and default | VERIFIED | config.ts lines 43-53: strategic block in Config interface with 9 fields. Lines 121-131: runtime config with parsePositiveNumberEnv and STRATEGIC_ prefix env vars for all 9 fields. |
| 18 | StrategicPlanner is instantiated in index.ts and started on bot:spawned alongside TacticalPlanner | VERIFIED | index.ts line 349: `new StrategicPlanner(llmClient, memory.workingMemory, eventBus, config.strategic)`. Line 353: `strategicPlanner.start()` inside onBotSpawned alongside tacticalPlanner.start(). |
| 19 | The stub onEscalateToStrategic listener is removed from index.ts | VERIFIED | grep for 'StrategicPlanner stub' and 'onEscalateToStrategic' in index.ts returns no matches. |
| 20 | StrategicPlanner.stop() is called in shutdownPerception alongside tacticalPlanner.stop() | VERIFIED | index.ts lines 412-413: tacticalPlanner.stop() and strategicPlanner.stop() both called in shutdownPerception. |
| 21 | tsc --noEmit and eslint pass clean after wiring | VERIFIED | Both commands exit 0 with no output. |
| 22 | Bot can start and reach the spawned state without crashing | NEEDS HUMAN | Cannot verify without a live Minecraft server connection and real bot lifecycle. Human-verify checkpoint in Plan 03 was approved, per 06-03-SUMMARY.md. |

**Score:** 21/22 automated truths verified; 1 requires human (runtime startup)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/planner/strategicSchema.ts` | Zod schema for Model A JSON output (StrategicOutputSchema, StrategicOutput type) | VERIFIED | File exists, 37 lines. Exports: SubgoalSchema, GoalPlanSchema, ChatDecisionSchema, StrategicOutputSchema, StrategicOutput. All .min(1) guards present. |
| `src/planner/strategicSchema.test.ts` | Schema boundary validation tests | VERIFIED | 8 tests, all pass (exit 0). Covers empty subgoals, empty abortConditions, empty successConditions, invalid priority enum, chatDecision variants, missing decision field. |
| `src/planner/systemPrompts.ts` | MODEL_A_SYSTEM_PROMPT export | VERIFIED | MODEL_A_SYSTEM_PROMPT exported at line 1. Contains 'Model A', 'isSurvivalStable', priority rules, Minecraft critical progression path (Stage 1-3), chat trigger rule, and example JSON. |
| `src/planner/StrategicPlanner.ts` | StrategicPlanner class with all four trigger paths and plan handoff | VERIFIED | 283 lines. Exports: StrategicPlanner, StrategicConfig, DEFAULT_STRATEGIC_CONFIG. All four triggers (idle, escalation, survival, chat), named arrow properties, applyPlanHandoff with correct ordering, strategic:chat-reply emission. |
| `src/planner/StrategicPlanner.test.ts` | Unit tests for trigger policy, dedup, debounce, handoff | VERIFIED | 18 tests, all pass (exit 0). Covers all required behaviors including idle trigger, escalation dedup, survival debounce, chat dedup, handoff order, subgoal advancement, plan-completion, schema failure, LLM failure, stop() cleanup. |
| `src/config.ts` | strategic config block in Config interface and config object | VERIFIED | Lines 43-53: interface. Lines 121-131: runtime object. 9 fields, all env-var overridable with STRATEGIC_ prefix. |
| `src/index.ts` | StrategicPlanner wiring replacing stub | VERIFIED | Import at line 17. Instantiation at line 349. start() at line 353. stop() at line 413. strategic:chat-reply listener wired. Stub completely absent. |
| `src/events/EventBus.ts` | strategic:chat-reply typed event channel | VERIFIED | Line 19: `'strategic:chat-reply': [message: string]` in BotEvents interface. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/planner/StrategicPlanner.ts` | `src/planner/strategicSchema.ts` | `StrategicOutputSchema.safeParse` | WIRED | Line 254: `StrategicOutputSchema.safeParse(llmResult.data)`. Import at line 5. |
| `src/planner/StrategicPlanner.ts` | `src/planner/systemPrompts.ts` | `MODEL_A_SYSTEM_PROMPT as system message` | WIRED | Line 4 import. Line 240: used as `{ role: 'system', content: MODEL_A_SYSTEM_PROMPT }` in messages array. |
| `src/planner/StrategicPlanner.ts` | `src/memory/WorkingMemory.ts` | `setPlan / setActiveSubgoal / setActionQueue` | WIRED | applyPlanHandoff (lines 276-281): workingMemory.setPlan(plan), workingMemory.setActiveSubgoal(plan.subgoals[0].id), workingMemory.setActionQueue(null). |
| `src/planner/StrategicPlanner.ts` | `src/events/EventBus.ts` | `events.emit('strategic:plan-ready', plan)` | WIRED | Line 280: `this.events.emit('strategic:plan-ready', plan)` in applyPlanHandoff. |
| `src/index.ts` | `src/planner/StrategicPlanner.ts` | `new StrategicPlanner(...)` | WIRED | Line 17 import. Line 349 instantiation with correct arguments: llmClient, memory.workingMemory, eventBus, config.strategic. |
| `src/config.ts` | `src/planner/StrategicPlanner.ts` | `Config.strategic satisfies StrategicConfig` | WIRED | Config.strategic interface (9 fields) mirrors StrategicConfig exactly. config.strategic passed to StrategicPlanner constructor at index.ts line 349. tsc --noEmit confirms type compatibility. |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PLAN-03 | 06-01, 06-02, 06-03 | Model A runs on discrete triggers (no active plan, escalation, plan completion, survival threshold); chooses long-horizon goal, produces ordered subgoal sequence with success and abort conditions, hands off to Model B; outputs strict JSON | SATISFIED | StrategicPlanner.ts implements all four triggers. applyPlanHandoff writes to WorkingMemory and emits strategic:plan-ready consumed by TacticalPlanner. StrategicOutputSchema validates strict JSON. All 18 trigger/handoff tests pass. |
| PLAN-04 | 06-01, 06-02, 06-03 | When bot has no active goal and is not in survival emergency, Model A autonomously selects next objective based on world state, memory, and progression heuristics (not waits for command) | SATISFIED | Idle trigger in checkIdleCondition() fires on start() when activePlan === null. MODEL_A_SYSTEM_PROMPT encodes progression heuristics and Minecraft critical path. isSurvivalStable signal distinguishes stable vs emergency. User context JSON includes workingMemory snapshot, perception, and memory bundle. |

No orphaned requirements found. Both PLAN-03 and PLAN-04 are marked Phase 6 in REQUIREMENTS.md and claimed by all three plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/planner/StrategicPlanner.ts` | 247 | `console.warn(...)` for LLM failure | Info | Expected operational logging; not a stub. Planner sets strategicCallInProgress=false and returns cleanly. |
| `src/planner/StrategicPlanner.ts` | 258 | `console.warn(...)` for schema failure | Info | Expected operational logging; not a stub. Planner sets strategicCallInProgress=false and returns cleanly. |

No TODO, FIXME, placeholder, or empty implementation patterns found. No empty return values used as stubs. No handlers that only call `console.log` without real behavior.

### Human Verification Required

#### 1. Bot Startup and Idle Trigger

**Test:** Run `npm start` against a local Minecraft server (with or without FIREWORKS_API_KEY set). Wait 30 seconds after spawn.
**Expected:**
- Bot connects and spawns (bot:spawned fires)
- A log line indicating idle trigger fired appears (StrategicPlanner calls LLM on idle since no active plan)
- If FIREWORKS_API_KEY is set: plan-ready log and tactical loop begins
- If no API key: structured error log, no crash
- The string "[StrategicPlanner stub] Escalation received" does NOT appear in output
**Why human:** Requires a live Minecraft server. The human-verify checkpoint in Plan 03 was marked approved in 06-03-SUMMARY.md, but this verification cannot independently confirm runtime behavior from static analysis.

#### 2. Chat Reply Routing

**Test:** With FIREWORKS_API_KEY set, send a chat message to the bot in-game (e.g., "go mine diamonds"). Wait 5-10 seconds.
**Expected:** If the LLM produces a chatDecision with a non-null responseMessage, the bot replies in the Minecraft chat.
**Why human:** The wiring (strategic:chat-reply → onStrategicChatReply → bot.chat()) is statically verified in index.ts, but the round-trip requires a live server and a real LLM response with responseMessage set.

### Gaps Summary

No automated gaps found. All artifacts exist, are substantive, and are correctly wired. All 26 tests across three test files pass. tsc and eslint are clean. The phase goal is functionally complete.

The only outstanding items are human-verified runtime behaviors (bot startup, idle trigger firing, chat reply routing) that were already approved during the Plan 03 human-verify checkpoint per 06-03-SUMMARY.md.

---

_Verified: 2026-03-08T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
