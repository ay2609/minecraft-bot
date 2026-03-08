---
phase: 06-strategic-planner-and-autonomous-loop
plan: 03
subsystem: planning
tags: [typescript, strategic-planner, autonomous-loop, event-bus, config]

# Dependency graph
requires:
  - phase: 06-02
    provides: StrategicPlanner class with trigger policies and plan handoff logic
  - phase: 05-llm-client-and-tactical-planner
    provides: FireworksLLMClient, TacticalPlanner, and runtime wiring patterns in index.ts
provides:
  - Strategic config block in Config interface and runtime config object (9 env-var-overridable fields)
  - StrategicPlanner instantiation and lifecycle (start/stop) wired into index.ts
  - strategic:chat-reply event channel for bot chat replies from StrategicPlanner
  - Complete autonomous loop — bot selects and pursues goals on discrete triggers without player commands
affects:
  - phase-07-terminal-ui (config.strategic visible alongside config.tactical)
  - any future plan extending StrategicPlanner trigger logic

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Typed event channel for cross-layer async reply (strategic:chat-reply in BotEvents)"
    - "Config block env-var overrides with parsePositiveNumberEnv and SCREAMING_SNAKE_CASE prefix"
    - "Human-verify checkpoint triggers deferred fix commits before plan closeout"

key-files:
  created: []
  modified:
    - src/config.ts
    - src/index.ts
    - src/events/EventBus.ts
    - src/planner/StrategicPlanner.ts
    - src/planner/strategicSchema.ts
    - src/planner/systemPrompts.ts
    - package.json

key-decisions:
  - "strategic:chat-reply event added to typed BotEvents so StrategicPlanner can emit chat replies without direct bot reference"
  - "requestSummary field in ChatDecisionSchema made optional to allow non-chat-triggered responses to pass schema validation"
  - "package.json start script updated to --env-file=.env so FIREWORKS_API_KEY and server config load automatically without manual export"
  - "Post-wiring fixes committed as a separate fix commit after human-verify checkpoint approval, not amended into task commits"

patterns-established:
  - "Checkpoint-gated fixes: deferred fixes discovered during human verify are committed atomically after approval"
  - "Event channel pattern: StrategicPlanner emits typed events rather than holding direct references to bot or other subsystems"

requirements-completed: [PLAN-03, PLAN-04]

# Metrics
duration: 45min
completed: 2026-03-08
---

# Phase 6 Plan 03: StrategicPlanner Runtime Wiring Summary

**StrategicPlanner wired into index.ts with 9-field strategic config block and strategic:chat-reply event channel — autonomous loop is complete.**

## Performance

- **Duration:** ~45 min (including human-verify checkpoint cycle)
- **Started:** 2026-03-08
- **Completed:** 2026-03-08
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 7

## Accomplishments

- Added `strategic` block to Config interface and config object with 9 fields, each env-var-overridable with a sensible default (STRATEGIC_ prefix convention)
- Replaced the stub `onEscalateToStrategic` listener in index.ts with a real StrategicPlanner instance wired into bot:spawned and shutdownPerception lifecycle
- Added `strategic:chat-reply` typed event to BotEvents and wired `bot.chat()` response handler in index.ts — chat replies now flow from StrategicPlanner to the Minecraft server
- Made `requestSummary` optional in ChatDecisionSchema so non-chat triggers don't fail validation
- Clarified system prompt chat trigger rule with explicit chatDecision field guidance
- Updated package.json start script to use `--env-file=.env` for zero-friction local startup
- Full test suite: 3 test files (28 tests), tsc, eslint — all pass clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Strategic config block in config.ts** - `6dc4c23` (feat)
2. **Task 2: Replace stub with StrategicPlanner wiring in index.ts** - `7ddd03f` (feat)
3. **Task 3: Human verify checkpoint (approved)** - checkpoint pass, no commit
4. **Post-verify fixes (deferred from checkpoint)** - `a09d7fa` (fix)

## Files Created/Modified

- `src/config.ts` - Added `strategic` block to Config interface and config object (9 fields, env-var overridable)
- `src/index.ts` - Instantiates StrategicPlanner, starts/stops in lifecycle, wires strategic:chat-reply handler
- `src/events/EventBus.ts` - Added `strategic:chat-reply: [message: string]` to typed BotEvents interface
- `src/planner/StrategicPlanner.ts` - Emits `strategic:chat-reply` event instead of console.log for chat responses
- `src/planner/strategicSchema.ts` - Made `requestSummary` optional in ChatDecisionSchema
- `src/planner/systemPrompts.ts` - Clarified chat trigger rule with explicit chatDecision field guidance
- `package.json` - Updated start script to `tsx --env-file=.env src/index.ts`

## Decisions Made

- **strategic:chat-reply event channel:** StrategicPlanner holds no direct reference to the bot object. Instead it emits a typed event; index.ts owns the bot and handles the reply. This preserves the EventBus cross-layer boundary established in Phase 1.
- **requestSummary optional:** The ChatDecisionSchema's `requestSummary` field is only meaningful when triggered by chat. Making it optional allows the same schema to validate non-chat responses without forcing the LLM to fabricate a summary string.
- **--env-file=.env in start script:** Eliminates the need to manually `export` env vars or source a shell file before running the bot locally.
- **Fix commit after checkpoint:** Discovered issues during human-verify were committed as a distinct fix commit (a09d7fa) rather than amending task commits — preserves audit trail and avoids rewriting committed history.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] strategic:chat-reply event channel not in plan**
- **Found during:** Human-verify checkpoint (Task 3)
- **Issue:** StrategicPlanner.ts was logging chat responses to console instead of routing them to the bot. The plan's task 2 description didn't specify this event channel.
- **Fix:** Added `strategic:chat-reply` to BotEvents, updated StrategicPlanner to emit it, wired `bot.chat()` handler in index.ts.
- **Files modified:** src/events/EventBus.ts, src/planner/StrategicPlanner.ts, src/index.ts
- **Verification:** Full test suite passes; event is typed and correctly on/off'd in lifecycle
- **Committed in:** a09d7fa (post-verify fix commit)

**2. [Rule 1 - Bug] ChatDecisionSchema requestSummary rejected valid non-chat LLM responses**
- **Found during:** Human-verify checkpoint (Task 3)
- **Issue:** `requestSummary: z.string()` caused schema validation failures when LLM omitted the field on non-chat triggers, producing unnecessary schema errors in logs.
- **Fix:** Changed to `z.string().optional()`.
- **Files modified:** src/planner/strategicSchema.ts
- **Verification:** schema-1 test still passes; non-chat responses no longer fail validation
- **Committed in:** a09d7fa (post-verify fix commit)

**3. [Rule 2 - Missing Critical] System prompt chatDecision guidance was ambiguous**
- **Found during:** Human-verify checkpoint (Task 3)
- **Issue:** Chat trigger rule in MODEL_A_SYSTEM_PROMPT didn't clearly specify all required chatDecision fields, risking LLM omitting requestSummary or responseMessage.
- **Fix:** Added explicit chatDecision example and updated the trigger rule text.
- **Files modified:** src/planner/systemPrompts.ts
- **Committed in:** a09d7fa (post-verify fix commit)

---

**Total deviations:** 3 auto-fixed (1 missing critical event channel, 1 schema bug, 1 missing critical prompt clarity)
**Impact on plan:** All fixes required for correct operation of chat-triggered planning. No scope creep.

## Issues Encountered

The human-verify checkpoint revealed that the chat reply path was incomplete (logging only, not routing to bot). All issues were resolved before checkpoint approval and committed as a post-verify fix batch.

## User Setup Required

None - no new external services required. FIREWORKS_API_KEY from Phase 5 is still the only required env var.

## Next Phase Readiness

- Phase 6 complete: autonomous loop is fully wired (perception → strategic planner → tactical planner → executor → perception)
- Bot selects goals on idle, escalation, survival, and chat triggers without player commands
- Full test suite (28 tests, tsc, eslint) passes clean
- Phase 7 (terminal UI) can now observe StrategicPlanner output via strategic:plan-ready and strategic:chat-reply events

---
*Phase: 06-strategic-planner-and-autonomous-loop*
*Completed: 2026-03-08*
