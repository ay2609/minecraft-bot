---
phase: 06-strategic-planner-and-autonomous-loop
plan: 01
subsystem: planner
tags: [zod, schema, validation, system-prompt, llm, strategic-planner]

requires:
  - phase: 05-llm-client-and-tactical-planner
    provides: tacticalSchema.ts pattern (z.object + safeParse), MODEL_B_SYSTEM_PROMPT pattern in systemPrompts.ts

provides:
  - StrategicOutputSchema Zod schema validating Model A JSON output
  - StrategicOutput, GoalPlanSchema, SubgoalSchema, ChatDecisionSchema types
  - MODEL_A_SYSTEM_PROMPT with priority rules, isSurvivalStable guard, and critical progression path
  - strategicSchema.test.ts with 8 boundary test cases

affects:
  - 06-02-PLAN.md (StrategicPlanner imports StrategicOutputSchema and MODEL_A_SYSTEM_PROMPT)

tech-stack:
  added: []
  patterns:
    - "z.array(schema).min(1) pattern to reject empty arrays at schema boundary"
    - "ChatDecisionSchema.nullable() pattern for optional LLM decision objects"

key-files:
  created:
    - src/planner/strategicSchema.ts
    - src/planner/strategicSchema.test.ts
  modified:
    - src/planner/systemPrompts.ts

key-decisions:
  - "GoalPlanSchema enforces .min(1) on subgoals, successConditions, and abortConditions to prevent empty-array contract violations"
  - "ChatDecisionSchema exported separately so StrategicPlanner can validate chatDecision independently if needed"
  - "GoalPlanSchema exported from strategicSchema.ts for direct import by StrategicPlanner (Plan 02)"
  - "MODEL_A_SYSTEM_PROMPT prepended before MODEL_B_SYSTEM_PROMPT in systemPrompts.ts to maintain clear priority ordering"

patterns-established:
  - "Strategic schema mirrors GoalPlan/Subgoal interfaces from src/types/index.ts — schema and types stay in sync"
  - "System prompts include inline JSON schema example for LLM orientation"

requirements-completed: [PLAN-03, PLAN-04]

duration: 2min
completed: 2026-03-08
---

# Phase 6 Plan 01: Strategic Schema and System Prompt Summary

**StrategicOutputSchema Zod schema with .min(1) array guards and MODEL_A_SYSTEM_PROMPT with isSurvivalStable priority rules and Minecraft critical progression path**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-08T16:44:44Z
- **Completed:** 2026-03-08T16:46:31Z
- **Tasks:** 2 (with TDD on Task 1)
- **Files modified:** 3

## Accomplishments

- Created strategicSchema.ts with SubgoalSchema, GoalPlanSchema, ChatDecisionSchema, and StrategicOutputSchema — all with .min(1) array guards
- Created strategicSchema.test.ts with 8 boundary test cases covering empty arrays, enum validation, nullable chatDecision, and missing required fields
- Added MODEL_A_SYSTEM_PROMPT to systemPrompts.ts with survival priority rules, isSurvivalStable guard, Minecraft critical progression path, and a complete example JSON

## Task Commits

Each task was committed atomically:

1. **Task 1: StrategicOutputSchema with boundary tests** - `015b9dd` (feat - TDD green)
2. **Task 2: MODEL_A_SYSTEM_PROMPT in systemPrompts.ts** - `cf67c8d` (feat)

**Plan metadata:** (docs commit follows)

_Note: Task 1 used TDD — tests written first (RED: module-not-found), then schema implemented (GREEN: all 8 pass)._

## Files Created/Modified

- `src/planner/strategicSchema.ts` - Zod schemas: SubgoalSchema, GoalPlanSchema, ChatDecisionSchema, StrategicOutputSchema; StrategicOutput type export
- `src/planner/strategicSchema.test.ts` - 8 boundary test cases using hand-rolled assert pattern (same style as tacticalSchema.test.ts)
- `src/planner/systemPrompts.ts` - MODEL_A_SYSTEM_PROMPT added above MODEL_B_SYSTEM_PROMPT

## Decisions Made

- GoalPlanSchema enforces `.min(1)` on subgoals, successConditions, and abortConditions to prevent empty-array contract violations at the schema boundary
- GoalPlanSchema and ChatDecisionSchema exported from strategicSchema.ts so StrategicPlanner (Plan 02) can import them directly without re-defining types
- MODEL_A_SYSTEM_PROMPT placed before MODEL_B_SYSTEM_PROMPT in systemPrompts.ts for natural read order (Model A = strategic, Model B = tactical)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (StrategicPlanner class) can now import StrategicOutputSchema, GoalPlanSchema, and MODEL_A_SYSTEM_PROMPT directly
- Schema boundary is fully validated — StrategicPlanner only needs to call `StrategicOutputSchema.safeParse(parsed)` on LLM JSON output
- No blockers for Plan 02 execution

---
*Phase: 06-strategic-planner-and-autonomous-loop*
*Completed: 2026-03-08*
