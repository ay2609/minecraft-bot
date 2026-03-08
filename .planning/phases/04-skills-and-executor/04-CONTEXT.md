# Phase 4: Skills and Executor - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the executor and tool/skill layer so all 10 core skills run against the live server, return structured `ExecutorResult` outcomes (never throw), and enforce movement-mutex behavior that prevents oscillation under concurrent move requests.

</domain>

<decisions>
## Implementation Decisions

### Skill outcome rules
- Success validation should be hybrid by skill: some skills require strict post-condition world checks while lower-risk actions can use lighter validation.
- Partial completion is not success; return a structured failure code that best matches the incomplete outcome.
- Executor should not auto-retry failed actions by default.
- Unsafe conditions must be derived from attempted execution outcomes and post-condition evidence, not broad global pre-blocking of risky actions.

### Movement mutex behavior
- When concurrent `move_to` requests conflict, resolution should be delegated to the thinking/planning layer based on request intent (why each request was made), rather than fixed queue-or-replace behavior only.
- Critical preemption is allowed for higher-priority safety/escape situations.
- Keep at most one pending movement request in queue.
- Stale queued moves should auto-drop.
- Every conflict, drop, timeout, and failed action must be fed back as context so the thinking/planning layer has full action-history visibility.

### Timeout and failure policy
- Use per-skill timeout budgets (configurable per skill).
- Timeouts must always return structured `timed_out` results (no throws).
- Failure-code semantics should be mostly consistent across skills.
- Failure payloads should stay compact and actionable for planner decisions; avoid raw state/db dumps.
- Timeout events must be included in thinking/planner-visible context.

### Claude's Discretion
- Exact per-skill classification table for strict vs lighter success validation.
- Concrete schema fields for compact failure diagnostics (while keeping payloads bounded).
- Specific trigger criteria for "critical" movement preemption.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/types/index.ts`: already defines `ExecutorResult`, `ExecutorErrorCode`, and action contracts that Phase 4 should implement directly.
- `src/events/EventBus.ts`: typed `executor:result` channel already exists for cross-layer result propagation.
- `src/config.ts`: natural place for per-skill timeout and executor behavior knobs.
- `src/memory/WorkingMemory.ts`: existing action queue and intent context can consume executor outcomes.

### Established Patterns
- EventBus-first boundaries are required for cross-layer communication.
- Strict TypeScript contracts and no-floating-promises guardrails are already enforced.
- Structured outcomes over exceptions are a core pattern in prior phases.

### Integration Points
- `src/index.ts` currently wires perception with `executor:result`; executor implementation should plug into this boundary.
- Phase 3 context assembly can include executor outcomes, drops, and timeouts for tactical/strategic reasoning in later phases.
- Future planner phases depend on clean, stable executor result semantics from this phase.

</code_context>

<specifics>
## Specific Ideas

- Conflict handling for movement should account for intent, not only request order.
- Thinking/planning layers should always see dropped/failed/timed-out action history.
- Keep failure payloads compact but decision-useful.
- Up-front blocking should be limited to hard-invalid or impossible requests; risk/unsafe classification is attempt-derived.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-skills-and-executor*
*Context gathered: 2026-03-07*
