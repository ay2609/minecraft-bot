# Requirements: minecraft-bot

**Defined:** 2026-03-06
**Core Value:** The bot should feel like a competent, persistent player — not a command executor. It pursues meaningful goals on its own, recovers when plans break, and doesn't require babysitting.

## v1 Requirements

### Foundation

- [x] **FOUND-01**: Developer can initialize the project with a single command (`npm install`) and run the bot with `npm start`; TypeScript compiles via tsx, CJS modules, ESLint enforces `no-floating-promises`
- [ ] **FOUND-02**: All shared types are defined in a central types module — `PerceptionSnapshot`, `GoalPlan`, `Subgoal`, `ActionQueue`, `ActionItem`, `ExecutorResult`, `ExecutorErrorCode` (10 codes)
- [ ] **FOUND-03**: EventBus is available as an in-process pub/sub system; planner layers communicate through it rather than direct imports of each other
- [ ] **FOUND-04**: SQLite database initializes on startup with WAL mode enabled and creates all required schemas for semantic and episodic memory

### Perception

- [ ] **PERC-01**: Bot produces a structured `PerceptionSnapshot` at 1–2 Hz containing: position, health, hunger, armor, inventory contents, nearby entities (type/distance/health), nearby blocks (type/position), current action, recent failures, time-of-day
- [ ] **PERC-02**: Snapshot generation is debounced (not per-tick, not on-demand) and emits an event on the EventBus when ready
- [ ] **PERC-03**: Context assembler composes a compact prompt-ready context object from the current snapshot + relevant memory entries; downstream models receive this assembled context, not raw state

### Executor

- [ ] **EXEC-01**: All 10 core skills are implemented and callable by Model B: `move_to`, `follow_entity`, `place_block`, `break_block`, `craft_item`, `drop_item`, `equip_item`, `interact_block`, `attack_entity`, `send_chat`
- [ ] **EXEC-02**: Every skill call returns a structured `ExecutorResult` (never throws); all 10 error codes are used: `no_path`, `interrupted`, `insufficient_materials`, `inventory_full`, `tool_missing`, `unsafe`, `timed_out`, `target_unavailable`, `route_blocked`, `invalid_state`; every skill has a configurable max duration and returns `timed_out` if exceeded
- [ ] **EXEC-03**: A movement mutex prevents concurrent pathfinding calls; a second `move_to` while one is in-flight queues or cancels cleanly — never causes oscillation

### Memory

- [ ] **MEM-01**: Working memory holds current plan, active subgoal, action queue, and constraints as an in-process object; it is the single source of truth for what the bot is currently doing
- [ ] **MEM-02**: Semantic memory persists to SQLite: locations (named places with coordinates), resources (where things were found), known routes, known structures, server-specific facts; queryable by type and proximity
- [ ] **MEM-03**: Episodic memory persists to SQLite: every attempt, outcome, failure reason, and success with timestamps and goal context; queryable to surface relevant past experience for a given goal
- [ ] **MEM-04**: On process restart, semantic and episodic memory are fully available immediately; working memory is reconstructed from the last committed plan state so the bot resumes rather than starting from scratch

### Planning

- [ ] **PLAN-01**: Fireworks LLM client wraps the `openai` npm package with `baseURL` pointing to the Fireworks.ai inference endpoint; handles JSON parse failures with a retry, surfaces structured errors for context-length exceeded and rate limits
- [ ] **PLAN-02**: Model B (tactical loop) runs on completion or failure of each action; it receives the assembled context, maintains the action queue, selects the next skill call, and decides whether to continue, retry, reorder, or escalate; outputs strict JSON
- [ ] **PLAN-03**: Model A (strategic loop) runs on discrete triggers (no active plan, escalation from Model B, plan completion, survival threshold); it chooses the current long-horizon goal, produces an ordered subgoal sequence with success and abort conditions, and hands off to Model B; outputs strict JSON
- [ ] **PLAN-04**: When the bot has no active goal and is not in a survival emergency, Model A autonomously selects the next objective based on current world state, memory, and progression heuristics (not just waits for a command)

### Recovery

- [ ] **RECV-01**: Each goal tracks a consecutive failure counter; after N failures (configurable), the current strategy is marked blocked and Model A is triggered to choose a different approach
- [ ] **RECV-02**: A wall-clock watchdog fires if the bot makes no meaningful progress toward its current goal within a configurable time window; triggers Model A re-evaluation rather than letting the bot silently idle
- [ ] **RECV-03**: On bot death, the action queue is cleared, the death location and cause are written to episodic memory, and Model A is triggered to reprioritize (typically: recover gear, reassess safety)
- [ ] **RECV-04**: Model A's context includes recent episodic failures for the candidate goal; it is instructed not to re-select a strategy that has failed recently without an explicit reason to believe conditions have changed

### Observability

- [ ] **OBS-01**: Terminal dashboard displays in real time: current strategic goal, current subgoal, active action queue, last Model A output summary, last Model B decision, recent executor outcomes, memory entry counts, and uptime
- [ ] **OBS-02**: Every LLM call (prompt, response, parse result, latency), executor result (skill, outcome, error code), and plan transition is written to a structured JSON log with a call ID for replay and debugging
- [ ] **OBS-03**: Player chat messages are captured from the game and included in the next perception context; Model B or Model A may respond via `send_chat` as part of normal action selection — chat is treated as input, not as a hard interrupt

## v2 Requirements

### Executor Hardening

- **EXEC-V2-01**: Post-condition validators — after each action, verify the world actually changed as expected before marking the action complete
- **EXEC-V2-02**: Priority health event — perception debounce is bypassed on critical health drop, fires immediately to working memory

### Gameplay Depth

- **GAME-V2-01**: Crop farming — plant, tend, and harvest crops as a food source
- **GAME-V2-02**: Base construction — bot builds and maintains a home base as a long-term goal
- **GAME-V2-03**: Structured exploration — systematic biome/structure search with semantic memory recording discoveries
- **GAME-V2-04**: Player task execution — player can assign a goal via chat; bot adds it to its priority queue

### Observability

- **OBS-V2-01**: Bot chat narration — bot occasionally announces its current goal or recent decision in chat
- **OBS-V2-02**: Web dashboard — browser-based view of bot state, plan history, memory, decision log

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web dashboard (v1) | Terminal dashboard sufficient; web adds infrastructure complexity with no bot behavior benefit |
| Multi-bot coordination | Single-bot architecture first; multi-agent is a fundamentally different design |
| Plugin/mod support | Vanilla server only in v1; Paper/Spigot changes nothing about core bot behavior |
| Visual/screenshot perception | mineflayer's programmatic APIs provide richer structured data at zero cost; vision adds latency and complexity |
| Frame-by-frame motor control in models | mineflayer-pathfinder handles all movement; models never output raw coordinates |
| Nether / End / dimension travel | Overworld progression is the sufficient scope for demonstrating autonomy |
| Redstone engineering | High complexity, narrow gameplay value for an autonomous agent |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| FOUND-04 | Phase 2 | Pending |
| MEM-01 | Phase 2 | Pending |
| MEM-02 | Phase 2 | Pending |
| MEM-03 | Phase 2 | Pending |
| MEM-04 | Phase 2 | Pending |
| PERC-01 | Phase 3 | Pending |
| PERC-02 | Phase 3 | Pending |
| PERC-03 | Phase 3 | Pending |
| EXEC-01 | Phase 4 | Pending |
| EXEC-02 | Phase 4 | Pending |
| EXEC-03 | Phase 4 | Pending |
| PLAN-01 | Phase 5 | Pending |
| PLAN-02 | Phase 5 | Pending |
| PLAN-03 | Phase 6 | Pending |
| PLAN-04 | Phase 6 | Pending |
| RECV-01 | Phase 7 | Pending |
| RECV-02 | Phase 7 | Pending |
| RECV-03 | Phase 7 | Pending |
| RECV-04 | Phase 7 | Pending |
| OBS-01 | Phase 8 | Pending |
| OBS-02 | Phase 8 | Pending |
| OBS-03 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-06 after roadmap creation — all 25 requirements mapped*
