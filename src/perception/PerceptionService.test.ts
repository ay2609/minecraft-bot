import type { PerceptionSnapshot } from '../types/index';
import type { InitializedMemory } from '../memory';
import { initializeApplication } from '../index';
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

interface FakeEventBus {
  emit: (event: string, payload?: unknown) => boolean;
  on: (event: string, listener: (payload?: unknown) => void) => FakeEventBus;
  off: (event: string, listener: (payload?: unknown) => void) => FakeEventBus;
}

function createFakeEventBus(): FakeEventBus {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();

  return {
    emit: (event, payload) => {
      const eventListeners = listeners.get(event);
      if (!eventListeners) {
        return false;
      }
      for (const listener of eventListeners) {
        listener(payload);
      }
      return eventListeners.size > 0;
    },
    on: (event, listener) => {
      const existing = listeners.get(event) ?? new Set<(payload?: unknown) => void>();
      existing.add(listener);
      listeners.set(event, existing);
      return createFakeEventBusFacade(listeners);
    },
    off: (event, listener) => {
      const existing = listeners.get(event);
      existing?.delete(listener);
      return createFakeEventBusFacade(listeners);
    },
  };
}

function createFakeEventBusFacade(
  listeners: Map<string, Set<(payload?: unknown) => void>>,
): FakeEventBus {
  return {
    emit: (event, payload) => {
      const eventListeners = listeners.get(event);
      if (!eventListeners) {
        return false;
      }
      for (const listener of eventListeners) {
        listener(payload);
      }
      return eventListeners.size > 0;
    },
    on: (event, listener) => {
      const existing = listeners.get(event) ?? new Set<(payload?: unknown) => void>();
      existing.add(listener);
      listeners.set(event, existing);
      return createFakeEventBusFacade(listeners);
    },
    off: (event, listener) => {
      const existing = listeners.get(event);
      existing?.delete(listener);
      return createFakeEventBusFacade(listeners);
    },
  };
}

function testPerceptionServiceRespondsToDirtySignalsFromEventBus(): void {
  let now = 10_000;
  const pending: Array<{ dueAt: number; callback: () => void }> = [];
  const emitted: PerceptionSnapshot[] = [];
  const fakeEventBus = createFakeEventBus();

  const service = new PerceptionService({
    buildSnapshot: () => createSnapshot(now, 'idle'),
    emitSnapshot: (snapshot) => emitted.push(snapshot),
    clock: () => now,
    schedule: (callback, delayMs) => {
      pending.push({ dueAt: now + delayMs, callback });
      return pending.length;
    },
    cancelSchedule: () => {
      // no-op for deterministic test scheduler
    },
    eventBus: fakeEventBus as never,
  });

  service.start();
  const first = pending.shift();
  assert(first !== undefined, 'Expected initial timer');
  if (first === undefined) {
    throw new Error('Expected initial timer');
  }
  now = first.dueAt;
  first.callback();
  assert(emitted.length === 1, 'Expected first snapshot emission');

  const scheduledBeforeDirty = pending[pending.length - 1];
  assert(scheduledBeforeDirty !== undefined, 'Expected follow-up schedule after first emission');
  if (scheduledBeforeDirty === undefined) {
    throw new Error('Expected follow-up schedule after first emission');
  }
  assert(
    scheduledBeforeDirty.dueAt >= (now + 500),
    `Expected non-burst follow-up cadence before dirty signal, got ${scheduledBeforeDirty.dueAt - now}ms`,
  );

  now += 100;
  fakeEventBus.emit('perception:dirty', { reason: 'movement', burst: true });

  const scheduledAfterDirty = pending[pending.length - 1];
  assert(scheduledAfterDirty !== undefined, 'Expected service to reschedule after dirty signal');
  if (scheduledAfterDirty === undefined) {
    throw new Error('Expected service to reschedule after dirty signal');
  }
  const delayFromDirty = scheduledAfterDirty.dueAt - now;
  assert(
    delayFromDirty <= 300,
    `Expected burst scheduling <=300ms after dirty signal, got ${delayFromDirty}ms`,
  );
}

function createMemoryStub(): InitializedMemory {
  return {
    database: {} as InitializedMemory['database'],
    semantic: {} as InitializedMemory['semantic'],
    episodic: {} as InitializedMemory['episodic'],
    checkpoint: {} as InitializedMemory['checkpoint'],
    workingMemory: {
      getSnapshot: () => ({
        activePlan: null,
        activeSubgoalId: null,
        actionQueue: null,
        constraints: {},
        execution: { inFlightAction: null, lockedSkill: null },
        restore: {
          restoredFromCheckpoint: false,
          restoredAt: null,
          checkpointId: null,
        },
      }),
    } as InitializedMemory['workingMemory'],
    restore: {} as InitializedMemory['restore'],
    close: () => {
      // no-op
    },
  };
}

function testInitializeApplicationStartsAndStopsPerceptionService(): void {
  let started = 0;
  let stopped = 0;

  const botStub = {
    username: 'TestBot',
    version: '1.21.11',
    entity: { position: { x: 0, y: 64, z: 0 } },
    inventory: {
      items: () => [],
      slots: [] as Array<{ name: string; count: number } | null>,
    },
    once: (event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'end') {
        (botStub as { __endHandler?: (...args: unknown[]) => void }).__endHandler = handler;
      }
      return botStub;
    },
    on: () => botStub,
  };

  initializeApplication({
    dependencies: {
      createBot: () => botStub as never,
      initializeMemory: () => createMemoryStub(),
      createPerceptionService: () => ({
        start: () => {
          started += 1;
        },
        stop: () => {
          stopped += 1;
        },
        getLastSnapshot: () => null,
        markDirty: () => {
          // no-op
        },
      }),
    } as never,
  });

  assert(started === 1, `Expected initializeApplication to start perception service once, got ${started}`);

  const endHandler = (botStub as { __endHandler?: () => void }).__endHandler;
  assert(endHandler !== undefined, 'Expected bot end handler to be registered for perception shutdown');
  if (endHandler === undefined) {
    throw new Error('Expected bot end handler to be registered');
  }

  endHandler();
  assert(stopped === 1, `Expected perception service stop on bot end, got ${stopped}`);
}

testCadenceDefaultsStartImmediatelyAndThrottleAfterEmit();
testPerceptionServiceLifecycleAndSingleEmissionPerTick();
testPerceptionServiceRespondsToDirtySignalsFromEventBus();
testInitializeApplicationStartsAndStopsPerceptionService();

console.log('PerceptionService behavior: PASS');

export {};
