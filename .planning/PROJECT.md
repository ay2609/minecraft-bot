# minecraft-bot

## What This Is

An LLM-powered autonomous Minecraft bot built on mineflayer (Node.js/TypeScript) that plays Minecraft as a genuine agent — choosing its own goals, managing multi-step plans, recovering from failures, and communicating with players. It uses a two-model architecture (both MiniMax M2.5 via Fireworks.ai) with a layered perception/memory/planning/execution stack, connecting to a local Minecraft 1.21.11 vanilla server.

## Core Value

The bot should feel like a competent, persistent player — not a command executor. It pursues meaningful goals on its own, recovers when plans break, and doesn't require babysitting.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **Perception layer** — live game state converted to compact structured snapshots (position, health, inventory, nearby entities/blocks, current action, recent failures)
- [ ] **Working memory** — in-process structured state holding current plan, subgoal, action queue, constraints, and immediate context
- [ ] **Semantic memory** — SQLite store of durable world facts (locations, resources, routes, structures, server rules, social context)
- [ ] **Episodic memory** — SQLite store of attempts, failures, successes, interrupted plans, and learned patterns with timestamps
- [ ] **Executor layer** — validates and runs mineflayer actions, monitors progress, checks completion, returns structured error codes (no_path, interrupted, insufficient_materials, inventory_full, tool_missing, unsafe, timed_out, target_unavailable, route_blocked, invalid_state)
- [ ] **Tool/skill layer** — high-level game actions callable by Model B: move_to, follow_entity, place_block, break_block, craft_item, drop_item, equip_item, interact_block, attack_entity, send_chat
- [ ] **Model B (tactical loop)** — faster-cycling loop that manages the current action queue, selects next actions, reacts to executor results, and advances the current subgoal without calling Model A constantly
- [ ] **Model A (strategic loop)** — slower loop that chooses long-horizon goals, justifies priorities, produces subgoal sequences with success/abort conditions, and hands off to Model B
- [ ] **Hierarchical control loop** — slow strategic loop (event-triggered) + medium tactical loop (completion/failure-triggered), neither loop drives frame-by-frame behavior
- [ ] **Player communication** — bot monitors chat, routes player messages to Model A (strategic trigger), responds in chat as part of its actions
- [ ] **Open-ended autonomy** — internal prioritization logic for survival, exploration, resource gathering, construction, progression; bot selects its own objectives when idle
- [ ] **Recovery system** — detects stalled/repeated-failure patterns, escalates to Model A for strategy revision rather than looping forever
- [ ] **Persistence** — bot state (current plan, memory) survives restarts; resumes from where it left off
- [ ] **Terminal dashboard** — real-time CLI display of current strategic goal, current action queue, last model decisions, recent executor outcomes, memory stats

### Out of Scope

- Web dashboard UI — terminal dashboard is sufficient for v1; web UI adds complexity without changing bot behavior
- Multi-bot coordination — single bot first; multi-agent later
- Plugin/mod support — targeting vanilla server only; Paper/Spigot support can be added later
- Visual/screenshot perception — mineflayer's programmatic APIs provide richer structured data than vision
- Fine-grained motor control in model outputs — all low-level movement handled by mineflayer-pathfinder in code

## Context

- **Server**: Minecraft 1.21.11 vanilla, running via Docker (`itzg/minecraft-server`) at `localhost:25565`, `ONLINE_MODE=FALSE` (no auth required)
- **Runtime**: mineflayer + mineflayer-pathfinder for all game interaction
- **LLM**: Fireworks.ai API (OpenAI-compatible endpoint), MiniMax M2.5 for both Model A and Model B — same model, different system prompts and call cadences
- **Memory storage**: SQLite for semantic and episodic memory (durable, structured, queryable, no infrastructure overhead)
- **Language**: TypeScript + Node.js — natural fit for mineflayer ecosystem

## Constraints

- **LLM**: Fireworks.ai API only — must use OpenAI-compatible client pointed at Fireworks endpoint
- **Model**: MiniMax M2.5 for both planning roles — no fallback model configured in v1
- **Server**: Minecraft 1.21.11 vanilla — mineflayer must match protocol version
- **Output format**: Both models must output strict JSON — no natural-language-only responses allowed in production paths
- **Anti-patterns (hard)**: No raw state dumps to models, no model-driven motor control, no replanning after every action, no vague failure taxonomy, no monolithic prompt

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + Node.js | mineflayer is Node.js-native; TypeScript adds reliability to a complex async system | — Pending |
| Same model for Model A and B | User has one API key/model; differentiation is via system prompt + call frequency, not model capability | — Pending |
| SQLite for persistent memory | No infrastructure to run, structured queries, works offline, easy to inspect | — Pending |
| Fireworks.ai OpenAI-compatible client | Use `openai` npm package with `baseURL` overridden to Fireworks endpoint — minimal wrapper code | — Pending |
| In-process working memory | Working memory is ephemeral per-session state; no benefit to externalizing it | — Pending |
| mineflayer-pathfinder for navigation | Mature, well-tested A* pathfinder built for mineflayer; executor layer wraps it | — Pending |

---
*Last updated: 2026-03-06 after initialization*
