import { MovementCoordinator } from './MovementCoordinator';
import type { ActionItem } from '../types';
import type { SkillExecutionOutcome } from './types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createAction(skill: 'move_to' | 'follow_entity', tag: string): ActionItem {
  return {
    skill,
    params: { tag },
    expectedDurationSeconds: 5,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function testRetainsSinglePendingAndDropsReplacedRequest(): Promise<void> {
  const nowMs = 0;
  const coordinator = new MovementCoordinator({
    now: () => nowMs,
    pendingTtlMs: 10_000,
  });

  const active = createDeferred<SkillExecutionOutcome>();

  const first = coordinator.requestMove({
    actionItem: createAction('move_to', 'first'),
    timeoutMs: 1_000,
    intent: 'normal',
    execute: () => active.promise,
  });

  const second = coordinator.requestMove({
    actionItem: createAction('move_to', 'second'),
    timeoutMs: 1_000,
    intent: 'normal',
    execute: () => Promise.resolve({ success: true, errorCode: null, errorMessage: null, stateChanges: {} }),
  });

  const third = coordinator.requestMove({
    actionItem: createAction('move_to', 'third'),
    timeoutMs: 1_000,
    intent: 'normal',
    execute: () => Promise.resolve({ success: true, errorCode: null, errorMessage: null, stateChanges: {} }),
  });

  const secondResult = await second;
  assert(secondResult.success === false, 'Replaced pending request should fail');
  assert(secondResult.errorCode === 'interrupted', 'Replaced pending request should map to interrupted');

  active.resolve({ success: true, errorCode: null, errorMessage: null, stateChanges: {} });

  const firstResult = await first;
  const thirdResult = await third;

  assert(firstResult.success === true, 'First active request should complete');
  assert(thirdResult.success === true, 'Latest pending request should execute');
}

async function testCriticalRequestPreemptsNonCriticalActive(): Promise<void> {
  const coordinator = new MovementCoordinator({
    pendingTtlMs: 10_000,
  });

  const active = createDeferred<SkillExecutionOutcome>();

  const first = coordinator.requestMove({
    actionItem: createAction('follow_entity', 'first'),
    timeoutMs: 1_000,
    intent: 'normal',
    execute: () => active.promise,
  });

  const critical = coordinator.requestMove({
    actionItem: createAction('move_to', 'critical'),
    timeoutMs: 1_000,
    intent: 'critical',
    execute: () => Promise.resolve({ success: true, errorCode: null, errorMessage: null, stateChanges: {} }),
  });

  active.resolve({
    success: false,
    errorCode: 'interrupted',
    errorMessage: 'aborted',
    stateChanges: {},
  });

  const firstResult = await first;
  const criticalResult = await critical;

  assert(firstResult.success === false, 'Preempted movement should fail');
  assert(firstResult.errorCode === 'interrupted', 'Preempted movement should return interrupted');
  assert(criticalResult.success === true, 'Critical movement should execute after preemption');
}

async function testDropsStalePendingRequest(): Promise<void> {
  let nowMs = 0;
  const coordinator = new MovementCoordinator({
    now: () => nowMs,
    pendingTtlMs: 25,
  });

  const active = createDeferred<SkillExecutionOutcome>();

  const first = coordinator.requestMove({
    actionItem: createAction('move_to', 'first'),
    timeoutMs: 1_000,
    intent: 'normal',
    execute: () => active.promise,
  });

  nowMs = 1;
  const pending = coordinator.requestMove({
    actionItem: createAction('follow_entity', 'pending'),
    timeoutMs: 1_000,
    intent: 'normal',
    execute: () => Promise.resolve({ success: true, errorCode: null, errorMessage: null, stateChanges: {} }),
  });

  nowMs = 100;
  active.resolve({ success: true, errorCode: null, errorMessage: null, stateChanges: {} });

  const firstResult = await first;
  const pendingResult = await pending;

  assert(firstResult.success === true, 'Active request should complete');
  assert(pendingResult.success === false, 'Stale pending should be dropped');
  assert(pendingResult.errorCode === 'interrupted', 'Stale pending should map to interrupted');
}

async function run(): Promise<void> {
  await testRetainsSinglePendingAndDropsReplacedRequest();
  await testCriticalRequestPreemptsNonCriticalActive();
  await testDropsStalePendingRequest();
}

void run();
