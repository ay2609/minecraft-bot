---
phase: 04-skills-and-executor
plan: 03
subsystem: executor
tags: [unsafe-policy, non-movement-skills, failure-mapping, movement-metadata, smoke-tests]
requires:
  - phase: 04-skills-and-executor
    provides: movement coordinator mutex and coordinator-routed movement skills from 04-02
provides:
  - high-risk non-movement skill handlers with attempt-derived unsafe semantics
  - deterministic failure mapping precedence for timeout/unsafe/blocked outcomes
  - smoke tests for unsafe-policy classification and runtime stability invariants
affects: [phase-04-plan-04, planner-context, executor-results, movement-observability]
tech-stack:
  added: []
  patterns: [attempt-then-classify, deterministic-failure-precedence, movement-outcome-metadata]
key-files:
  created:
    - src/executor/skills/placeBlock.ts
    - src/executor/skills/breakBlock.ts
    - src/executor/skills/interactBlock.ts
    - src/executor/skills/attackEntity.ts
    - src/executor/skills/sendChat.ts
    - src/executor/UnsafePolicy.smoke.test.ts
    - src/executor/SkillRuntime.smoke.test.ts
  modified:
    - src/executor/SkillRegistry.ts
    - src/executor/failureMapping.ts
    - src/executor/Executor.ts
    - src/executor/Task2.contract.test.ts
    - src/types/index.ts
key-decisions:
  - "High-risk skills reject only hard-invalid requests up front and classify unsafe from attempted execution/post-condition evidence."
  - "Failure mapping now merges structured attempt signals with text patterns and applies deterministic precedence (timed_out > target_unavailable > unsafe > route_blocked)."
  - "Movement arbitration outcomes are preserved in ExecutorResult metadata for planner-visible runtime diagnostics."
patterns-established:
  - "Non-movement handlers follow never-throw structured result contracts with compact planner-usable diagnostics."
  - "Unsafe-policy tests prove no broad global pre-blocking for structurally valid risky actions."
requirements-completed: [EXEC-01, EXEC-02, EXEC-03]
duration: 7 min
completed: 2026-03-08
---

# Phase 04 Plan 03: Unsafe Policy and High-Risk Skills Summary

**Attempt-derived unsafe classification for high-risk non-movement skills with deterministic failure precedence and movement-aware runtime smoke coverage**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-08T03:50:59Z
- **Completed:** 2026-03-08T03:58:00Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments
- Implemented `place_block`, `break_block`, `interact_block`, `attack_entity`, and `send_chat` handlers with hard-invalid prechecks only and attempt-derived unsafe/blocked/target outcome mapping.
- Upgraded failure mapping to consume structured attempt signals plus text evidence with deterministic precedence suitable for planner reuse.
- Added fast smoke checks covering unsafe-policy semantics, structured runtime invariants, and non-movement coexistence with movement mutex behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement high-risk non-movement skill handlers with attempt-derived unsafe semantics**
- `c970d2f` (test): RED unsafe-policy smoke tests
- `08bd489` (feat): GREEN high-risk skill handlers + registry wiring

2. **Task 2: Encode deterministic unsafe and failure precedence mapping**
- `f50ca9f` (test): RED failure precedence contract tests
- `7958c5c` (feat): GREEN structured deterministic failure mapping

3. **Task 3: Add fast smoke checks for unsafe policy and runtime stability**
- `b4aeff5` (test): RED runtime smoke checks
- `f594fce` (feat): GREEN movement outcome metadata propagation

## Files Created/Modified
- `src/executor/skills/placeBlock.ts` - Place flow with attempt/post-condition driven unsafe classification.
- `src/executor/skills/breakBlock.ts` - Break flow with compact structured failure outcomes.
- `src/executor/skills/interactBlock.ts` - Block interaction runtime mapping for target/unsafe/blocked outcomes.
- `src/executor/skills/attackEntity.ts` - Attack handler with target validation and attempt-derived failure semantics.
- `src/executor/skills/sendChat.ts` - Chat handler with lightweight validation and attempt-derived policy outcomes.
- `src/executor/SkillRegistry.ts` - High-risk skill resolution wiring.
- `src/executor/failureMapping.ts` - Deterministic precedence mapping over structured and text signals.
- `src/executor/UnsafePolicy.smoke.test.ts` - Unsafe-policy behavior smoke checks.
- `src/executor/SkillRuntime.smoke.test.ts` - Runtime invariants and movement-stability smoke checks.
- `src/executor/Executor.ts` - Movement outcome metadata propagation in normalized executor results.
- `src/executor/Task2.contract.test.ts` - Deterministic precedence contract assertions.
- `src/types/index.ts` - Executor metadata extension for movement outcomes.

## Decisions Made
- Kept high-risk handler semantics attempt-first for structurally valid requests, preventing broad blanket pre-blocking.
- Treated structured failure hints (`timeout`, `unsafe`, `blocked`, `targetMissing`) as first-class mapping inputs before fallback pattern parsing.
- Preserved movement arbitration details in result metadata to keep planner context compact but actionable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Lint blockers during Wave 3 verification**
- **Found during:** Final verification after Task 3
- **Issue:** `require-await` errors in `UnsafePolicy.smoke.test.ts` and a `no-unnecessary-type-assertion` error in `failureMapping.ts` blocked required lint gate.
- **Fix:** Removed unnecessary `async` callbacks in smoke tests and simplified compact message extraction in failure mapping.
- **Files modified:** `src/executor/UnsafePolicy.smoke.test.ts`, `src/executor/failureMapping.ts`
- **Verification:** `npm run typecheck && npm run lint && npx tsx src/executor/UnsafePolicy.smoke.test.ts && npx tsx src/executor/SkillRuntime.smoke.test.ts`
- **Committed in:** `3017762`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Verification-only fixes in newly changed files; no scope expansion and all required deliverables preserved.

## Issues Encountered
None beyond resolved lint blockers in newly added smoke/mapping code.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Unsafe policy semantics and high-risk non-movement runtime behavior are now deterministic and smoke-tested; plan 04-04 can build additional executor integration without revisiting error semantics.

---
*Phase: 04-skills-and-executor*
*Completed: 2026-03-08*

## Self-Check: PASSED
- Found summary file and all task/deviation commits.
