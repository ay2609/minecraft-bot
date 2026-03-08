# Phase 6: Strategic Planner and Autonomous Loop - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement Model A strategic planning so it fires on discrete triggers, selects long-horizon goals, produces structured subgoal sequences, and hands off cleanly to Model B for autonomous execution without command babysitting.

This phase clarifies strategic decision behavior and handoff policy. It does not add new capabilities beyond the Phase 6 roadmap boundary.

</domain>

<decisions>
## Implementation Decisions

### Strategic Trigger Policy
- Idle trigger: fire immediately when no active plan exists, but enforce cooldown to prevent rapid replan loops.
- Escalation trigger: `escalate:to-strategic` should trigger immediate strategic interruption.
- Plan-completion trigger: immediately plan the next goal once completion is confirmed.
- Survival trigger: any survival breach (low health, starvation risk, combat/death signals) should trigger immediate re-evaluation.
- Anti-spam requirement: survival-triggered loops must include throttling/debouncing safeguards.

### Autonomy Priority Policy
- Default priority direction: survival first, then progression, then exploration.
- Guardrail: survival must not permanently dominate and stall progression/exploration; strategy should resume advancement when stable.
- Risk tolerance: balanced (not hyper-conservative, not reckless).
- Exploration policy: exploration should emerge naturally from progression context rather than being forced on a fixed cadence.
- Player chat impact: chat events escalate to strategic; Model A decides switch/defer and records that decision to avoid re-processing the same request repeatedly.

### Strategic-to-Tactical Handoff
- New strategic plan arrival should use graceful replace: finish safe in-flight action, then replace remaining tactical queue.
- Partially completed subgoals should be revalidated and kept/discarded based on alignment with the new plan.
- Replan thrash control: use cooldown + cause tracking for duplicate trigger suppression.
- This throttle is provisional and may be relaxed later if it becomes a bottleneck.
- On chat-driven replan, persist trigger/decision/outcome and send concise acknowledgment when appropriate.

### Claude's Discretion
- Exact cooldown durations and dedupe windows for strategic trigger throttling.
- Heuristic details for deciding when stable-survival conditions allow progression priority to resume.
- Exact schema details for strategic decision records that prevent duplicate chat-request handling.
- Exact wording/conditions for concise chat acknowledgments.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/events/EventBus.ts`: already defines `strategic:plan-ready`, `escalate:to-strategic`, `tactical:queue-ready`, and `bot:chat` event contracts.
- `src/types/index.ts`: existing `GoalPlan` and `Subgoal` types are the core strategic output contract.
- `src/memory/WorkingMemory.ts`: existing `activePlan`, `activeSubgoalId`, `actionQueue`, and failure records can anchor strategic trigger state and handoff decisions.
- `src/planner/TacticalPlanner.ts`: current tactical loop/handoff behavior is already event-driven and escalation-aware.

### Established Patterns
- EventBus-first cross-layer boundaries are mandatory.
- Strict JSON model outputs and typed contracts are non-negotiable.
- Tactical layer already uses cooldown/escalation logic; strategic throttling should align with this style.
- Structured diagnostics over raw dumps is the established pattern.

### Integration Points
- `src/index.ts`: currently contains a strategic escalation stub listener; this is the immediate insertion point for real strategic planner wiring.
- Strategic planner should consume `planner:context-ready`, `executor:result` outcomes, and chat-trigger events via EventBus, then emit `strategic:plan-ready` and update working memory handoff state.
- Tactical planner queue replacement path should integrate with strategic plan-ready events without bypassing executor boundaries.

</code_context>

<specifics>
## Specific Ideas

- "Make sure survival trigger logic doesn’t spam the model."
- "The bot shouldn’t get stuck always trying to keep itself alive."
- "Exploration should happen naturally from progression, not because of arbitrary forced scheduling."
- "If chat triggers a planning decision (switch or defer), persist that outcome so future calls know it was already handled."
- "Bot should speak back when appropriate around chat-driven strategic decisions."

</specifics>

<deferred>
## Deferred Ideas

- If strategic replan throttling becomes a bottleneck, revisit toward lighter/no throttling in a later iteration.
- Rich conversational behavior and broader player-interaction UX remain primarily a later-phase concern (Phase 8 scope).

</deferred>

---

*Phase: 06-strategic-planner-and-autonomous-loop*
*Context gathered: 2026-03-08*
