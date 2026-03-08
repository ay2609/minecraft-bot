---
phase: 05-llm-client-and-tactical-planner
plan: 01
subsystem: api
tags: [fireworks, openai-sdk, zod, llm, json-parse, retry, discriminated-union]

# Dependency graph
requires:
  - phase: 04-skills-and-executor
    provides: ActionItem and ActionQueue types used in tactical schema
provides:
  - FireworksLLMClient class with structured LLMResult discriminated union
  - TacticalOutputSchema (Zod) validating Model B JSON output shape
  - MODEL_B_SYSTEM_PROMPT string for Model B chat completion calls
  - LLMCallFn injection seam for unit-testing without real API calls
affects:
  - 05-02-tactical-planner
  - 06-strategic-planner

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LLMCallFn injection seam in constructor — pass stub fn in tests, real OpenAI client in prod"
    - "Discriminated union LLMResult — never throws, surfaces all error classes as typed variants"
    - "JSON parse retry — one retry before returning parse_failure; finish_reason=length exits immediately"
    - "Zod safeParse for schema validation with field-level diagnostics via error.issues"

key-files:
  created:
    - src/planner/FireworksLLMClient.ts
    - src/planner/FireworksLLMClient.test.ts
    - src/planner/tacticalSchema.ts
    - src/planner/tacticalSchema.test.ts
    - src/planner/systemPrompts.ts
  modified: []

key-decisions:
  - "FireworksLLMClient uses maxRetries:0 on the OpenAI client to surface RateLimitError immediately — planner manages retries"
  - "finish_reason=length is treated as context_length without consuming a retry — truncated output cannot succeed on retry"
  - "LLMCallFn injection seam chosen over HTTP mocking — cleaner and avoids network layer coupling in tests"
  - "TacticalOutputSchema uses z.discriminatedUnion on 'op' field for QueueOpSchema variants — provides precise field-level error messages"

patterns-established:
  - "Hand-rolled test runner: assert + async run().catch(exit 1) — consistent with project's no-jest/vitest pattern"
  - "Constructor injection seam for testable LLM clients without real API credentials"

requirements-completed: [PLAN-01]

# Metrics
duration: 5min
completed: 2026-03-08
---

# Phase 5 Plan 01: LLM Client and Tactical Schema Summary

**FireworksLLMClient with structured LLMResult union (5 error kinds + success), Zod TacticalOutputSchema, and MODEL_B_SYSTEM_PROMPT — all tested via hand-rolled assert suites without real API calls**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T06:47:21Z
- **Completed:** 2026-03-08T06:52:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Built FireworksLLMClient with JSON parse retry (1 retry max), structured LLMResult discriminated union covering ok, rate_limit, context_length, parse_failure, and api_error paths
- Built TacticalOutputSchema (Zod) with QueueOpSchema discriminated union on 'op' field — full safeParse diagnostics
- Defined MODEL_B_SYSTEM_PROMPT with queue ops semantics, escalation rules, and compact JSON example
- Achieved 100% branch coverage across 7 FireworksLLMClient test cases and 3 tacticalSchema safeParse assertions
- TypeScript clean, ESLint clean (no floating promises)

## Task Commits

Each task was committed atomically:

1. **Task 1: Tactical schema and system prompt** - `2cf74f2` (feat)
2. **Task 2: FireworksLLMClient with retry and structured errors** - `ddcb9b7` (feat)

## Files Created/Modified
- `src/planner/tacticalSchema.ts` - Zod schema for Model B JSON output shape (QueueOpSchema, ActionItemSchema, TacticalOutputSchema, TacticalOutput)
- `src/planner/tacticalSchema.test.ts` - 3 safeParse assertions: valid, missing finalQueue, invalid op value
- `src/planner/systemPrompts.ts` - MODEL_B_SYSTEM_PROMPT with full tactical planner instructions
- `src/planner/FireworksLLMClient.ts` - LLM call + JSON parse + retry + structured error surface; exports FireworksLLMClient and LLMResult
- `src/planner/FireworksLLMClient.test.ts` - 7 test cases covering all LLMResult paths via injected stub callFn

## Decisions Made
- FireworksLLMClient uses `maxRetries: 0` on the OpenAI SDK client to surface `RateLimitError` immediately — the client manages its own retry logic
- `finish_reason='length'` returns `context_length` without consuming a retry — truncated output cannot be fixed by retrying
- LLMCallFn injection seam (optional constructor param) chosen over HTTP mocking — no network layer coupling, cleaner test setup
- `z.discriminatedUnion('op', [...])` for QueueOpSchema gives field-level parse errors pointing to exact op variant mismatches

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Fireworks API key is read from config at runtime, not hardcoded.

## Next Phase Readiness
- FireworksLLMClient and TacticalOutputSchema are ready for the tactical planner (05-02) to consume
- LLMCallFn injection seam means the tactical planner can be unit-tested without real Fireworks API access
- Blocker still present: Fireworks model ID `accounts/fireworks/models/minimax-m2` should be verified before phase 5 integration tests

---
*Phase: 05-llm-client-and-tactical-planner*
*Completed: 2026-03-08*
