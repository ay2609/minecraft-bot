import mineflayer from 'mineflayer';
import type { Bot } from 'mineflayer';
import { config, type Config } from './config';
import { eventBus } from './events/EventBus';
import { initializeMemory, type InitializeMemoryOptions, type InitializedMemory } from './memory';

type BotFactory = (options: Parameters<typeof mineflayer.createBot>[0]) => Bot;
type MemoryInitializer = (options: InitializeMemoryOptions) => InitializedMemory;

export interface StartupConfigOverride {
  memory?: Partial<Config['memory']>;
  minecraft?: Partial<Config['minecraft']>;
}

export interface StartupDependencies {
  createBot?: BotFactory;
  initializeMemory?: MemoryInitializer;
}

export interface InitializeApplicationOptions {
  configOverride?: StartupConfigOverride;
  dependencies?: StartupDependencies;
}

export interface InitializedApplication {
  memory: InitializedMemory;
  bot: Bot;
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

function wireBotEvents(bot: Bot): void {
  bot.once('spawn', () => {
    console.log(`[bot] Spawned as ${bot.username} on Minecraft ${bot.version}`);
    console.log(`[bot] Position: ${JSON.stringify(bot.entity.position)}`);
    eventBus.emit('bot:spawned');
    console.log('[bot] EventBus bot:spawned emitted');
  });

  bot.on('error', (err: Error) => {
    console.error('[bot] Connection error:', err.message);
  });

  bot.on('end', (reason: string) => {
    console.log('[bot] Disconnected:', reason);
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
  });

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    console.log(`[chat] <${username}> ${message}`);
    eventBus.emit('bot:chat', { username, message });
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

    wireBotEvents(bot);
    return { memory, bot };
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
