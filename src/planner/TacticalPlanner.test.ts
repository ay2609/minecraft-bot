/**
 * TacticalPlanner unit tests — hand-rolled stubs, no real I/O
 *
 * Run: npx tsx src/planner/TacticalPlanner.test.ts
 */

import assert from 'node:assert/strict';
import type { ActionQueue, ExecutorResult, ActionItem } from '../types';
import type { WorkingMemorySnapshot, WorkingMemoryFailureRecord } from '../types/index';
import { TacticalPlanner, DEFAULT_TACTICAL_CONFIG } from './TacticalPlanner';
import type { TacticalConfig } from './TacticalPlanner';
import type { PlannerContextBundle } from '../perception/types';

// ─── Stubs ─────────────────────────────────────────────────────────────────

interface RegisteredHandler {
  event: string;
  handler: (...args: unknown[]) => void;
}

interface EmittedEvent {
  event: string;
  args: unknown[];
}

function makeEventBusStub() {
  const handlers: RegisteredHandler[] = [];
  const emitted: EmittedEvent[] = [];

  return {
    handlers,
    emitted,
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.push({ event, handler });
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      const idx = handlers.findIndex((h) => h.event === event && h.handler === handler);
      if (idx !== -1) handlers.splice(idx, 1);
    },
    emit(event: string, ...args: unknown[]) {
      emitted.push({ event, args });
      return true;
    },
  };
}

function makeWorkingMemoryStub() {
  let queue: ActionQueue | null = null;
  const failures: WorkingMemoryFailureRecord[] = [];

  const baseSnap: WorkingMemorySnapshot = {
    activePlan: null,
    activeSubgoalId: 'sg-test',
    actionQueue: null,
    constraints: {},
    execution: { inFlightAction: null, lockedSkill: null },
    restore: { restoredFromCheckpoint: false, restoredAt: null, checkpointId: null },
    recentFailures: [],
  };

  return {
    getSetQueues: () => queue,
    getRecordedFailures: () => failures,
    getSnapshot(): WorkingMemorySnapshot {
      return { ...baseSnap, actionQueue: queue, recentFailures: [...failures] };
    },
    setActionQueue(q: ActionQueue | null) {
      queue = q;
    },
    recordFailure(failure: WorkingMemoryFailureRecord) {
      failures.push({ ...failure });
    },
  };
}

type LLMResultOk = { ok: true; data: unknown };
type LLMResultFail = { ok: false; kind: string; message: string; attempt: number };
type LLMResult = LLMResultOk | LLMResultFail;

function makeLLMStub(result: LLMResult) {
  return {
    call(_messages: unknown[]): Promise<LLMResult> {
      void _messages;
      return Promise.resolve(result);
    },
  };
}

function makeCountingLLMStub(result: LLMResult) {
  let callCount = 0;
  return {
    getCallCount: () => callCount,
    call(_messages: unknown[]): Promise<LLMResult> {
      void _messages;
      callCount++;
      return Promise.resolve(result);
    },
  };
}

function makeTacticalOutput(overrides: Partial<{
  reasoning: string;
  queueOps: unknown[];
  finalQueue: ActionItem[];
  subgoalComplete: boolean;
  escalate: boolean;
  escalateReason: string | null;
}> = {}) {
  return {
    reasoning: overrides.reasoning ?? 'test reasoning',
    queueOps: overrides.queueOps ?? [],
    finalQueue: overrides.finalQueue ?? [{ skill: 'move_to', params: { x: 0, y: 64, z: 0 }, expectedDurationSeconds: 5 }],
    subgoalComplete: overrides.subgoalComplete ?? false,
    escalate: overrides.escalate ?? false,
    escalateReason: overrides.escalateReason ?? null,
  };
}

function makeExecutorResult(overrides: Partial<ExecutorResult> = {}): ExecutorResult {
  return {
    actionItem: { skill: 'move_to', params: {}, expectedDurationSeconds: 5 },
    success: true,
    errorCode: null,
    errorMessage: null,
    durationMs: 1000,
    stateChanges: {},
    ...overrides,
  };
}

function makeConfig(overrides: Partial<TacticalConfig> = {}): TacticalConfig {
  return { ...DEFAULT_TACTICAL_CONFIG, ...overrides };
}

function makePlannerContextBundle(): PlannerContextBundle {
  return {
    snapshot: {
      position: { x: 12, y: 64, z: -3 },
      biome: 'plains',
      currentAction: 'move_to',
      nearbyEntities: ['cow', 'sheep'],
      nearbyBlocks: ['oak_log', 'crafting_table'],
    },
    intent: {
      activeGoal: 'collect oak logs',
      activeSubgoalId: 'sg-test',
      inFlightSkill: 'move_to',
    },
    memory: {
      semantic: [
        {
          label: 'oak_forest',
          position: { x: 20, y: 64, z: -8 },
          distance: 11.3,
          confidence: 0.92,
          lastSeenAt: '2026-03-08T00:00:00.000Z',
        },
      ],
      episodic: [
        {
          goal: 'collect oak logs',
          action: 'break_block',
          outcome: 'success',
          failureReason: null,
          createdAt: '2026-03-08T00:01:00.000Z',
        },
      ],
    },
    meta: {
      memorySource: 'live',
      memoryTimedOut: false,
      truncation: {
        applied: false,
        droppedEpisodic: 0,
        droppedSemantic: 0,
        reason: null,
      },
    },
  };
}

// ─── Test Helpers ───────────────────────────────────────────────────────────

function getEmitted(bus: ReturnType<typeof makeEventBusStub>, event: string) {
  return bus.emitted.filter((e) => e.event === event);
}

function triggerHandler(bus: ReturnType<typeof makeEventBusStub>, event: string, ...args: unknown[]) {
  const handler = bus.handlers.find((h) => h.event === event);
  if (!handler) throw new Error(`No handler registered for event: ${event}`);
  handler.handler(...args);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${String(err)}`);
      failed++;
    }
  }

  console.log('\nTacticalPlanner tests\n');

  // Test 1: executor:result (success) triggers LLM call and emits tactical:queue-ready
  await test('Test 1: executor:result (success) triggers LLM call and emits tactical:queue-ready', async () => {
    const successOutput = makeTacticalOutput();
    const llm = makeCountingLLMStub({ ok: true, data: successOutput });
    const mem = makeWorkingMemoryStub();
    const bus = makeEventBusStub();

    const planner = new TacticalPlanner(llm as never, mem as never, bus as never, makeConfig());
    planner.start();

    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: true }));
    await sleep(10);

    assert.equal(llm.getCallCount(), 1, 'LLM should be called once');

    const queues = getEmitted(bus, 'tactical:queue-ready');
    assert.equal(queues.length, 1, 'tactical:queue-ready should be emitted once');
    const emittedQueue = queues[0].args[0] as ActionQueue;
    assert.equal(emittedQueue.actions[0].skill, 'move_to', 'emitted queue should have finalQueue from LLM output');

    planner.stop();
  });

  // Test 1b: planner:context-ready updates LLM payload to include non-null context
  await test('Test 1b: planner:context-ready makes LLM user payload context non-null', async () => {
    let capturedMessages: unknown[] | null = null;
    const llm = {
      call(messages: unknown[]): Promise<LLMResult> {
        capturedMessages = messages;
        return Promise.resolve({
          ok: true,
          data: makeTacticalOutput({ finalQueue: [] }),
        });
      },
    };
    const mem = makeWorkingMemoryStub();
    const bus = makeEventBusStub();

    const planner = new TacticalPlanner(llm as never, mem as never, bus as never, makeConfig());
    planner.start();

    triggerHandler(bus, 'planner:context-ready', makePlannerContextBundle());
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: true }));
    await sleep(10);

    assert.ok(capturedMessages, 'LLM should receive messages payload');
    const userMessage = (capturedMessages as Array<{ role?: string; content?: string }>)[1];
    assert.equal(userMessage?.role, 'user', 'Second message should be user payload');
    const parsedPayload = JSON.parse(userMessage?.content ?? '{}') as {
      context: null | {
        position: unknown;
        currentAction: unknown;
        nearbyEntities: unknown;
        nearbyBlocks: unknown;
        memory: unknown;
      };
    };

    assert.notEqual(parsedPayload.context, null, 'Context must not be null once planner context is ready');
    assert.ok(parsedPayload.context?.position, 'Context should include snapshot position');
    assert.ok(parsedPayload.context?.memory, 'Context should include memory attachment');

    planner.stop();
  });

  // Test 2: executor:result with LLM parse_failure emits tactical:queue-ready with WAIT action
  await test('Test 2: executor:result with LLM parse_failure emits tactical:queue-ready with WAIT action', async () => {
    const llm = makeLLMStub({ ok: false, kind: 'parse_failure', message: 'bad json', attempt: 2 });
    const mem = makeWorkingMemoryStub();
    const bus = makeEventBusStub();

    const planner = new TacticalPlanner(llm as never, mem as never, bus as never, makeConfig());
    planner.start();

    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: true }));
    await sleep(10);

    const queues = getEmitted(bus, 'tactical:queue-ready');
    assert.equal(queues.length, 1, 'tactical:queue-ready should be emitted');
    const emittedQueue = queues[0].args[0] as ActionQueue;
    assert.equal(emittedQueue.actions.length, 1, 'WAIT queue should have exactly one action');
    assert.equal(emittedQueue.actions[0].skill, 'WAIT', 'Fallback action should be WAIT');
    assert.equal(emittedQueue.actions[0].expectedDurationSeconds, 5, 'WAIT duration should be 5s');

    planner.stop();
  });

  // Test 3: executor:result with errorCode=invalid_state emits escalate:to-strategic immediately
  await test('Test 3: executor:result with errorCode=invalid_state emits escalate:to-strategic immediately', async () => {
    const llm = makeLLMStub({ ok: true, data: makeTacticalOutput() });
    const mem = makeWorkingMemoryStub();
    const bus = makeEventBusStub();

    const planner = new TacticalPlanner(llm as never, mem as never, bus as never, makeConfig({ consecutiveFailureThreshold: 3 }));
    planner.start();

    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: false, errorCode: 'invalid_state', errorMessage: 'state corrupted' }));
    await sleep(10);

    const escalations = getEmitted(bus, 'escalate:to-strategic');
    assert.equal(escalations.length, 1, 'Should escalate exactly once');
    const payload = escalations[0].args[0] as { reason: string; consecutiveFailures: number };
    assert.ok(payload.reason.includes('invalid_state'), 'Reason should mention invalid_state');

    // tactical:queue-ready should NOT be emitted on invalid_state
    const queues = getEmitted(bus, 'tactical:queue-ready');
    assert.equal(queues.length, 0, 'Should not emit tactical:queue-ready on invalid_state escalation');

    planner.stop();
  });

  // Test 4: three consecutive non-invalid_state failures emit escalate:to-strategic after third
  await test('Test 4: three consecutive failures emit escalate:to-strategic after threshold', async () => {
    const llm = makeLLMStub({ ok: true, data: makeTacticalOutput() });
    const mem = makeWorkingMemoryStub();
    const bus = makeEventBusStub();

    const planner = new TacticalPlanner(llm as never, mem as never, bus as never, makeConfig({ consecutiveFailureThreshold: 3 }));
    planner.start();

    // First failure — no escalation
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: false, errorCode: 'no_path', errorMessage: 'no path' }));
    await sleep(10);
    assert.equal(getEmitted(bus, 'escalate:to-strategic').length, 0, 'No escalation after 1st failure');

    // Second failure — no escalation
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: false, errorCode: 'no_path', errorMessage: 'no path' }));
    await sleep(10);
    assert.equal(getEmitted(bus, 'escalate:to-strategic').length, 0, 'No escalation after 2nd failure');

    // Third failure — escalation
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: false, errorCode: 'no_path', errorMessage: 'no path' }));
    await sleep(10);
    const escalations = getEmitted(bus, 'escalate:to-strategic');
    assert.equal(escalations.length, 1, 'Should escalate after 3rd consecutive failure');
    const payload = escalations[0].args[0] as { consecutiveFailures: number };
    assert.equal(payload.consecutiveFailures, 3, 'consecutiveFailures should be 3');

    planner.stop();
  });

  // Test 5: success after failures resets counter — no premature escalation
  await test('Test 5: success after failures resets counter — no premature escalation', async () => {
    const llm = makeLLMStub({ ok: true, data: makeTacticalOutput() });
    const mem = makeWorkingMemoryStub();
    const bus = makeEventBusStub();

    const planner = new TacticalPlanner(llm as never, mem as never, bus as never, makeConfig({ consecutiveFailureThreshold: 3 }));
    planner.start();

    // Two failures
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: false, errorCode: 'no_path', errorMessage: 'x' }));
    await sleep(10);
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: false, errorCode: 'no_path', errorMessage: 'x' }));
    await sleep(10);

    // Success — resets counter
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: true }));
    await sleep(10);

    // Two more failures — should not escalate (counter was reset)
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: false, errorCode: 'no_path', errorMessage: 'x' }));
    await sleep(10);
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: false, errorCode: 'no_path', errorMessage: 'x' }));
    await sleep(10);

    const escalations = getEmitted(bus, 'escalate:to-strategic');
    assert.equal(escalations.length, 0, 'No escalation — counter was reset by success');

    planner.stop();
  });

  // Test 6: watchdog fires tactical cycle when no executor:result arrives within interval
  await test('Test 6: watchdog fires tactical cycle when no executor:result arrives within interval', async () => {
    const llm = makeCountingLLMStub({ ok: true, data: makeTacticalOutput() });
    const mem = makeWorkingMemoryStub();
    const bus = makeEventBusStub();

    const planner = new TacticalPlanner(
      llm as never,
      mem as never,
      bus as never,
      makeConfig({ watchdogIntervalMs: 50 }), // very short for test
    );
    planner.start();

    // Wait longer than watchdog interval
    await sleep(100);

    assert.ok(llm.getCallCount() >= 1, 'Watchdog should trigger at least one LLM call');
    const queues = getEmitted(bus, 'tactical:queue-ready');
    assert.ok(queues.length >= 1, 'Watchdog should emit tactical:queue-ready');

    planner.stop();
  });

  // Test 7: churn escalation fires when churnWindowSize consecutive large-rewrite cycles detected
  await test('Test 7: churn escalation fires when churnWindowSize consecutive large-rewrite cycles detected', async () => {
    // Each cycle has > churnOpsThreshold (5) ops — 6 ops
    const churnOutput = makeTacticalOutput({
      queueOps: [
        { op: 'clear' }, { op: 'clear' }, { op: 'clear' },
        { op: 'clear' }, { op: 'clear' }, { op: 'clear' },
      ],
    });
    const llm = makeLLMStub({ ok: true, data: churnOutput });
    const mem = makeWorkingMemoryStub();
    const bus = makeEventBusStub();

    const planner = new TacticalPlanner(
      llm as never,
      mem as never,
      bus as never,
      makeConfig({
        churnOpsThreshold: 5,
        churnWindowSize: 3,
        churnCooldownMs: 0, // no cooldown for test
      }),
    );
    planner.start();

    // Trigger 3 cycles (churnWindowSize)
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: true }));
    await sleep(10);
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: true }));
    await sleep(10);
    triggerHandler(bus, 'executor:result', makeExecutorResult({ success: true }));
    await sleep(10);

    const escalations = getEmitted(bus, 'escalate:to-strategic');
    assert.ok(escalations.length >= 1, 'Churn should trigger escalation after churnWindowSize consecutive large-rewrite cycles');
    const payload = escalations[0].args[0] as { reason: string };
    assert.ok(payload.reason.toLowerCase().includes('churn'), 'Reason should mention churn');

    planner.stop();
  });

  // Test 8: executor:result failure records errorCode and errorMessage before triggerTactical
  await test('Test 8: executor:result failure records errorCode/errorMessage to workingMemory before LLM call', async () => {
    let recordFailureCalledBeforeLLM = false;
    let llmCallCount = 0;

    const trackingMem = {
      ...makeWorkingMemoryStub(),
      recordFailure(failure: WorkingMemoryFailureRecord) {
        void failure;
        if (llmCallCount === 0) {
          recordFailureCalledBeforeLLM = true;
        }
      },
    };

    const trackingLLM = {
      call(messages: unknown[]): Promise<LLMResult> {
        void messages;
        llmCallCount++;
        return Promise.resolve({ ok: true as const, data: makeTacticalOutput() });
      },
    };

    const bus = makeEventBusStub();
    const planner = new TacticalPlanner(trackingLLM as never, trackingMem as never, bus as never, makeConfig());
    planner.start();

    triggerHandler(bus, 'executor:result', makeExecutorResult({
      success: false,
      errorCode: 'no_path',
      errorMessage: 'could not find path',
    }));
    await sleep(10);

    assert.ok(recordFailureCalledBeforeLLM, 'recordFailure must be called before LLM is invoked');
    assert.ok(llmCallCount >= 1, 'LLM should have been called after recordFailure');

    planner.stop();
  });

  // Test 9: stop() correctly removes both executor:result and planner:context-ready listeners
  await test('Test 9: stop() correctly removes both executor:result and planner:context-ready listeners', () => {
    const llm = makeLLMStub({ ok: true, data: makeTacticalOutput() });
    const mem = makeWorkingMemoryStub();
    const bus = makeEventBusStub();

    const planner = new TacticalPlanner(llm as never, mem as never, bus as never, makeConfig());
    planner.start();

    assert.equal(bus.handlers.length, 2, 'start() should register 2 handlers');

    planner.stop();

    assert.equal(bus.handlers.length, 0, 'stop() should remove all registered handlers');
  });

  // Results
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err: unknown) => {
  console.error('Test failed:', err);
  process.exit(1);
});
