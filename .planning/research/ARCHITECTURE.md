# Architecture Patterns

**Domain:** LLM-powered autonomous Minecraft bot (hierarchical agentic system)
**Researched:** 2026-03-06
**Confidence:** HIGH — architecture derived from well-specified project requirements, established agentic system patterns, and direct mineflayer/Node.js knowledge

---

## Recommended Architecture

The system is a single Node.js process with five vertical layers plus three memory stores. Data flows predominantly downward (perception → planning → execution) with a structured feedback path upward (execution results → tactical loop → strategic loop escalation). Neither loop drives frame-by-frame behavior; mineflayer-pathfinder handles all real-time motor control internally.

```
┌─────────────────────────────────────────────────────────────────┐
│                        PROCESS BOUNDARY                         │
│                                                                 │
│  mineflayer events ──► PerceptionLayer ──► PerceptionSnapshot  │
│                                │                                │
│                    ┌───────────▼───────────┐                   │
│                    │    WorkingMemory       │ (in-process)      │
│                    │  current plan/subgoal  │                   │
│                    │  action queue          │                   │
│                    │  session constraints   │                   │
│                    └───────────┬───────────┘                   │
│                                │                                │
│              ┌─────────────────┼─────────────────┐             │
│              │                 │                 │             │
│    SemanticMemory      EpisodicMemory     (both SQLite)        │
│    (world facts)       (attempts/failures)                     │
│              │                 │                 │             │
│              └─────────────────┼─────────────────┘             │
│                                │                                │
│          ┌─────────────────────▼─────────────────────┐         │
│          │         StrategicPlanner (Model A)         │         │
│          │  Slow loop — event-triggered               │         │
│          │  Input: full context bundle                │         │
│          │  Output: GoalPlan (goal + SubgoalSequence) │         │
│          └─────────────────────┬─────────────────────┘         │
│                                │ SubgoalHandoff                 │
│          ┌─────────────────────▼─────────────────────┐         │
│          │         TacticalPlanner (Model B)          │         │
│          │  Medium loop — completion/failure-triggered │         │
│          │  Input: SubgoalHandoff + perception         │         │
│          │  Output: ActionQueue                        │         │
│          └─────────────────────┬─────────────────────┘         │
│                                │ SkillCall[]                    │
│          ┌─────────────────────▼─────────────────────┐         │
│          │            SkillLayer                      │         │
│          │  move_to, craft_item, break_block, etc.    │         │
│          │  Validates params, wraps mineflayer calls  │         │
│          └─────────────────────┬─────────────────────┘         │
│                                │ ExecutorRequest                │
│          ┌─────────────────────▼─────────────────────┐         │
│          │            ExecutorLayer                   │         │
│          │  Runs skill, monitors completion, timeout  │         │
│          │  Returns ExecutorResult (ok | error code)  │         │
│          └─────────────────────┬─────────────────────┘         │
│                                │                                │
│              mineflayer-pathfinder + mineflayer bot API         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Single-Process vs Multi-Process

**Recommendation: Single process.**

Rationale:
- mineflayer requires a single Node.js process with its event emitter; bridging across processes adds IPC complexity with no benefit at this scale.
- Working memory is ephemeral per-session state — externalizing it to a separate process adds latency on every read/write with no durability gain.
- Model A and Model B share the same API key and are called sequentially within a loop — no parallelism benefit from separate processes.
- SQLite is not designed for concurrent multi-process write access; single-process serializes writes safely without a lock manager.
- The only async concurrency needed is: `await` on LLM calls, `await` on pathfinder operations, and SQLite query awaits — all handled natively in Node.js with `async/await`.

Multi-process would be worth revisiting only if Model A calls become a latency bottleneck (>5s) and you want to pipeline perception processing — deferrable to a later milestone.

---

## Component Boundaries

| Component | Responsibility | Input | Output | Communicates With |
|-----------|---------------|-------|--------|-------------------|
| `PerceptionLayer` | Subscribes to mineflayer events, computes `PerceptionSnapshot` | mineflayer bot events | `PerceptionSnapshot` | Pushes to `EventBus`; read by `WorkingMemory`, `StrategicPlanner`, `TacticalPlanner` |
| `WorkingMemory` | In-process mutable state for current session | Writes from planners, reads from all layers | Current `GoalPlan`, `SubgoalHandoff`, `ActionQueue`, session flags | All layers read from it; planners write to it |
| `SemanticMemory` | SQLite store for durable world facts | Write: skill/executor events; Read: planner context assembly | Fact rows keyed by type+key | Queried by `ContextAssembler` before each planner call |
| `EpisodicMemory` | SQLite store for attempt/failure/success records | Write: executor results; Read: planner context | Episode rows with timestamps | Queried by `ContextAssembler`; written by `EpisodeRecorder` |
| `ContextAssembler` | Builds the prompt context bundle from all memory sources | Current snapshot, working memory, memory queries | `StrategicContext` or `TacticalContext` struct | Called by planners before each LLM invocation |
| `StrategicPlanner` | Calls Model A, produces `GoalPlan` | `StrategicContext` | `GoalPlan` | Reads `ContextAssembler`; writes to `WorkingMemory`; triggers `TacticalPlanner` |
| `TacticalPlanner` | Calls Model B, produces `ActionQueue` | `TacticalContext` | `ActionQueue` | Reads `ContextAssembler` + `WorkingMemory`; dispatches to `SkillLayer` |
| `SkillLayer` | Validates and translates skill calls to executor requests | `SkillCall` | `ExecutorRequest` | Called by `TacticalPlanner`; dispatches to `ExecutorLayer` |
| `ExecutorLayer` | Runs mineflayer actions, monitors completion/timeout | `ExecutorRequest` | `ExecutorResult` | Drives mineflayer API; feeds results back to `TacticalPlanner`; writes to `EpisodicMemory` |
| `EscalationDetector` | Detects stall/repeated-failure patterns | `ExecutorResult` stream | Escalation signal | Triggers `StrategicPlanner` loop |
| `EpisodeRecorder` | Writes executor results to episodic memory | `ExecutorResult` | — | Writes to `EpisodicMemory` |
| `EventBus` | Internal typed pub/sub for decoupled event routing | Any component emitting events | Any subscriber | Used by all layers to avoid circular imports |
| `Dashboard` | Terminal UI, renders current state | `WorkingMemory` reads + event stream | Terminal output | Reads `WorkingMemory`; subscribes to `EventBus` |
| `ChatHandler` | Routes player chat to `StrategicPlanner` | mineflayer chat events | Strategic trigger + queued response | Triggers `StrategicPlanner`; writes chat via skill |

---

## Data Flow: Layer by Layer

### Perception → Working Memory

mineflayer fires events (`physicsTick`, `health`, `chat`, entity events, block events). `PerceptionLayer` subscribes to these and recomputes a `PerceptionSnapshot` on a debounced schedule (not every tick — target: 1–2 Hz update rate to avoid over-sampling). The snapshot is written to `WorkingMemory.currentSnapshot` and published on `EventBus('perception:updated')`.

```typescript
// PerceptionSnapshot — what gets computed from mineflayer state
interface PerceptionSnapshot {
  timestamp: number;

  // Self state
  position: Vec3;           // bot.entity.position
  yaw: number;              // bot.entity.yaw
  health: number;           // bot.health
  food: number;             // bot.food
  gameMode: string;         // bot.game.gameMode
  isOnGround: boolean;

  // Inventory (compact — not every slot, just counts by item name)
  inventory: Record<string, number>; // { 'oak_log': 12, 'crafting_table': 1 }
  equippedItem: string | null;
  emptySlots: number;

  // World context
  biome: string;
  timeOfDay: number;        // 0–24000
  weather: 'clear' | 'rain' | 'thunder';
  nearbyEntities: NearbyEntity[];   // within 32 blocks, sorted by distance
  nearbyBlocks: NearbyBlock[];      // notable blocks within 16 blocks
  lightLevel: number;

  // Execution context
  currentAction: string | null;     // what executor is currently doing
  recentFailures: FailureRecord[];  // last 3 executor failures, for context
}

interface NearbyEntity {
  name: string;        // 'creeper', 'player:Steve', 'cow'
  distance: number;
  isHostile: boolean;
}

interface NearbyBlock {
  name: string;        // 'diamond_ore', 'crafting_table'
  position: Vec3;
  distance: number;
}
```

**What is NOT in the snapshot:** Raw mineflayer bot object, full chunk data, NBT data dumps, full entity list. The snapshot is intentionally a lossy but sufficient projection.

---

### Context Assembly for Planners

Before each LLM call, `ContextAssembler` builds a typed context struct by combining:
1. `WorkingMemory.currentSnapshot` (perception)
2. Relevant semantic memory facts (queried by proximity, current goal domain)
3. Recent episodic records (last N episodes matching the current goal type)
4. Current working memory state (active plan, constraints)

```typescript
// Built before each Model A invocation
interface StrategicContext {
  snapshot: PerceptionSnapshot;
  currentPlan: GoalPlan | null;         // what we're currently pursuing (if any)
  semanticFacts: SemanticFact[];        // relevant durable knowledge
  recentEpisodes: Episode[];            // last 10 episodes (any type)
  failurePatterns: FailurePattern[];    // detected repeated failures
  playerMessage: string | null;         // if triggered by chat
  sessionAge: number;                   // seconds since bot started
  idleReason: string | null;            // why strategic loop was triggered
}

// Built before each Model B invocation
interface TacticalContext {
  snapshot: PerceptionSnapshot;
  currentSubgoal: Subgoal;              // what Model B is currently working on
  actionHistory: ActionRecord[];        // last 5 actions + outcomes in this subgoal
  relevantFacts: SemanticFact[];        // narrowly scoped to current subgoal domain
  remainingSubgoals: Subgoal[];         // what comes after this one (for lookahead)
  abortConditions: string[];            // from Model A's GoalPlan
}
```

---

### Model A Output: GoalPlan

Model A outputs strict JSON. The system prompt instructs it to produce this structure and nothing else.

```typescript
interface GoalPlan {
  goal: string;                         // "Build a shelter before nightfall"
  goalRationale: string;                // Why this goal now (survival/progression/player request)
  priority: 'survival' | 'progression' | 'exploration' | 'social' | 'construction';
  subgoals: Subgoal[];                  // Ordered sequence
  successConditions: string[];          // Observable conditions that mean goal is done
  abortConditions: string[];            // If any of these occur, abort and re-plan
  estimatedComplexity: 'low' | 'medium' | 'high';
  allowedSkills: string[];              // Constrain Model B's tool palette for this goal
}

interface Subgoal {
  id: string;                           // "sg-1", "sg-2" etc.
  description: string;                  // "Gather 10 oak logs"
  requiredItems: Record<string, number>; // Pre-conditions: what must be in inventory
  expectedOutcome: string;              // What working memory should look like when done
  maxAttempts: number;                  // Before escalating back to Model A
  timeoutSeconds: number;               // Hard timeout
}
```

**GoalPlan is written to `WorkingMemory.activePlan`.** Model A does not return an action queue. It only returns strategic decomposition.

---

### Model A → Model B Handoff

After Model A produces a `GoalPlan`, `StrategicPlanner`:
1. Writes the plan to `WorkingMemory.activePlan`
2. Sets `WorkingMemory.currentSubgoalIndex = 0`
3. Emits `EventBus('strategic:plan-ready')`
4. `TacticalPlanner` subscribes to this event and begins its loop

`TacticalPlanner` reads `WorkingMemory.activePlan.subgoals[currentSubgoalIndex]` to know what its current Subgoal is. It does not receive a separate message — it reads from the shared working memory.

---

### Model B Output: ActionQueue

Model B outputs an ordered list of skill calls. It runs a loop: invoke LLM → enqueue actions → execute first action → observe result → if subgoal not done, invoke LLM again with updated context.

```typescript
interface ActionQueue {
  subgoalId: string;                    // Must match current working memory subgoal
  actions: SkillCall[];                 // Ordered list; executor runs one at a time
  reasoning: string;                    // Short explanation (logged to dashboard, not model-looped)
  subgoalComplete: boolean;             // Model B declares subgoal done
  escalate: boolean;                    // Model B requests strategic replanning
  escalateReason: string | null;        // Why escalation is needed
}

interface SkillCall {
  skill: string;                        // 'move_to' | 'break_block' | 'craft_item' | etc.
  params: Record<string, unknown>;      // Skill-specific validated parameters
  expectedDurationSeconds: number;      // For timeout budgeting in executor
}

// Example SkillCall values:
// { skill: 'move_to', params: { x: 120, y: 64, z: -88 }, expectedDurationSeconds: 15 }
// { skill: 'break_block', params: { blockName: 'oak_log', count: 10 }, expectedDurationSeconds: 30 }
// { skill: 'craft_item', params: { item: 'crafting_table', count: 1 }, expectedDurationSeconds: 5 }
```

---

### Executor Results: Flow Back Up

The executor runs each `SkillCall` and returns an `ExecutorResult`:

```typescript
type ExecutorErrorCode =
  | 'no_path'
  | 'interrupted'
  | 'insufficient_materials'
  | 'inventory_full'
  | 'tool_missing'
  | 'unsafe'
  | 'timed_out'
  | 'target_unavailable'
  | 'route_blocked'
  | 'invalid_state';

interface ExecutorResult {
  skillCall: SkillCall;                 // Echo back for logging
  success: boolean;
  errorCode: ExecutorErrorCode | null;
  errorMessage: string | null;          // Human-readable detail
  durationMs: number;
  stateChanges: Partial<PerceptionSnapshot>; // What actually changed (inventory delta, position)
}
```

**Result routing:**
- `success: true` → `TacticalPlanner` proceeds to next action in queue (or re-invokes Model B if queue exhausted and subgoal not declared complete)
- `success: false, errorCode` → `EscalationDetector` increments failure counter for current subgoal
  - If failure count < `subgoal.maxAttempts`: `TacticalPlanner` re-invokes Model B with failure context in `TacticalContext.actionHistory`
  - If failure count >= `maxAttempts` OR Model B sets `escalate: true`: `EscalationDetector` fires `EventBus('escalate:to-strategic')` → `StrategicPlanner` loop runs
  - If `errorCode === 'unsafe'` or `errorCode === 'interrupted'` by health event: immediate escalation regardless of attempt count

All results are written to `EpisodicMemory` via `EpisodeRecorder` regardless of success/failure.

---

## Control Loop Hierarchy

### Strategic Loop (Model A) — Event-Triggered

The strategic loop does NOT run on a timer. It runs when:
- Bot has no active plan (`WorkingMemory.activePlan === null`)
- `EscalationDetector` fires escalation signal
- Player sends a chat message routed by `ChatHandler`
- Bot completes all subgoals in the current `GoalPlan` (plan succeeded)
- Survival threshold crossed (health < 5, night approaching without shelter)

When triggered:
1. `ContextAssembler.buildStrategicContext()` — queries memory, assembles snapshot
2. LLM call to Model A with strategic system prompt + context JSON
3. Parse + validate `GoalPlan` response
4. Write to `WorkingMemory.activePlan`
5. Emit `EventBus('strategic:plan-ready')`
6. Strategic loop goes idle until next trigger

**Cadence in practice:** A typical strategic loop fires 1–5 times per minute depending on how often subgoals complete or failures occur. During a smooth run (bot gathering wood successfully), it may not fire for several minutes.

### Tactical Loop (Model B) — Completion/Failure-Triggered

The tactical loop does NOT run on a timer either. It runs when:
- `EventBus('strategic:plan-ready')` fires (new plan from Model A)
- Current action queue is exhausted and subgoal not declared complete
- `ExecutorResult` returns a failure (retry path)
- Subgoal index advances (previous subgoal completed, move to next)

When triggered:
1. Read current subgoal from `WorkingMemory`
2. `ContextAssembler.buildTacticalContext()` — narrow context for this subgoal
3. LLM call to Model B with tactical system prompt + context JSON
4. Parse + validate `ActionQueue` response
5. Execute first `SkillCall` in queue via `SkillLayer` → `ExecutorLayer`
6. Observe `ExecutorResult`
7. Loop back to step 1 (re-invoke Model B with updated context)

**Cadence in practice:** Model B fires roughly once per completed action. If a `move_to` takes 10 seconds, Model B fires after those 10 seconds. If crafting takes 2 seconds, Model B fires after 2 seconds. A sustained activity burst might invoke Model B 10–20 times per minute.

---

## Memory: Query and Update at Each Layer

### WorkingMemory (in-process object)

Read by: all layers. Written by: `StrategicPlanner`, `TacticalPlanner`, `ExecutorLayer` (state changes), `EpisodeRecorder`.

```typescript
interface WorkingMemory {
  // Plan state
  activePlan: GoalPlan | null;
  currentSubgoalIndex: number;
  subgoalAttemptCount: number;          // Reset when subgoal advances

  // Snapshot
  currentSnapshot: PerceptionSnapshot | null;
  lastSnapshotAt: number;               // ms timestamp

  // Action state
  currentActionQueue: ActionQueue | null;
  currentActionIndex: number;

  // Session metadata
  sessionStartedAt: number;
  totalLLMCallsThisSession: number;
  lastStrategicCallAt: number;
  lastTacticalCallAt: number;

  // Failure tracking
  recentFailures: ExecutorResult[];     // Rolling window of last 10 failures
  consecutiveFailuresOnSubgoal: number;
}
```

WorkingMemory does NOT persist to disk. On restart, it is re-initialized empty and the strategic loop fires immediately to re-establish a plan.

### SemanticMemory (SQLite)

Schema:
```sql
CREATE TABLE semantic_facts (
  id INTEGER PRIMARY KEY,
  fact_type TEXT NOT NULL,   -- 'location', 'resource', 'structure', 'rule', 'social'
  fact_key TEXT NOT NULL,    -- 'chest_at_spawn', 'iron_vein_near_cave', 'player:Steve'
  fact_value TEXT NOT NULL,  -- JSON blob
  confidence REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(fact_type, fact_key)
);
CREATE INDEX idx_semantic_type ON semantic_facts(fact_type);
```

**Written by:**
- `SkillLayer` on `interact_block` success (records chest/furnace locations)
- `PerceptionLayer` on notable block discovery (records ore vein, structure positions)
- `StrategicPlanner` when player tells bot something via chat (records social facts)

**Read by:**
- `ContextAssembler` queried by fact_type relevance to current goal domain:
  ```typescript
  // Example: assembling context for a 'gather wood' subgoal
  const facts = await semanticMemory.query({
    types: ['location', 'resource'],
    limit: 10,
    nearPosition: snapshot.position,   // prefer nearby facts
    maxAge: 3600 * 1000                // only facts from last hour
  });
  ```

### EpisodicMemory (SQLite)

Schema:
```sql
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  goal_type TEXT NOT NULL,     -- 'gather', 'craft', 'navigate', 'combat', 'build'
  skill_used TEXT NOT NULL,
  params_json TEXT NOT NULL,   -- JSON of SkillCall.params
  success INTEGER NOT NULL,    -- 0 or 1
  error_code TEXT,
  duration_ms INTEGER NOT NULL,
  position_json TEXT NOT NULL, -- Where bot was when this happened
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_episodes_goal ON episodes(goal_type, created_at DESC);
CREATE INDEX idx_episodes_skill ON episodes(skill_used, success);
```

**Written by:** `EpisodeRecorder` after every `ExecutorResult`.

**Read by:** `ContextAssembler` for recent failure patterns:
```typescript
// Example: detect repeated no_path failures on move_to
const recentFailures = await episodicMemory.query({
  skill: 'move_to',
  success: false,
  errorCode: 'no_path',
  since: Date.now() - 300_000,   // last 5 minutes
  limit: 5
});
```

---

## Skill Layer: Validation Boundary

The `SkillLayer` is the contract boundary between Model B's outputs and actual game execution. It:
1. Validates that the `skill` name is a known skill
2. Validates that required params are present and type-correct
3. Rejects impossible requests before touching the game (e.g., `craft_item` with item not in crafting registry)
4. Translates high-level params to concrete mineflayer API calls

This is where Model B's JSON outputs are sanitized. Invalid skill calls return an `ExecutorResult` with `errorCode: 'invalid_state'` immediately, without calling mineflayer. This makes the skill layer independently unit-testable.

```typescript
// Skill registry pattern
const SKILL_REGISTRY: Record<string, SkillDefinition> = {
  move_to: {
    requiredParams: ['x', 'y', 'z'],
    optionalParams: ['allowSprint', 'avoidWater'],
    validate: (params) => { /* type checks */ },
    execute: async (bot, params) => { /* mineflayer-pathfinder call */ }
  },
  break_block: {
    requiredParams: ['blockName'],
    optionalParams: ['count', 'maxDistance'],
    validate: (params) => { /* check blockName is valid */ },
    execute: async (bot, params) => { /* find + dig loop */ }
  },
  // ... etc
};
```

---

## Making Planning Logic Testable Independently

The key architectural decision enabling testability: **all planner logic is pure functions over typed data structures**, with mineflayer injected as a dependency.

### Strategy

1. `PerceptionLayer`, `SkillLayer`, `ExecutorLayer` all accept a `bot` parameter. In tests, inject a mock bot.
2. `ContextAssembler` accepts `WorkingMemory`, `SemanticMemory`, `EpisodicMemory` as constructor dependencies. In tests, inject in-memory SQLite (`:memory:`) databases.
3. `StrategicPlanner` and `TacticalPlanner` accept an `LLMClient` interface. In tests, inject a mock client that returns pre-scripted JSON responses.
4. `EscalationDetector` is pure logic over `ExecutorResult[]` — fully unit-testable with no mocks.

```typescript
// LLMClient interface (injected)
interface LLMClient {
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}

// Real implementation
class FireworksLLMClient implements LLMClient {
  constructor(private openai: OpenAI) {}
  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const res = await this.openai.chat.completions.create({
      model: 'accounts/fireworks/models/minimax-01',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' }
    });
    return res.choices[0].message.content ?? '';
  }
}

// Test double
class MockLLMClient implements LLMClient {
  constructor(private responses: string[]) {}
  private index = 0;
  async complete(): Promise<string> {
    return this.responses[this.index++] ?? '{}';
  }
}
```

### Test Categories

| Test Category | What's Tested | Dependencies Mocked |
|--------------|--------------|-------------------|
| Unit: ContextAssembler | Correct context built from given memory state | In-memory SQLite |
| Unit: EscalationDetector | Correct escalation thresholds | None (pure logic) |
| Unit: SkillLayer validation | Invalid skill calls rejected before execution | bot (mock) |
| Unit: GoalPlan parsing | Model A JSON parsed correctly, bad JSON surfaced | None |
| Unit: ActionQueue parsing | Model B JSON parsed correctly | None |
| Integration: StrategicPlanner | Full loop with mock LLM + real memory | bot (mock), LLM (mock) |
| Integration: TacticalPlanner | Full loop with mock LLM + real memory | bot (mock), LLM (mock) |
| Integration: EscalationDetector → StrategicPlanner | Failure count triggers re-plan | bot (mock), LLM (mock) |
| E2E: Live server | Real bot against local Minecraft server | None |

---

## File and Module Organization

```
src/
├── index.ts                     # Entry point: create bot, wire all layers, start loop
├── config.ts                    # Env-driven config (server host, API key, model name)
│
├── perception/
│   ├── PerceptionLayer.ts       # Subscribes to mineflayer events, emits snapshots
│   ├── snapshot.ts              # PerceptionSnapshot type + snapshot builder functions
│   └── perception.test.ts
│
├── memory/
│   ├── WorkingMemory.ts         # In-process state class + types
│   ├── SemanticMemory.ts        # SQLite wrapper for world facts
│   ├── EpisodicMemory.ts        # SQLite wrapper for attempt/failure records
│   ├── ContextAssembler.ts      # Builds StrategicContext and TacticalContext
│   ├── EpisodeRecorder.ts       # Writes ExecutorResults to EpisodicMemory
│   └── memory.test.ts
│
├── planner/
│   ├── StrategicPlanner.ts      # Model A loop: context → LLM → GoalPlan
│   ├── TacticalPlanner.ts       # Model B loop: context → LLM → ActionQueue
│   ├── EscalationDetector.ts    # Detects stall/repeated-failure patterns
│   ├── types.ts                 # GoalPlan, Subgoal, ActionQueue, SkillCall types
│   ├── prompts/
│   │   ├── strategic.system.md  # Model A system prompt
│   │   └── tactical.system.md   # Model B system prompt
│   └── planner.test.ts
│
├── skills/
│   ├── SkillLayer.ts            # Registry dispatch + validation
│   ├── skills/
│   │   ├── move_to.ts
│   │   ├── break_block.ts
│   │   ├── craft_item.ts
│   │   ├── place_block.ts
│   │   ├── equip_item.ts
│   │   ├── drop_item.ts
│   │   ├── attack_entity.ts
│   │   ├── follow_entity.ts
│   │   ├── interact_block.ts
│   │   └── send_chat.ts
│   └── skills.test.ts
│
├── executor/
│   ├── ExecutorLayer.ts         # Runs SkillCalls, monitors completion, returns results
│   ├── types.ts                 # ExecutorRequest, ExecutorResult, ExecutorErrorCode
│   └── executor.test.ts
│
├── llm/
│   ├── LLMClient.ts             # Interface + FireworksLLMClient implementation
│   └── MockLLMClient.ts         # Test double
│
├── events/
│   └── EventBus.ts              # Typed pub/sub (EventEmitter wrapper with typed events)
│
├── chat/
│   ├── ChatHandler.ts           # Routes chat events to strategic planner
│   └── chat.test.ts
│
├── dashboard/
│   └── Dashboard.ts             # Terminal UI (blessed or ink for rendering)
│
└── db/
    ├── schema.sql               # SQLite schema (applied on startup)
    └── migrations/              # Schema migration files (numbered)
```

---

## Build Order Implications

The architecture has clear dependency layers. Build order must respect these dependencies:

| Phase | Components | Dependencies |
|-------|-----------|--------------|
| 1. Foundation | `EventBus`, `WorkingMemory`, types in `planner/types.ts`, `executor/types.ts`, `LLMClient` interface | None |
| 2. Storage | `SemanticMemory`, `EpisodicMemory`, `db/schema.sql` | SQLite (better-sqlite3) |
| 3. Perception | `PerceptionLayer`, `PerceptionSnapshot` builder | mineflayer connection, EventBus |
| 4. Context Assembly | `ContextAssembler` | WorkingMemory, SemanticMemory, EpisodicMemory |
| 5. Skill + Executor | `SkillLayer`, individual skill files, `ExecutorLayer` | mineflayer, mineflayer-pathfinder |
| 6. Planning (Strategic) | `StrategicPlanner` | LLMClient, ContextAssembler, WorkingMemory, EventBus |
| 7. Planning (Tactical) | `TacticalPlanner`, `EscalationDetector` | StrategicPlanner output, SkillLayer, ExecutorLayer, EpisodeRecorder |
| 8. Chat + Dashboard | `ChatHandler`, `Dashboard` | WorkingMemory reads, EventBus subscriptions |

**Critical constraint:** `SkillLayer` and `ExecutorLayer` (Phase 5) can be built and tested before any LLM integration. This is the correct sequence — validate that game actions work before building the planner that drives them.

**Testability gate:** After Phase 5, you can write an integration test that manually constructs an `ActionQueue` and runs it against a live server, confirming executor behavior without any LLM calls. This validates the execution foundation before the planning layer depends on it.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Raw State Dump to Models
**What:** Serializing the entire mineflayer bot object (or large chunk of world state) into the LLM prompt.
**Why bad:** Token cost explodes, model attention dilutes, latency increases, JSON parsing fails on oversized payloads.
**Instead:** `PerceptionSnapshot` is the only thing models ever see — a hand-curated, token-efficient projection.

### Anti-Pattern 2: Model-Driven Motor Control
**What:** Model B outputs `{ move: { x: 0.1, z: 0.3 } }` per-tick velocity instructions.
**Why bad:** LLM call latency is 100ms–2s; Minecraft physics run at 20 TPS. Models cannot drive real-time movement.
**Instead:** Model B outputs high-level skill calls (`move_to` with a destination); mineflayer-pathfinder handles all real-time navigation internally.

### Anti-Pattern 3: Replanning After Every Action
**What:** Calling Model A after every single executor result.
**Why bad:** Strategic replanning is expensive (slow model, large context). Most actions are routine; replanning on each one causes latency loops and incoherent behavior.
**Instead:** Model A is only called on discrete trigger events. Model B handles tactical adaptation between strategic checkpoints.

### Anti-Pattern 4: Monolithic Prompt
**What:** Stuffing all context (strategic goals, tactical state, memory, personality, constraints) into one giant prompt for every call.
**Why bad:** Model attention is finite; important tactical details are diluted by irrelevant strategic context.
**Instead:** `StrategicContext` and `TacticalContext` are separate. Each planner gets only the context it needs.

### Anti-Pattern 5: Vague Error Codes
**What:** Executor returns `{ success: false, error: "failed" }` or `{ success: false, error: "couldn't complete action" }`.
**Why bad:** Model B cannot distinguish between "no path found" (retry at different route) vs "missing tool" (need to craft first) vs "unsafe" (disengage). Recovery strategy depends entirely on error semantics.
**Instead:** The 10 specific `ExecutorErrorCode` values have distinct recovery semantics that Model B's system prompt explicitly maps to recovery strategies.

### Anti-Pattern 6: Circular Module Imports
**What:** `TacticalPlanner` imports from `StrategicPlanner` and vice versa; `SkillLayer` imports from `ExecutorLayer` which imports from `SkillLayer`.
**Why bad:** TypeScript circular imports cause subtle initialization order bugs; difficult to test in isolation.
**Instead:** `EventBus` mediates cross-layer communication. Planners communicate through `WorkingMemory` reads + EventBus events, not direct function calls to each other.

---

## Scalability Considerations

| Concern | Current (v1, single bot) | Later (multi-bot) | Later (production scale) |
|---------|--------------------------|-------------------|--------------------------|
| Memory storage | SQLite per-bot (single file) | SQLite per-bot OR shared Postgres | Postgres with per-bot namespacing |
| LLM call rate | Sequential, single model | Per-bot sequential calls | Rate limiting, request queue |
| Working memory | In-process object | In-process per-bot | Redis if cross-process coordination needed |
| Dashboard | Terminal, single bot view | Terminal multi-pane | Web dashboard with API |
| Executor concurrency | Single action at a time | One executor per bot | Same, just more bots |

For v1, none of these concerns apply. The single-process, single-bot design is intentionally simple and should not be prematurely generalized.

---

## Sources

- Project specification: `/Users/aviyadava/minecraft-bot/.planning/PROJECT.md`
- mineflayer API: https://github.com/PrismarineJS/mineflayer (Node.js Minecraft client library)
- mineflayer-pathfinder: https://github.com/PrismarineJS/mineflayer-pathfinder (A* navigation)
- Voyager (LLM Minecraft agent reference architecture): https://voyager.minedojo.org/ — demonstrates skill library pattern and LLM-driven action decomposition
- ReAct pattern (reason + act loops): Yao et al. 2022 — basis for tactical loop design
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3 — synchronous SQLite for Node.js
- Confidence: HIGH for component boundaries and data flow (derived from well-specified requirements). MEDIUM for exact SQL schema (standard patterns, verify against better-sqlite3 current API). HIGH for build order (dependency graph is deterministic from the architecture).
