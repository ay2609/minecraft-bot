# Phase 03 Research: Perception Layer

**Phase:** 03-perception-layer  
**Date:** 2026-03-07  
**Purpose:** Define implementation-ready guidance for delivering `PERC-01`, `PERC-02`, and `PERC-03`.

## Scope and Alignment

Phase 03 must produce a reliable perception pipeline that emits compact, planner-ready snapshots at controlled cadence and assembles memory-aware context for downstream model loops. This phase should not add new skills or planning logic; it provides the state substrate those layers consume.

Key alignment from phase context:
- Emit baseline snapshots at adaptive 1–2 Hz with heartbeat during idle.
- Allow event-level burst emissions with cooldown back to baseline.
- Keep payloads compact and deterministic (no raw state/memory dumps).
- Build context from current snapshot + working memory intent + targeted memory slice.

## Requirement Coverage Matrix

| Requirement | Phase-end evidence |
|---|---|
| `PERC-01` | `PerceptionSnapshot` is generated from live bot/game state and includes required fields (position, health, hunger/food, armor signal, inventory, nearby entities, nearby blocks, current action, recent failures, time-of-day) with deterministic ordering and bounded list sizes. |
| `PERC-02` | Snapshot generation runs via scheduler/event aggregator (not tick-per-event and not ad hoc on-demand), with dedupe/debounce and EventBus emission on `perception:updated`. |
| `PERC-03` | Context assembler outputs compact prompt-ready object composed from snapshot + working memory + relevant semantic/episodic memory; downstream consumers receive only assembled context object. |

## Standard Stack

- Runtime: existing TypeScript + Node.js stack.
- Event transport: existing typed singleton EventBus (`src/events/EventBus.ts`).
- Source of current intent: existing `WorkingMemory` snapshot (`src/memory/WorkingMemory.ts`).
- Persistent context retrieval: existing semantic + episodic repositories (`src/memory/SemanticMemoryRepository.ts`, `src/memory/EpisodicMemoryRepository.ts`).
- Validation: `zod` schemas for perception/context payload boundaries (already dependency).

## Architecture Patterns

1. Event-driven sampler + periodic heartbeat
- Use a perception service that listens to relevant bot events (`bot:spawned`, `bot:chat`, `executor:result`, and mineflayer world/entity change hooks).
- Maintain lightweight dirty flags (inventory changed, health changed, nearby changed, failure changed).
- Run a baseline scheduler (target ~750ms default, adaptive within 500–1000ms) for steady 1–2 Hz cadence.
- Permit urgent event-triggered emission paths (burst mode) with hard cap and cooldown.

2. Snapshot builder with deterministic ordering and bounds
- Build `PerceptionSnapshot` from live bot state + rolling runtime buffers (recent failures, current action).
- Nearby selection policy:
  - entities: nearest-distance, max 12
  - blocks: nearest-distance, max 16
- For ties, stabilize ordering by deterministic secondary keys (name then coordinates).
- Apply payload budget rules before publish (trim long tails first).

3. Context assembler as separate stage
- Stage A: normalize snapshot into concise, token-efficient fields.
- Stage B: attach working memory intent (`activePlan` summary, `activeSubgoalId`, queue head).
- Stage C: attach targeted memory slice by goal/location:
  - semantic: nearest known locations/resources/routes/structures relevant to active goal
  - episodic: recent failures and most relevant successes for current goal type
- Stage D: enforce token/size budget with drop policy (older episodic details first).

4. Emit one canonical object for downstream planning
- Publish `perception:updated` with full snapshot (for observability/debugging).
- Expose or publish a derived `PlannerContextBundle` object for model calls (no raw DB rows, no full inventory metadata beyond compact aggregate).

## Planner-Ready Implementation Guidance

Recommended modules:

1. `src/perception/PerceptionService.ts`
- Owns scheduler, event subscriptions, burst cooldown, dedupe policy, and EventBus emission.
- Public API: `start(bot)`, `stop()`, `getLastSnapshot()`.

2. `src/perception/SnapshotBuilder.ts`
- Pure functions to build `PerceptionSnapshot` from bot/runtime inputs.
- Implements nearest selection, deterministic sort, and compact projection.

3. `src/perception/NearbyScanner.ts`
- Encapsulates entity/block scanning and fallback behavior.
- Includes cost guardrails (scan radius clamp, scan timeout/fallback, stale-cache fallback).

4. `src/perception/ContextAssembler.ts`
- Builds planner context bundle from snapshot + working memory + memory repos.
- Enforces strict output schema and budget constraints.

5. `src/perception/types.ts`
- `PlannerContextBundle`, budget config, and assembler query result types.

6. `src/events/EventBus.ts` update
- Add typed event for assembled context, e.g. `planner:context-ready` (or equivalent), if needed by later phases.

7. `src/config.ts` update
- Add perception config:
  - `baseHzMin`, `baseHzMax`
  - `burstMaxHz`
  - `burstCooldownMs`
  - `nearbyEntityLimit` (default 12)
  - `nearbyBlockLimit` (default 16)
  - `nearbyScanRadius`
  - `contextTokenBudgetApprox`

8. `src/index.ts` integration
- Initialize perception after memory is ready and bot is created.
- Ensure clean shutdown/unsubscribe semantics.

## Data and Budget Policy

Snapshot compactness rules:
- Inventory as item-count map only; no slot-by-slot dump.
- Nearby arrays capped and sorted by distance asc.
- `recentFailures` limited window (for example 5-10 latest).
- `currentAction` from working memory/executor bridge, not inferred ad hoc.

Context compactness rules:
- Always include: snapshot digest + working-memory intent + short memory summary.
- Semantic memory: closest/relevant only (proximity + active goal keyword/type).
- Episodic memory: prioritize recent failures and latest successful analogs.
- Under pressure: drop older episodic details first, then low-confidence semantic details.

## Don’t Hand-Roll

- Do not build ad hoc string prompts in multiple modules; centralize context assembly into one typed object builder.
- Do not emit full mineflayer raw entity/block objects.
- Do not couple perception emission cadence to memory query latency; use cached/async-safe memory attachment path.
- Do not bypass EventBus with direct planner imports.

## Common Pitfalls

1. Per-tick emission flood
- Symptom: high CPU/log spam and unstable downstream model loop.
- Prevention: baseline scheduler + dedupe + burst hard cap.

2. Nondeterministic nearby ordering
- Symptom: prompt churn despite same world state.
- Prevention: stable sort with deterministic tie-breakers.

3. Expensive nearby block scans causing frame lag
- Symptom: cadence jitter and delayed emissions.
- Prevention: radius/limit clamps, timebox scan, fallback to last stable block list.

4. Memory context bloat
- Symptom: prompt length spikes and low-signal context.
- Prevention: relevance filters + strict budget + deterministic drop order.

5. Implicit action/failure tracking
- Symptom: missing/incorrect `currentAction` and failure context.
- Prevention: subscribe explicitly to executor/result events and keep bounded ring buffers.

## Risks and Mitigations

1. Risk: Burst-heavy environments overwhelm downstream consumers.
- Mitigation: `burstMaxHz` hard ceiling, cooldown, and near-duplicate suppression hash.

2. Risk: Nearby block extraction is unstable on some world states.
- Mitigation: introduce scanner fallback mode (entity-only + cached blocks), emit degradation flag in context metadata.

3. Risk: Context assembly blocks emission loop due to DB latency.
- Mitigation: decouple snapshot emission from memory enrichment; memory fetch on separate step with timeout and partial context fallback.

4. Risk: Schema drift between snapshot and planner expectations.
- Mitigation: central zod/type guards and contract tests for snapshot + context bundle.

5. Risk: Overfitting relevance heuristics too early.
- Mitigation: start with deterministic baseline relevance (goal keyword + distance + recency), keep scoring weights configurable.

## Validation Architecture

Validation is split into four layers to protect correctness, cadence behavior, and prompt quality:

1. Contract Validation
- Type-level checks (`tsc`) and runtime schema checks (`zod`) for snapshot/context payloads.
- Assertions that required `PERC-01` fields are always present.

2. Temporal/Cadence Validation
- Simulated clock tests verifying:
  - idle heartbeat at baseline 1–2 Hz
  - no per-tick flood
  - burst spikes obey max-rate cap and cooldown reset

3. Integration Validation
- EventBus integration tests proving `perception:updated` emits on schedule and with event-driven acceleration.
- Context assembler integration tests with seeded memory DB proving compact, relevant outputs.

4. Regression and Budget Validation
- Snapshot size and context-size budget tests with fixed fixtures.
- Determinism tests (same input state => same sorted output/order).

## Verification Strategy

Unit tests:
- `SnapshotBuilder` covers field mapping, nearby caps/order, failure-window truncation.
- `NearbyScanner` covers radius clamp, timeout fallback, deterministic sorting.
- `ContextAssembler` covers relevance filtering, drop policy, compact object shape.
- Deduper/cadence utilities cover debounce and cooldown state transitions.

Integration tests:
- Perception service emits at baseline cadence with idle heartbeat.
- Event-triggered burst emission path activates and returns to baseline.
- Assembled planner context includes working memory + memory slice and excludes raw DB rows.

Manual/UAT checks mapped to IDs:
1. `PERC-01`: run bot in-world, inspect emitted snapshots for required fields and caps.
2. `PERC-02`: verify average emit frequency in idle and active scenarios; confirm EventBus emission.
3. `PERC-03`: inspect planner input payload source and confirm it uses assembled context object only.

Execution commands (current repo):
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Wave Sequencing Recommendations

Wave 1: Snapshot Foundations (`PERC-01`)
- Implement `SnapshotBuilder` + `NearbyScanner` + config defaults.
- Add unit tests for required fields, ordering, and caps.

Wave 2: Cadence and Event Emission (`PERC-02`)
- Implement `PerceptionService` scheduler/debounce/burst/cooldown.
- Wire EventBus `perception:updated` emissions.
- Add cadence simulation tests and integration emission tests.

Wave 3: Context Assembly (`PERC-03`)
- Implement `ContextAssembler` and `PlannerContextBundle` contracts.
- Integrate working memory + semantic/episodic relevance retrieval.
- Add compactness/relevance tests and integration tests with seeded DB.

Wave 4: Hardening and Readiness Gate
- Add budget regressions, degradation flags, and observability hooks.
- Verify end-to-end acceptance against `PERC-01/02/03` with representative runtime traces.

## Open Decisions for Plan Phase

1. Exact burst trigger list (health delta threshold, executor failure types, chat priority events).
2. Whether assembled context should be emitted on EventBus or pulled synchronously by planner loop.
3. Final token budget target for planner context bundle (to align with Phase 5 model limits).
4. Preferred fallback behavior when block scan cost exceeds timeout (cached-only vs reduced radius retry).
