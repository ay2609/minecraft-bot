# Phase 04 Research: Skills and Executor

**Phase:** 04-skills-and-executor  
**Date:** 2026-03-08  
**Purpose:** Define implementation-ready guidance for delivering `EXEC-01`, `EXEC-02`, and `EXEC-03`.

## Scope and Alignment

Phase 04 must add a production executor layer that runs all 10 required skills against live mineflayer state, returns structured `ExecutorResult` objects for every call, and enforces a movement mutex that prevents oscillation under conflicting movement requests.

This phase should not introduce strategic/tactical model logic. It must establish the deterministic action runtime contract those later phases rely on.

## Requirement Coverage Matrix

| Requirement | Phase-end evidence |
|---|---|
| `EXEC-01` | `SkillRegistry` exposes all 10 skills (`move_to`, `follow_entity`, `place_block`, `break_block`, `craft_item`, `drop_item`, `equip_item`, `interact_block`, `attack_entity`, `send_chat`) through one typed executor entrypoint. |
| `EXEC-02` | Every invocation returns `ExecutorResult` (never throws), supports per-skill timeout budgets, and maps runtime failures into the 10 allowed `ExecutorErrorCode` values. |
| `EXEC-03` | Movement coordinator serializes pathfinder goals, allows one pending move intent, supports critical preemption, and emits conflict/drop/timeout outcomes without oscillation. |

## Standard Stack

- Runtime and contracts:
  - Existing TypeScript contracts in `src/types/index.ts` (`ActionItem`, `ExecutorResult`, `ExecutorErrorCode`).
  - Existing typed EventBus channel `executor:result` in `src/events/EventBus.ts`.
- Core runtime libraries:
  - `mineflayer@4.35.0`
  - `mineflayer-pathfinder@2.4.5`
  - Installed helper plugins already available for selective use:
    - `mineflayer-collectblock@1.6.0`
    - `mineflayer-auto-eat@5.0.3`
- Existing app integration anchors:
  - `src/index.ts` already subscribes to `executor:result` to track recent failures for perception.
  - `src/memory/WorkingMemory.ts` already has execution fields (`inFlightAction`, `lockedSkill`) for mutex state.

## Architecture Patterns

1. Skill adapter boundary with normalized result contract
- Add `src/executor/SkillRegistry.ts` as the single lookup table from skill name to implementation.
- Add one adapter interface for all skills:
  - input: `ActionItem`, runtime context (`bot`, `eventBus`, `workingMemory`, config, movement coordinator).
  - output: `Promise<ExecutorResult>` (never reject to caller).
- Each skill implementation can use internal throws/rejections, but registry wrapper converts all errors to `ExecutorResult`.

2. Central executor with guaranteed “never throw” semantics
- Add `src/executor/Executor.ts` with one method like `execute(actionItem): Promise<ExecutorResult>`.
- Always wrap skill execution in:
  - timeout guard,
  - result normalization,
  - post-condition validation,
  - final emission on `eventBus.emit('executor:result', result)`.
- Fail-closed on unknown skill to `invalid_state` result, not exceptions.

3. Movement mutex as a dedicated coordinator (not inline in `move_to`)
- Add `src/executor/MovementCoordinator.ts` that owns all pathfinder goal transitions.
- Rules aligned to context decisions:
  - exactly one active movement,
  - at most one pending movement request,
  - stale pending request auto-drop,
  - optional critical preemption path (safety/escape priority),
  - every arbitration outcome produces structured telemetry/result context.
- `move_to` and `follow_entity` both route through this coordinator.

4. Skill-specific validators with strict/light modes
- Add `src/executor/validators.ts` for post-condition checks.
- Strict validation for world-mutating skills (`place_block`, `break_block`, `craft_item`, `drop_item`, `equip_item`, `interact_block`, `attack_entity`).
- Lighter validation for low-risk side effects (`send_chat`) and pathing completion states (`move_to`, `follow_entity`) where pathfinder already guarantees reach semantics.
- Partial completion maps to failure (never success) per phase decisions.

5. Config-first timeout and executor knobs
- Extend `src/config.ts` with executor config section:
  - per-skill timeout seconds,
  - mutex pending TTL,
  - critical preemption policy,
  - movement think/search tuning overrides.
- Keep defaults deterministic and conservative; no auto-retry by default.

## Implementation Targets (Practical)

1. `src/executor/Executor.ts`
- Owns `execute(actionItem)` and end-to-end lifecycle.
- Writes compact diagnostics only (`errorCode`, short reason, optional target identifiers).

2. `src/executor/SkillRegistry.ts`
- Maps required 10 skill names to handlers.
- Rejects unknown skills as `invalid_state`.

3. `src/executor/MovementCoordinator.ts`
- Owns pathfinder locking, pending queue (max 1), preemption checks, and stale drop logic.

4. `src/executor/skills/*.ts`
- One file per skill for clear ownership and testability:
  - `moveTo.ts`, `followEntity.ts`, `placeBlock.ts`, `breakBlock.ts`, `craftItem.ts`, `dropItem.ts`, `equipItem.ts`, `interactBlock.ts`, `attackEntity.ts`, `sendChat.ts`.

5. `src/executor/failureMapping.ts`
- Converts mineflayer/pathfinder conditions to `ExecutorErrorCode` + compact messages.

6. `src/executor/types.ts`
- Internal runtime context types and typed skill params guards.

7. `src/config.ts`
- Add `executor` section for timeout budgets and mutex policy.

8. `src/index.ts`
- Initialize executor with bot/memory/event bus and wire tactical trigger path (placeholder for Phase 5 tactical loop).

## Real-Condition Failure Mapping Strategy

Use a two-stage mapping:
1. Detect concrete runtime condition from skill execution and engine signals.
2. Collapse into allowed `ExecutorErrorCode` set with deterministic precedence.

Precedence (most specific first):
1. `timed_out`
2. `interrupted`
3. `target_unavailable`
4. `insufficient_materials`
5. `inventory_full`
6. `tool_missing`
7. `no_path`
8. `route_blocked`
9. `unsafe`
10. `invalid_state`

Mapping anchors:
- Pathfinder `goto` rejection:
  - `NoPath` => `no_path`
  - `Timeout` => `route_blocked` (path computation failed inside budget)
  - `GoalChanged`/`PathStopped` => `interrupted`
- Pathfinder runtime events:
  - `path_reset: stuck` => `route_blocked`
  - `path_reset: no_scaffolding_blocks` => `insufficient_materials`
  - `path_reset: dig_error` => `tool_missing` if best-tool unavailable, else `route_blocked`
  - `path_reset: place_error` => `invalid_state` unless inventory shortage detected (`insufficient_materials`)
- Mineflayer action conditions:
  - target block/entity missing/null at execution time => `target_unavailable`
  - no matching recipe from `recipesFor(...)` => `insufficient_materials`
  - equip/drop/craft with incompatible inventory state => `invalid_state`
  - dig/place blocked by hazard rule (lava/drop/fall-risk) => `unsafe`

Compact diagnostic payload policy:
- Include only planner-useful fields in `errorMessage` (target id/name, distance class, short reason token).
- Do not include raw stack traces or raw world dumps in `ExecutorResult`.

## Skill Notes by Requirement

### `EXEC-01`: Required skill coverage

- `move_to`: pathfinder `GoalNear` with movement mutex.
- `follow_entity`: pathfinder `GoalFollow` (dynamic goal; cancel cleanly on target lost).
- `place_block`: ensure placeable face and item availability before `bot.placeBlock`.
- `break_block`: guard against concurrent dig; validate block actually removed.
- `craft_item`: resolve recipe via `bot.recipesFor`; ensure table path if required.
- `drop_item`: use `bot.toss`/`bot.tossStack`; validate inventory delta.
- `equip_item`: use `bot.equip`; validate `bot.heldItem`/equipment slot post-condition.
- `interact_block`: use `bot.activateBlock`; treat missing block as `target_unavailable`.
- `attack_entity`: select target entity and perform `bot.attack`; validate target still valid.
- `send_chat`: use `bot.chat` with lightweight validation (message accepted and locally emitted).

### `EXEC-02`: Structured outcomes and timeout discipline

- Executor wrapper owns a per-skill timeout race and always returns `ExecutorResult` on every code path.
- No uncaught throw from skill handlers may escape.
- `durationMs` must represent full wall-clock runtime including validation.
- Every failure path must set both:
  - `success: false`
  - non-null `errorCode`.

### `EXEC-03`: Movement mutex and anti-oscillation

- Do not call `bot.pathfinder.setGoal` from multiple skill handlers directly.
- All movement requests pass through coordinator lock.
- Conflict policy from phase context:
  - queue one pending request,
  - allow intent-based preemption for critical safety class,
  - auto-drop stale queued requests,
  - emit explicit outcomes for queued, dropped, interrupted, and preempted transitions.

## Mineflayer/Pathfinder Integration Notes

- `mineflayer-pathfinder` `goto(goal)` resolves on `goal_reached`, rejects on `NoPath`, `Timeout`, `GoalChanged`, or `PathStopped`; these are stable anchors for error-code mapping.
- `path_reset` reasons include `stuck`, `dig_error`, `no_scaffolding_blocks`, `place_error`; these should be captured by movement coordinator telemetry to enrich failure classification.
- `bot.pathfinder.stop()` emits `path_stop` and should be the default graceful cancel path; `setGoal(null)` is immediate hard stop.
- `bot.dig` can emit `diggingAborted` when called concurrently; map this to `interrupted`/`invalid_state` depending on lock ownership.
- `bot.recipesFor(...)` should be used as preflight for craft feasibility before committing movement to crafting table.
- For entity skills (`follow_entity`, `attack_entity`), entity references can go stale between selection and execution; re-resolve by id just before action.

## Risk Areas and Mitigations

1. Error-code drift across skills
- Risk: each skill invents custom mapping logic and semantics diverge.
- Mitigation: enforce shared `failureMapping.ts` and contract tests for all codes.

2. Movement oscillation under concurrent tactical requests
- Risk: alternating `setGoal` calls produce thrashing.
- Mitigation: single movement coordinator with lock + one pending slot + stale drop + explicit preemption policy.

3. False-positive successes
- Risk: action promise resolves but world did not change as expected.
- Mitigation: validator layer with strict post-conditions for mutating skills.

4. Timeout ambiguity
- Risk: mixed internal timeouts from pathfinder and executor cause inconsistent outcomes.
- Mitigation: executor owns authoritative wall-clock timeout and normalizes internal timeout signals.

5. Oversized failure payloads polluting planner context
- Risk: unbounded diagnostics bloat later prompts.
- Mitigation: compact message schema; no raw state dumps in `ExecutorResult`.

6. Stale target race conditions
- Risk: target block/entity gone during execution causing uncaught exceptions.
- Mitigation: revalidate targets immediately before side-effectful calls; map to `target_unavailable`.

## Validation Architecture

This section defines the validation layers to support downstream Nyquist template generation.

1. Contract Validation
- Static: type-level assertions for full `ExecutorErrorCode` union usage and `ExecutorResult` non-throw guarantee boundaries.
- Runtime: schema checks for outbound `ExecutorResult` shape and required field invariants.

2. Deterministic Failure-Mapping Validation
- Table-driven tests for each required code (`no_path`, `interrupted`, `insufficient_materials`, `inventory_full`, `tool_missing`, `unsafe`, `timed_out`, `target_unavailable`, `route_blocked`, `invalid_state`).
- Verify precedence rules when multiple signals occur (for example timeout + target loss).

3. Movement Mutex Validation
- Concurrency tests with overlapping `move_to`/`follow_entity` requests:
  - single in-flight invariant,
  - one pending invariant,
  - stale-drop behavior,
  - preemption behavior,
  - no oscillation (bounded goal transitions per time window).

4. Skill Integration Validation (Live-condition simulation)
- Simulate common world outcomes per skill:
  - missing target,
  - blocked route,
  - insufficient materials,
  - inventory saturation,
  - tool absence,
  - unsafe environment.
- Assert result object, error code, duration, and EventBus emission.

5. Nyquist-Oriented Evidence Artifacts
- Artifact A: failure-mapping matrix (condition -> expected code -> test id).
- Artifact B: movement arbitration timeline traces (request, queue, preempt, drop, result).
- Artifact C: per-skill timeout proof tests.
- Artifact D: post-condition validator pass/fail fixtures.

## Verification Strategy

Unit tests:
- `Executor` never-throw wrapper and timeout race behavior.
- `failureMapping` precedence matrix.
- `MovementCoordinator` lock/pending/preemption logic.
- Each skill handler parameter guards and result shaping.

Integration tests:
- EventBus `executor:result` propagation and perception recent-failure integration.
- Movement conflict scenarios proving anti-oscillation behavior.
- End-to-end skill executions against stubbed bot APIs with deterministic failure injection.

Phase gate commands:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Wave Sequencing Recommendations

Wave 1: Executor Skeleton + Contracts (`EXEC-02` baseline)
- Build executor wrapper, skill registry, shared failure mapper, config scaffolding.

Wave 2: Movement Coordinator (`EXEC-03`)
- Implement mutex/pending/preemption/stale-drop and pathfinder signal mapping.

Wave 3: 10 Skill Implementations (`EXEC-01` + `EXEC-02`)
- Implement and validate all skills with shared timeout and result normalization.

Wave 4: Hardening and Validation Architecture Completion
- Add matrix tests, concurrency tests, and Nyquist evidence artifacts.
