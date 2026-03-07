# Technology Stack

**Project:** minecraft-bot
**Researched:** 2026-03-06
**Overall confidence:** HIGH (all versions verified against npm registry and live APIs)

---

## Recommended Stack

### Core Game Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| mineflayer | `^4.35.0` | Minecraft bot framework | The canonical Node.js Minecraft bot library. Ships its own TypeScript types (`index.d.ts`). Released 2026-02-13, built on minecraft-protocol 1.64.0 + minecraft-data 3.105.0 which both include 1.21.11 protocol support (confirmed: `minecraft-data` `dataPaths.json` lists `1.21.11`). No alternatives exist for this role. |
| mineflayer-pathfinder | `^2.4.5` | A* navigation | Mature, mineflayer-native pathfinder. Last release 2023-09-04 — not stale, stable. Ships `index.d.ts` in the repo (confirmed on GitHub) but does NOT declare `types` in package.json; TypeScript needs path resolution via `skipLibCheck: true` or manual declaration. Compatible with mineflayer 4.x. |
| mineflayer-collectblock | `^1.6.0` | Block collection w/ pathing | Wraps pathfinder + block-breaking into a single `collectBlock` action. Released 2025-01-24. Ships `lib/index.d.ts`. Handles item pickup, multiple block types in one call — removes boilerplate from the executor layer. |
| mineflayer-auto-eat | `^5.0.3` | Automatic food management | Actively maintained (last release 2025-08-01). Handles hunger autonomously so the tactical loop doesn't need to poll for it. Essential for survival-mode autonomy. |

### LLM Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| openai | `^6.27.0` | LLM API client | The `openai` npm package is the correct way to call Fireworks.ai — it supports any OpenAI-compatible endpoint via `baseURL` override. Version 6.x ships full TypeScript types. No custom HTTP client needed. |

**Fireworks.ai API pattern** (confirmed by probing `api.fireworks.ai`):

```typescript
import OpenAI from 'openai';

const llm = new OpenAI({
  apiKey: process.env.FIREWORKS_API_KEY,
  baseURL: 'https://api.fireworks.ai/inference/v1',
});

const response = await llm.chat.completions.create({
  model: 'accounts/fireworks/models/minimax-m2',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ],
  response_format: { type: 'json_object' },
  temperature: 0.2,
});
```

**Model ID note:** The Fireworks.ai model page confirms the correct ID is `accounts/fireworks/models/minimax-m2`. The project document references "MiniMax M2.5" — this is likely a naming discrepancy; no `minimax-m2-5` model page exists on Fireworks.ai as of 2026-03-06. Use `minimax-m2` until confirmed otherwise.

**Why NOT a dedicated Fireworks SDK:** No Fireworks-specific npm package with meaningful adoption exists. The `openai` package with `baseURL` override is the community-standard approach and matches Fireworks' own documented recommendation (confirmed via their 401 error response format matching OpenAI's).

### Persistent Memory (SQLite)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| better-sqlite3 | `^12.6.2` | SQLite database | **Synchronous API** is the right choice here. The tactical loop needs to read/write memory between LLM calls, not inside async chains. Synchronous reads eliminate callback complexity in the perception/memory pipeline. Actively maintained (released 2026-01-17). Node.js native addon — requires node-gyp build on install, but works cleanly on Node.js 20. |
| @types/better-sqlite3 | `^7.6.13` | TypeScript types | Community types; last updated 2025-04-04. Stable. |

**Why NOT bun:sqlite:** The project uses Node.js 20 (confirmed: `node --version` = `v20.20.0`). `bun:sqlite` is a Bun built-in — unavailable in Node.js. Using Bun would require replacing the entire runtime and risks mineflayer native addon compatibility issues. Not worth it.

**Why NOT `@databases/sqlite` or `sql.js`:** `sql.js` is an in-memory WASM SQLite with no persistence by default. `@databases/sqlite` wraps better-sqlite3 with a promise API — adds abstraction with no benefit since synchronous is what we want here.

### TypeScript Project Setup

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| typescript | `^5.9.3` | Language | Current stable release. |
| tsx | `^4.21.0` | Dev execution | `tsx` replaces `ts-node`. It uses esbuild for fast transpilation (no type-checking overhead at runtime), watches files, and is actively maintained (released 2025-11-30 vs ts-node's last release 2023-12-08). Run with `tsx src/index.ts` — no compilation step needed during development. |
| tsconfig | — | Build config | See recommended config below. |

**Why NOT ts-node:** ts-node's last release was December 2023. It requires `esModuleInterop` gymnastics, has ESM mode issues, and startup is slower. tsx is the community replacement.

**Why NOT Bun runtime:** mineflayer-pathfinder and better-sqlite3 are native Node.js addons (N-API/nan). Bun's Node.js compatibility for native addons is incomplete as of early 2026 — risk of silent failures or build errors. Not worth the uncertainty for a project that depends on ecosystem stability.

**Why NOT compiling to JS for production:** For a local dev/research bot, `tsx` in watch mode is sufficient. If a compiled artifact is needed, `tsc` to `dist/` works fine.

**Recommended tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`module: "CommonJS"` is mandatory — mineflayer and its entire plugin ecosystem are CJS. `skipLibCheck: true` handles mineflayer-pathfinder which ships a `d.ts` not declared in `package.json`.

### Terminal Dashboard

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| ink | `^6.8.0` | Terminal UI | React-for-CLI. Declarative component model makes the dashboard composable (goal box, action queue, LLM decisions, memory stats as separate components). Requires React 19+ as peer dep. Actively maintained. |
| react + react-dom | `^19.x` | ink peer dep | Required by ink. |

**Why NOT blessed:** blessed@0.1.81 was last meaningfully maintained around 2015-2016 and has no TypeScript types. It works but is a dead library — using it means owning its bugs.

**Why NOT raw console.log:** Viable as a fallback, but a terminal dashboard (per project requirements) needs structured multi-pane output. ink makes that straightforward without a terminal cursor management nightmare.

**Why NOT blessed-contrib:** Built on blessed, inherits its maintenance status. Avoid.

**Consideration for ink vs just chalk+boxen:** If ink adds too much complexity (React state management overhead for a side-display), a simpler approach with `chalk` + `cli-boxes` + interval refresh (`process.stdout.write + \x1b[2J\x1b[H`) is a viable fallback for Phase 1. Recommend starting with ink but defer until the core bot loop is working.

### Schema Validation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| zod | `^4.3.6` | LLM output validation | Both Model A and Model B must output strict JSON. Zod parses and validates JSON against schemas, throws typed errors on malformed output, and gives TypeScript types derived from schemas. Essential for the "strict JSON output" constraint in PROJECT.md. |

### Package Manager

**Recommendation: pnpm `^10.x`**

- Faster installs than npm, disk-efficient
- Better monorepo support if this grows
- No Bun or native-addon risks
- `pnpm install` works correctly with better-sqlite3 (runs node-gyp via lifecycle scripts)

**Why NOT npm:** Works but slower; no strong reason to avoid.
**Why NOT yarn:** pnpm has displaced yarn v1 for new projects.
**Why NOT bun install:** Risk with native addon build scripts (better-sqlite3, mineflayer uses some native deps in minecraft-protocol).

---

## Plugins: What NOT to Use

| Plugin | Reason to Avoid |
|--------|----------------|
| `mineflayer-armor-manager` | Last release 2023-07-01. The bot's executor layer can handle armor equipping directly via `bot.equip()` — no plugin needed for a custom agent. |
| `prismarine-viewer` | Web-based 3D viewer. Out-of-scope per PROJECT.md ("Web dashboard UI — out of scope for v1"). Useful for debugging only — add it as an optional dev dependency if needed. |
| `mineflayer-statemachine` | State machine abstraction for bots. The project's hierarchical loop (Model A strategic + Model B tactical) IS the state management — adding a state machine library would conflict with the LLM-driven architecture. |
| `mineflayer-crafting` | Ancient package (pre-2021). mineflayer 4.x has `bot.craft()` built in. |

---

## Installation

```bash
# Core runtime
pnpm add mineflayer mineflayer-pathfinder mineflayer-collectblock mineflayer-auto-eat

# LLM
pnpm add openai

# SQLite
pnpm add better-sqlite3

# Schema validation
pnpm add zod

# Terminal dashboard
pnpm add ink react react-dom

# TypeScript + dev tools
pnpm add -D typescript tsx @types/node @types/better-sqlite3

# Optional: viewer for debugging only
# pnpm add -D prismarine-viewer
```

---

## Confirmed Version Compatibility

All versions verified against npm registry on 2026-03-06:

| Package | Confirmed Version | Release Date |
|---------|-------------------|--------------|
| mineflayer | 4.35.0 | 2026-02-13 |
| minecraft-protocol (mineflayer dep) | 1.64.0 | 2026-02-13 |
| minecraft-data (mineflayer dep) | 3.105.0 | includes 1.21.11 ✓ |
| mineflayer-pathfinder | 2.4.5 | 2023-09-04 |
| mineflayer-collectblock | 1.6.0 | 2025-01-24 |
| mineflayer-auto-eat | 5.0.3 | 2025-08-01 |
| openai | 6.27.0 | current |
| better-sqlite3 | 12.6.2 | 2026-01-17 |
| @types/better-sqlite3 | 7.6.13 | 2025-04-04 |
| tsx | 4.21.0 | 2025-11-30 |
| typescript | 5.9.3 | current |
| zod | 4.3.6 | current |
| ink | 6.8.0 | current |
| pnpm | 10.30.3 | current |
| Node.js | 20.20.0 | system (confirmed) |

**Minecraft 1.21.11 compatibility:** CONFIRMED. `minecraft-data` 3.105.0 includes `pc/1.21.11` data path (verified via `dataPaths.json`). mineflayer 4.35.0 depends on `minecraft-data ^3.98.0` and `minecraft-protocol ^1.64.0`, both of which were released the same day as mineflayer 4.35.0 (2026-02-13), indicating coordinated 1.21.x support.

**Fireworks.ai API base URL:** `https://api.fireworks.ai/inference/v1` (confirmed by live API probe returning OpenAI-format 401).

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Bot framework | mineflayer | minecraft-protocol direct | mineflayer is minecraft-protocol + structured game state + event system. Writing directly against the protocol means reimplementing everything mineflayer gives for free. |
| SQLite client | better-sqlite3 (sync) | drizzle-orm + better-sqlite3 | Drizzle adds schema migration tooling but also abstraction overhead. The bot has two simple tables (semantic memory, episodic memory) — raw better-sqlite3 SQL is cleaner and faster to iterate. Add an ORM in a later phase if schema complexity grows. |
| TypeScript runner | tsx | ts-node | ts-node unmaintained since 2023. tsx is the active replacement. |
| Terminal UI | ink | blessed | blessed unmaintained since ~2016, no TypeScript types. |
| Package manager | pnpm | npm | pnpm faster, no downsides for this project. |
| LLM validation | zod | manual JSON.parse | Manual parsing gives no TypeScript types and no structured error messages. Zod parses + validates + infers types in one step. |

---

## Confidence Notes

- **mineflayer 1.21.11 support:** HIGH — verified via `minecraft-data` `dataPaths.json` which explicitly lists `1.21.11`, and mineflayer 4.35.0's release date (Feb 2026) postdates 1.21.11 release.
- **Fireworks.ai API endpoint:** HIGH — confirmed by live probe returning OpenAI-format response at `api.fireworks.ai/inference/v1`.
- **MiniMax model ID:** MEDIUM — `accounts/fireworks/models/minimax-m2` confirmed on Fireworks.ai model page. The PROJECT.md says "M2.5" but no `minimax-m2-5` page exists. Verify model name before first LLM call.
- **mineflayer-pathfinder 1.21.11 compat:** MEDIUM — pathfinder uses `minecraft-data ^3.5.1` (which covers 1.21.11) and mineflayer 4.x's API. No 1.21.x-specific breakage found, but last release was 2023 — if bugs exist in 1.21.x navigation, there may be no upstream fix available. Test pathfinding early.
- **ink for terminal dashboard:** MEDIUM — requires React 19 peer dep; React 19 is stable as of late 2024. Works well for structured dashboards but adds React dependency to a Node.js bot. Worth validating in Phase 1.

---

## Sources

- npm registry: `https://registry.npmjs.org/[package]/latest` — all version data
- `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/dataPaths.json` — 1.21.11 support confirmation
- `https://raw.githubusercontent.com/PrismarineJS/mineflayer-pathfinder/master/index.d.ts` — TypeScript types confirmed
- `https://api.fireworks.ai/inference/v1/models` — API endpoint and error format confirmed (live probe, 401)
- `https://fireworks.ai/models/fireworks/minimax-m2` — model ID `accounts/fireworks/models/minimax-m2` confirmed
- `https://raw.githubusercontent.com/openai/openai-node/master/README.md` — `new OpenAI({ apiKey, baseURL })` constructor pattern
