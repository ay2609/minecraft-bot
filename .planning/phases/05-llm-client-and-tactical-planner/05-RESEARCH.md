# Phase 5: LLM Client and Tactical Planner - Research

**Researched:** 2026-03-08
**Domain:** Fireworks.ai API client, LLM JSON output handling, event-driven tactical planner loop
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**JSON failure and fallback policy**
- If Model B returns invalid JSON, perform exactly one retry.
- If parse remains unrecoverable, emit a `WAIT` action rather than crashing/looping.
- Parse diagnostics must be compact and structured (error class/location/attempt count), without raw prompt dumps.
- Escalate after retry budget is exhausted.
- Keep WAIT behavior observable because it may become a bottleneck later.

**Tactical triggering policy**
- Model B uses a hybrid trigger model (event-driven plus bounded timer watchdog).
- Primary activation remains executor-result boundaries.
- Add bounded watchdog trigger when no executor results arrive for a while.
- Immediate tactical reconsideration triggers: critical failures and unexpected queue-empty states.
- Player-chat tactical triggering is deferred for this phase (revisit later).

**Queue control policy**
- Model B queue control supports append/prepend/insert/delete operations and may cancel currently running actions when needed.
- Start with full queue recomputation after each executor result.
- Keep queue short (target 1-3 actions) for responsiveness.
- Conflict/preemption/drop metadata should trigger immediate tactical replan.
- Urgent actions insert at queue front by default.
- Include both explicit queue-change ops and final queue snapshot in tactical outputs.
- Add churn-threshold escalation if repeated large queue rewrites occur.

**Executor failure handling policy**
- For recoverable failures (e.g., `route_blocked`, `target_unavailable`), Model B first tries alternative actions.
- Use consecutive-failure threshold for escalation from Model B to Model A.
- Immediate escalation is required for `invalid_state`; other failure classes stay tactical-first.
- Failure outcomes must be fed back immediately into tactical context/memory for the next Model B step.

### Claude's Discretion
- Exact watchdog interval and churn-threshold default values.
- Compact schema fields for queue ops + final queue representation.
- Detailed mapping of failure-code classes into tactical action heuristics (within the locked escalation rules).

### Deferred Ideas (OUT OF SCOPE)
- Chat-triggered tactical calls.
- Evolution from full-queue recomputation toward single-next-action control.
- Structured "learning/figuring out" loop (external lookup and self-experimentation).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLAN-01 | Fireworks LLM client wraps the `openai` npm package with `baseURL` pointing to the Fireworks.ai inference endpoint; handles JSON parse failures with a retry, surfaces structured errors for context-length exceeded and rate limits | OpenAI v6.27.0 error class hierarchy confirmed; Fireworks baseURL and model ID verified |
| PLAN-02 | Model B (tactical loop) runs on completion or failure of each action; it receives the assembled context, maintains the action queue, selects the next skill call, and decides whether to continue, retry, reorder, or escalate; outputs strict JSON | EventBus integration points confirmed; ActionQueue type already exists in types/index.ts |
</phase_requirements>

---

## Summary

Phase 5 wires the Fireworks.ai LLM API into the bot's event loop and implements Model B — the tactical planner that turns assembled context into executable skill queues. The two building blocks are distinct: the LLM client is a thin wrapper around the already-installed `openai` npm package (v6.27.0) pointed at Fireworks, while the tactical loop is a stateful EventBus subscriber that consumes `planner:context-ready` and `executor:result` events and publishes `tactical:queue-ready`.

The project already has the `openai` package installed and the Fireworks endpoint/model configured in `src/config.ts`. The `ActionQueue`, `ActionItem`, and `ExecutorResult` types are fully defined. The EventBus typed channels for `planner:context-ready`, `executor:result`, and `tactical:queue-ready` already exist in `src/events/EventBus.ts`. Phase 5 is therefore about connecting these existing pieces rather than inventing new infrastructure.

The primary technical risks are: (1) MiniMax M2 JSON mode behavior is unverified against the live API — the client must be robust to partial JSON even with `response_format: { type: "json_object" }` active; (2) the watchdog timer must not fire when the executor is legitimately busy running long skills; (3) the consecutive-failure counter must survive the full Model B cycle including the escalate-to-strategic path.

**Primary recommendation:** Build `FireworksLLMClient` as a single-responsibility class (call + parse + retry + structured error surface), then build `TacticalPlanner` as a separate class that owns the watchdog, churn-threshold, and consecutive-failure counter — wired together by the EventBus.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `openai` | 6.27.0 (installed) | HTTP client for Fireworks chat completions endpoint | Already in package.json; Fireworks is OpenAI-compatible |
| TypeScript + tsx | ^5.9.3 / ^4.21.0 (installed) | Type safety, CJS module target | Established project stack |
| `zod` | ^4.3.6 (installed) | Runtime validation of LLM JSON output schema | Already in package.json; validates action queue shape |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `setTimeout`/`clearTimeout` | built-in | Watchdog timer implementation | Bounded watchdog trigger for no-executor-result interval |
| EventBus (project singleton) | N/A | Cross-layer pub/sub | All tactical loop event subscriptions and emissions |
| `WorkingMemory` (project singleton) | N/A | Action queue state source of truth | Reading/writing queue between tactical cycles |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `openai` npm | `node-fetch` + raw HTTP | Raw HTTP removes type-safe error classes (RateLimitError, BadRequestError) — no benefit |
| `zod` for schema validation | Manual type guards | Manual guards lose structural error messages and are harder to maintain |
| EventBus trigger | Direct function call from executor | Direct call creates circular imports — violates established architecture |

**Installation:** No new packages needed. `openai`, `zod`, TypeScript, and tsx are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── planner/
│   ├── FireworksLLMClient.ts       # LLM call, JSON parse, retry, structured error
│   ├── TacticalPlanner.ts          # Subscriber, watchdog, churn-threshold, failure counter
│   ├── tacticalSchema.ts           # Zod schema for Model B JSON output
│   ├── systemPrompts.ts            # Model B system prompt (kept separate from logic)
│   ├── FireworksLLMClient.test.ts  # Unit tests: retry, error mapping, JSON parse
│   └── TacticalPlanner.test.ts     # Unit tests: trigger policy, queue ops, WAIT fallback
├── config.ts                       # Add tactical config knobs (watchdog, churn, failures)
└── events/EventBus.ts              # Already has all required channels
```

### Pattern 1: FireworksLLMClient — Thin API Wrapper

**What:** A class that calls `client.chat.completions.create()` with `response_format: { type: "json_object" }`, catches `RateLimitError` and `BadRequestError`, and performs exactly one retry on JSON parse failure before returning a structured error discriminant union.

**When to use:** Every time the tactical planner needs an LLM response.

**Example:**
```typescript
// Source: openai npm v6.27.0 installed in project
import OpenAI, { RateLimitError, BadRequestError } from 'openai';

export type LLMResult =
  | { ok: true; data: unknown }
  | { ok: false; kind: 'rate_limit' | 'context_length' | 'parse_failure' | 'api_error'; message: string; attempt: number };

export class FireworksLLMClient {
  private readonly client: OpenAI;

  constructor(apiKey: string, modelId: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.fireworks.ai/inference/v1',
      maxRetries: 0,   // We control retries ourselves; disable SDK auto-retry
    });
    this.modelId = modelId;
  }

  async call(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<LLMResult> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.modelId,
          messages,
          response_format: { type: 'json_object' },
          max_tokens: 1024,
        });

        const content = response.choices[0]?.message?.content ?? '';
        if (response.choices[0]?.finish_reason === 'length') {
          return { ok: false, kind: 'context_length', message: 'finish_reason=length; output truncated', attempt };
        }

        try {
          return { ok: true, data: JSON.parse(content) };
        } catch {
          if (attempt === 2) {
            return { ok: false, kind: 'parse_failure', message: 'JSON parse failed after 2 attempts', attempt };
          }
          // Loop for retry
        }
      } catch (error) {
        if (error instanceof RateLimitError) {
          return { ok: false, kind: 'rate_limit', message: error.message, attempt };
        }
        if (error instanceof BadRequestError) {
          // context_length_exceeded arrives as 400 with code field
          const code = (error.error as Record<string, unknown>)?.code;
          if (code === 'context_length_exceeded') {
            return { ok: false, kind: 'context_length', message: error.message, attempt };
          }
          return { ok: false, kind: 'api_error', message: error.message, attempt };
        }
        return { ok: false, kind: 'api_error', message: String(error), attempt };
      }
    }
    // Unreachable but TypeScript needs it
    return { ok: false, kind: 'api_error', message: 'Unexpected loop exit', attempt: 2 };
  }
}
```

**Critical note:** Set `maxRetries: 0` on the OpenAI client constructor. The SDK auto-retries 429s by default (2 retries). For this project, we want to surface `RateLimitError` immediately as a structured result, not silently retry.

### Pattern 2: TacticalPlanner — Event-Driven Loop with Watchdog

**What:** A class that subscribes to `executor:result` and `planner:context-ready`, runs Model B on each trigger, applies queue ops, publishes `tactical:queue-ready`, and manages a bounded watchdog timer for cases where no executor result arrives.

**When to use:** Instantiated once at startup; owns the full tactical loop lifetime.

**Example:**
```typescript
// Source: established EventBus pattern from existing codebase
export class TacticalPlanner {
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private recentQueueSizes: number[] = [];

  constructor(
    private readonly llmClient: FireworksLLMClient,
    private readonly workingMemory: WorkingMemory,
    private readonly events: TypedEventBus,
    private readonly config: TacticalConfig,
  ) {}

  start(): void {
    this.events.on('executor:result', (result) => {
      void this.onExecutorResult(result);
    });
    this.events.on('planner:context-ready', (bundle) => {
      void this.onContextReady(bundle);
    });
    this.resetWatchdog();
  }

  private resetWatchdog(): void {
    if (this.watchdogTimer !== null) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      void this.triggerTactical('watchdog');
    }, this.config.watchdogIntervalMs);
  }

  private async onExecutorResult(result: ExecutorResult): Promise<void> {
    this.resetWatchdog();
    // Feed failure immediately to memory before tactical call
    if (!result.success) this.recordFailureToMemory(result);
    await this.triggerTactical('executor-result');
  }
}
```

### Pattern 3: Tactical JSON Schema with Zod

**What:** Define the expected Model B output shape as a Zod schema. Validate after JSON.parse. This produces structured error messages (which field failed) rather than "JSON is valid but wrong shape" silent bugs.

**Example:**
```typescript
// Source: zod v4.3.6 installed in project
import { z } from 'zod';

const ActionItemSchema = z.object({
  skill: z.string(),
  params: z.record(z.unknown()),
  expectedDurationSeconds: z.number().positive(),
});

const QueueOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('append'), action: ActionItemSchema }),
  z.object({ op: z.literal('prepend'), action: ActionItemSchema }),
  z.object({ op: z.literal('clear') }),
]);

export const TacticalOutputSchema = z.object({
  reasoning: z.string(),
  queueOps: z.array(QueueOpSchema),
  finalQueue: z.array(ActionItemSchema),
  subgoalComplete: z.boolean(),
  escalate: z.boolean(),
  escalateReason: z.string().nullable(),
});

export type TacticalOutput = z.infer<typeof TacticalOutputSchema>;
```

### Pattern 4: WAIT Action as Structured Sentinel

**What:** When parse fails unrecoverably after one retry, the tactical planner emits a `WAIT` action via `tactical:queue-ready` rather than leaving the queue empty or crashing.

**Example:**
```typescript
const WAIT_ACTION: ActionQueue = {
  subgoalId: workingMemory.getSnapshot().activeSubgoalId ?? 'none',
  actions: [{ skill: 'WAIT', params: {}, expectedDurationSeconds: 5 }],
  reasoning: 'Parse failure fallback',
  subgoalComplete: false,
  escalate: false,
  escalateReason: null,
};
```

The executor must tolerate `WAIT` as an unknown skill (it already returns `invalid_state` for unknown skills, which is fine — the WAIT action just keeps the queue non-empty and observable). Alternatively, add `WAIT` as a registered no-op skill.

**Recommendation:** Register `WAIT` as a real no-op skill in SkillRegistry so it returns `success: true` rather than `invalid_state`. This makes the WAIT frequency trackable via executor results.

### Anti-Patterns to Avoid

- **Sharing OpenAI client instance across layers:** Each call from TacticalPlanner goes through FireworksLLMClient — never instantiate OpenAI client inline inside the planner.
- **Catching all errors as a JSON parse fallback:** Distinguish API errors (rate limit, auth) from parse errors — they need different responses.
- **Setting `maxRetries` on the SDK constructor to > 0:** The SDK retries 429 errors silently with exponential backoff, masking rate limit pressure. Keep at 0 and surface as structured result.
- **Letting the watchdog fire while the executor is busy:** The watchdog resets on every `executor:result` event. It only fires if no result arrives within the interval — which is the correct no-progress detection.
- **Logging raw prompt content on parse failure:** CONTEXT.md requires compact diagnostics (error class, location, attempt count) only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for Fireworks | Raw `node-fetch` + header management | `openai` npm (already installed) | Type-safe error classes, streaming support, automatic header handling |
| JSON output schema validation | Manual `typeof` checks on every field | `zod` (already installed) | Structural error messages, inferred TypeScript types, composable schemas |
| Rate limit and 429 detection | String-matching on error.message | `instanceof RateLimitError` from openai | SDK maps all HTTP 429s to this class reliably |
| Context length detection | Parsing error body text | `finish_reason === 'length'` + `BadRequestError` with `code === 'context_length_exceeded'` | Both cases must be handled (output truncation vs. input too long) |

**Key insight:** The openai SDK's error hierarchy handles all HTTP-level error classification. Use `instanceof` checks — never re-parse status codes or message strings.

---

## Common Pitfalls

### Pitfall 1: SDK Auto-Retry Swallowing Rate Limit Errors

**What goes wrong:** The openai SDK retries 429 responses 2 times by default with exponential backoff. The `RateLimitError` is only thrown after all retries are exhausted, adding 10-30 seconds of silent latency. The structured error surface sees a delayed error, not an immediate one.

**Why it happens:** SDK default `maxRetries = 2` is designed for interactive use cases, not for agents that need fast structured error propagation.

**How to avoid:** Set `maxRetries: 0` in the `OpenAI` constructor. The TacticalPlanner's single-retry logic then runs immediately.

**Warning signs:** LLM calls taking >10s without a network issue.

### Pitfall 2: finish_reason='length' Producing Truncated JSON

**What goes wrong:** With `response_format: { type: "json_object" }`, if the model hits `max_tokens`, it may stop mid-JSON. `JSON.parse()` fails. The planner retries, produces another truncated response, and eventually falls through to WAIT.

**Why it happens:** `max_tokens` is too low for the model's action queue output, or the context is pushing the model to verbose reasoning before the JSON.

**How to avoid:** Set `max_tokens` conservatively high (1024-2048). Check `finish_reason === 'length'` before attempting JSON parse — treat it as a `context_length` error immediately without wasting a retry.

**Warning signs:** Repeated WAIT emissions with "JSON parse failed" diagnostics.

### Pitfall 3: Watchdog Firing During Legitimate Long Actions

**What goes wrong:** The watchdog fires while `move_to` is in progress (which can take up to 20s per config). This triggers an unnecessary tactical replan mid-movement, potentially issuing a conflicting queue.

**Why it happens:** Watchdog interval is shorter than the longest skill timeout.

**How to avoid:** Watchdog interval must be set higher than `max(perSkillTimeoutMs)`. The longest configured skill timeout is `move_to` at 20s. Recommend watchdog interval of 30-45s default. Reset watchdog on every `executor:result` event to prevent spurious firing.

**Warning signs:** Tactical replans arriving while movement is in progress.

### Pitfall 4: Consecutive-Failure Counter Not Resetting on Success

**What goes wrong:** After a string of failures followed by a success, the counter stays elevated. A single subsequent failure triggers premature escalation to Model A.

**Why it happens:** Counter is only incremented on failure, never decremented or reset on success.

**How to avoid:** Reset `consecutiveFailures = 0` on every successful `executor:result`. Only increment on failure.

**Warning signs:** Model A triggered immediately after a recovery success.

### Pitfall 5: MiniMax M2 model ID mismatch

**What goes wrong:** Calling `accounts/fireworks/models/minimax-m2` (the stored default) when the model is in preview or has been superseded returns a 404 or model-not-found error.

**Why it happens:** The Fireworks model page shows `fireworks/minimax-m2` as the page slug, but API calls use the full `accounts/fireworks/models/minimax-m2` path. There is now also MiniMax-M2.1 (`accounts/fireworks/models/minimax-m2p1`).

**How to avoid:** The model ID is env-overridable via `FIREWORKS_MODEL_ID` in `src/config.ts`. The default `accounts/fireworks/models/minimax-m2` is the correct format based on Fireworks documentation conventions. A live API smoke test in the first plan will confirm reachability. If M2 is unavailable, switch to `accounts/fireworks/models/minimax-m2p1` (M2.1, 204.8k context window, GA support).

**Warning signs:** HTTP 404 or `model_not_found` error on first API call.

### Pitfall 6: Churn Threshold Not Bounded

**What goes wrong:** The churn-threshold escalation fires repeatedly if Model A doesn't resolve the root cause. Each escalation triggers a new Model A call (Phase 6), which may produce a plan that still causes churn.

**Why it happens:** Churn threshold is evaluated per tactical cycle without a cooldown.

**How to avoid:** After a churn-threshold escalation, add a cooldown period before churn counting resets. Track escalation count separately from churn count. (Churn policy is at Claude's discretion — recommend 3 large rewrites within 5 cycles as default threshold, with 30s cooldown before next churn escalation.)

---

## Code Examples

Verified patterns from official sources and installed packages:

### FireworksLLMClient Constructor
```typescript
// Source: openai v6.27.0 client.d.ts — maxRetries confirmed at src/node_modules/openai/client.d.ts:97
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: config.fireworks.apiKey,
  baseURL: 'https://api.fireworks.ai/inference/v1',
  maxRetries: 0,
});
```

### Error Class Instanceof Checks
```typescript
// Source: openai v6.27.0 core/error.js — confirmed in project node_modules
import { RateLimitError, BadRequestError, APIError } from 'openai';

try {
  const response = await client.chat.completions.create({ ... });
} catch (error) {
  if (error instanceof RateLimitError) {
    // HTTP 429 — surface as structured rate_limit error
  } else if (error instanceof BadRequestError) {
    // HTTP 400 — check error.code for 'context_length_exceeded'
    const code = (error.error as Record<string, unknown>)?.['code'];
  }
}
```

### finish_reason Check for Output Truncation
```typescript
// Source: openai v6.27.0 completions.d.ts line 217 — finish_reason: 'stop' | 'length' | ...
const choice = response.choices[0];
if (choice?.finish_reason === 'length') {
  // Model hit max_tokens mid-output — treat as context_length error
  // Do NOT attempt JSON.parse on truncated output
}
```

### Zod Schema Validation After Parse
```typescript
// Source: zod v4.3.6 installed in project
import { z } from 'zod';

const result = TacticalOutputSchema.safeParse(parsed);
if (!result.success) {
  // result.error.issues contains structured field-level diagnostics
  const diagnostics = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
}
```

### EventBus Subscription Pattern (no-floating-promises compliant)
```typescript
// Source: established pattern in src/executor/Executor.ts and src/index.ts
this.events.on('executor:result', (result) => {
  void this.onExecutorResult(result);
});
```

The `void` operator satisfies the `no-floating-promises` ESLint rule while keeping the subscription synchronous.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual HTTP with `node-fetch` + error string matching | `openai` SDK with typed error classes | openai v4+ | No custom HTTP layer needed |
| `JSON.parse` wrapped in try/catch | `response_format: { type: "json_object" }` + `finish_reason` check | 2023+ (chat completions API) | Reduces invalid JSON, but doesn't eliminate it — parser still needed |
| Polling loop for LLM responses | EventBus-triggered reactive loop | Project architecture | Eliminates busy-wait, integrates with existing event model |
| `ts-node` | `tsx` | Phase 1 decision | Already established |

**Deprecated/outdated:**
- `response_format: { type: "text" }` with prompt-injected JSON instructions: Still works but produces more parse failures than `json_object` mode. Use `json_object` for Model B.
- SDK `maxRetries: 2` default for agent use cases: Silent retry adds latency and hides pressure signals. Use `maxRetries: 0`.

---

## Open Questions

1. **MiniMax M2 JSON mode behavior under real load**
   - What we know: Fireworks documents `response_format: { type: "json_object" }` support broadly; MiniMax M2 is in preview; M2.1 has GA support
   - What's unclear: Whether MiniMax M2 (preview) respects `response_format: json_object` reliably, or whether the model occasionally escapes JSON mode with preamble text
   - Recommendation: The first plan should be a live smoke test: one real Fireworks API call with `response_format: json_object` and verify the response is valid JSON. If M2 is unavailable, default to M2.1 (`accounts/fireworks/models/minimax-m2p1`).

2. **WAIT action — registered no-op skill vs. sentinel**
   - What we know: Executor returns `invalid_state` for unknown skills. That result would emit `executor:result` with failure, which re-triggers the tactical loop — potentially causing a loop if the parse problem persists.
   - What's unclear: Whether `invalid_state` on WAIT would cause infinite tactical re-triggering before the consecutive-failure threshold fires.
   - Recommendation: Register `WAIT` as a real skill in SkillRegistry that sleeps for `expectedDurationSeconds` and returns `success: true`. This prevents the tight failure loop and makes WAIT frequency trackable.

3. **Context window token budget for Model B prompts**
   - What we know: MiniMax M2 context window is 196.6k tokens (from Fireworks model page). The ContextAssembler already limits output to 4500 chars (roughly 1125 tokens). System prompt + context + action queue schema is well within budget.
   - What's unclear: Whether the system prompt should include the full ActionQueue schema definition inline, or just a compact example.
   - Recommendation: Include a compact JSON example in the system prompt rather than the full TypeScript type. This is more token-efficient and produces better model alignment.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in runner (`node --test` via tsx) — established project pattern using hand-rolled `assert()` + `async run()` |
| Config file | None — tests run as standalone `tsx src/planner/FireworksLLMClient.test.ts` |
| Quick run command | `npx tsx src/planner/FireworksLLMClient.test.ts && npx tsx src/planner/TacticalPlanner.test.ts` |
| Full suite command | `npx tsx src/planner/FireworksLLMClient.test.ts && npx tsx src/planner/TacticalPlanner.test.ts && npx tsc --noEmit && npx eslint src --ext .ts` |

**Note:** The project uses a hand-rolled test pattern (established in Phase 4) — files export an `async run()` function that calls `assert()`. No jest/vitest. Tests import the real module and inject stub dependencies via the dependency injection pattern used throughout the codebase.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAN-01 | Fireworks client returns parsed JSON on success | unit | `npx tsx src/planner/FireworksLLMClient.test.ts` | Wave 0 |
| PLAN-01 | JSON parse failure triggers exactly one retry | unit | `npx tsx src/planner/FireworksLLMClient.test.ts` | Wave 0 |
| PLAN-01 | RateLimitError surfaces as structured `rate_limit` result | unit | `npx tsx src/planner/FireworksLLMClient.test.ts` | Wave 0 |
| PLAN-01 | BadRequestError with context_length_exceeded code surfaces as `context_length` result | unit | `npx tsx src/planner/FireworksLLMClient.test.ts` | Wave 0 |
| PLAN-01 | finish_reason='length' surfaces as `context_length` without retrying | unit | `npx tsx src/planner/FireworksLLMClient.test.ts` | Wave 0 |
| PLAN-02 | Unrecoverable parse failure emits WAIT action queue | unit | `npx tsx src/planner/TacticalPlanner.test.ts` | Wave 0 |
| PLAN-02 | executor:result triggers tactical cycle | unit | `npx tsx src/planner/TacticalPlanner.test.ts` | Wave 0 |
| PLAN-02 | Watchdog fires when no executor:result arrives within interval | unit | `npx tsx src/planner/TacticalPlanner.test.ts` | Wave 0 |
| PLAN-02 | Consecutive failures above threshold trigger escalate:to-strategic | unit | `npx tsx src/planner/TacticalPlanner.test.ts` | Wave 0 |
| PLAN-02 | invalid_state failure triggers immediate escalation | unit | `npx tsx src/planner/TacticalPlanner.test.ts` | Wave 0 |
| PLAN-02 | Churn threshold escalates when large queue rewrites repeat | unit | `npx tsx src/planner/TacticalPlanner.test.ts` | Wave 0 |
| PLAN-01 + PLAN-02 | Live Fireworks API call returns valid JSON action queue | smoke (live API) | Manual / integration environment only | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsx src/planner/FireworksLLMClient.test.ts && npx tsc --noEmit`
- **Per wave merge:** `npx tsx src/planner/FireworksLLMClient.test.ts && npx tsx src/planner/TacticalPlanner.test.ts && npx tsc --noEmit && npx eslint src --ext .ts`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/planner/FireworksLLMClient.test.ts` — covers PLAN-01 retry, error class, finish_reason cases
- [ ] `src/planner/TacticalPlanner.test.ts` — covers PLAN-02 trigger policy, WAIT fallback, churn, escalation
- [ ] `src/planner/tacticalSchema.ts` — Zod schema used by both planner and tests
- [ ] `src/planner/FireworksLLMClient.ts` — the module under test
- [ ] `src/planner/TacticalPlanner.ts` — the module under test
- [ ] `src/planner/systemPrompts.ts` — Model B system prompt

---

## Sources

### Primary (HIGH confidence)
- openai npm v6.27.0 installed at `/Users/aviyadava/minecraft-bot/node_modules/openai/` — error class hierarchy, `maxRetries`, `finish_reason` types confirmed by reading source
- `src/config.ts` — Fireworks `baseURL` pattern and default model ID `accounts/fireworks/models/minimax-m2` confirmed
- `src/events/EventBus.ts` — `planner:context-ready`, `executor:result`, `tactical:queue-ready`, `escalate:to-strategic` channels confirmed
- `src/types/index.ts` — `ActionQueue`, `ActionItem`, `ExecutorResult` types confirmed
- [Fireworks.ai Chat Completions API](https://docs.fireworks.ai/api-reference/post-chatcompletions) — `baseURL` = `https://api.fireworks.ai/inference/v1`, `context_length_exceeded_behavior` parameter, response format

### Secondary (MEDIUM confidence)
- [Fireworks.ai MiniMax-M2 model page](https://fireworks.ai/models/fireworks/minimax-m2) — 196.6k token context window, preview status, function calling supported
- [Fireworks.ai MiniMax-M2.1 model page](https://fireworks.ai/models/fireworks/minimax-m2p1) — `accounts/fireworks/models/minimax-m2p1`, 204.8k context, GA fallback option
- [Fireworks Structured Outputs docs](https://docs.fireworks.ai/structured-responses/structured-response-formatting) — `response_format: json_object` and `json_schema` confirmed; `finish_reason=length` truncation warning confirmed
- [Fireworks Quickstart](https://docs.fireworks.ai/getting-started/quickstart) — baseURL convention confirmed

### Tertiary (LOW confidence)
- WebSearch results for Fireworks + openai SDK TypeScript pattern — corroborated by official docs
- WebSearch for context_length_exceeded error code — primary signal is `BadRequestError.code` field, which is not explicitly documented by Fireworks (mapped from OpenAI conventions)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed, error class hierarchy read from source
- Architecture: HIGH — EventBus channels already declared, types already defined, pattern follows established project conventions
- Pitfalls: MEDIUM — SDK behavior confirmed from source; MiniMax M2 JSON mode behavior under load is LOW confidence pending live API test
- MiniMax M2 model ID: MEDIUM — `accounts/fireworks/models/minimax-m2` confirmed from config.ts default and Fireworks model page slug; full production support "coming soon" per Fireworks page

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (Fireworks model availability may change; verify model ID with live API smoke test in Wave 1)
