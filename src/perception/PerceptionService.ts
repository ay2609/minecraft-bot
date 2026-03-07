import type { BotEvents, TypedEventBus } from '../events/EventBus';
import type { PerceptionSnapshot } from '../types/index';
import {
  createPerceptionCadenceState,
  DEFAULT_PERCEPTION_CADENCE_CONFIG,
  markCadenceDirty,
  nextEmitAt,
  type PerceptionCadenceConfig,
  recordCadenceEmission,
} from './PerceptionCadence';

type ScheduleHandle = ReturnType<typeof setTimeout> | number;

export interface PerceptionServiceOptions {
  buildSnapshot: () => PerceptionSnapshot;
  eventBus?: Pick<TypedEventBus, 'emit' | 'on' | 'off'>;
  emitSnapshot?: (snapshot: PerceptionSnapshot) => void;
  clock?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduleHandle;
  cancelSchedule?: (handle: ScheduleHandle) => void;
  cadenceConfig?: Partial<PerceptionCadenceConfig>;
  duplicateSuppressionWindowMs?: number;
}

export interface MarkDirtyOptions {
  burst?: boolean;
}

function defaultSchedule(callback: () => void, delayMs: number): ScheduleHandle {
  return setTimeout(callback, delayMs);
}

function defaultCancel(handle: ScheduleHandle): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function normalizeSuppressionWindowMs(value: number | undefined): number {
  if (value === undefined) {
    return 350;
  }
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 350;
}

function snapshotFingerprint(snapshot: PerceptionSnapshot): string {
  const comparable = {
    position: snapshot.position,
    yaw: snapshot.yaw,
    health: snapshot.health,
    food: snapshot.food,
    armorPoints: snapshot.armorPoints,
    gameMode: snapshot.gameMode,
    isOnGround: snapshot.isOnGround,
    inventory: snapshot.inventory,
    equippedItem: snapshot.equippedItem,
    emptySlots: snapshot.emptySlots,
    biome: snapshot.biome,
    timeOfDay: snapshot.timeOfDay,
    weather: snapshot.weather,
    nearbyEntities: snapshot.nearbyEntities,
    nearbyBlocks: snapshot.nearbyBlocks,
    lightLevel: snapshot.lightLevel,
    currentAction: snapshot.currentAction,
    recentFailures: snapshot.recentFailures,
  };

  return JSON.stringify(comparable);
}

export class PerceptionService {
  private readonly buildSnapshot: () => PerceptionSnapshot;
  private readonly eventBus?: Pick<TypedEventBus, 'emit' | 'on' | 'off'>;
  private readonly emitSnapshot?: (snapshot: PerceptionSnapshot) => void;
  private readonly clock: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => ScheduleHandle;
  private readonly cancelSchedule: (handle: ScheduleHandle) => void;
  private readonly cadenceConfig: PerceptionCadenceConfig;
  private readonly duplicateSuppressionWindowMs: number;

  private running = false;
  private timer: ScheduleHandle | null = null;
  private lastSnapshot: PerceptionSnapshot | null = null;
  private lastFingerprint: string | null = null;
  private lastFingerprintAt: number | null = null;
  private cadenceState = createPerceptionCadenceState();
  private readonly unsubscribeFns: Array<() => void> = [];

  constructor(options: PerceptionServiceOptions) {
    this.buildSnapshot = options.buildSnapshot;
    this.eventBus = options.eventBus;
    this.emitSnapshot = options.emitSnapshot;
    this.clock = options.clock ?? Date.now;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancelSchedule = options.cancelSchedule ?? defaultCancel;
    this.cadenceConfig = {
      ...DEFAULT_PERCEPTION_CADENCE_CONFIG,
      ...options.cadenceConfig,
    };
    this.duplicateSuppressionWindowMs = normalizeSuppressionWindowMs(options.duplicateSuppressionWindowMs);
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.attachEventBusSignals();
    this.markDirty();
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.detachEventBusSignals();
  }

  getLastSnapshot(): PerceptionSnapshot | null {
    return this.lastSnapshot;
  }

  markDirty(options: MarkDirtyOptions = {}): void {
    this.cadenceState = markCadenceDirty({
      state: this.cadenceState,
      now: this.clock(),
      config: this.cadenceConfig,
      burst: options.burst ?? false,
    });

    if (this.running) {
      this.scheduleNext();
    }
  }

  private attachEventBusSignals(): void {
    if (!this.eventBus || this.unsubscribeFns.length > 0) {
      return;
    }

    const onDirtySignal = (payload: BotEvents['perception:dirty'][0]): void => {
      this.markDirty({ burst: payload.burst });
    };
    const onBotSpawned = (): void => {
      this.markDirty();
    };
    const onBotChat = (): void => {
      this.markDirty({ burst: true });
    };
    const onBotDeath = (): void => {
      this.markDirty({ burst: true });
    };
    const onExecutorResult = (): void => {
      this.markDirty({ burst: true });
    };

    this.subscribe('perception:dirty', onDirtySignal);
    this.subscribe('bot:spawned', onBotSpawned);
    this.subscribe('bot:chat', onBotChat);
    this.subscribe('bot:death', onBotDeath);
    this.subscribe('executor:result', onExecutorResult);
  }

  private detachEventBusSignals(): void {
    while (this.unsubscribeFns.length > 0) {
      const unsubscribe = this.unsubscribeFns.pop();
      unsubscribe?.();
    }
  }

  private subscribe<K extends keyof BotEvents>(event: K, listener: (...args: BotEvents[K]) => void): void {
    if (!this.eventBus) {
      return;
    }

    this.eventBus.on(event, listener);
    this.unsubscribeFns.push(() => {
      this.eventBus?.off(event, listener);
    });
  }

  private scheduleNext(): void {
    if (!this.running) {
      return;
    }

    this.clearTimer();
    const now = this.clock();
    const dueAt = nextEmitAt({
      state: this.cadenceState,
      now,
      config: this.cadenceConfig,
    });
    const delayMs = Math.max(0, dueAt - now);

    this.timer = this.schedule(() => {
      this.timer = null;
      this.onTick();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.cancelSchedule(this.timer);
      this.timer = null;
    }
  }

  private onTick(): void {
    if (!this.running) {
      return;
    }

    const now = this.clock();
    const snapshot = this.buildSnapshot();

    if (this.shouldEmitSnapshot(snapshot, now)) {
      this.publishSnapshot(snapshot);
      this.lastSnapshot = snapshot;
      this.lastFingerprint = snapshotFingerprint(snapshot);
      this.lastFingerprintAt = now;
    }

    this.cadenceState = recordCadenceEmission({
      state: this.cadenceState,
      now,
      config: this.cadenceConfig,
    });

    this.scheduleNext();
  }

  private shouldEmitSnapshot(snapshot: PerceptionSnapshot, now: number): boolean {
    if (this.lastFingerprint === null) {
      return true;
    }

    const fingerprint = snapshotFingerprint(snapshot);
    if (fingerprint !== this.lastFingerprint) {
      return true;
    }

    if (this.lastFingerprintAt === null) {
      return true;
    }

    return (now - this.lastFingerprintAt) >= this.duplicateSuppressionWindowMs;
  }

  private publishSnapshot(snapshot: PerceptionSnapshot): void {
    if (this.emitSnapshot !== undefined) {
      this.emitSnapshot(snapshot);
      return;
    }

    this.eventBus?.emit('perception:updated', snapshot);
  }
}
