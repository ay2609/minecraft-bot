# Phase 5: LLM Client and Tactical Planner - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the Fireworks LLM client and Model B tactical loop so executor-result and planner-context inputs produce strict-JSON tactical outputs that manage the action queue end-to-end without crashing or stalling.

</domain>

<decisions>
## Implementation Decisions

### JSON failure and fallback policy
- If Model B returns invalid JSON, perform exactly one retry.
- If parse remains unrecoverable, emit a `WAIT` action rather than crashing/looping.
- Parse diagnostics must be compact and structured (error class/location/attempt count), without raw prompt dumps.
- Escalate after retry budget is exhausted.
- Keep WAIT behavior observable because it may become a bottleneck later.

### Tactical triggering policy
- Model B uses a hybrid trigger model (event-driven plus bounded timer watchdog).
- Primary activation remains executor-result boundaries.
- Add bounded watchdog trigger when no executor results arrive for a while.
- Immediate tactical reconsideration triggers: critical failures and unexpected queue-empty states.
- Player-chat tactical triggering is deferred for this phase (revisit later).

### Queue control policy
- Model B queue control supports append/prepend/insert/delete operations and may cancel currently running actions when needed.
- Start with full queue recomputation after each executor result.
- Keep queue short (target 1-3 actions) for responsiveness.
- Conflict/preemption/drop metadata should trigger immediate tactical replan.
- Urgent actions insert at queue front by default.
- Include both explicit queue-change ops and final queue snapshot in tactical outputs.
- Add churn-threshold escalation if repeated large queue rewrites occur.

### Executor failure handling policy
- For recoverable failures (e.g., `route_blocked`, `target_unavailable`), Model B first tries alternative actions.
- Use consecutive-failure threshold for escalation from Model B to Model A.
- Immediate escalation is required for `invalid_state`; other failure classes stay tactical-first.
- Failure outcomes must be fed back immediately into tactical context/memory for the next Model B step.

### Claude's Discretion
- Exact watchdog interval and churn-threshold default values.
- Compact schema fields for queue ops + final queue representation.
- Detailed mapping of failure-code classes into tactical action heuristics (within the locked escalation rules).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config.ts`: already contains Fireworks endpoint/model and executor config surface; natural place for tactical loop/LLM knobs.
- `src/events/EventBus.ts`: typed channels already exist for `planner:context-ready`, `executor:result`, and `tactical:queue-ready`.
- `src/perception/ContextAssembler.ts`: emits compact `planner:context-ready` payload boundary ready for tactical consumption.
- `src/executor/Executor.ts` + `src/executor/SkillRegistry.ts`: deterministic action execution surface and 10-skill runtime now available.
- `src/memory/WorkingMemory.ts`: existing action queue and execution state can anchor tactical queue state transitions.

### Established Patterns
- Strict TypeScript contracts + no-floating-promises are enforced.
- Structured outcomes and compact diagnostics are preferred over exceptions/raw dumps.
- EventBus-first cross-layer integration is the established architecture.

### Integration Points
- Model B loop should subscribe to `planner:context-ready` and `executor:result`, then publish queue decisions via `tactical:queue-ready`.
- Tactical queue policies should align with existing movement arbitration metadata from Phase 4.
- LLM client output must feed executor `executeAction` contracts without bypassing existing normalization paths.

</code_context>

<specifics>
## Specific Ideas

- Keep immediate `WAIT` fallback for unrecoverable parse failures, but track WAIT frequency as a potential tactical bottleneck.
- Initial tactical policy can recompute full queue each cycle, with a later evolution toward single-next-action operation.
- Longer-term note: enable the bot to figure out new procedures by combining stored knowledge, external lookup, or autonomous trial loops.

</specifics>

<deferred>
## Deferred Ideas

- Revisit chat-triggered tactical calls in a later phase.
- Revisit tactical output mode from full-queue recomputation toward single-next-action control.
- Future capability: structured "learning/figuring out" loop (external lookup and self-experimentation) beyond Phase 5 scope.

</deferred>

---

*Phase: 05-llm-client-and-tactical-planner*
*Context gathered: 2026-03-08*
