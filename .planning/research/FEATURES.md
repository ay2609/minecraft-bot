# Feature Landscape

**Domain:** LLM-powered autonomous Minecraft bot (mineflayer + two-model hierarchical agent)
**Researched:** 2026-03-06
**Confidence:** HIGH for feature categorization (strong training signal from Voyager, GROOT, MineDreamer, and mineflayer community patterns); MEDIUM for complexity estimates

---

## Table Stakes

Features the bot must have or it fails at basic gameplay. Missing any of these means the bot dies, gets stuck, or is useless to watch.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Health monitoring and eating** | A bot that starves to death in 10 minutes is a demo failure. | Med | Hunger threshold triggers food retrieval/eating before starvation; requires food in inventory or interrupting current task to forage. Must handle "no food available" case without looping. |
| **Death recovery** | Bots die. Without recovery, the run is over. | Med | On death: respawn detection, optionally navigate back to death location to recover items, re-assess current plan validity, resume or replan. |
| **Basic pathfinding (move_to)** | Can't do anything without movement. | Low | mineflayer-pathfinder handles A*; executor layer wraps it. Needs timeout and stuck detection. |
| **Stuck/loop detection** | Bots that spin in place or repeat the same failing action indefinitely are unusable. | Med | Track position history and recent action history; if no progress in N seconds/M attempts, escalate. This is the single most common failure mode in LLM agents. |
| **Wood-to-stone tool progression** | Bare minimum resource pipeline: punch tree, craft planks, craft sticks, craft workbench, craft wooden pickaxe, mine stone, craft stone tools. | Med | Requires crafting recipe knowledge baked into Model B context or a recipe lookup layer. Sequence has strict ordering — each step depends on the previous. |
| **Inventory management (basic)** | Full inventory causes action failures. | Med | Detect full inventory; decide what to drop (prefer junk over tools/food); executor must propagate `inventory_full` error. |
| **Tool equipping** | Mining without the right tool is 3-10x slower; some blocks require specific tiers. | Low | equip_item before break_block; tier awareness (stone pick can't mine iron-tier blocks). |
| **Crafting via workbench** | Most useful items require a crafting table. | Med | Place workbench, open, craft, optionally pick up workbench. Must handle "no wood for workbench" upstream. |
| **Failure escalation to Model A** | Without this, Model B loops on stuck states forever. | Med | Model B tracks consecutive failure counts per action type; exceeding threshold triggers Model A re-evaluation. This is what makes the recovery system meaningful. |
| **State persistence across restarts** | Bot restarts during development are frequent. Without persistence, it re-learns everything and repeats initialization. | Med | SQLite semantic + episodic memory must be written before process exit; on startup, load prior plan and context. |
| **Basic chat response** | Bot ignores players = feels broken and untrustworthy. | Low | Monitor chat events; route player messages through Model A; respond in chat using send_chat. Doesn't need to be smart — just must not be silent. |
| **Terminal dashboard** | Developer can't debug a bot they can't observe. | Med | Real-time display of: current goal, current action queue, last model output, last executor result, memory counts, health/hunger/position. Blessed or plain stdout. |
| **Resource collection (wood, stone, coal, iron)** | These four unlock the entire early-game progression. | Med | Navigate to resource, mine enough, return. Must handle "resource not nearby" by exploring. |
| **Smelting (furnace)** | Raw iron is useless without a furnace; this is required for iron-tier tools. | Med | Craft furnace, place it, smelt ore with coal fuel, retrieve output. Adds state machine complexity (furnace is not instant). |
| **Threat detection (hostile mobs)** | Skeletons and creepers kill new bots fast, especially at night. | Med | Detect nearby hostile mobs from perception layer; trigger flee or fight response based on health/equipment state. |
| **Day/night awareness** | Nights spawn hostile mobs; a bot that ignores time of day dies regularly. | Low | Read game time from mineflayer; surface mining/exploring at night is a threat. Seek shelter or continue underground when it's dark. |

---

## Differentiators

Features that make the bot feel like a genuine autonomous agent rather than a scripted macro. Not required for viability, but required for the "wow, it's actually playing" reaction.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Goal narration in chat** | "I'm heading to the mountains to find iron" — bot announces its reasoning, making autonomy legible to observers. | Low | Model A produces a one-line rationale with each goal selection; bot announces it unprompted. Transforms "what is it doing?" into "oh it decided to do X." |
| **Iron-to-diamond progression (full pipeline)** | Demonstrates multi-session, multi-phase planning. The bot actually plays the game. | High | Requires: iron ore → smelt → iron tools → find diamonds → diamond pick → enchantment table (optional). Spans multiple sessions. Semantic memory is essential for tracking progress. |
| **Base construction (shelter)** | Bot builds a house it returns to at night, showing spatial planning and construction. | High | Choose a location, plan a layout, place blocks in sequence, remember location. Model A must break "build shelter" into a 20-50 block placement sequence. |
| **Bed placement and sleep** | Sets respawn point, skips nights safely. Bot that uses a bed feels like it understands the game. | Med | Craft bed (requires wool from sheep), place in shelter, sleep when night arrives. Requires sheep hunting which adds mob interaction. |
| **Episodic memory-driven adaptation** | "Last time I went north I fell in lava — I'll avoid that route." Uses past failures to change future behavior. | High | Requires episodic memory integration in Model A's planning prompt. Most LLM agent demos skip this; it's the feature that makes the bot feel like it learns. |
| **Autonomous goal prioritization (idle logic)** | When no task is active and no player gives direction, bot decides what to do next based on its state. | High | Model A evaluates: health/food state, current tool tier, time of day, known resources, proximity to goals. Produces a justified next goal. This is the core of "genuinely autonomous." |
| **Recovery narration** | "My last three attempts to mine here failed — switching strategy." Bot explains why it changed course. | Low | Pairs with failure escalation; Model A's replanning output includes a brief reasoning note that goes to chat. |
| **Crop farming** | Bot plants wheat/carrots/potatoes for a sustainable food supply rather than hunting food each time. | High | Requires hoe, water source management, bone meal optionally, harvest timing. Demonstrates long-horizon planning (plant now, harvest later). |
| **Player-requested tasks** | "Mine 32 iron for me" — bot takes direction from players and integrates it with its own goals. | Med | Model A receives player message as high-priority context injection; re-evaluates current goal against player request; may defer or execute immediately. |
| **Multi-step combat (sword + shield or bow)** | Bot engages hostile mobs with appropriate weapons and retreats when health drops. | High | Requires: equip sword/bow, maintain distance for bow, retreat threshold, consume food mid-fight. Not required for survival (fleeing works) but impressive when it fights. |
| **Structured exploration with memory** | Bot marks explored areas in semantic memory, prioritizes unexplored regions, builds a mental map. | High | Record chunk coordinates visited; when searching for a resource, bias toward unexplored directions. Prevents the bot from endlessly re-scanning the same 20-block radius. |
| **Enchanting table usage** | End-game behavior; demonstrates the bot can chain complex multi-step unlocks (bookshelves needed for higher enchants). | Very High | Complexity spike: requires diamond tools, lapis, XP farming. Impressive but deep-late-game. Better as a future milestone. |

---

## Anti-Features

Things to deliberately NOT build in v1. Each has a clear reason and a v1 alternative.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Web dashboard / GUI** | Doubles UI surface area; doesn't change bot behavior; web socket infrastructure adds maintenance overhead. | Terminal dashboard with Blessed or plain stdout. It's sufficient for observability. |
| **Multi-bot coordination** | Completely different problem domain — requires consensus, communication protocol, task partitioning. Adds complexity before single-bot baseline is solid. | Nail single-bot autonomy first. Multi-bot is a future milestone. |
| **Visual/screenshot perception** | mineflayer's programmatic APIs return richer structured data than GPT-4V would extract from screenshots — with far less latency and cost. | Use mineflayer's block/entity/inventory APIs for perception. Structured > visual for this use case. |
| **Custom Minecraft mods/plugins** | Targeting vanilla server only. Mod support changes the game state API contract, multiplies test surface. | Stay vanilla 1.21.11. All features must work without server-side mods. |
| **Fine-grained motor control in model outputs** | LLMs produce dx/dy/dz vectors slowly and imprecisely. This was tried early in Minecraft AI research and abandoned. | All movement delegated to mineflayer-pathfinder. Models output goals, not movements. |
| **Replanning after every action** | Calls Model A on every action step — costs money, adds latency, thrashes plans before they can execute. | Model A plans at goal-level; Model B manages action sequences. Replanning only on escalation. |
| **Raw game-state dumps to models** | Sending full world state (thousands of blocks) to the LLM exceeds context windows and adds noise. | Perception layer produces compact structured snapshots with only relevant entities/blocks in range. |
| **Vague failure taxonomy** | "Error" or "failed" forces the model to guess what went wrong. Unusable for targeted recovery. | Executor returns structured error codes: no_path, interrupted, insufficient_materials, inventory_full, tool_missing, unsafe, timed_out, target_unavailable, route_blocked, invalid_state. |
| **Villager trading automation** | High complexity (finding village, identifying trades, acquiring emeralds via trading chains), low payoff for v1. | Vanilla resource progression covers all v1 needs without trading. |
| **PvP against human players** | Ethically borderline on shared servers; complex hit-registration timing, prediction, strafing. | Bot targets hostile mobs only. Player-vs-bot combat is defensive (flee/retaliate if attacked). |
| **Redstone circuits** | Requires understanding of pulse logic, tick timing, item movers. Enormous feature surface for marginal v1 value. | Craft and place simple functional blocks (furnaces, chests, beds). No Redstone automation. |
| **Nether/End progression** | Requires portal construction, specialized equipment, very different threat profile. Risk of permanent death outweighs v1 value. | Stay in Overworld. Nether is a future milestone after survival and construction are stable. |

---

## Feature Dependencies

```
Pathfinding (move_to)
  ├── Resource collection (requires navigation to blocks)
  │     ├── Wood collection
  │     │     └── Crafting (requires planks/sticks)
  │     │           ├── Workbench placement
  │     │           │     ├── Wooden tools → Stone tools
  │     │           │     │     └── Stone pickaxe → Coal, Iron ore mining
  │     │           │     │           └── Furnace crafting → Smelting
  │     │           │     │                 └── Iron tools → Iron pickaxe
  │     │           │     │                       └── Diamond mining (deep)
  │     │           │     └── Bed crafting (requires wool → sheep mob interaction)
  │     │           └── Swords (requires iron tools upstream)
  │     └── Stone collection → Furnace crafting
  │
  ├── Threat detection → flee/fight response
  │     └── Combat (requires sword equipped → tool equipping)
  │
  └── Exploration → Structured memory of locations
        └── Semantic memory of resources → faster future gathering

Health/food monitoring (independent, parallel to all above)
  └── Eating → requires food in inventory → food collection task

Death recovery
  ├── Respawn detection (mineflayer event)
  └── Inventory check on respawn → replan if tools lost

Stuck detection → failure escalation → Model A replanning
  └── Episodic memory logging (records failure patterns)

State persistence
  └── SQLite semantic + episodic write on exit → read on startup
```

**Critical path for a functional v1 demo:**
`Pathfinding → Wood collection → Crafting → Stone tools → Iron mining → Smelting → Iron tools → Goal selection loop`

All survival features (health, food, threat) run in parallel to this progression and must interrupt it on threshold breach.

---

## MVP Recommendation

Prioritize in this order:

1. **Perception layer + executor with error codes** — everything else depends on reliable game state and action results
2. **Pathfinding + stuck detection** — without movement and loop detection, nothing works
3. **Health/hunger monitoring + eating** — bot must survive long enough to demonstrate anything
4. **Wood collection + crafting + stone tools** — minimum viable progression
5. **Iron mining + smelting + iron tools** — completes the core progression arc
6. **Model B tactical loop** — action queue management, handles most moment-to-moment decisions
7. **Model A strategic loop + goal selection** — long-horizon planning, idle goal prioritization
8. **Failure escalation + recovery** — escalate stuck Model B to Model A replanning
9. **Semantic + episodic memory** — persistence and adaptation
10. **Terminal dashboard** — observability without which debugging is blind
11. **Basic chat response** — player interaction (low effort, high perceived quality)

**Defer to v2:**
- Base construction (shelter + bed): High complexity, impressive but not required for proving autonomy
- Crop farming: Long-horizon value, but survival via hunting is sufficient for v1
- Structured exploration with memory map: Worthwhile but add after core loop is stable
- Player-requested tasks: Nice, but autonomous goal loop should come first
- Enchanting, Nether, End: Future milestones

---

## Complexity Notes

**"Low" complexity** means: straightforward mineflayer API call, no state machine, solvable in under 100 lines.

**"Medium" complexity** means: requires a state machine or multi-step coordination, 100-400 lines, likely needs a dedicated module.

**"High" complexity** means: involves multi-session planning, significant model prompt engineering, or interaction between multiple subsystems. 400+ lines, can cause cascading failures elsewhere if done wrong.

**"Very High" complexity** means: full new feature domain (e.g., enchanting requires XP mechanics, bookshelves, enchant randomness). Save for after v1 is stable.

---

## Sources

- Training knowledge: mineflayer npm package documentation (high confidence — stable API)
- Training knowledge: Voyager (Wang et al., 2023) — LLM-powered Minecraft agent with skill library and curriculum learning
- Training knowledge: GROOT (Cai et al., 2023) — hierarchical goal inference for Minecraft
- Training knowledge: MineDreamer (He et al., 2024) — goal-conditioned Minecraft agent
- Training knowledge: Steve-1 (Lifshitz et al., 2023) — instruction-following Minecraft agent
- Training knowledge: mineflayer-pathfinder documentation — A* pathfinder, goal types, movement options
- Confidence on feature categorization: HIGH (consistent across multiple research lines)
- Confidence on complexity estimates: MEDIUM (actual complexity depends on implementation choices)
