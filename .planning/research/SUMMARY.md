# Project Research Summary

**Project:** minecraft-bot
**Domain:** LLM-powered autonomous Minecraft agent (hierarchical two-model control loop, mineflayer + TypeScript)
**Researched:** 2026-03-06
**Confidence:** HIGH (stack verified against npm registry and live APIs; architecture derived from well-specified requirements and published LLM-agent research)

## Executive Summary

This project is a hierarchical LLM agent that plays Minecraft autonomously. The approach is well-established in research (Voyager, GROOT, MineDreamer) and the tooling is mature: mineflayer provides a comprehensive programmatic game interface, mineflayer-pathfinder handles all real-time navigation, and the openai npm package with a baseURL override is the correct way to call Fireworks.ai. The architecture is a five-layer single-process Node.js system — Perception, Memory, Strategic Planner (Model A), Tactical Planner (Model B), and Executor — with SQLite for durable memory. This design keeps complexity manageable while enabling genuine multi-session autonomous behavior.

The recommended approach is to build bottom-up: establish the Executor and SkillLayer first so that game actions can be validated against a live server before any LLM integration. This decouples the most unpredictable surface (LLM outputs and game interaction) and lets each layer be tested independently. Model A handles goal-level planning and fires only on discrete events (no active plan, escalation, player chat, plan completion); Model B handles action-queue generation between strategic checkpoints. Neither loop runs on a timer — event-triggered loops prevent the re-entrancy and token-thrash problems that plague naive agent implementations.

The dominant risks are concentrated in the Executor and control loop layers: pathfinder race conditions, silent action failures with no post-condition checks, infinite LLM escalation loops (both thrash and stuck extremes), and JSON parse failures stalling the bot silently. All of these have well-understood prevention strategies that must be built into the foundation phases — retrofitting them later is significantly harder. A secondary risk is the MiniMax M2 model ID (PROJECT.md says "M2.5" but only `accounts/fireworks/models/minimax-m2` exists on Fireworks.ai as of 2026-03-06); this must be verified before the first LLM call.

## Key Findings

### Recommended Stack

The stack is anchored by mineflayer 4.35.0 (confirmed Minecraft 1.21.11 support via minecraft-data 3.105.0) and the openai npm package v6 pointing at `https://api.fireworks.ai/inference/v1`. TypeScript 5.9 with `tsx` (not ts-node, which is unmaintained) provides fast iterative development. SQLite via `better-sqlite3` with a synchronous API is the correct database choice — the tactical loop reads and writes between async LLM calls, not inside them, so synchronous DB access eliminates callback complexity. Zod validates all LLM JSON outputs and derives TypeScript types from schemas. Ink provides the terminal dashboard with a React component model.

**Core technologies:**
- `mineflayer ^4.35.0`: Game framework — the only viable choice; confirmed 1.21.11 protocol support
- `mineflayer-pathfinder ^2.4.5`: A* navigation — mineflayer-native, stable; requires `skipLibCheck: true` in tsconfig
- `mineflayer-collectblock ^1.6.0`: Block collection wrapping pathfinder + dig in one call
- `mineflayer-auto-eat ^5.0.3`: Autonomous hunger management — removes hunger polling from tactical loop
- `openai ^6.27.0` with `baseURL: 'https://api.fireworks.ai/inference/v1'`: LLM client for Fireworks.ai
- `better-sqlite3 ^12.6.2`: Synchronous SQLite — correct for this architecture's memory access pattern
- `zod ^4.3.6`: LLM output validation — required for reliable JSON contract enforcement
- `tsx ^4.21.0`: TypeScript execution — replaces unmaintained ts-node
- `ink ^6.8.0`: Terminal dashboard — declarative React-for-CLI; validate in Phase 1 before committing
- `pnpm ^10.x`: Package manager — handles native addon build scripts correctly

**Avoid:** `mineflayer-statemachine` (conflicts with LLM-driven architecture), `prismarine-viewer` (web scope out of v1), `bun` runtime (native addon compatibility risk).

### Expected Features

**Must have (table stakes):**
- Pathfinding with stuck/loop detection — without this nothing works; stuck detection is the most common agent failure
- Health monitoring and eating — bot must survive to demonstrate anything
- Wood-to-stone-to-iron tool progression — minimum viable gameplay arc
- Smelting (furnace) — required for iron tools
- Basic crafting via workbench
- Tool equipping with tier awareness
- Inventory management (drop junk when full)
- Failure escalation from Model B to Model A — makes recovery meaningful
- Death recovery — death is a system-level state reset, not a recoverable action failure
- State persistence across restarts (SQLite semantic + episodic memory)
- Threat detection and day/night awareness — skeletons kill un-prepared bots at night
- Terminal dashboard — developer cannot debug what they cannot observe
- Basic chat response — silent bot feels broken

**Should have (differentiators):**
- Goal narration in chat (low cost, high perceived autonomy)
- Episodic memory-driven adaptation (the feature that makes the bot feel like it learns)
- Autonomous idle goal prioritization (core of "genuinely autonomous")
- Recovery narration when strategy changes
- Player-requested task integration

**Defer to v2+:**
- Base construction and shelter (high complexity, impressive but not required to prove autonomy)
- Crop farming (long-horizon value; hunting works for v1)
- Structured exploration with memory map (add after core loop is stable)
- Multi-step combat (fleeing works for v1)
- Enchanting, Nether, End progression

**Critical path for a functional v1 demo:**
`Pathfinding → Wood collection → Crafting → Stone tools → Iron mining → Smelting → Iron tools → Goal selection loop`

All survival features (health, food, threat) run in parallel and must interrupt the progression arc on threshold breach.

### Architecture Approach

The system is a single Node.js process with five vertical layers: PerceptionLayer computes a compact `PerceptionSnapshot` (not raw world state) at ~1-2 Hz; StrategicPlanner (Model A) fires on discrete events and produces a `GoalPlan` with an ordered `Subgoal[]` sequence; TacticalPlanner (Model B) fires on subgoal handoff and produces an `ActionQueue` of `SkillCall[]`; SkillLayer validates all Model B outputs before any game interaction; ExecutorLayer runs skills, monitors completion with per-action timeouts, and returns structured `ExecutorResult` with 10+ specific error codes. Two SQLite stores (SemanticMemory for world facts, EpisodicMemory for attempt/failure records) feed a `ContextAssembler` that builds typed context structs before each LLM call. An `EventBus` mediates cross-layer communication to prevent circular imports.

**Major components:**
1. `PerceptionLayer` — subscribes to mineflayer events, emits compact `PerceptionSnapshot` at 1-2 Hz
2. `WorkingMemory` — in-process mutable session state (plan, subgoal index, action queue, failure tracking)
3. `SemanticMemory` / `EpisodicMemory` — SQLite with WAL mode; queried by `ContextAssembler`, never loaded raw into prompts
4. `ContextAssembler` — builds `StrategicContext` and `TacticalContext` from memory + snapshot before each LLM call
5. `StrategicPlanner` / `TacticalPlanner` — LLM wrappers with injected `LLMClient` interface (mockable for testing)
6. `SkillLayer` — validates Model B JSON outputs; rejects impossible requests before touching mineflayer
7. `ExecutorLayer` — wraps all mineflayer calls with `Promise.race` timeouts and post-condition checks
8. `EscalationDetector` — pure logic over `ExecutorResult[]`; triggers strategic replanning on failure threshold or wall-clock watchdog
9. `EventBus` — typed pub/sub decoupling all layers; prevents circular imports
10. `Dashboard` + `ChatHandler` — observability and player interaction, reads WorkingMemory + EventBus

### Critical Pitfalls

1. **Pathfinder goal replacement race condition** — `setGoal` is not awaitable; a re-entrant tactical tick issues a second goal before the first resolves, causing oscillation. Prevention: wrap every pathfinder goal in a Promise resolving on `pathGoalReached`/`pathError` plus a movement mutex flag. Build this into the executor from day one.

2. **Control loop re-entrancy** — `setInterval(async () => {...})` does not await completion; overlapping ticks create conflicting action queue updates. Prevention: recursive `setTimeout` pattern only, with a `loopIsRunning` guard and try/catch around the full tick body.

3. **Silent action failures** — `bot.dig` and `bot.placeBlock` do not throw when the server silently rejects them. The executor reports success; downstream crafting fails. Prevention: post-condition validators after every action (check inventory delta or block state at target coordinates).

4. **JSON parse failures stalling the bot** — LLMs output markdown fences even when instructed not to; token truncation produces partial JSON. Prevention: response sanitizer stripping fences, regex-based JSON extraction fallback, explicit `WAIT` action on unrecoverable parse failure, 15s hard timeout on all LLM calls.

5. **Death as action failure (not system reset)** — Without a `bot.on('death')` handler that flushes the action queue and sets `RESPAWNING` state, the bot resumes its pre-death plan with an empty inventory, entering a "need wood → need tools → need wood" infinite loop. Prevention: death handler is mandatory in the executor layer before any survival testing.

6. **Escalation thrash vs. stuck** — Escalating to Model A on every failure burns API tokens and stalls the bot; escalating too rarely means the bot stands still for minutes. Prevention: minimum N=3 consecutive failures per subgoal before escalation, plus a 90-second wall-clock watchdog that forces escalation regardless of failure count.

## Implications for Roadmap

Based on the architecture's dependency graph and the pitfall phase warnings, a 5-phase structure is strongly implied.

### Phase 1: Foundation and Infrastructure
**Rationale:** All other layers depend on types, EventBus, LLM client interface, and memory schemas being correct. SQLite WAL mode, WAL pragmas, and memory indexes must be established before any data is written. The `bot.once('spawn')` initialization pattern and `no-floating-promises` ESLint rule must be in place before any event handlers are written. Getting these wrong causes cascading failures.
**Delivers:** Typed data contracts (`GoalPlan`, `Subgoal`, `ActionQueue`, `SkillCall`, `ExecutorResult`, `PerceptionSnapshot`), `EventBus`, `WorkingMemory`, `LLMClient` interface + mock, `SemanticMemory` + `EpisodicMemory` with correct schema and WAL mode, bot connection with proper spawn initialization, structured logging infrastructure.
**Addresses:** State persistence, observability baseline.
**Avoids:** Pitfall 6 (version/protocol mismatch — assert `bot.version` on startup), Pitfall 9 (unbounded memory growth — indexes from day one), Pitfall 10 (over-querying memory — cache strategy), Pitfall 18 (WAL mode), Pitfall 19 (spawn initialization), Pitfall 15 (async event handler try/catch + ESLint rule).

### Phase 2: Perception and Executor
**Rationale:** The SkillLayer and ExecutorLayer can be built and integration-tested against a live server before any LLM integration. This validates that all game interactions work correctly and that error codes map accurately to mineflayer's actual failure surface. Fixing pathfinder race conditions and post-condition validators here prevents enormous debugging effort later.
**Delivers:** `PerceptionLayer` computing debounced `PerceptionSnapshot` at 1-2 Hz, `ContextAssembler`, all 10 skills (move_to, break_block, craft_item, place_block, equip_item, drop_item, attack_entity, follow_entity, interact_block, send_chat), `ExecutorLayer` with `Promise.race` timeouts and post-condition validators, `EscalationDetector` (pure logic), `EpisodeRecorder`, death recovery handler.
**Addresses:** Pathfinding, stuck detection, tool equipping, basic inventory management.
**Avoids:** Pitfall 1 (pathfinder race condition), Pitfall 4 (control loop re-entrancy), Pitfall 5 (silent action failures), Pitfall 11 (death recovery), Pitfall 13 (error taxonomy completeness), Pitfall 14 (executor timeouts), Pitfall 16 (findBlock performance).

### Phase 3: LLM Integration and Control Loops
**Rationale:** With a validated executor and game state pipeline, the LLM planners can be integrated against real model calls. The two-model hierarchy is implemented here: Model A strategic loop (event-triggered, stateless context construction), Model B tactical loop (recursive setTimeout, loopIsRunning guard). Prompt engineering and JSON schema design happen in this phase.
**Delivers:** `FireworksLLMClient` implementation, `StrategicPlanner` and `TacticalPlanner` with full context assembly, system prompts for both models, Zod schemas for `GoalPlan` and `ActionQueue` validation, JSON response sanitizer and parse fallback, goal narration in chat.
**Uses:** openai ^6.27.0 with Fireworks baseURL, zod ^4.3.6, accounts/fireworks/models/minimax-m2 (verify model ID before first call).
**Addresses:** Basic autonomous goal selection loop, wood-to-iron progression, survival features (health/hunger monitoring with mineflayer-auto-eat).
**Avoids:** Pitfall 2 (LLM hallucinating world state — source validation in executor), Pitfall 3 (JSON parse failures), Pitfall 4 (re-entrant loops), Pitfall 12 (token limit from conversation history — stateless calls only), Pitfall 20 (Model B prompt drift under failures — cap failure history at 5).

### Phase 4: Recovery and Memory-Driven Adaptation
**Rationale:** Once the core loop works end-to-end, the escalation system and episodic memory integration can be tuned. This is where the bot stops being a scripted macro and starts adapting based on experience. The escalation thresholds (N=3 failures, 90-second watchdog) and memory-driven context queries are calibrated here.
**Delivers:** Full failure escalation pipeline (EscalationDetector → StrategicPlanner), wall-clock watchdog timer, episodic memory integration into ContextAssembler prompts, death recovery with Model A `DEATH_RECOVERY` priority flag, smelting (furnace state machine), threat detection and day/night awareness.
**Addresses:** Failure escalation, death recovery, iron-to-full-tool progression, autonomous goal prioritization.
**Avoids:** Pitfall 7 (strategic replanning thrash — minimum N failures + replan interval), Pitfall 8 (never replanning when stuck — wall-clock watchdog).

### Phase 5: Observability and Player Interaction
**Rationale:** Dashboard and chat integration are deliberately last — they depend on WorkingMemory reads and EventBus subscriptions but do not gate any bot functionality. Building them last means the dashboard displays real data from a working system rather than stubs.
**Delivers:** ink-based terminal dashboard (current goal, subgoal, last 5 actions with outcomes, LLM call latency, memory row counts, health/hunger/position), `ChatHandler` routing player messages to StrategicPlanner, recovery narration in chat, basic chat response.
**Addresses:** Terminal dashboard, player-requested task integration, recovery narration.
**Avoids:** Pitfall 17 (no observability).

### Phase Ordering Rationale

- **Types before code** (Phase 1 first): The entire system communicates through typed contracts (`GoalPlan`, `ExecutorResult`, `PerceptionSnapshot`). These must be finalized before any implementation layer.
- **Executor before planner** (Phase 2 before Phase 3): Skills and execution must work correctly before LLM outputs drive them. A manually constructed `ActionQueue` can validate the full execution pipeline without any LLM calls.
- **Core loop before recovery** (Phase 3 before Phase 4): Escalation logic requires a working end-to-end loop to calibrate thresholds against real behavior.
- **Observability last** (Phase 5): Dashboard reads from WorkingMemory and EventBus — it is a consumer, not a producer. It cannot be meaningfully implemented before the data it displays exists.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3:** LLM prompt engineering for MiniMax M2 specifically is unknown territory — prompt structure, JSON schema compactness, token budget, and temperature tuning all require empirical calibration against the actual model. Recommend a spike (prompt prototype against the API) before committing to schema design.
- **Phase 3:** Model ID must be verified — PROJECT.md references "MiniMax M2.5" but only `accounts/fireworks/models/minimax-m2` exists on Fireworks.ai as of research date. Confirm before implementing `FireworksLLMClient`.
- **Phase 4:** mineflayer-pathfinder's built-in stuck detection behavior in v2.4.5 is unverified (web research was unavailable during PITFALLS.md research). Confirm whether pathfinder emits a stuck event or if the executor must implement its own position-history-based stuck detection.

Phases with standard patterns (skip research-phase):
- **Phase 1:** TypeScript project setup, SQLite schema, EventBus, bot initialization — all well-documented with clear best practices.
- **Phase 2:** SkillLayer registry pattern, ExecutorLayer `Promise.race` timeout pattern — established patterns in the mineflayer community.
- **Phase 5:** ink dashboard component model — standard React patterns; dependency injection from WorkingMemory is straightforward.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified against npm registry on 2026-03-06; Fireworks.ai API endpoint confirmed via live probe; Minecraft 1.21.11 support confirmed via minecraft-data dataPaths.json |
| Features | HIGH | Feature categorization consistent across Voyager, GROOT, MineDreamer, Steve-1 research; complexity estimates are MEDIUM confidence |
| Architecture | HIGH | Component boundaries derived from well-specified requirements; data flow patterns match established agentic system designs (ReAct, Voyager); build order is deterministic from the dependency graph |
| Pitfalls | MEDIUM | Web search was unavailable during PITFALLS research; all findings based on training knowledge of mineflayer internals, LLM agent post-mortems, and Node.js async patterns. Items marked for validation during implementation |

**Overall confidence:** HIGH for architecture and stack decisions; MEDIUM for pitfall mitigation specifics pending verification against current library versions.

### Gaps to Address

- **MiniMax model ID:** Verify `accounts/fireworks/models/minimax-m2` is correct and that no `minimax-m2-5` model exists on Fireworks.ai before implementing the LLM client. This is a blocking gap for Phase 3.
- **mineflayer-pathfinder stuck detection:** Verify whether v2.4.5 emits a stuck event natively or if the executor must implement position-history polling. Affects executor design in Phase 2.
- **MiniMax M2 context window size:** Exact token limit is unconfirmed. Affects token budget design for StrategicContext and TacticalContext in Phase 3. Use conservative estimates until confirmed.
- **mineflayer 4.x `bot.dig` timeout behavior:** Exact conditions under which `bot.dig` hangs indefinitely vs. self-times-out are unverified. The executor's `Promise.race` timeout pattern is correct regardless, but timeout durations need calibration during Phase 2 testing.
- **ink peer dependency:** ink ^6.8.0 requires React 19. Validate that React 19 installs cleanly alongside mineflayer's dependency tree before committing to ink. If conflicts arise, fallback to chalk + interval-based stdout refresh.

## Sources

### Primary (HIGH confidence)
- npm registry (`https://registry.npmjs.org/[package]/latest`) — all version data for mineflayer, pathfinder, collectblock, auto-eat, openai, better-sqlite3, tsx, zod, ink
- `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/dataPaths.json` — 1.21.11 support confirmed
- `https://raw.githubusercontent.com/PrismarineJS/mineflayer-pathfinder/master/index.d.ts` — TypeScript types confirmed
- `https://api.fireworks.ai/inference/v1/models` — API endpoint confirmed via live probe (401 in OpenAI format)
- `https://fireworks.ai/models/fireworks/minimax-m2` — model ID `accounts/fireworks/models/minimax-m2` confirmed

### Secondary (MEDIUM confidence)
- Training knowledge: Voyager (Wang et al., 2023) — LLM-powered Minecraft agent, skill library and curriculum learning patterns
- Training knowledge: GROOT (Cai et al., 2023) — hierarchical goal inference for Minecraft
- Training knowledge: MineDreamer (He et al., 2024) / Steve-1 (Lifshitz et al., 2023) — goal-conditioned agent patterns
- Training knowledge: ReAct (Yao et al., 2022) — reason+act loop basis for tactical loop design
- Training knowledge: mineflayer ~4.x behavior patterns, node.js async patterns, SQLite WAL mode behavior
- Training knowledge: LLM agent failure modes from BabyAGI, AutoGPT, Voyager post-mortems

### Tertiary (LOW confidence — needs implementation validation)
- mineflayer-pathfinder v2.4.5 built-in stuck detection behavior — unverified, web unavailable during research
- MiniMax M2 exact context window size — unconfirmed
- mineflayer 4.x `bot.dig` exact timeout/hang behavior — unverified against current source

---
*Research completed: 2026-03-06*
*Ready for roadmap: yes*
