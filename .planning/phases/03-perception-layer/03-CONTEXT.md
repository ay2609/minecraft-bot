# Phase 3: Perception Layer - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the perception layer so the bot emits compact `PerceptionSnapshot` updates at controlled cadence and assembles planner-ready context from live state plus relevant memory. This phase is about reliable snapshot quality, debounced/event-aware emission behavior, and token-efficient context composition. It does not add new gameplay capabilities.

</domain>

<decisions>
## Implementation Decisions

### Nearby selection policy
- `nearbyEntities` should use nearest-distance selection with a cap of 12 (not threat-first).
- `nearbyBlocks` should use nearest-distance selection with a cap of 16.
- Use a medium default nearby scan radius.
- Snapshot ordering should be stable/deterministic when candidates are equivalent.
- Perception output must not emit excessive data volume at high frequency.
- Planner context should include broader important world knowledge in addition to nearby blocks.

### Context bundle composition
- Always include: current snapshot + working-memory intent + memory summary.
- Memory attachment should be a small targeted slice relevant to current goal/location.
- Memory content should be structured summaries (not raw DB-style row dumps).
- Under token pressure, drop older episodic detail first.

### Snapshot cadence behavior
- Baseline cadence should be adaptive in the 1–2 Hz range.
- During bursts, event-level emissions are acceptable (no forced coalescing for every burst).
- Idle periods should still emit heartbeat snapshots.
- Cadence should remain independent of memory/query workload (no automatic backpressure coupling).
- Burst mode should return to baseline with a short cooldown.

### Claude's Discretion
- Critical-event override behavior (whether urgent events bypass normal cadence and how often).
- Hard max rate cap during burst-heavy periods.
- Near-duplicate suppression policy for consecutive snapshots.
- Fallback strategy if nearest-block extraction becomes costly or unstable.

</decisions>

<specifics>
## Specific Ideas

- "nearest 16 blocks, but the model should know locations of important stuff in general as well, besides blocks."
- "make sure that the platform isn't trying to send a shit ton of data at a very quick rate."
- "if nearby blocks is difficult to quickly attain and organize, revisit that approach."

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/types/index.ts`: `PerceptionSnapshot`, `NearbyEntity`, `NearbyBlock`, and related planner/executor types are already defined.
- `src/events/EventBus.ts`: typed `perception:updated` event already exists as the perception publication channel.
- `src/memory/index.ts` + repository modules: semantic/episodic memory APIs already available for context assembly inputs.
- `src/index.ts`: startup pipeline already initializes memory first, giving perception a stable base to read from.

### Established Patterns
- EventBus-first cross-layer communication is a locked project pattern.
- Strict TypeScript contracts + lint safety are enforced and should remain for perception emissions and context assembly.
- Raw-state/raw-database dump behavior is explicitly disallowed by roadmap/project constraints.

### Integration Points
- Add perception-layer modules that subscribe to bot/game events and emit `perception:updated` snapshots.
- Connect context assembly to current snapshot + working memory + semantic/episodic query outputs.
- Ensure perception emission behavior aligns with planner consumption expectations before Phase 4/5 loops.

</code_context>

<deferred>
## Deferred Ideas

- Revisit nearby-block extraction strategy if nearest-block collection proves too expensive or unstable in practice.
- Revisit how long-term game progression awareness should be represented to planners if current memory summary proves insufficient.

</deferred>

---

*Phase: 03-perception-layer*
*Context gathered: 2026-03-07*
