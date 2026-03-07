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

interface ScheduledTimer {
  id: number;
  dueAt: number;
  callback: () => void;
}

interface ServiceHarness {
  now: number;
  emittedAt: number[];
  emittedSnapshots: PerceptionSnapshot[];
  bus: FakeEventBus;
  service: PerceptionService;
  nextTimer: () => ScheduledTimer | null;
}

function createServiceHarness(initialNow = 0): ServiceHarness {
  let now = initialNow;
  let timerId = 0;
  const timers = new Map<number, ScheduledTimer>();
  const bus = createFakeEventBus();
  const emittedSnapshots: PerceptionSnapshot[] = [];
  const emittedAt: number[] = [];
  let sequence = 0;

  const service = new PerceptionService({
    buildSnapshot: () => {
      sequence += 1;
      return createSnapshot(now, `tick-${sequence}`);
    },
    clock: () => now,
    emitSnapshot: (snapshot) => {
      emittedSnapshots.push(snapshot);
      emittedAt.push(now);
    },
    schedule: (callback, delayMs) => {
      timerId += 1;
      timers.set(timerId, {
        id: timerId,
        dueAt: now + delayMs,
        callback,
      });
      return timerId;
    },
    cancelSchedule: (id) => {
      timers.delete(id as number);
    },
    eventBus: bus as never,
  });

  return {
    get now(): number {
      return now;
    },
    set now(value: number) {
      now = value;
    },
    emittedAt,
    emittedSnapshots,
    bus,
    service,
    nextTimer: () => {
      const ordered = Array.from(timers.values()).sort((a, b) => a.dueAt - b.dueAt || a.id - b.id);
      const next = ordered[0];
      if (!next) {
        return null;
      }
      timers.delete(next.id);
      return next;
    },
  };
}

function toIntervals(timestamps: number[]): number[] {
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const previous = timestamps[i - 1];
    const current = timestamps[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    intervals.push(current - previous);
  }
  return intervals;
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

function testIdleHeartbeatCadenceStaysInOneToTwoHzBand(): void {
  const harness = createServiceHarness(5_000);
  harness.service.start();

  while (harness.emittedAt.length < 5) {
    const timer = harness.nextTimer();
    assert(timer !== null, 'Expected timer while collecting idle cadence samples');
    if (timer === null) {
      throw new Error('Expected timer while collecting idle cadence samples');
    }
    harness.now = timer.dueAt;
    timer.callback();
  }

  const intervals = toIntervals(harness.emittedAt);
  assert(intervals.length > 0, 'Expected idle intervals');
  assert(
    intervals.every((interval) => interval >= 500 && interval <= 1000),
    `Expected idle cadence intervals in 500-1000ms band, got [${intervals.join(', ')}]`,
  );
}

function testExecutorResultSignalAcceleratesCadence(): void {
  const harness = createServiceHarness(8_000);
  harness.service.start();

  const firstTimer = harness.nextTimer();
  assert(firstTimer !== null, 'Expected initial timer');
  if (firstTimer === null) {
    throw new Error('Expected initial timer');
  }
  harness.now = firstTimer.dueAt;
  firstTimer.callback();

  harness.now += 50;
  harness.bus.emit('executor:result', {
    actionItem: { skill: 'move_to', params: {}, expectedDurationSeconds: 10 },
    success: true,
    errorCode: null,
    errorMessage: null,
    durationMs: 200,
    stateChanges: {},
  });

  const acceleratedTimer = harness.nextTimer();
  assert(acceleratedTimer !== null, 'Expected rescheduled timer after executor result signal');
  if (acceleratedTimer === null) {
    throw new Error('Expected rescheduled timer after executor result signal');
  }

  const delayMs = acceleratedTimer.dueAt - harness.now;
  assert(delayMs <= 300, `Expected accelerated cadence <=300ms after executor result, got ${delayMs}ms`);
}

function testBurstCadenceIsHardCappedAndCoolsDown(): void {
  const harness = createServiceHarness(12_000);
  harness.service.start();

  const initialTimer = harness.nextTimer();
  assert(initialTimer !== null, 'Expected initial timer');
  if (initialTimer === null) {
    throw new Error('Expected initial timer');
  }
  harness.now = initialTimer.dueAt;
  initialTimer.callback();

  harness.now += 10;
  harness.bus.emit('perception:dirty', { reason: 'activity', burst: true });

  while (harness.emittedAt.length < 9) {
    const timer = harness.nextTimer();
    assert(timer !== null, 'Expected timer during burst/cooldown sampling');
    if (timer === null) {
      throw new Error('Expected timer during burst/cooldown sampling');
    }
    harness.now = timer.dueAt;
    timer.callback();
  }

  const intervals = toIntervals(harness.emittedAt);
  const burstIntervals = intervals.slice(0, 6);
  assert(
    burstIntervals.every((interval) => interval >= 250),
    `Expected burst max rate hard cap (>=250ms intervals), got [${burstIntervals.join(', ')}]`,
  );
  const cooldownInterval = intervals.find((interval) => interval >= 700 && interval <= 1000);
  if (cooldownInterval === undefined) {
    throw new Error('Expected at least one cooldown interval sample in baseline range');
  }
  assert(
    cooldownInterval >= 700 && cooldownInterval <= 1000,
    `Expected cooldown to return toward baseline, got ${cooldownInterval}ms`,
  );
}

function testSnapshotCycleEmitsExactlyOneEventPayload(): void {
  const harness = createServiceHarness(16_000);
  harness.service.start();

  let callbacks = 0;
  while (callbacks < 4) {
    const timer = harness.nextTimer();
    assert(timer !== null, 'Expected timer while counting snapshot cycles');
    if (timer === null) {
      throw new Error('Expected timer while counting snapshot cycles');
    }
    callbacks += 1;
    harness.now = timer.dueAt;
    timer.callback();
  }

  assert(
    harness.emittedSnapshots.length === callbacks,
    `Expected one emitted payload per snapshot cycle: emitted=${harness.emittedSnapshots.length}, cycles=${callbacks}`,
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
testIdleHeartbeatCadenceStaysInOneToTwoHzBand();
testExecutorResultSignalAcceleratesCadence();
testBurstCadenceIsHardCappedAndCoolsDown();
testSnapshotCycleEmitsExactlyOneEventPayload();
testInitializeApplicationStartsAndStopsPerceptionService();

console.log('PerceptionService behavior: PASS');

export {};
