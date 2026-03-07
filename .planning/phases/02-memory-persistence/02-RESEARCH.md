# Phase 02 Research: Memory Persistence

**Phase:** 02-memory-persistence  
**Date:** 2026-03-07  
**Purpose:** Define implementation-ready guidance for planning Phase 02 (`FOUND-04`, `MEM-01`, `MEM-02`, `MEM-03`, `MEM-04`).

## Scope and Alignment

Phase 02 must deliver four things together:
1. Reliable SQLite startup with WAL and required schemas.
2. A working-memory in-process source of truth.
3. Durable semantic + episodic memory across process restart.
4. Restart reconstruction behavior that preserves goal continuity without blindly resuming stale in-flight actions.

This phase should not add new gameplay behavior. It should establish trustworthy memory foundations for Phase 3+.

## Requirement Coverage Matrix

| Requirement | What must exist by phase end |
|---|---|
| `FOUND-04` | DB initialization runs at startup, enforces WAL, and creates required tables: `locations`, `resources`, `routes`, `structures`, `server_facts`, `episodes`. |
| `MEM-01` | `WorkingMemory` object is single in-process source of truth for current plan/subgoal/action queue/constraints, with controlled mutation API. |
| `MEM-02` | Semantic memory persists durable world knowledge in SQLite with query APIs by type and proximity. |
| `MEM-03` | Episodic memory persists attempts/outcomes/failure reasons/successes with timestamps and goal context; query APIs support goal-relevant recall. |
| `MEM-04` | On restart, semantic+episodic stores are available immediately; working memory is reconstructed from committed plan state using a safe restore policy. |

## Recommended Deliverables (Planner Targets)

1. `src/memory/Database.ts`
- Owns SQLite connection lifecycle.
- Applies startup pragmas (`journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, optional `busy_timeout`).
- Applies idempotent schema creation in one transaction.
- Exposes health/readiness checks used before higher layers start.

2. `src/memory/schema.sql` or equivalent typed migration module
- Canonical DDL for required tables and indexes.
- Kept deterministic and idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

3. `src/memory/WorkingMemory.ts`
- In-process store with explicit methods (no direct object mutation by external modules).
- Holds: `activePlan`, `activeSubgoal`, `actionQueue`, `constraints`, and minimal restoration metadata.

4. `src/memory/SemanticMemoryRepository.ts`
- CRUD/query for `locations`, `resources`, `routes`, `structures`, `server_facts`.
- Provides proximity queries and type filtering.

5. `src/memory/EpisodicMemoryRepository.ts`
- Append/query API for `episodes` with goal context + timestamps.

6. `src/memory/WorkingMemoryRestore.ts`
- Implements restart reconstruction from committed plan state.
- Drops unsafe transient execution state (in-flight step details), restores safe plan intent.

7. `src/types/index.ts` updates
- Add memory domain types (rows/DTOs, working memory snapshot shape, restore status).

8. `src/events/EventBus.ts` updates
- Add memory lifecycle events (example): `memory:ready`, `memory:restore-complete`, `memory:restore-failed`, `memory:persistence-error`.

9. `src/config.ts` updates
- Add memory config (`dbPath`, optional retention/limits and restore mode flags).

10. `src/index.ts` startup integration
- Initialize memory stack before long-running bot control loops.
- Fail fast on unrecoverable init/restore corruption.

## Data Model Recommendations

Use explicit domain tables instead of one generic facts table for this phase (matches required schema names and keeps plan verification simple).

### Semantic tables (required)

- `locations`
  - `id`, `name`, `x`, `y`, `z`, `dimension`, `category`, `confidence`, `created_at`, `updated_at`
  - Indexes: `(dimension, x, z)`, `(category)`, `(name)`

- `resources`
  - `id`, `resource_type`, `x`, `y`, `z`, `dimension`, `quantity_estimate`, `source`, `confidence`, `last_seen_at`, `created_at`, `updated_at`
  - Indexes: `(resource_type)`, `(dimension, x, z)`, `(last_seen_at)`

- `routes`
  - `id`, `from_location_id`, `to_location_id`, `distance`, `risk_score`, `last_success_at`, `metadata_json`, `created_at`, `updated_at`
  - Indexes: `(from_location_id, to_location_id)`, `(last_success_at)`

- `structures`
  - `id`, `structure_type`, `name`, `x`, `y`, `z`, `dimension`, `integrity`, `notes_json`, `created_at`, `updated_at`
  - Indexes: `(structure_type)`, `(dimension, x, z)`

- `server_facts`
  - `id`, `fact_key`, `fact_value_json`, `scope`, `confidence`, `created_at`, `updated_at`
  - Unique index: `(fact_key)`

### Episodic table (required)

- `episodes`
  - `id`, `goal_id`, `goal_type`, `subgoal_id`, `action_skill`, `params_json`, `outcome` (`success`/`failure`), `failure_reason`, `error_code`, `position_json`, `started_at`, `ended_at`, `created_at`
  - Indexes: `(goal_type, created_at DESC)`, `(action_skill, outcome)`, `(error_code, created_at DESC)`, `(goal_id, subgoal_id, created_at DESC)`

### Plan state checkpoint table (strong recommendation for `MEM-04`)

- `plan_checkpoints`
  - `id`, `is_active`, `goal_id`, `plan_json`, `active_subgoal_id`, `queue_json`, `constraints_json`, `commit_reason`, `created_at`
  - Keep only latest active row (or latest N with one active flag).

Reason: `MEM-04` requires reconstructing working memory from last committed plan state. A dedicated checkpoint table removes ambiguity and decouples this from episodic event replay.

## Working Memory Model and Mutation Policy (`MEM-01`)

Use one singleton working-memory service (in-process only). External layers interact via methods, not raw object writes.

Minimum state shape:
- `currentPlan: GoalPlan | null`
- `activeSubgoalId: string | null`
- `actionQueue: ActionQueue | null`
- `constraints: Record<string, unknown>`
- `restoreInfo: { restoredFromCheckpoint: boolean; restoredAt?: number; checkpointId?: number }`

Mutation rules:
- Only memory service methods can mutate state (`setPlan`, `setSubgoal`, `setQueue`, `setConstraints`, `clearExecutionTransients`).
- Every plan-level mutation that affects restart behavior emits a checkpoint write trigger.
- In-flight execution details (timers, pending promise handles, partial pathing internals) are never persisted.

## Restart Reconstruction Policy (`MEM-04`) — Recommended

This policy resolves the tension between "resume prior goal" and "do not continue stale in-flight execution".

1. At runtime, write checkpoints on durable boundaries:
- strategic plan accepted
- subgoal transition
- tactical queue replacement
- explicit constraint changes

2. On startup:
- Initialize DB + schema first.
- Load latest active checkpoint (if any).
- Rehydrate working memory with `currentPlan`, `activeSubgoalId`, high-level `actionQueue`, and `constraints`.
- Immediately clear unsafe transient execution state (`current action index in-flight`, movement locks, unconfirmed step progress).
- Mark restored queue as `needsRevalidation=true` (or equivalent) so tactical planner confirms next action before execution.

3. If checkpoint is corrupt/incompatible:
- Emit `memory:restore-failed` with reason.
- Fail fast (as required by phase context) rather than silently starting with inconsistent state.

Outcome:
- Knowledge continuity is preserved.
- Goal continuity is preserved.
- Unsafe stale action continuity is prevented.

## Startup Ordering (Concrete)

1. Parse config.
2. Open SQLite connection.
3. Apply pragmas and schema transaction.
4. Instantiate repositories + working memory service.
5. Run reconstruction policy.
6. Emit `memory:ready` / `memory:restore-complete`.
7. Only then continue higher-level bot loops.

If any step in 2-5 fails with integrity/corruption risk, process should exit non-zero.

## Error Handling and Durability Boundaries

- Fail-fast boundaries:
  - DB cannot open.
  - Required schema missing after migration.
  - Checkpoint parse/validation fails.
- Non-fatal boundaries:
  - Individual semantic/episodic insert failure during runtime can emit `memory:persistence-error`; system can continue if current operation can degrade safely.
- Validation:
  - Validate persisted JSON blobs (`plan_json`, `queue_json`, etc.) before accepting into working memory.

## Risks and Mitigations

1. Schema drift across plans
- Risk: later plans silently change columns/indexes and break restoration.
- Mitigation: single canonical schema module + startup schema assertion tests.

2. WAL not actually enabled
- Risk: lock contention under read/write concurrency.
- Mitigation: assert and test `PRAGMA journal_mode` result is `wal` at startup.

3. Unbounded semantic growth
- Risk: slow proximity queries and prompt bloat later.
- Mitigation: indexes from day one; include `last_seen_at`/`confidence`; add pruning policy hooks (even if pruning executes in later phase).

4. Unsafe resume of stale in-flight actions
- Risk: bot resumes invalid movement/action after restart.
- Mitigation: checkpoint only plan/subgoal/queue intent; force post-restart queue revalidation before executor action.

5. Corrupt checkpoint causing undefined behavior
- Risk: silent bad state in working memory.
- Mitigation: strict parse/validation + hard fail on incompatibility.

6. Cross-layer coupling
- Risk: planners/executor import memory internals directly.
- Mitigation: EventBus notifications + typed repository/service interfaces only.

## Verification Strategy (for PLAN.md and Phase Verification)

### Unit tests

- Database init
  - Confirms pragmas applied (`journal_mode`, `synchronous`, `foreign_keys`).
  - Confirms all required tables exist.
- Semantic repository
  - Insert/query by type and proximity for each required semantic domain.
- Episodic repository
  - Append and query by goal type, recent failures, success history.
- Working memory
  - Mutator APIs enforce single-source-of-truth behavior.
- Restore policy
  - Rehydrate from valid checkpoint.
  - Reject corrupt/incompatible checkpoint.
  - Clears unsafe transient execution fields.

### Integration tests

- Restart durability test
  - Process A writes semantic rows + episodes + checkpoint; process B starts and reads same data.
- Startup gate test
  - If memory init fails, system refuses to mark memory ready.
- EventBus lifecycle test
  - `memory:ready` and restore events emitted exactly once per startup.

### Manual acceptance checks (must map to success criteria)

1. `FOUND-04`
- Start app on clean DB path, inspect schema + WAL mode via SQL pragma/query.

2. `MEM-01`
- Set plan/subgoal/queue/constraints in working memory and verify reads reflect latest in-process state.

3. `MEM-02` + `MEM-03`
- Insert semantic and episodic entries, restart process, verify entries remain queryable.

4. `MEM-04`
- Persist checkpoint mid-goal, restart, verify working memory reconstructed to same goal/subgoal context but does not auto-run stale in-flight action without revalidation.

## Planner Recommendations (Executable PLAN.md Guidance)

1. Plan sequence should be dependency-first:
- Plan A: DB bootstrap + schema + low-level tests (`FOUND-04`).
- Plan B: Working memory service + checkpoint model (`MEM-01`, part of `MEM-04`).
- Plan C: Semantic/Episodic repositories + restart reconstruction + integration tests (`MEM-02`, `MEM-03`, `MEM-04`).

2. Each plan should include explicit requirement IDs and evidence commands.

3. Every plan should ship tests in the same PR as implementation; avoid deferred testing for persistence logic.

4. Define objective pass/fail commands for planner use, e.g.:
- `npm run typecheck`
- `npm run lint`
- targeted memory test command (to be added in phase)

5. Do not allow “best effort restore.” Restore is either valid and explicit, or startup fails with a concrete reason.

## Open Decisions to Resolve During Planning

1. Checkpoint cadence granularity
- Choose one and document: action-transition, subgoal-boundary, or hybrid.
- Recommendation: hybrid (subgoal boundary mandatory + queue replacement writes).

2. Proximity query approach
- Choose SQL distance approximation strategy (squared distance in SQL vs post-filter in TS).
- Recommendation: bounding-box prefilter in SQL, final distance sort in TS for simplicity.

3. Retention policy defaults
- Decide default caps for semantic/episodic growth.
- Recommendation: add schema fields now; implement active pruning job in later phase unless required immediately.

## Summary Recommendation

Implement Phase 02 as a memory platform, not a thin SQLite wrapper: deterministic DB bootstrap, explicit domain tables, strict working-memory ownership, and checkpoint-based restart reconstruction with safety revalidation. This is the minimum architecture that can satisfy all of `FOUND-04` and `MEM-01..04` without creating restart hazards for later planning/executor phases.
