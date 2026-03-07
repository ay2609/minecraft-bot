# Phase 2: Memory Persistence - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement persistent memory foundations so the bot reliably initializes memory systems on startup and retains durable knowledge across restarts. This phase includes working-memory reconstruction policy, SQLite-backed semantic/episodic storage, and restart-safe boot behavior. It does not add new gameplay capabilities.

</domain>

<decisions>
## Implementation Decisions

### Restart behavior
- On restart, keep durable memory (semantic + episodic) available immediately.
- Do not automatically resume in-flight pre-restart action execution.
- Start with a fresh working state after boot, informed by persisted knowledge.
- If persisted state is corrupt/incomplete at boot, fail fast rather than silently continuing.

### State restoration policy
- Working memory should be reconstructed in a controlled way that avoids auto-continuing stale in-flight actions.
- Resume target is knowledge continuity, not action continuity.

### Claude's Discretion
- Conflict handling strategy when persisted state partially mismatches current world state.
- Checkpoint/write cadence for resumable plan state (action-transition vs subgoal-boundary or hybrid).

</decisions>

<specifics>
## Specific Ideas

- "I want it remember things between sessions, but also starting from fresh state. It shouldn't be trying to complete something it was trying to do before it's started back up again. It should remember things it's built or actions it's completed, stuff like that."

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/events/EventBus.ts`: typed singleton pub/sub available for memory lifecycle events (init complete, restore status, persistence failures).
- `src/types/index.ts`: shared contracts already established; memory-facing state and result types can align with this central module.
- `src/config.ts`: existing runtime config module is the natural location for DB path and memory-related runtime knobs.

### Established Patterns
- TypeScript strict mode + ESLint `no-floating-promises` are already enforced; memory initialization and writes should follow explicit async error-boundary patterns.
- Cross-layer communication is EventBus-first (no direct module coupling between planners/executor/perception/memory).
- SQLite via `better-sqlite3` is already a locked architectural decision.

### Integration Points
- Startup flow in `src/index.ts` is the entrypoint for memory initialization ordering before higher-level loops begin.
- EventBus is the integration surface for exposing memory readiness and recovery states to future tactical/strategic layers.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-memory-persistence*
*Context gathered: 2026-03-07*
