# Domain Pitfalls

**Domain:** LLM-powered autonomous Minecraft bot (mineflayer + TypeScript + two-model hierarchical control loop)
**Researched:** 2026-03-06
**Confidence:** MEDIUM — based on training knowledge of mineflayer internals, LLM agent patterns, and Node.js async. Web verification unavailable; flag critical items for validation against current mineflayer/mineflayer-pathfinder changelogs.

---

## Critical Pitfalls

Mistakes that cause rewrites, infinite loops, or a bot that simply stops working.

---

### Pitfall 1: Pathfinder Goal Replacement Race Condition

**What goes wrong:** The executor calls `pathfinder.setGoal(new GoalNear(...))` and immediately returns, treating the bot as "moving." Before the path is computed, another code path (or a re-entrant tactical loop tick) sets a new goal. The first `pathGoalReached` event never fires. The bot appears stuck. Worse: if the tactical loop polls `bot.pathfinder.isMoving()` before path computation begins, it reads `false` and immediately issues another `setGoal`, creating a rapid-fire loop.

**Why it happens:** `setGoal` is synchronous-looking but the A* computation and actual movement are async. There is no Promise returned by `setGoal`. Code that awaits nothing and checks state immediately will always see a stale value.

**Consequences:** Bot oscillates between two positions, burns CPU on path computation, and never completes movement tasks. The tactical LLM sees repeated `move_to` failures and escalates endlessly to the strategic loop.

**Prevention:**
- Wrap every pathfinder goal in a Promise that resolves on `pathGoalReached` and rejects on `pathError`.
- Use a movement mutex (a simple boolean `isMoving` flag + guard at the top of the executor) that is set before `setGoal` and cleared in the event handlers.
- Never allow the tactical loop to issue a second `move_to` while the flag is set.

**Detection:** Bot position oscillates. Executor logs show repeated `move_to` calls with no intervening `success` outcomes. `pathGoalReached` event count is zero while `setGoal` count is high.

**Phase:** Executor layer (Phase 2 / skill layer foundation).

---

### Pitfall 2: LLM Hallucinating World State

**What goes wrong:** The model is given a compact state snapshot but produces a plan that references blocks, entities, or locations that are not in the snapshot. For example: "go mine the iron ore at (100, 64, -200)" when no iron ore appears in the perception context. The executor faithfully tries to path to those coordinates. Nothing is there. The action fails with `target_unavailable`. The model is called again with the failure — and often doubles down on the hallucinated location because it was confident the first time.

**Why it happens:** LLMs pattern-match on domain knowledge ("iron ore is usually underground near stone") and confabulate specifics. This is especially bad with MiniMax M2.5 if the context window is small and the world state snapshot is sparse.

**Consequences:** Infinite replanning cycle. Bot wanders to random coordinates. Episodic memory fills with `target_unavailable` failures that don't teach the model anything useful.

**Prevention:**
- Require all resource/block references in model output to include a `source` field: `"known_from": "perception"` or `"known_from": "semantic_memory"`. Reject any action targeting a location not currently in perception OR in semantic memory.
- In the executor, validate goal coordinates against known-world data before executing.
- In prompts, be explicit: "Only reference blocks and entities that appear in the current_state snapshot or in the memory entries below. Do not invent locations."

**Detection:** Executor logs show `target_unavailable` on coordinates that never appear in perception snapshots. Semantic memory has no record of the referenced location.

**Phase:** Perception layer + executor validation (Phase 1/2). Prompt engineering (Phase 3).

---

### Pitfall 3: JSON Parse Failures Silently Stalling the Bot

**What goes wrong:** The model outputs valid JSON wrapped in a markdown code fence (` ```json ... ``` `), or appends a reasoning paragraph after the closing brace, or produces a truncated response because the output hit a token limit. The JSON parser throws. The calling code catches the error, logs it, and... does nothing. The control loop has no current plan. The bot goes idle.

**Why it happens:** LLMs frequently output markdown formatting even when instructed not to. Token limits are easy to exceed when prompts are large. Error handling paths are written last and tested least.

**Consequences:** Completely silent bot. No movement, no actions. From the outside it looks like the bot is "thinking." From the inside there is no plan.

**Prevention:**
- Implement a response sanitizer that strips ` ```json ``` ` fences before parsing.
- Implement a JSON repair step: try `JSON.parse`, on failure try `JSON.parse` after extracting the first `{...}` or `[...]` substring with a regex, on second failure log the raw response and fall back to a `WAIT` action (not idle — explicit no-op).
- Set `max_tokens` conservatively on the Fireworks API call and design JSON schemas to be compact enough to always fit.
- Add a hard timeout on LLM calls (e.g., 15s). If the call does not resolve, return a synthetic `{"action": "WAIT", "reason": "llm_timeout"}`.
- Monitor: count parse failures per hour. More than 2-3/hour means schema or prompt is wrong.

**Detection:** Tactical loop call count drops to zero. Bot is stationary. No executor calls logged.

**Phase:** LLM client wrapper (Phase 1). Tighten in Phase 3 when prompts stabilize.

---

### Pitfall 4: Control Loop Re-entrancy / Overlapping Ticks

**What goes wrong:** The tactical loop is implemented as a `setInterval` or recursive `setTimeout`. A tick fires, calls the LLM (async, ~2-5s), and awaits the response. Before the response arrives, the interval fires again. A second LLM call is made. Both calls complete and both try to update the action queue. The queue now has two conflicting action sequences. The executor runs them interleaved.

**Why it happens:** Standard interval timers do not await the previous tick's completion. This is a classic Node.js async mistake: treating `setInterval(async () => {...})` as if it serializes calls.

**Consequences:** Duplicate actions (crafting twice, breaking the same block twice), conflicting state updates, impossible-to-debug behavior because log ordering is non-deterministic.

**Prevention:**
- Use a recursive `setTimeout` pattern, not `setInterval`, with the next tick scheduled only after the current tick's `async` function fully resolves.
- Add a `loopIsRunning` guard at the top of every loop tick. If `true`, skip and reschedule.
- Wrap the entire tick body in a try/catch so an unhandled rejection cannot break the loop silently.

**Detection:** Duplicate executor call IDs in logs. Action queue length grows unexpectedly. LLM call count exceeds 1 per tactical cycle.

**Phase:** Control loop design (Phase 2).

---

### Pitfall 5: mineflayer `bot.dig` / `bot.placeBlock` Silently Failing

**What goes wrong:** `bot.dig(block)` and `bot.placeBlock(referenceBlock, faceVector, item)` do not throw on many failure conditions. If the bot is out of range, the wrong tool is equipped, or the block was already destroyed by another player, the call completes without error but nothing happens. The executor reports `success` because no exception was thrown. The plan proceeds as if the block was mined.

**Why it happens:** mineflayer mirrors Minecraft's client behavior: the client sends the packet, the server silently rejects it, and no error packet is reliably sent back. The library resolves the Promise when the action animation completes, not when the server confirms the outcome.

**Consequences:** Plans built on "I mined that wood" proceed into "craft planks" which fails because no wood is in inventory. The model sees `insufficient_materials` and concludes the tree doesn't exist.

**Prevention:**
- After every `bot.dig`, check `bot.inventory` for the expected item drop OR check that the block at those coordinates is now `air`.
- After every `bot.placeBlock`, check that the block at the target position matches the expected block type.
- Wrap these checks in the executor as post-condition validators. If the post-condition fails, return `action_had_no_effect` (a new error code to add to the taxonomy).
- Enforce tool/range pre-conditions before calling: check `bot.heldItem`, check distance to block.

**Detection:** Inventory stays unchanged after a "successful" dig. Plan consistently fails at craft step despite preceding mine step returning success.

**Phase:** Executor layer (Phase 2).

---

### Pitfall 6: Mineflayer Version / Protocol Mismatch

**What goes wrong:** mineflayer is installed at a version that uses `minecraft-protocol` with a different supported version list than Minecraft 1.21.1 (the server). The bot connects but certain packets are malformed. Block IDs, item IDs, or entity types from the mineflayer registry do not match server reality. The bot sees wrong block types or crashes on certain chunks.

**Why it happens:** Minecraft 1.21.x has seen rapid minor version changes (1.21, 1.21.1, 1.21.4, 1.21.11 as of early 2026). mineflayer releases lag behind server releases. npm's semver resolution may install a minor version that predates 1.21.11 support.

**Consequences:** Silent wrong-block perception (bot thinks it's looking at stone when the server has iron ore). Pathfinder treats passable blocks as solid or vice versa. Intermittent crashes on specific chunk types.

**Prevention:**
- Pin mineflayer and minecraft-protocol to exact versions (`"mineflayer": "4.x.x"` is not enough — use `"4.23.0"` or exact) after verifying the release changelog supports `1.21.11`.
- On bot startup, log `bot.version` and assert it matches the expected server version. Fail fast rather than proceeding with wrong registry data.
- Keep a `package-lock.json` committed and do not update mineflayer casually.

**Detection:** `bot.version` at runtime does not match `1.21.1` or `1.21.11`. Wrong block names in perception snapshots (e.g., seeing `minecraft:stone` where the server has something else).

**Phase:** Infrastructure / setup (Phase 0 / Phase 1 setup).

---

## Moderate Pitfalls

---

### Pitfall 7: Strategic Loop Replanning Thrash

**What goes wrong:** Model A is triggered too eagerly. Any executor failure causes the tactical loop to escalate to Model A. Model A produces a new strategic plan. The new plan has the same first subgoal as the old one (because the world state hasn't changed). Model B runs that subgoal. It fails again. Model A is triggered again within seconds.

**Why it happens:** The escalation condition is "any failure" rather than "persistent failure or novel failure." Model A doesn't know the subgoal was just attempted — there is no "attempts" counter in the context it receives.

**Consequences:** Burn Fireworks.ai API tokens at high rate. Model A latency (~3-8s) stalls the bot while strategic planning happens. Episodic memory fills with identical failure records.

**Prevention:**
- Escalate to Model A only when: (a) the same subgoal has failed N consecutive times (N=3 is a reasonable default), OR (b) the failure code is `unsafe` or `invalid_state` (which Model B cannot resolve), OR (c) a player sends a chat message.
- Pass "last N failure codes for this subgoal" to Model A so it has context to produce a genuinely different plan.
- Implement a minimum re-plan interval (e.g., 30 seconds) that can only be overridden by player messages or `unsafe` failures.

**Detection:** Model A call rate exceeds 1 per 60 seconds during normal operation (excluding startup). Episodic memory shows repeated identical failure sequences.

**Phase:** Control loop design (Phase 2) + recovery system (Phase 4).

---

### Pitfall 8: Never Replanning When Stuck (Opposite of Thrash)

**What goes wrong:** The bot is caught in a state where every tactical action fails, but the failure codes are all "soft" (e.g., `no_path`, `target_unavailable`). The tactical loop retries with exponential backoff or similar. It never escalates to Model A. The bot stands still for minutes or hours.

**Why it happens:** The escalation threshold is set too high to prevent thrash (see Pitfall 7), but the minimum-failures-before-escalation counter resets on each new action type, so the same location-based failure never accumulates enough count.

**Consequences:** Bot does nothing. From the outside looks like it's "thinking." Terminal dashboard shows same subgoal for extended time.

**Prevention:**
- Track wall-clock time since last successful action completion, not just failure count. If more than 90 seconds pass without a success, force escalation to Model A regardless of failure count.
- Treat `no_path` and `target_unavailable` as stuck indicators if they appear more than twice for the same subgoal.
- Add a watchdog timer in the control loop. If no action completes in X seconds, log a WARNING and trigger replanning.

**Detection:** Same subgoal in terminal dashboard for >90 seconds. `last_success_at` timestamp is stale.

**Phase:** Recovery system (Phase 4), but watchdog timer should be in Phase 2.

---

### Pitfall 9: Semantic Memory Growing Unbounded

**What goes wrong:** Every "learned fact" is inserted into SQLite without a TTL or deduplication strategy. The bot explores a large map. Every observed block, entity, and route gets an entry. After several hours, the semantic memory has tens of thousands of rows. Queries that look for "nearest iron ore" do a full table scan (or even worse, load all rows into the context string for the LLM).

**Why it happens:** SQLite writes are easy. Reads are free. There's no natural forcing function to think about cleanup until performance degrades.

**Consequences:** Memory queries slow to >500ms. The context string passed to models balloons. Token costs rise. Eventually, the perception-to-prompt pipeline stalls the loop.

**Prevention:**
- Index the `location` column and all `fact_type` columns from day one.
- Implement a maximum N rows per fact type (e.g., keep only the 100 most recent ore observations, preferring high-confidence ones).
- Add a `last_confirmed_at` timestamp to every row. Rows older than X game-ticks without re-observation are marked `stale` and excluded from active queries (but not deleted — can be useful for replanning).
- Never load raw memory rows into LLM context. Always summarize: "5 iron ore deposits known within 200 blocks."

**Detection:** SQLite file size > 10MB after a few hours. Memory query latency > 100ms.

**Phase:** Memory design (Phase 1), schema must be right from the start.

---

### Pitfall 10: Over-Querying Memory on Every Tactical Tick

**What goes wrong:** The tactical loop, on every tick, queries semantic memory for "nearby resources," "known routes," and "recent failures." Each query hits SQLite. With a tactical loop frequency of every 2-5 seconds, this is 12-30 SQLite queries per minute, each potentially scanning thousands of rows.

**Why it happens:** SQLite reads feel "free" in development with small data. The query is added to the tick because "it might be useful context."

**Consequences:** In production with months of accumulated memory, tactical tick latency rises. The event loop is occupied with DB I/O, delaying mineflayer event processing, which causes missed `entityHurt`, `death`, and `blockUpdate` events.

**Prevention:**
- Cache memory query results in working memory. Refresh the cache only when: (a) the bot moves more than 50 blocks, (b) the subgoal changes, or (c) an explicit memory invalidation event fires.
- Separate "hot" working memory (in-process object, updated constantly) from "cold" semantic memory (SQLite, queried rarely). The tactical loop should read only working memory.

**Detection:** Node.js event loop lag > 20ms sustained (measure with `perf_hooks`). Mineflayer events arriving late relative to actual game time.

**Phase:** Memory architecture (Phase 1).

---

### Pitfall 11: Death Recovery Not Implemented = Infinite Stuck State

**What goes wrong:** The bot dies (fall damage, mob attack, starvation). mineflayer fires the `death` event. No handler exists. The bot's internal state still says "current subgoal: mine iron at (X, Y, Z)." On respawn, the bot is at spawn point. The tactical loop tries to resume from the pre-death state. The first action is `move_to` the last known position. The bot starts walking. But inventory is empty (items dropped on death). The next action in the queue requires a pickaxe. `tool_missing`. Failure. Escalate to Model A. Model A says "get a pickaxe" — but the bot has no wood to craft one. Infinite escalation.

**Why it happens:** Death is treated as a recoverable action failure rather than a system-level state reset.

**Consequences:** Bot stuck in a "get wood -> can't get wood without tools -> get tools -> need wood" loop.

**Prevention:**
- Register a `bot.on('death', ...)` handler in Phase 2 that: (1) clears the current action queue, (2) sets working memory state to `RESPAWNING`, (3) writes an episodic memory entry for the death (cause, location, inventory at time of death), (4) after respawn fires the `spawn` event again, triggers Model A with a `DEATH_RECOVERY` priority flag.
- Model A's death recovery context must include: "inventory is now empty, last known item drops are at (coordinates), nearest starting resources are..."
- Automatically collect dropped items if they are within reasonable distance.

**Detection:** `bot.health === 0` with no action queue flush. Episodic memory has no death entries despite in-game deaths visible in server logs.

**Phase:** Executor layer event handling (Phase 2) + recovery system (Phase 4).

---

### Pitfall 12: Token Limit Exceeded Mid-Conversation

**What goes wrong:** Model A is implemented as a stateful conversation (messages array passed with each call for "memory"). Over many strategic cycles, the messages array grows. Eventually the total tokens exceed MiniMax M2.5's context window. The API returns an error (or silently truncates the beginning). The model loses its earliest instructions, including the system prompt behavior, and begins acting erratically.

**Why it happens:** Conversation-style prompting feels natural but accumulates silently. There is no automatic truncation in the OpenAI-compatible client.

**Consequences:** Model A begins producing mal-formed plans or ignoring JSON output requirements. The bot's behavior degrades gradually, not all at once, making it hard to identify the root cause.

**Prevention:**
- Do not use conversation history for Model A. Each Model A call is stateless: construct the full context from working memory + recent episodic memory + current perception snapshot. This is the correct design for an agent (memory is explicit, not implicit conversation history).
- If conversation history is used for any purpose, implement a sliding window with explicit token counting (use `tiktoken` or a character-based approximation).
- Set a hard `max_tokens` on every API call and verify the input is within limits before sending.

**Detection:** Model A outputs stop matching the JSON schema. API error logs show `context_length_exceeded`. Token count in calls monotonically increases.

**Phase:** LLM client wrapper (Phase 1) + Model A design (Phase 3).

---

### Pitfall 13: Executor Error Taxonomy Is Incomplete or Ambiguous

**What goes wrong:** The project correctly specifies structured error codes (`no_path`, `interrupted`, `insufficient_materials`, etc.). But in practice, mineflayer surfaces many failure conditions that don't map cleanly to any of these. For example: pathfinder emits `path_update` with status `"noPath"` which is different from `"timeout"`. A crafting failure might be "recipe unknown" (model asked to craft something that doesn't exist) vs "missing materials." These all collapse to `no_path` or `insufficient_materials` and the model cannot distinguish them.

**Why it happens:** The error taxonomy is designed up front from the model's perspective, not from mineflayer's actual failure surface.

**Consequences:** Model B receives ambiguous error codes. It applies the wrong recovery strategy. `recipe_unknown` looks like `insufficient_materials` so the bot goes out to gather more materials for a recipe that doesn't exist.

**Prevention:**
- Map every mineflayer failure event and Promise rejection type to a specific error code during executor design. Maintain this as a table in the codebase (not just in PROJECT.md).
- Add `recipe_unknown`, `action_had_no_effect`, `server_rejected`, and `bot_died` to the error taxonomy.
- Include `details` as a structured field in every executor result: `{code: "no_path", details: {reason: "timeout", attempts: 3, last_pos: {...}}}`.

**Detection:** Model B makes the same wrong recovery decision repeatedly. Executor logs show a variety of raw mineflayer errors being mapped to the same code.

**Phase:** Executor design (Phase 2).

---

### Pitfall 14: No Timeout on Executor Actions

**What goes wrong:** `bot.dig(block)` is called. The block is at the edge of range. The bot never gets close enough. The `dig` coroutine hangs forever (or mineflayer's internal timeout is very long). The executor awaits it. The tactical loop is blocked. No new actions are issued. The bot is frozen.

**Why it happens:** Mineflayer actions have internal timeouts for some operations but not all. Digging, pathfinding, and interaction have different timeout behaviors that aren't clearly documented.

**Consequences:** Bot freezes on any action that enters a pathological waiting state. The only recovery is a process restart.

**Prevention:**
- Wrap every executor action in a `Promise.race([actionPromise, timeoutPromise(N)])`.
- Use per-action-type timeouts: movement 30s, dig 10s, place 5s, craft 10s, interact 5s.
- On timeout, cancel the action (call `bot.pathfinder.stop()`, `bot.stopDigging()` as appropriate) and return `timed_out`.

**Detection:** Executor log shows an action start with no corresponding completion after >30s. Tactical loop shows no activity.

**Phase:** Executor layer (Phase 2).

---

## Minor Pitfalls

---

### Pitfall 15: TypeScript `await` Inside `bot.on` Callbacks

**What goes wrong:** An async handler is registered with `bot.on('chat', async (username, message) => { await doSomething(); })`. If `doSomething()` throws, the Promise rejection is unhandled. Node.js 15+ will crash the process on unhandled Promise rejections. Older Node.js will silently swallow it.

**Prevention:**
- Wrap every `async` event handler body in try/catch.
- Add a global `process.on('unhandledRejection', ...)` handler that logs and decides whether to crash or continue.
- Lint rule: `no-floating-promises` from `@typescript-eslint` catches these at compile time.

**Phase:** Phase 1 setup. Add the ESLint rule from the start.

---

### Pitfall 16: Mineflayer `bot.findBlock` Performance

**What goes wrong:** `bot.findBlock({ matching: blockType, maxDistance: 64 })` does a synchronous search through up to 64^3 = 262,144 blocks. If called frequently (e.g., every tactical tick), this blocks the Node.js event loop for 10-50ms per call.

**Prevention:**
- Call `findBlock` only when the subgoal changes, not on every tick.
- Cache the result in working memory. Invalidate when the bot moves significantly or a `blockUpdate` event fires for a nearby block.
- Prefer `bot.findBlocks` (plural) with a `count` limit to get the top N results once.

**Phase:** Perception layer (Phase 1).

---

### Pitfall 17: No Observability = Impossible Debugging

**What goes wrong:** The bot behaves unexpectedly (oscillates, ignores goals, crashes). There are no structured logs. The only output is console.log statements. To debug, a developer must add logging and reproduce — but the problem only occurs after 20 minutes of autonomous operation.

**Prevention:**
- Implement structured logging from Phase 1: every LLM call gets an ID, every executor call references the LLM call ID, every action result references the executor call ID. This creates a traceable chain.
- Terminal dashboard (required by PROJECT.md) should display: current strategic goal, current subgoal, last 5 actions with outcomes, LLM call latency, memory row count.
- Write executor action start/end to a log file (not just stdout) so post-mortem analysis is possible.
- Log the full LLM prompt+response (to a debug file, not stdout) for at least the last 10 calls. This is invaluable for diagnosing prompt issues.

**Phase:** Phase 1 (logging infrastructure) and Phase 3 (terminal dashboard).

---

### Pitfall 18: SQLite WAL Mode Not Enabled

**What goes wrong:** SQLite defaults to journal mode DELETE. Concurrent reads (tactical loop reading memory) and writes (episodic memory writes after each action) take out locks that block each other. With write frequency of ~1/second and read frequency of ~1/5 seconds, lock contention causes visible stalls.

**Prevention:**
- Enable WAL mode on first connection: `PRAGMA journal_mode=WAL;`
- Enable `PRAGMA synchronous=NORMAL;` for performance without meaningful durability loss.
- These two pragmas reduce write amplification and allow concurrent readers with writers.

**Phase:** Memory initialization (Phase 1).

---

### Pitfall 19: Forgetting `bot.once('spawn', ...)` for Initialization

**What goes wrong:** Bot initialization code runs before the bot has fully spawned (received chunks, initialized physics). Calls to `bot.entity.position` return null or incorrect values. `bot.findBlock` finds nothing because chunks aren't loaded. Pathfinder fails because the world model is empty.

**Prevention:**
- All initialization beyond basic connection setup must happen inside a `bot.once('spawn', ...)` handler.
- Perception layer must check `bot.entity` is non-null before reading position.
- Add a startup readiness check: wait for `bot.world.getColumn(bot.entity.position.x, bot.entity.position.z)` to return a valid chunk before starting the control loop.

**Phase:** Phase 1 bot setup.

---

### Pitfall 20: Model B Prompt Drift Under Repeated Failures

**What goes wrong:** Model B is given increasingly long failure histories as context (to help it understand why previous actions failed). After 10+ failures, the prompt is dominated by failure narrative. The model's attention shifts toward explaining failures rather than proposing new actions. Output quality degrades.

**Prevention:**
- Cap failure history in Model B context to the last 5 failures for the current subgoal.
- Summarize older failures: "Attempted move_to 8 times, all returned no_path" rather than listing each attempt.
- Separate failure context from action-proposal context in the prompt structure: failures first (brief), then "Given this, what is the next action?" as a clear instruction.

**Phase:** Phase 3 (prompt engineering).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Bot initialization (Phase 1) | Code runs before spawn — null entity | All setup in `bot.once('spawn')` handler |
| Perception layer (Phase 1) | `bot.findBlock` blocking event loop | Cache results, call only on subgoal change |
| Memory schema (Phase 1) | Unbounded growth, no indexes | Index location/fact_type, add TTL from day one |
| Memory init (Phase 1) | SQLite lock contention | Enable WAL mode immediately |
| Executor design (Phase 2) | Silent action failures (dig, place) | Post-condition validators after every action |
| Executor design (Phase 2) | No timeouts = frozen bot | `Promise.race` with per-action-type timeouts |
| Executor design (Phase 2) | Incomplete error taxonomy | Map ALL mineflayer failure surfaces before coding |
| Control loop (Phase 2) | Re-entrant overlapping ticks | Recursive setTimeout + `isRunning` guard |
| Control loop (Phase 2) | Pathfinder race condition | Movement mutex + Promise-wrapped `setGoal` |
| Strategic model (Phase 3) | Growing conversation history | Stateless calls, explicit context construction |
| Tactical model (Phase 3) | Prompt drift under failures | Cap failure history, summarize old failures |
| Recovery system (Phase 4) | Death leaves bot in impossible state | `death` event must flush state and trigger Model A |
| Recovery system (Phase 4) | Thrash vs. stuck — wrong threshold | Wall-clock watchdog AND minimum-failures escalation |
| Version pinning (setup) | Wrong block IDs, protocol mismatch | Pin exact mineflayer version, assert `bot.version` on startup |

---

## Sources

- Training knowledge: mineflayer source code and documentation (PrismarineJS ecosystem), assessed against known mineflayer ~4.x behavior patterns
- Training knowledge: LLM agent control loop failure modes (ReAct, BabyAGI, AutoGPT post-mortems, Voyager paper)
- Training knowledge: Node.js async patterns and event loop blocking behavior
- Training knowledge: SQLite performance characteristics (WAL mode, lock contention)
- **Confidence caveat:** WebSearch and WebFetch were unavailable during this research session. All claims are MEDIUM confidence. The following should be verified against current sources before implementation:
  - Exact mineflayer 4.x timeout behavior for `bot.dig` and `bot.placeBlock`
  - Whether mineflayer-pathfinder's current version has built-in stuck detection
  - MiniMax M2.5 exact context window size (affects token limit guidance)
  - Fireworks.ai API error codes for context-length exceeded
