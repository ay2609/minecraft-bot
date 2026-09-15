# minecraft-bot

An LLM-driven Minecraft bot with a strategic/tactical planning loop, built with mineflayer and TypeScript.

## What it is

A [mineflayer](https://github.com/PrismarineJS/mineflayer)-based Minecraft bot whose behavior is
driven by an LLM (via an OpenAI-compatible API). The architecture splits decision-making into a
**StrategicPlanner** (longer-horizon goals) and a **TacticalPlanner** (moment-to-moment execution),
with working memory persisted to SQLite. Development is tracked through a structured phase/plan
system in `.planning/STATE.md`.

The goal is a bot that "feels like a competent, persistent player — not a command executor."

> **Note:** This is a separate, earlier experiment from [`minecraft-server`](https://github.com/ay2609/minecraft-server),
> which uses a different architecture (a decoupled runtime/brain split over WebSocket) for the same
> general idea of an LLM-controlled Minecraft agent. The two don't share code.

## Stack

- TypeScript, Bun/tsx
- mineflayer, mineflayer-pathfinder, mineflayer-collectblock, mineflayer-auto-eat
- OpenAI SDK (pointed at an OpenAI-compatible provider)
- better-sqlite3, Zod

## Status

Experimental / in development — see `.planning/STATE.md` for the current milestone and phase.
