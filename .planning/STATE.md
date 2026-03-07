# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-06)

**Core value:** The bot should feel like a competent, persistent player — not a command executor. It pursues meaningful goals on its own, recovers when plans break, and doesn't require babysitting.
**Current focus:** Phase 1 — Project Scaffolding

## Current Position

Phase: 1 of 8 (Project Scaffolding)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-03-06 — Roadmap created

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: none yet
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Architecture: TypeScript + Node.js with tsx runner (not ts-node — unmaintained)
- Architecture: Two-model hierarchy using same model (MiniMax M2 via Fireworks.ai) with different system prompts and call cadences
- Architecture: SQLite via better-sqlite3 synchronous API — correct for memory access pattern between async LLM calls
- Architecture: EventBus for cross-layer communication — prevents circular imports between Perception, Memory, Planning, Executor
- Risk: MiniMax model ID must be verified before Phase 5 — PROJECT.md says "M2.5" but `accounts/fireworks/models/minimax-m2` is the confirmed Fireworks model ID

### Pending Todos

None yet.

### Blockers/Concerns

- [Pre-Phase 5] MiniMax model ID: verify `accounts/fireworks/models/minimax-m2` is correct on Fireworks.ai before implementing FireworksLLMClient
- [Pre-Phase 4] mineflayer-pathfinder stuck detection: confirm whether v2.4.5 emits a stuck event natively or if the executor must implement position-history polling
- [Pre-Phase 5] MiniMax M2 context window size: unconfirmed — use conservative token budget estimates until verified
- [Pre-Phase 8] ink peer dependency: validate ink ^6.8.0 + React 19 installs cleanly alongside mineflayer's dependency tree; fallback is chalk + interval stdout refresh

## Session Continuity

Last session: 2026-03-06
Stopped at: Roadmap created — ready to plan Phase 1
Resume file: None
