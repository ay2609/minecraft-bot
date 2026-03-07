import mineflayer from 'mineflayer';
import type { Bot } from 'mineflayer';
import { config, type Config } from './config';
import { eventBus } from './events/EventBus';
import { initializeMemory, type InitializeMemoryOptions, type InitializedMemory } from './memory';
import { buildPerceptionSnapshot } from './perception/SnapshotBuilder';
import { PerceptionService, type PerceptionServiceOptions } from './perception/PerceptionService';
import type { SnapshotBuildInput } from './perception/types';
import type { ExecutorResult, FailureRecord, PerceptionSnapshot, Vec3Like } from './types/index';

type BotFactory = (options: Parameters<typeof mineflayer.createBot>[0]) => Bot;
type MemoryInitializer = (options: InitializeMemoryOptions) => InitializedMemory;
type PerceptionServiceFactory = (options: PerceptionServiceOptions) => PerceptionService;

export interface StartupConfigOverride {
  memory?: Partial<Config['memory']>;
  minecraft?: Partial<Config['minecraft']>;
}

export interface StartupDependencies {
  createBot?: BotFactory;
  initializeMemory?: MemoryInitializer;
  createPerceptionService?: PerceptionServiceFactory;
}

export interface InitializeApplicationOptions {
  configOverride?: StartupConfigOverride;
  dependencies?: StartupDependencies;
}

export interface InitializedApplication {
  memory: InitializedMemory;
  bot: Bot;
  perception: PerceptionService;
}

function resolveMemoryConfig(override?: Partial<Config['memory']>): Config['memory'] {
  return {
    ...config.memory,
    ...override,
  };
}

function resolveMinecraftConfig(override?: Partial<Config['minecraft']>): Config['minecraft'] {
  return {
    ...config.minecraft,
    ...override,
  };
}

interface BotRuntimeEntity {
  name?: string;
  position?: Vec3Like;
}

interface BotRuntimeLike {
  health?: number;
  food?: number;
  rainState?: number;
  thunderState?: number;
  entity?: {
    position?: Vec3Like;
    yaw?: number;
    onGround?: boolean;
  };
  game?: {
    gameMode?: string;
  };
  inventory?: {
    items?: () => Array<{ name: string; count: number }>;
    slots?: Array<unknown>;
  };
  heldItem?: { name: string } | null;
  biome?: string | { name?: string };
  time?: {
    timeOfDay?: number;
  };
  entities?: Record<string, BotRuntimeEntity>;
}

interface BotEventEmitterLike {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function toVec3Like(position: unknown, fallback: Vec3Like): Vec3Like {
  if (typeof position !== 'object' || position === null) {
    return fallback;
  }
  const vec = position as Partial<Vec3Like>;
  return {
    x: toFiniteNumber(vec.x, fallback.x),
    y: toFiniteNumber(vec.y, fallback.y),
    z: toFiniteNumber(vec.z, fallback.z),
  };
}

function isHostileEntityName(name: string): boolean {
  const hostileNames = new Set([
    'blaze',
    'creeper',
    'drowned',
    'enderman',
    'evoker',
    'ghast',
    'guardian',
    'hoglin',
    'husk',
    'magma_cube',
    'phantom',
    'pillager',
    'ravager',
    'shulker',
    'silverfish',
    'skeleton',
    'slime',
    'spider',
    'stray',
    'vex',
    'vindicator',
    'warden',
    'witch',
    'wither_skeleton',
    'zoglin',
    'zombie',
    'zombie_villager',
  ]);

  return hostileNames.has(name);
}

function toNearbyEntities(botState: BotRuntimeLike): SnapshotBuildInput['world']['nearbyEntities'] {
  if (!botState.entities) {
    return [];
  }

  return Object.values(botState.entities)
    .map((entity) => {
      const name = toStringValue(entity.name, 'unknown');
      return {
        name,
        position: toVec3Like(entity.position, { x: 0, y: 0, z: 0 }),
        isHostile: isHostileEntityName(name),
      };
    })
    .slice(0, config.perception.nearbyEntityLimit * 2);
}

function toWeather(botState: BotRuntimeLike): SnapshotBuildInput['world']['weather'] {
  if (toFiniteNumber(botState.thunderState, 0) > 0) {
    return 'thunder';
  }
  if (toFiniteNumber(botState.rainState, 0) > 0) {
    return 'rain';
  }
  return 'clear';
}

function toBiomeName(biome: BotRuntimeLike['biome']): string {
  if (typeof biome === 'string') {
    return biome;
  }
  if (biome && typeof biome === 'object') {
    return toStringValue(biome.name, 'unknown');
  }
  return 'unknown';
}

function createSnapshotFactory(
  bot: Bot,
  memory: InitializedMemory,
  recentFailures: FailureRecord[],
): () => PerceptionSnapshot {
  return () => {
    const botState = bot as unknown as BotRuntimeLike;
    const workingMemorySnapshot = memory.workingMemory.getSnapshot();
    const position = toVec3Like(botState.entity?.position, { x: 0, y: 0, z: 0 });
    const inventoryItems = botState.inventory?.items?.() ?? [];
    const emptySlots = botState.inventory?.slots?.filter((slot) => slot === null).length ?? 36;
    const currentAction = workingMemorySnapshot.execution.inFlightAction?.skill ?? null;

    return buildPerceptionSnapshot({
      self: {
        position,
        yaw: toFiniteNumber(botState.entity?.yaw, 0),
        health: toFiniteNumber(botState.health, 20),
        food: toFiniteNumber(botState.food, 20),
        armorPoints: 0,
        gameMode: toStringValue(botState.game?.gameMode, 'survival'),
        isOnGround: Boolean(botState.entity?.onGround),
        lightLevel: 15,
      },
      inventory: {
        items: inventoryItems.map((item) => ({
          name: toStringValue(item.name, 'unknown'),
          count: toFiniteNumber(item.count, 0),
        })),
        equippedItem: botState.heldItem?.name ? { name: botState.heldItem.name } : null,
        emptySlots,
      },
      world: {
        biome: toBiomeName(botState.biome),
        timeOfDay: toFiniteNumber(botState.time?.timeOfDay, 0),
        weather: toWeather(botState),
        nearbyEntities: toNearbyEntities(botState),
        nearbyBlocks: [],
      },
      runtime: {
        currentAction,
        recentFailures,
      },
      scan: {
        radius: config.perception.nearbyScanRadius,
        entityLimit: config.perception.nearbyEntityLimit,
        blockLimit: config.perception.nearbyBlockLimit,
        recentFailureLimit: config.perception.recentFailureLimit,
      },
    });
  };
}

function wireBotEvents(bot: Bot, onShutdown: () => void): void {
  bot.once('spawn', () => {
    console.log(`[bot] Spawned as ${bot.username} on Minecraft ${bot.version}`);
    console.log(`[bot] Position: ${JSON.stringify(bot.entity.position)}`);
    eventBus.emit('bot:spawned');
    eventBus.emit('perception:dirty', { reason: 'bot:spawned', burst: true });
    console.log('[bot] EventBus bot:spawned emitted');
  });

  bot.on('error', (err: Error) => {
    console.error('[bot] Connection error:', err.message);
  });

  bot.once('end', (reason: string) => {
    console.log('[bot] Disconnected:', reason);
    onShutdown();
  });

  bot.on('death', () => {
    console.log('[bot] Bot died');
    eventBus.emit('bot:death', {
      cause: 'unknown',
      position: {
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z,
      },
    });
    eventBus.emit('perception:dirty', { reason: 'bot:death', burst: true });
  });

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    console.log(`[chat] <${username}> ${message}`);
    eventBus.emit('bot:chat', { username, message });
    eventBus.emit('perception:dirty', { reason: 'bot:chat', burst: true });
  });

  const emitter = bot as unknown as BotEventEmitterLike;
  emitter.on('move', () => {
    eventBus.emit('perception:dirty', { reason: 'bot:move', burst: true });
  });
  emitter.on('health', () => {
    eventBus.emit('perception:dirty', { reason: 'bot:health', burst: true });
  });
  emitter.on('entityMoved', () => {
    eventBus.emit('perception:dirty', { reason: 'bot:entityMoved', burst: false });
  });
  emitter.on('physicsTick', () => {
    eventBus.emit('perception:dirty', { reason: 'bot:physicsTick', burst: false });
  });

  eventBus.once('bot:spawned', () => {
    console.log('[eventbus] bot:spawned subscriber confirmed working');
  });
}

export function initializeApplication(options: InitializeApplicationOptions = {}): InitializedApplication {
  const memoryConfig = resolveMemoryConfig(options.configOverride?.memory);
  const minecraftConfig = resolveMinecraftConfig(options.configOverride?.minecraft);
  const initializeMemoryFn = options.dependencies?.initializeMemory ?? initializeMemory;
  const createBotFn = options.dependencies?.createBot ?? mineflayer.createBot;
  const createPerceptionServiceFn =
    options.dependencies?.createPerceptionService ?? ((serviceOptions: PerceptionServiceOptions) => new PerceptionService(serviceOptions));

  const memory = initializeMemoryFn({
    dbPath: memoryConfig.dbPath,
    sqliteBusyTimeoutMs: memoryConfig.sqliteBusyTimeoutMs,
  });

  try {
    const bot = createBotFn({
      host: minecraftConfig.host,
      port: minecraftConfig.port,
      username: minecraftConfig.username,
      version: minecraftConfig.version,
      auth: minecraftConfig.auth,
    });

    const recentFailures: FailureRecord[] = [];
    const onExecutorResult = (result: ExecutorResult): void => {
      if (result.success || result.errorCode === null) {
        return;
      }

      recentFailures.push({
        skill: result.actionItem.skill,
        errorCode: result.errorCode,
        timestamp: Date.now(),
      });

      if (recentFailures.length > config.perception.recentFailureLimit) {
        recentFailures.splice(0, recentFailures.length - config.perception.recentFailureLimit);
      }
    };

    eventBus.on('executor:result', onExecutorResult);

    const perception = createPerceptionServiceFn({
      buildSnapshot: createSnapshotFactory(bot, memory, recentFailures),
      eventBus,
    });

    const shutdownPerception = (): void => {
      eventBus.off('executor:result', onExecutorResult);
      perception.stop();
    };

    wireBotEvents(bot, shutdownPerception);
    perception.start();

    return { memory, bot, perception };
  } catch (error) {
    memory.close();
    throw error;
  }
}

export function startApplication(): InitializedApplication {
  console.log('[bot] Starting minecraft-bot...');
  console.log(
    `[bot] Connecting to ${config.minecraft.host}:${config.minecraft.port} as ${config.minecraft.username}`,
  );

  const app = initializeApplication();
  console.log('[bot] Memory initialized and restored');
  console.log('[bot] Bot created, waiting for spawn...');
  return app;
}

if (require.main === module) {
  try {
    startApplication();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    console.error('[bot] Startup failed:', message);
    process.exitCode = 1;
  }
}
