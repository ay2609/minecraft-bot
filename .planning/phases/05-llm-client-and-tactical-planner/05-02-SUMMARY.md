---
phase: 05-llm-client-and-tactical-planner
plan: 02
subsystem: planner
tags: [fireworks, llm, tactical-planner, event-driven, watchdog, failure-handling, tdd]

# Dependency graph
requires:
  - phase: 05-01
    provides: FireworksLLMClient, TacticalOutputSchema, MODEL_B_SYSTEM_PROMPT, systemPrompts
  - phase: 04-skills-and-executor
    provides: SkillRegistry, ExecutorResult, ActionQueue, ExecutorErrorCode types
  - phase: 03-perception-layer
    provides: PlannerContextBundle, EventBus, planner:context-ready event
  - phase: 02-memory-persistence
    provides: WorkingMemory with getSnapshot/setActionQueue

provides:
  - TacticalPlanner class with start()/stop() lifecycle and all failure policies
  - TacticalConfig interface with watchdog/churn/failure thresholds
  - DEFAULT_TACTICAL_CONFIG with production-safe defaults
  - executeWait WAIT no-op skill handler
  - WorkingMemory.recordFailure() ring buffer method
  - WorkingMemoryFailureRecord type and recentFailures in WorkingMemorySnapshot
  - 9 unit tests covering all trigger and fallback paths

affects:
  - 05-03 (if exists — StrategicPlanner subscribes to escalate:to-strategic)
  - phase 6+ (coordinator, runtime loop)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Named class property arrow functions for stable event listener references (on/off symmetry)
    - WAIT ActionQueue as parse failure fallback (always emits, never drops)
    - Bounded ring buffer (last 10 entries) for WorkingMemory failure tracking
    - TDD with hand-rolled stubs: EventBus stub tracks handlers/emitted events, WorkingMemory stub tracks calls

key-files:
  created:
    - src/planner/TacticalPlanner.ts
    - src/planner/TacticalPlanner.test.ts
    - src/executor/skills/wait.ts
  modified:
    - src/executor/SkillRegistry.ts
    - src/memory/WorkingMemory.ts
    - src/types/index.ts

key-decisions:
  - "Named class property arrow functions for handleExecutorResult/handleContextReady — same reference in start() and stop() for correct events.off() deregistration"
  - "WAIT fallback queue always emitted on LLM failure (parse_failure, api_error, rate_limit, context_length) — tactical:queue-ready is never dropped"
  - "recordFailure() called BEFORE triggerTactical() on failure executor results — ensures next planner:context-ready bundle includes the failure details"
  - "invalid_state errorCode triggers immediate escalation regardless of consecutiveFailures counter"
  - "Churn cooldown (churnCooldownMs) prevents repeated escalations during the same churn episode"

patterns-established:
  - "Pattern: Event handler as private readonly class arrow property for on/off symmetry"
  - "Pattern: Watchdog timer reset on every executor:result so it only fires on silence"
  - "Pattern: Always emit tactical:queue-ready — valid queue or WAIT fallback, never silent"
  - "Pattern: Hand-rolled LLM stub returns Promise.resolve() (not async) to satisfy @typescript-eslint/require-await"

requirements-completed: [PLAN-02]

# Metrics
duration: 18min
completed: 2026-03-08
---

# Phase 05 Plan 02: TacticalPlanner Summary

**Event-driven TacticalPlanner with watchdog, consecutive-failure escalation, churn detection, WAIT fallback, and failure-feedback-before-LLM-call — all 9 TDD tests pass**

## Performance

- **Duration:** 18 min
- **Started:** 2026-03-08T07:00:00Z
- **Completed:** 2026-03-08T07:18:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- TacticalPlanner subscribes to executor:result and planner:context-ready, calls FireworksLLMClient, and emits tactical:queue-ready on every cycle (never drops)
- Three failure policies: invalid_state immediate escalation, consecutive threshold escalation (configurable), and churn escalation (sliding window of large rewrites)
- WAIT no-op skill registered in SkillRegistry; WAIT ActionQueue emitted as parse failure fallback
- WorkingMemory.recordFailure() ring buffer (last 10 entries) added; called before triggerTactical so ContextAssembler picks up failure details in the next context bundle
- Named class property arrow function pattern ensures stop() correctly deregisters both listeners using the same function references registered in start()

## Task Commits

Each task was committed atomically:

1. **Task 1: WAIT no-op skill and SkillRegistry registration** - `583c546` (feat)
2. **Task 2: TacticalPlanner event loop, watchdog, failure policies** - `3e48454` (feat)

## Files Created/Modified

- `src/planner/TacticalPlanner.ts` - Event-driven tactical loop; exports TacticalPlanner and TacticalConfig
- `src/planner/TacticalPlanner.test.ts` - 9 TDD unit tests covering all trigger and fallback paths
- `src/executor/skills/wait.ts` - WAIT no-op skill: sleeps expectedDurationSeconds, returns success:true
- `src/executor/SkillRegistry.ts` - Early-return WAIT guard before CoreSkillName registry lookup
- `src/memory/WorkingMemory.ts` - Added recordFailure() method with 10-entry ring buffer
- `src/types/index.ts` - Added WorkingMemoryFailureRecord type and recentFailures field to WorkingMemorySnapshot

## Decisions Made

- Named class property arrow functions for event handlers ensure `events.off()` in `stop()` receives the exact same reference registered by `events.on()` in `start()` — using `.bind(this)` in `stop()` would create a new object that never matches.
- WAIT ActionQueue is emitted on all LLM failure kinds (parse_failure, api_error, rate_limit, context_length) — tactical:queue-ready is guaranteed to fire every cycle, preventing the executor from stalling.
- `recordFailure()` is called before `triggerTactical()` so the next planner:context-ready bundle always contains the latest failure details.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added recordFailure() to WorkingMemory and WorkingMemoryFailureRecord to types**
- **Found during:** Task 2 (TacticalPlanner implementation)
- **Issue:** Plan's interface block documented `recordFailure` with a note "if it does not exist yet, add it" — WorkingMemory lacked this method and WorkingMemorySnapshot lacked recentFailures
- **Fix:** Added WorkingMemoryFailureRecord type to types/index.ts, added recentFailures: [] to WorkingMemorySnapshot and createInitialState(), added recordFailure() ring buffer (RECENT_FAILURES_LIMIT=10) to WorkingMemory class
- **Files modified:** src/types/index.ts, src/memory/WorkingMemory.ts
- **Verification:** TypeScript compiles clean; test stub uses the same interface
- **Committed in:** 3e48454 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed ESLint violations in test stubs and wait.ts**
- **Found during:** Task 2 (lint check after tests passed)
- **Issue:** LLM stubs used `async call()` with no await (violates @typescript-eslint/require-await); unused params in stubs; wait.ts used underscore-prefix param (not allowed by ESLint config)
- **Fix:** Changed async stubs to return `Promise.resolve()` directly; used `void param` pattern matching existing skills; made Test 9 callback synchronous
- **Files modified:** src/planner/TacticalPlanner.test.ts, src/executor/skills/wait.ts
- **Verification:** `npx eslint src --ext .ts` passes with 0 errors
- **Committed in:** 3e48454 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both auto-fixes required for correctness and lint compliance. No scope creep.

## Issues Encountered

- Project uses CommonJS output (tsconfig target), so top-level `await` in test file causes esbuild error — rewrote test file to use `run().catch()` pattern matching existing test files (FireworksLLMClient.test.ts)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- TacticalPlanner is fully wired: subscribes to executor:result, calls FireworksLLMClient, emits tactical:queue-ready and escalate:to-strategic
- WorkingMemory now tracks recent failures in a bounded ring buffer, ready for ContextAssembler to include in planner:context-ready bundles
- WAIT skill is registered and trackable via executor:result like any other skill
- Ready for Phase 5 wave 3+ or StrategicPlanner integration

---
*Phase: 05-llm-client-and-tactical-planner*
*Completed: 2026-03-08*
