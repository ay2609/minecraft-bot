---
phase: 04-skills-and-executor
plan: 02
subsystem: executor
tags: [movement-coordinator, mutex, arbitration, anti-oscillation, executor]
requires:
  - phase: 04-skills-and-executor
    provides: executor runtime boundary and skill dispatch scaffolding from 04-01
provides:
  - movement coordinator with single active and single pending arbitration
  - move_to and follow_entity routed through coordinator-backed handlers
  - anti-oscillation movement tests for pending replacement, preemption, and stale drop
affects: [phase-04-plan-03, phase-04-plan-04, planner-context, executor-results]
tech-stack:
  added: []
  patterns: [movement-mutex, single-pending-queue, critical-preemption, stale-pending-drop]
key-files:
  created:
    - src/executor/MovementCoordinator.ts
    - src/executor/skills/moveTo.ts
    - src/executor/skills/followEntity.ts
    - src/executor/MovementCoordinator.test.ts
    - src/executor/ExecutorMovement.integration.test.ts
  modified:
    - src/executor/Executor.ts
    - src/executor/SkillRegistry.ts
    - src/executor/types.ts
    - src/config.ts
key-decisions:
  - "Coordinator returns explicit movement arbitration outcomes (executed, dropped, preempted, timed_out) alongside ExecutorErrorCode."
  - "move_to and follow_entity validate minimal param contracts and fail closed when movement coordinator is unavailable."
  - "Pending movement capacity stays fixed at one slot, replacing older pending requests to prevent goal churn."
patterns-established:
  - "Movement arbitration is centralized in MovementCoordinator; movement skills are coordinator clients only."
  - "Conflicting movement requests surface structured interrupted outcomes through executor:result visibility path."
requirements-completed: [EXEC-02, EXEC-03]
duration: 8 min
completed: 2026-03-08
---

# Phase 04 Plan 02: Movement Mutex Summary

**Coordinator-owned movement arbitration with critical preemption, stale pending drops, and shared move/follow pathing to prevent oscillation**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-08T03:41:33Z
- **Completed:** 2026-03-08T03:49:07Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Implemented `MovementCoordinator` enforcing one in-flight movement and one pending request with deterministic replacement behavior.
- Routed `move_to` and `follow_entity` through coordinator-mediated skill handlers wired by `SkillRegistry` and `Executor` dependencies.
- Added anti-oscillation and arbitration tests validating dropped pending, critical preemption, stale pending TTL handling, and no execution churn under conflicts.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement movement coordinator mutex and arbitration policy**
- `a1cedfa` (test): RED movement coordinator mutex tests
- `e8b76a3` (feat): GREEN coordinator/types/config implementation

2. **Task 2: Route move_to and follow_entity through movement coordinator**
- `881598a` (test): RED movement integration tests
- `ddc07d5` (feat): GREEN movement skill routing through coordinator

3. **Task 3: Add mutex and anti-oscillation integration tests**
- `a04dc28` (test): RED anti-oscillation/arbitration assertions
- `299237d` (test): GREEN arbitration metadata + no-churn integration coverage

## Files Created/Modified
- `src/executor/MovementCoordinator.ts` - Movement mutex with single active slot, single pending slot, preemption, and stale-drop logic.
- `src/executor/skills/moveTo.ts` - `move_to` handler routed through coordinator with param validation.
- `src/executor/skills/followEntity.ts` - `follow_entity` handler routed through coordinator with target validation.
- `src/executor/SkillRegistry.ts` - Movement skill resolution now injects coordinator-aware handlers.
- `src/executor/Executor.ts` - Resolver wiring updated to pass executor dependencies through skill resolution.
- `src/executor/types.ts` - Added movement request/coordinator contracts and optional movement arbitration metadata.
- `src/config.ts` - Added movement arbitration config knobs (`pendingTtlMs`, `criticalPreemption`).
- `src/executor/MovementCoordinator.test.ts` - Mutex behavior coverage for pending replacement, preemption, and stale-drop.
- `src/executor/ExecutorMovement.integration.test.ts` - Coordinator mediation and anti-oscillation integration coverage.

## Decisions Made
- Kept movement conflict results normalized to valid `ExecutorErrorCode` values while enriching arbitration semantics via `movement.outcome` metadata.
- Made coordinator dependency explicit for movement skills to avoid hidden multi-writer pathfinder ownership.
- Used one pending slot replacement policy to keep arbitration deterministic and avoid oscillating request backlogs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Lint blocker in Task 2 verification**
- **Found during:** Task 2
- **Issue:** `prefer-const` lint failure in `MovementCoordinator.test.ts` blocked required `npm run lint` verification.
- **Fix:** Changed an un-reassigned `let` binding to `const`.
- **Files modified:** `src/executor/MovementCoordinator.test.ts`
- **Verification:** `npm run typecheck && npm run lint`
- **Committed in:** `ddc07d5`

**2. [Rule 3 - Blocking] Type-level test harness issues in Task 3 verification**
- **Found during:** Task 3
- **Issue:** New anti-oscillation integration test had TypeScript narrowing/call-signature issues that blocked `npm run typecheck`.
- **Fix:** Reworked test deferred control flow into a typed helper and aligned callback signatures.
- **Files modified:** `src/executor/ExecutorMovement.integration.test.ts`
- **Verification:** `npm run typecheck && npm run lint && npx tsx src/executor/MovementCoordinator.test.ts && npx tsx src/executor/ExecutorMovement.integration.test.ts`
- **Committed in:** `299237d`

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Fixes were contained to new test code and did not expand scope; all planned movement mutex outcomes were delivered.

## Issues Encountered
None beyond test/lint blockers resolved inline.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Movement arbitration is now centralized and tested; Phase 04 follow-up plans can add remaining skill runtime implementations on top of this stable mutex path.

---
*Phase: 04-skills-and-executor*
*Completed: 2026-03-08*

## Self-Check: PASSED
- Summary file and all task commits verified.
