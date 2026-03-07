# Roadmap: minecraft-bot

## Overview

Build a hierarchical LLM-powered Minecraft agent from the bottom up: typed contracts and infrastructure first, then memory persistence, then game perception, then executor skills (validated against a live server before any LLM calls), then the tactical loop (Model B), then the strategic loop (Model A), then recovery hardening, and finally the terminal dashboard and player chat. Each phase delivers a coherent, independently verifiable capability. The bot cannot meaningfully autonomous until all eight phases complete, but every phase produces something testable on its own.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Project Scaffolding** - TypeScript project boots, shared types compile, EventBus wires layers together
- [ ] **Phase 2: Memory Persistence** - SQLite schemas initialize on startup; working, semantic, and episodic memory survive restarts
- [ ] **Phase 3: Perception Layer** - Bot produces debounced PerceptionSnapshot at 1-2 Hz; context assembler composes prompt-ready context
- [ ] **Phase 4: Skills and Executor** - All 10 skills run against a live server with structured error codes; no LLM involved
- [ ] **Phase 5: LLM Client and Tactical Planner** - Fireworks client calls succeed; Model B manages the action queue end-to-end
- [ ] **Phase 6: Strategic Planner and Autonomous Loop** - Model A selects goals and hands off to Model B; bot pursues goals without commands
- [ ] **Phase 7: Recovery System** - Failure escalation, watchdog, death recovery, and episodic memory-driven adaptation all fire correctly
- [ ] **Phase 8: Observability and Player Interaction** - Terminal dashboard shows live state; player chat reaches the planners

## Phase Details

### Phase 1: Project Scaffolding
**Goal**: Developer can run the bot, all shared types compile, and layers communicate through EventBus without direct imports
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03
**Success Criteria** (what must be TRUE):
  1. Running `npm install && npm start` connects the bot to the Minecraft server without TypeScript errors or lint failures
  2. All shared types (`PerceptionSnapshot`, `GoalPlan`, `Subgoal`, `ActionQueue`, `ActionItem`, `ExecutorResult`, `ExecutorErrorCode`) are importable from a single types module and used throughout the codebase
  3. EventBus pub/sub is operational — a subscriber registered in one module receives events emitted from another without either importing the other directly
  4. ESLint `no-floating-promises` rule is enforced and all async handlers have explicit error boundaries
**Plans**: 3 plans
Plans:
- [ ] 01-01-PLAN.md — Project foundation: package.json, tsconfig.json (CJS), ESLint with no-floating-promises
- [ ] 01-02-PLAN.md — Shared types module and typed EventBus singleton
- [ ] 01-03-PLAN.md — Bot entry point, config module, mineflayer connection smoke test

### Phase 2: Memory Persistence
**Goal**: All four memory systems initialize correctly on startup and survive process restarts
**Depends on**: Phase 1
**Requirements**: FOUND-04, MEM-01, MEM-02, MEM-03, MEM-04
**Success Criteria** (what must be TRUE):
  1. On startup, SQLite database opens in WAL mode and all required tables exist (locations, resources, routes, structures, server_facts, episodes) — verified by querying schema
  2. Working memory holds the current plan, active subgoal, action queue, and constraints as an in-process object; querying it returns the correct current state
  3. A fact written to semantic memory and an episode written to episodic memory are both readable after a process restart with no data loss
  4. After restart, working memory is reconstructed from the last committed plan state so the bot resumes its prior goal rather than starting from scratch
**Plans**: TBD

### Phase 3: Perception Layer
**Goal**: The bot continuously produces compact, prompt-ready game state snapshots and assembles them into structured context for planners
**Depends on**: Phase 2
**Requirements**: PERC-01, PERC-02, PERC-03
**Success Criteria** (what must be TRUE):
  1. A `PerceptionSnapshot` is produced at 1-2 Hz containing position, health, hunger, armor, inventory, nearby entities (type/distance/health), nearby blocks (type/position), current action, recent failures, and time-of-day — no raw mineflayer state leaks through
  2. Snapshot production is debounced — rapid game events do not produce multiple snapshots; exactly one event fires on EventBus per snapshot cycle
  3. The context assembler produces a compact context object from snapshot + relevant memory entries; the output fits a token budget and contains no raw database dumps
**Plans**: TBD

### Phase 4: Skills and Executor
**Goal**: All 10 core skills execute against a live Minecraft server and return structured results; no LLM calls required to verify this phase
**Depends on**: Phase 3
**Requirements**: EXEC-01, EXEC-02, EXEC-03
**Success Criteria** (what must be TRUE):
  1. Each of the 10 skills (`move_to`, `follow_entity`, `place_block`, `break_block`, `craft_item`, `drop_item`, `equip_item`, `interact_block`, `attack_entity`, `send_chat`) executes in-game and returns an `ExecutorResult` — never throws
  2. All 10 error codes (`no_path`, `interrupted`, `insufficient_materials`, `inventory_full`, `tool_missing`, `unsafe`, `timed_out`, `target_unavailable`, `route_blocked`, `invalid_state`) are produced by real failure conditions, not stub returns; each skill has a configurable max duration and returns `timed_out` when exceeded
  3. Issuing a second `move_to` while one is in-flight does not cause oscillation — the movement mutex queues or cancels the second call cleanly and a single coherent path is followed
**Plans**: TBD

### Phase 5: LLM Client and Tactical Planner
**Goal**: The Fireworks LLM client calls succeed against the real API; Model B manages the action queue end-to-end from context to executed skill
**Depends on**: Phase 4
**Requirements**: PLAN-01, PLAN-02
**Success Criteria** (what must be TRUE):
  1. A live call to the Fireworks.ai endpoint returns a valid JSON response; JSON parse failures are retried once and context-length / rate-limit errors surface as structured errors rather than uncaught exceptions
  2. On completion or failure of each action, Model B receives the assembled context, produces a valid JSON action queue, and the executor runs the next skill — the bot makes observable progress on a simple goal (e.g., move to a block and break it) without human intervention
  3. When Model B receives an unrecoverable parse failure, it emits a `WAIT` action rather than crashing or looping — the bot pauses and the failure is logged
**Plans**: TBD

### Phase 6: Strategic Planner and Autonomous Loop
**Goal**: Model A selects long-horizon goals, produces subgoal sequences, and hands them to Model B; the bot pursues goals autonomously when idle
**Depends on**: Phase 5
**Requirements**: PLAN-03, PLAN-04
**Success Criteria** (what must be TRUE):
  1. Model A fires on discrete triggers (no active plan, plan completion, player chat escalation, survival threshold) and produces a `GoalPlan` with an ordered `Subgoal[]` sequence including success and abort conditions — not on a timer
  2. After handing off a plan to Model B, Model A does not fire again until a discrete trigger occurs — the tactical loop runs autonomously between strategic checkpoints
  3. When the bot has no active goal and is not in a survival emergency, it selects its own next objective (survival, resource gathering, exploration, or progression) and begins executing without any player command
  4. The bot completes the critical path — gathers wood, crafts tools, progresses to stone tools — driven entirely by Model A goal selection and Model B tactical execution
**Plans**: TBD

### Phase 7: Recovery System
**Goal**: The bot detects stalled or looping behavior and escalates to a new strategy rather than grinding indefinitely; death is handled as a system-level reset
**Depends on**: Phase 6
**Requirements**: RECV-01, RECV-02, RECV-03, RECV-04
**Success Criteria** (what must be TRUE):
  1. After N consecutive failures on the same subgoal (configurable, default 3), the current strategy is marked blocked and Model A is triggered — the bot is observed choosing a different approach on the next strategic tick
  2. If no meaningful progress is made toward the current goal within a configurable wall-clock window, the watchdog fires and triggers Model A re-evaluation — the bot does not idle silently for more than the configured window
  3. On bot death, the action queue clears, death location and cause are written to episodic memory, and Model A is triggered with a `DEATH_RECOVERY` priority — the bot's first post-death action is to recover, not resume its pre-death plan
  4. When Model A is selecting a strategy for a goal that has recent episodic failures, it does not re-select the identical failing approach without an explicit contextual reason — observable as a different subgoal sequence in the plan output
**Plans**: TBD

### Phase 8: Observability and Player Interaction
**Goal**: The developer can observe the full bot state in real time from the terminal; player chat messages reach the planners and the bot responds
**Depends on**: Phase 7
**Requirements**: OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):
  1. The terminal dashboard displays in real time: current strategic goal, current subgoal, active action queue, last Model A output summary, last Model B decision, recent executor outcomes (with error codes), memory entry counts, and uptime — all updating live without manual refresh
  2. Every LLM call (prompt, response, parse result, latency), executor result (skill, outcome, error code), and plan transition is written to a structured JSON log file with a unique call ID — a developer can replay any decision from the log
  3. A player chat message sent in-game is captured, included in the next perception context, and the bot responds via `send_chat` as part of normal action selection — chat is not a hard interrupt and the bot continues its current goal unless Model A decides to reprioritize
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Project Scaffolding | 0/3 | Ready to execute | - |
| 2. Memory Persistence | 0/TBD | Not started | - |
| 3. Perception Layer | 0/TBD | Not started | - |
| 4. Skills and Executor | 0/TBD | Not started | - |
| 5. LLM Client and Tactical Planner | 0/TBD | Not started | - |
| 6. Strategic Planner and Autonomous Loop | 0/TBD | Not started | - |
| 7. Recovery System | 0/TBD | Not started | - |
| 8. Observability and Player Interaction | 0/TBD | Not started | - |
