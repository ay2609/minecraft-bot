/**
 * StrategicPlanner unit tests
 * Uses hand-rolled assert + async run() pattern (no Jest).
 * All tests use injected LLMCallFn stubs — no real API calls.
 */

import { TypedEventBus } from '../events/EventBus';
import { WorkingMemory } from '../memory/WorkingMemory';
import { FireworksLLMClient } from './FireworksLLMClient';
import { StrategicPlanner, DEFAULT_STRATEGIC_CONFIG } from './StrategicPlanner';
import type { StrategicConfig } from './StrategicPlanner';
import type { ActionQueue, GoalPlan, PerceptionSnapshot } from '../types';
import type { LLMCallFn } from './FireworksLLMClient';
import OpenAI from 'openai';

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL  ${name}\n        ${msg}`);
    errors.push(`${name}: ${msg}`);
    failed++;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────────────────────
// Fixture builders
// ──────────────────────────────────────────────────────────────

function buildValidStrategicOutput(overrides: Record<string, unknown> = {}): unknown {
  return {
    reasoning: 'Bot is stable. Starting wood gathering.',
    triggerCause: 'idle',
    plan: {
      goal: 'Gather wood',
      goalRationale: 'No tools in inventory',
      priority: 'progression',
      subgoals: [
        {
          id: 'sg-1',
          description: 'Break 8 oak logs',
          requiredItems: {},
          expectedOutcome: 'inventory has 8 oak_log',
          maxAttempts: 3,
          timeoutSeconds: 120,
        },
        {
          id: 'sg-2',
          description: 'Craft crafting table',
          requiredItems: { oak_log: 4 },
          expectedOutcome: 'inventory has crafting_table',
          maxAttempts: 2,
          timeoutSeconds: 30,
        },
      ],
      successConditions: ['inventory has crafting_table'],
      abortConditions: ['health drops below 4'],
      estimatedComplexity: 'low',
      allowedSkills: ['move_to', 'break_block', 'craft_item'],
    },
    chatDecision: null,
    ...overrides,
  };
}

function buildCompletion(content: string, finishReason = 'stop'): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'cmpl-test',
    object: 'chat.completion',
    created: Date.now(),
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: finishReason as 'stop' | 'length',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

function makeLLMCallFn(returnValue: unknown): LLMCallFn {
  const content = typeof returnValue === 'string' ? returnValue : JSON.stringify(returnValue);
  return () => Promise.resolve(buildCompletion(content));
}

function makeErrorLLMCallFn(errorKind: string): LLMCallFn {
  const finishReason = errorKind === 'length' ? 'length' : 'stop';
  return () => Promise.resolve(buildCompletion('not valid json {{{', finishReason));
}

function buildPerceptionSnapshot(overrides: Partial<PerceptionSnapshot> = {}): PerceptionSnapshot {
  return {
    timestamp: Date.now(),
    position: { x: 0, y: 64, z: 0 },
    yaw: 0,
    health: 20,
    food: 20,
    armorPoints: 0,
    gameMode: 'survival',
    isOnGround: true,
    inventory: {},
    equippedItem: null,
    emptySlots: 36,
    biome: 'plains',
    timeOfDay: 6000,
    weather: 'clear',
    nearbyEntities: [],
    nearbyBlocks: [],
    lightLevel: 15,
    currentAction: null,
    recentFailures: [],
    ...overrides,
  };
}

function buildTestConfig(overrides: Partial<StrategicConfig> = {}): StrategicConfig {
  return {
    ...DEFAULT_STRATEGIC_CONFIG,
    idleCooldownMs: 50,         // Very short for tests
    strategicCooldownMs: 50,
    survivalDebounceMs: 200,    // Short for debounce tests
    chatDedupeBucketMs: 5000,
    chatDedupeMaxEntries: 50,
    ...overrides,
  };
}

function buildPlanner(
  callFn: LLMCallFn,
  workingMemory: WorkingMemory,
  events: TypedEventBus,
  configOverrides: Partial<StrategicConfig> = {},
): StrategicPlanner {
  const client = new FireworksLLMClient('dummy-key', 'dummy-model', callFn);
  const config = buildTestConfig(configOverrides);
  return new StrategicPlanner(client, workingMemory, events, config);
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log('\nStrategicPlanner tests\n');

  // ── Idle trigger ──────────────────────────────────────────────

  await test('idle-1: activePlan null + no cooldown → triggerStrategic called (plan emitted)', async () => {
    const calls: string[] = [];
    const callFn = makeLLMCallFn(buildValidStrategicOutput());
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    let planEmitted = false;
    events.on('strategic:plan-ready', () => { planEmitted = true; });

    const planner = buildPlanner(callFn, mem, events);
    planner.start();

    // Give async trigger time to complete
    await sleep(100);
    planner.stop();

    assert(planEmitted, 'Expected strategic:plan-ready to be emitted');
    void calls; // suppress unused warning
  });

  await test('idle-2: activePlan not null → triggerStrategic NOT called', async () => {
    const callFn = makeLLMCallFn(buildValidStrategicOutput());
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Pre-set a plan so the bot is not idle
    const existingPlan: GoalPlan = buildValidStrategicOutput() as never;
    mem.setPlan((buildValidStrategicOutput() as { plan: GoalPlan }).plan);

    let planEmitted = false;
    events.on('strategic:plan-ready', () => { planEmitted = true; });

    const planner = buildPlanner(callFn, mem, events);
    planner.start();
    await sleep(100);
    planner.stop();

    assert(!planEmitted, 'Expected strategic:plan-ready NOT to be emitted when plan exists');
    void existingPlan;
  });

  await test('idle-3: after plan handoff, idle cooldown suppresses next idle check', async () => {
    let callCount = 0;
    const callFn: LLMCallFn = async (msgs, modelId) => {
      callCount++;
      return makeLLMCallFn(buildValidStrategicOutput())(msgs, modelId);
    };
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Config: very short cooldown but still > test sleep
    const planner = buildPlanner(callFn, mem, events, { idleCooldownMs: 500 });
    planner.start();

    // Wait for first trigger
    await sleep(100);

    // Now simulate that the plan got cleared (as if subgoals finished)
    // and fire a perception:updated — idle cooldown should suppress re-trigger
    mem.setPlan(null);

    let planEmittedAfterCooldown = false;
    events.on('strategic:plan-ready', () => { planEmittedAfterCooldown = true; });

    // Fire perception:updated — should NOT trigger because cooldown is active
    events.emit('perception:updated', buildPerceptionSnapshot());
    await sleep(50);

    planner.stop();

    assert(!planEmittedAfterCooldown, 'Idle cooldown should suppress re-trigger within cooldown window');
    // callCount should be exactly 1 (from start())
    assert(callCount === 1, `Expected exactly 1 LLM call, got ${callCount}`);
  });

  // ── Escalation dedup ──────────────────────────────────────────

  await test('esc-1: first escalate:to-strategic → triggerStrategic called', async () => {
    const callFn = makeLLMCallFn(buildValidStrategicOutput());
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Pre-set a plan so start() doesn't trigger idle
    mem.setPlan((buildValidStrategicOutput() as { plan: GoalPlan }).plan);

    let planEmitted = false;
    events.on('strategic:plan-ready', () => { planEmitted = true; });

    const planner = buildPlanner(callFn, mem, events);
    planner.start();

    // Trigger escalation
    events.emit('escalate:to-strategic', { reason: 'test reason', consecutiveFailures: 3 });
    await sleep(150);

    planner.stop();
    assert(planEmitted, 'Expected strategic:plan-ready to be emitted on escalation');
  });

  await test('esc-2: second escalate:to-strategic while strategicCallInProgress → ignored', async () => {
    let callCount = 0;
    // Slow LLM call to ensure strategicCallInProgress is still true during second emit
    const callFn: LLMCallFn = async (msgs, modelId) => {
      callCount++;
      await sleep(100); // slow call
      return makeLLMCallFn(buildValidStrategicOutput())(msgs, modelId);
    };
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Pre-set a plan so start() doesn't trigger idle
    mem.setPlan((buildValidStrategicOutput() as { plan: GoalPlan }).plan);

    const planner = buildPlanner(callFn, mem, events);
    planner.start();

    // Fire two escalations in rapid succession
    events.emit('escalate:to-strategic', { reason: 'first', consecutiveFailures: 3 });
    await sleep(10); // Let first start but not finish
    events.emit('escalate:to-strategic', { reason: 'second', consecutiveFailures: 3 });
    await sleep(200); // Wait for first to complete

    planner.stop();
    assert(callCount === 1, `Expected exactly 1 LLM call (dedup), got ${callCount}`);
  });

  // ── Survival debounce ─────────────────────────────────────────

  await test('surv-1: health=6 + no prior trigger → triggerStrategic called (survival)', async () => {
    const callFn = makeLLMCallFn(buildValidStrategicOutput());
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Pre-set a plan so start() doesn't trigger idle
    mem.setPlan((buildValidStrategicOutput() as { plan: GoalPlan }).plan);

    let planEmitted = false;
    events.on('strategic:plan-ready', () => { planEmitted = true; });

    const planner = buildPlanner(callFn, mem, events);
    planner.start();

    // Emit perception with low health
    events.emit('perception:updated', buildPerceptionSnapshot({ health: 6 }));
    await sleep(150);

    planner.stop();
    assert(planEmitted, 'Expected strategic:plan-ready to be emitted on survival condition');
  });

  await test('surv-2: health=6 + lastSurvivalTriggerAt within debounce → NOT called again', async () => {
    let callCount = 0;
    const callFn: LLMCallFn = async (msgs, modelId) => {
      callCount++;
      return makeLLMCallFn(buildValidStrategicOutput())(msgs, modelId);
    };
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Pre-set a plan so start() doesn't trigger idle
    mem.setPlan((buildValidStrategicOutput() as { plan: GoalPlan }).plan);

    // Config with long survival debounce
    const planner = buildPlanner(callFn, mem, events, { survivalDebounceMs: 5000 });
    planner.start();

    // First survival trigger
    events.emit('perception:updated', buildPerceptionSnapshot({ health: 6 }));
    await sleep(100);

    const callsAfterFirst = callCount;

    // Second trigger within debounce window
    events.emit('perception:updated', buildPerceptionSnapshot({ health: 6 }));
    await sleep(100);

    planner.stop();
    assert(callsAfterFirst === 1, `Expected 1 call after first trigger, got ${callsAfterFirst}`);
    assert(callCount === 1, `Expected 1 total LLM call (debounce), got ${callCount}`);
  });

  await test('surv-3: food=3 + no prior trigger → triggerStrategic called (survival)', async () => {
    const callFn = makeLLMCallFn(buildValidStrategicOutput());
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Pre-set a plan so start() doesn't trigger idle
    mem.setPlan((buildValidStrategicOutput() as { plan: GoalPlan }).plan);

    let planEmitted = false;
    events.on('strategic:plan-ready', () => { planEmitted = true; });

    const planner = buildPlanner(callFn, mem, events);
    planner.start();

    // Emit perception with low food
    events.emit('perception:updated', buildPerceptionSnapshot({ food: 3 }));
    await sleep(150);

    planner.stop();
    assert(planEmitted, 'Expected strategic:plan-ready to be emitted on low food (food=3)');
  });

  // ── Chat dedup ────────────────────────────────────────────────

  await test('chat-1: new chat message → triggerStrategic called (chat)', async () => {
    const callFn = makeLLMCallFn(buildValidStrategicOutput());
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Pre-set a plan so start() doesn't trigger idle
    mem.setPlan((buildValidStrategicOutput() as { plan: GoalPlan }).plan);

    let planEmitted = false;
    events.on('strategic:plan-ready', () => { planEmitted = true; });

    const planner = buildPlanner(callFn, mem, events);
    planner.start();

    events.emit('bot:chat', { username: 'player1', message: 'go mine diamonds' });
    await sleep(150);

    planner.stop();
    assert(planEmitted, 'Expected strategic:plan-ready to be emitted on chat message');
  });

  await test('chat-2: same message within 5-second bucket → NOT called again', async () => {
    let callCount = 0;
    const callFn: LLMCallFn = async (msgs, modelId) => {
      callCount++;
      return makeLLMCallFn(buildValidStrategicOutput())(msgs, modelId);
    };
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Pre-set a plan so start() doesn't trigger idle
    mem.setPlan((buildValidStrategicOutput() as { plan: GoalPlan }).plan);

    const planner = buildPlanner(callFn, mem, events);
    planner.start();
    await sleep(50); // Let start() settle
    callCount = 0; // Reset after start (no idle trigger expected, but be safe)

    // Same user + message + same time bucket = same requestId → deduplicated
    events.emit('bot:chat', { username: 'player1', message: 'build a house' });
    await sleep(200); // Wait for first LLM call to complete

    events.emit('bot:chat', { username: 'player1', message: 'build a house' });
    await sleep(100);

    planner.stop();
    assert(callCount === 1, `Expected 1 LLM call (chat dedup), got ${callCount}`);
  });

  // ── Plan handoff order ─────────────────────────────────────────

  await test('handoff-1: workingMemory.setPlan() called BEFORE events.emit(strategic:plan-ready)', async () => {
    const callFn = makeLLMCallFn(buildValidStrategicOutput());
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    const callOrder: string[] = [];

    // Wrap setPlan to track call order
    const origSetPlan = mem.setPlan.bind(mem);
    mem.setPlan = (plan) => {
      callOrder.push('setPlan');
      origSetPlan(plan);
    };

    events.on('strategic:plan-ready', () => {
      callOrder.push('plan-ready');
    });

    const planner = buildPlanner(callFn, mem, events);
    planner.start();
    await sleep(150);
    planner.stop();

    const setPlanIdx = callOrder.indexOf('setPlan');
    const planReadyIdx = callOrder.indexOf('plan-ready');
    assert(setPlanIdx !== -1, 'setPlan was not called');
    assert(planReadyIdx !== -1, 'plan-ready was not emitted');
    assert(setPlanIdx < planReadyIdx, `setPlan (${setPlanIdx}) must be called before plan-ready (${planReadyIdx})`);
  });

  await test('handoff-2: workingMemory.setActiveSubgoal(subgoals[0].id) called before emit', async () => {
    const callFn = makeLLMCallFn(buildValidStrategicOutput());
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    const callOrder: string[] = [];

    const origSetActiveSubgoal = mem.setActiveSubgoal.bind(mem);
    mem.setActiveSubgoal = (id) => {
      callOrder.push(`setActiveSubgoal:${id ?? 'null'}`);
      origSetActiveSubgoal(id);
    };

    events.on('strategic:plan-ready', () => {
      callOrder.push('plan-ready');
    });

    const planner = buildPlanner(callFn, mem, events);
    planner.start();
    await sleep(150);
    planner.stop();

    const setSubgoalIdx = callOrder.findIndex((s) => s.startsWith('setActiveSubgoal:sg-'));
    const planReadyIdx = callOrder.indexOf('plan-ready');

    assert(setSubgoalIdx !== -1, 'setActiveSubgoal(sg-1) was not called');
    assert(planReadyIdx !== -1, 'plan-ready was not emitted');
    assert(setSubgoalIdx < planReadyIdx, `setActiveSubgoal (${setSubgoalIdx}) must be before plan-ready (${planReadyIdx})`);
  });

  await test('handoff-3: workingMemory.setActionQueue(null) called before emit', async () => {
    const callFn = makeLLMCallFn(buildValidStrategicOutput());
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    const callOrder: string[] = [];

    const origSetActionQueue = mem.setActionQueue.bind(mem);
    mem.setActionQueue = (queue) => {
      callOrder.push(queue === null ? 'setActionQueue:null' : 'setActionQueue:value');
      origSetActionQueue(queue);
    };

    events.on('strategic:plan-ready', () => {
      callOrder.push('plan-ready');
    });

    const planner = buildPlanner(callFn, mem, events);
    planner.start();
    await sleep(150);
    planner.stop();

    const setQueueNullIdx = callOrder.indexOf('setActionQueue:null');
    const planReadyIdx = callOrder.indexOf('plan-ready');

    assert(setQueueNullIdx !== -1, 'setActionQueue(null) was not called');
    assert(planReadyIdx !== -1, 'plan-ready was not emitted');
    assert(setQueueNullIdx < planReadyIdx, `setActionQueue(null) (${setQueueNullIdx}) must be before plan-ready (${planReadyIdx})`);
  });

  // ── Subgoal advancement ───────────────────────────────────────

  await test('completion-1: subgoalComplete=true with remaining subgoal → advance activeSubgoal, no LLM call', async () => {
    let callCount = 0;
    const callFn: LLMCallFn = async (msgs, modelId) => {
      callCount++;
      return makeLLMCallFn(buildValidStrategicOutput())(msgs, modelId);
    };
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Set up a plan with two subgoals; active is sg-1
    const plan = (buildValidStrategicOutput() as { plan: GoalPlan }).plan;
    mem.setPlan(plan);
    mem.setActiveSubgoal('sg-1'); // Active is sg-1, sg-2 is next

    // Reset callCount after setup (setPlan/setActiveSubgoal may not trigger LLM, but let's be safe)
    callCount = 0;

    const planner = buildPlanner(callFn, mem, events);
    planner.start();

    // Wait for any idle trigger to settle (plan is not null, no idle trigger)
    await sleep(50);
    callCount = 0; // Reset after start

    // Emit tactical:queue-ready with subgoalComplete=true
    const queue: ActionQueue = {
      subgoalId: 'sg-1',
      actions: [],
      reasoning: 'done',
      subgoalComplete: true,
      escalate: false,
      escalateReason: null,
    };
    events.emit('tactical:queue-ready', queue);
    await sleep(50);

    planner.stop();

    const snapshot = mem.getSnapshot();
    assert(snapshot.activeSubgoalId === 'sg-2', `Expected activeSubgoalId=sg-2, got ${snapshot.activeSubgoalId}`);
    assert(callCount === 0, `Expected 0 LLM calls (subgoal advancement, no LLM), got ${callCount}`);
  });

  await test('completion-2: subgoalComplete=true with no remaining subgoals → triggerStrategic(plan-completion)', async () => {
    let callCount = 0;
    const callFn: LLMCallFn = async (msgs, modelId) => {
      callCount++;
      return makeLLMCallFn(buildValidStrategicOutput())(msgs, modelId);
    };
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Plan with two subgoals; active is sg-2 (the last one)
    const plan = (buildValidStrategicOutput() as { plan: GoalPlan }).plan;
    mem.setPlan(plan);
    mem.setActiveSubgoal('sg-2'); // Last subgoal — no more after this

    const planner = buildPlanner(callFn, mem, events);
    planner.start();
    await sleep(50);
    callCount = 0; // Reset after start

    let planEmitted = false;
    events.on('strategic:plan-ready', () => { planEmitted = true; });

    // Emit tactical:queue-ready with subgoalComplete=true on last subgoal
    const queue: ActionQueue = {
      subgoalId: 'sg-2',
      actions: [],
      reasoning: 'all done',
      subgoalComplete: true,
      escalate: false,
      escalateReason: null,
    };
    events.emit('tactical:queue-ready', queue);
    await sleep(150);

    planner.stop();

    assert(callCount === 1, `Expected 1 LLM call (plan-completion trigger), got ${callCount}`);
    assert(planEmitted, 'Expected strategic:plan-ready to be emitted after plan-completion trigger');
  });

  // ── Schema failure ─────────────────────────────────────────────

  await test('schema-1: LLM returns valid JSON but fails StrategicOutputSchema → no plan emitted, no crash', async () => {
    // Return JSON that parses but fails schema validation
    const callFn = makeLLMCallFn({ not: 'a valid strategic output' });
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    let planEmitted = false;
    let crashed = false;
    events.on('strategic:plan-ready', () => { planEmitted = true; });

    const planner = buildPlanner(callFn, mem, events);
    try {
      planner.start();
      await sleep(150);
    } catch {
      crashed = true;
    }
    planner.stop();

    assert(!planEmitted, 'Expected no plan to be emitted on schema failure');
    assert(!crashed, 'Expected no crash on schema failure');
  });

  // ── LLM failure ──────────────────────────────────────────────

  await test('llm-1: LLMResult ok=false → no plan emitted, no crash', async () => {
    // Return invalid JSON to force parse_failure
    const callFn = makeErrorLLMCallFn('parse');
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    let planEmitted = false;
    let crashed = false;
    events.on('strategic:plan-ready', () => { planEmitted = true; });

    const planner = buildPlanner(callFn, mem, events);
    try {
      planner.start();
      await sleep(150);
    } catch {
      crashed = true;
    }
    planner.stop();

    assert(!planEmitted, 'Expected no plan to be emitted on LLM failure');
    assert(!crashed, 'Expected no crash on LLM failure');
  });

  // ── stop() cleanup ────────────────────────────────────────────

  await test('stop-1: after stop(), no further event listeners fire on the planner', async () => {
    let callCount = 0;
    const callFn: LLMCallFn = async (msgs, modelId) => {
      callCount++;
      return makeLLMCallFn(buildValidStrategicOutput())(msgs, modelId);
    };
    const mem = new WorkingMemory();
    const events = new TypedEventBus();

    // Pre-set a plan so start() doesn't trigger idle
    mem.setPlan((buildValidStrategicOutput() as { plan: GoalPlan }).plan);

    const planner = buildPlanner(callFn, mem, events);
    planner.start();
    await sleep(50);
    planner.stop();

    callCount = 0; // Reset after stop

    // Fire events that should no longer trigger the planner
    events.emit('escalate:to-strategic', { reason: 'after stop', consecutiveFailures: 1 });
    events.emit('bot:chat', { username: 'user', message: 'test' });
    events.emit('perception:updated', buildPerceptionSnapshot({ health: 5 }));
    await sleep(100);

    assert(callCount === 0, `Expected 0 LLM calls after stop(), got ${callCount}`);
  });

  // ──────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const e of errors) {
      console.log(`  - ${e}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

void run();
