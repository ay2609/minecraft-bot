import type { PerceptionSnapshot } from '../types/index';
import { createPerceptionCadenceState, nextEmitAt } from './PerceptionCadence';
import { PerceptionService } from './PerceptionService';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createSnapshot(timestamp: number, action: string | null = null): PerceptionSnapshot {
  return {
    timestamp,
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
    timeOfDay: 0,
    weather: 'clear',
    nearbyEntities: [],
    nearbyBlocks: [],
    lightLevel: 15,
    currentAction: action,
    recentFailures: [],
  };
}

function testCadenceDefaultsStartImmediatelyAndThrottleAfterEmit(): void {
  const state = createPerceptionCadenceState();
  const initialDue = nextEmitAt({ state, now: 1000 });
  assert(initialDue === 1000, `Expected initial emit due immediately, got ${initialDue}`);

  const afterEmitState = {
    ...state,
    lastEmitAt: 1000,
  };
  const followUpDue = nextEmitAt({ state: afterEmitState, now: 1000 });
  assert(followUpDue >= 1500 && followUpDue <= 2000, `Expected baseline follow-up in 1-2Hz band, got ${followUpDue}`);
}

function testPerceptionServiceLifecycleAndSingleEmissionPerTick(): void {
  let now = 1_000;
  const emitted: PerceptionSnapshot[] = [];
  const pending: Array<{ dueAt: number; callback: () => void }> = [];
  let nextTimerId = 1;

  const timers = new Map<number, { dueAt: number; callback: () => void }>();

  const service = new PerceptionService({
    buildSnapshot: () => createSnapshot(now, 'idle'),
    clock: () => now,
    emitSnapshot: (snapshot) => emitted.push(snapshot),
    schedule: (callback, delayMs) => {
      const id = nextTimerId;
      nextTimerId += 1;
      const dueAt = now + delayMs;
      const timer = { dueAt, callback };
      pending.push(timer);
      timers.set(id, timer);
      return id;
    },
    cancelSchedule: (timerId) => {
      timers.delete(timerId as number);
    },
  });

  service.start();
  assert(pending.length > 0, 'Expected scheduler timer to be created on start');

  const first = pending.shift();
  assert(first !== undefined, 'Expected initial timer');
  if (first === undefined) {
    throw new Error('Expected initial timer');
  }
  now = first.dueAt;
  first.callback();

  assert(emitted.length === 1, `Expected exactly one emission after first tick, got ${emitted.length}`);
  assert(service.getLastSnapshot() !== null, 'Expected last snapshot to be available after first emission');

  service.stop();
  assert(service.getLastSnapshot() !== null, 'Expected stop to preserve last snapshot');
}

testCadenceDefaultsStartImmediatelyAndThrottleAfterEmit();
testPerceptionServiceLifecycleAndSingleEmissionPerTick();

console.log('PerceptionService behavior: PASS');

export {};
