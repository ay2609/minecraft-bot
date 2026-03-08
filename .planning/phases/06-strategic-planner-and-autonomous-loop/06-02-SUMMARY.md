---
phase: 06-strategic-planner-and-autonomous-loop
plan: 02
subsystem: planner
tags: [strategic-planner, llm, event-driven, trigger-policy, dedup, debounce]

requires:
  - phase: 06-01
    provides: StrategicOutputSchema, ChatDecisionSchema, GoalPlanSchema, MODEL_A_SYSTEM_PROMPT
  - phase: 05-llm-client-and-tactical-planner
    provides: FireworksLLMClient with LLMCallFn injection, TacticalPlanner named-arrow-property pattern

provides:
  - StrategicPlanner class with idle/escalation/survival/chat trigger paths
  - StrategicConfig interface and DEFAULT_STRATEGIC_CONFIG
  - Plan handoff: setPlan → setActiveSubgoal → setActionQueue(null) → emit strategic:plan-ready
  - handleTacticalQueueReady: subgoal advancement without LLM + plan-completion trigger
  - 18-test suite covering all trigger policies, dedup, debounce, handoff order

affects:
  - 06-03 (wires StrategicPlanner into index.ts)

tech-stack:
  added: []
  patterns:
    - Named arrow property handlers on class (handleX = () => ...) for correct events.off() deregistration
    - strategicCallInProgress boolean flag for escalation dedup
    - Time-bucket chat dedup (requestId = username:message:timeBucket)
    - Survival debounce via lastSurvivalTriggerAt timestamp
    - idleCooldownTimer after plan handoff to suppress immediate re-trigger

key-files:
  created:
    - src/planner/StrategicPlanner.ts
    - src/planner/StrategicPlanner.test.ts
  modified: []

key-decisions:
  - "StrategicPlanner mirrors TacticalPlanner named-arrow-property pattern for all event handlers to ensure correct events.off() deregistration in stop()"
  - "strategicCallInProgress guards all trigger paths (escalation, chat, survival, idle) to prevent concurrent LLM calls"
  - "Chat dedup uses 5-second time-bucket requestId rather than content-only hash to handle repeated messages across bucket boundaries naturally"
  - "handleTacticalQueueReady advances activeSubgoal without LLM call for partial completion; only calls triggerStrategic when all subgoals are done"

patterns-established:
  - "Trigger guard pattern: check strategicCallInProgress before calling triggerStrategic in each handler"
  - "Debounce pattern: store lastTriggerAt timestamp, check elapsed > debounceMs before triggering"
  - "Plan handoff order: setPlan → setActiveSubgoal → setActionQueue(null) → emit → startIdleCooldown"

requirements-completed:
  - PLAN-03
  - PLAN-04

duration: 3min
completed: 2026-03-08
---

# Phase 06 Plan 02: StrategicPlanner Summary

**StrategicPlanner class with four trigger paths (idle, escalation, survival, chat), dedup/debounce policies, LLM integration via FireworksLLMClient, and ordered plan handoff to WorkingMemory before emitting strategic:plan-ready**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-08T16:48:30Z
- **Completed:** 2026-03-08T16:51:39Z
- **Tasks:** 1 (TDD: RED commit + GREEN commit)
- **Files modified:** 2

## Accomplishments

- Implemented StrategicPlanner with idle, escalation, survival, and chat trigger paths — each with correct dedup/debounce semantics
- Enforced plan handoff ordering: setPlan → setActiveSubgoal → setActionQueue(null) → emit strategic:plan-ready
- handleTacticalQueueReady advances to next subgoal without LLM when partial completion; calls triggerStrategic('plan-completion') when last subgoal completes
- 18-test suite covers all trigger policies, dedup, debounce, handoff order, schema failure, LLM failure, and stop() cleanup

## Task Commits

1. **Task 1: StrategicPlanner class with trigger tests** - `eaf5c6a` (feat + test)

## Files Created/Modified

- `src/planner/StrategicPlanner.ts` - StrategicPlanner class, StrategicConfig interface, DEFAULT_STRATEGIC_CONFIG export
- `src/planner/StrategicPlanner.test.ts` - 18 unit tests covering all trigger and handoff behaviors

## Decisions Made

- Named arrow property pattern (same as TacticalPlanner) — ensures events.off() receives same reference as events.on()
- strategicCallInProgress flag used as single dedup guard across all trigger paths
- Time-bucket chat dedup: requestId = `${username}:${message}:${bucket}` allows the same message to re-trigger after a new 5-second window
- Subgoal advancement on partial completion is local state mutation only (no LLM) — LLM called only when all subgoals finish (plan-completion)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test chat-2 false failure due to missing plan pre-set**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** chat-2 test did not pre-set a plan before calling planner.start(), causing the idle trigger to fire a spurious LLM call alongside the chat trigger, resulting in callCount=2 instead of 1
- **Fix:** Added `mem.setPlan(plan)` before `planner.start()` and a `callCount = 0` reset after start() settled — consistent with all other trigger isolation tests
- **Files modified:** src/planner/StrategicPlanner.test.ts
- **Verification:** All 18 tests pass
- **Committed in:** eaf5c6a (same task commit)

**2. [Rule 1 - Bug] Fixed eslint errors in LLMCallFn stubs**
- **Found during:** Task 1 (full verification suite)
- **Issue:** makeLLMCallFn and makeErrorLLMCallFn had unused _messages/_modelId parameters and async functions with no await — 6 eslint errors
- **Fix:** Refactored both helpers to use a shared buildCompletion() builder and return Promise.resolve() synchronously — no parameters needed
- **Files modified:** src/planner/StrategicPlanner.test.ts
- **Verification:** eslint reports 0 errors
- **Committed in:** eaf5c6a (same task commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - test correctness)
**Impact on plan:** Both fixes were necessary for test isolation and lint compliance. No behavioral scope creep.

## Issues Encountered

None during implementation. Schema validation, LLM failure handling, and stop() cleanup all worked as designed on first pass.

## Next Phase Readiness

- StrategicPlanner is complete and fully tested
- Plan 03 (index.ts wiring) can proceed immediately — just needs to instantiate StrategicPlanner and call start()/stop() in the bot lifecycle
- No blockers

---
*Phase: 06-strategic-planner-and-autonomous-loop*
*Completed: 2026-03-08*
