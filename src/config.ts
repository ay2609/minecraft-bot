import type { CoreSkillName } from './types';

export interface Config {
  minecraft: {
    host: string;
    port: number;
    username: string;
    version: string;
    auth: 'offline' | 'microsoft';
  };
  fireworks: {
    apiKey: string;
    modelId: string;
  };
  bot: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  memory: {
    dbPath: string;
    sqliteBusyTimeoutMs: number;
  };
  perception: {
    nearbyScanRadius: number;
    nearbyEntityLimit: number;
    nearbyBlockLimit: number;
    recentFailureLimit: number;
  };
  executor: {
    defaultTimeoutMs: number;
    perSkillTimeoutMs: Record<CoreSkillName, number> & Record<string, number>;
  };
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveNumberEnv(value: string | undefined, fallback: number): number {
  const parsed = parseNumberEnv(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

export const config: Config = {
  minecraft: {
    host: process.env['MINECRAFT_HOST'] ?? 'localhost',
    port: parseNumberEnv(process.env['MINECRAFT_PORT'], 25565),
    username: process.env['BOT_USERNAME'] ?? 'ClaudeBot',
    version: '1.21.11',
    auth: 'offline',
  },
  fireworks: {
    apiKey: process.env['FIREWORKS_API_KEY'] ?? '',
    modelId: process.env['FIREWORKS_MODEL_ID'] ?? 'accounts/fireworks/models/minimax-m2',
  },
  bot: {
    logLevel: (process.env['LOG_LEVEL'] as Config['bot']['logLevel']) ?? 'info',
  },
  memory: {
    dbPath: process.env['MEMORY_DB_PATH'] ?? './data/memory.db',
    sqliteBusyTimeoutMs: parseNumberEnv(process.env['MEMORY_SQLITE_BUSY_TIMEOUT_MS'], 5000),
  },
  perception: {
    nearbyScanRadius: parsePositiveNumberEnv(process.env['PERCEPTION_NEARBY_SCAN_RADIUS'], 24),
    nearbyEntityLimit: parsePositiveNumberEnv(process.env['PERCEPTION_NEARBY_ENTITY_LIMIT'], 12),
    nearbyBlockLimit: parsePositiveNumberEnv(process.env['PERCEPTION_NEARBY_BLOCK_LIMIT'], 16),
    recentFailureLimit: parsePositiveNumberEnv(process.env['PERCEPTION_RECENT_FAILURE_LIMIT'], 8),
  },
  executor: {
    defaultTimeoutMs: parsePositiveNumberEnv(process.env['EXECUTOR_DEFAULT_TIMEOUT_MS'], 15000),
    perSkillTimeoutMs: {
      move_to: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_MOVE_TO_MS'], 20000),
      follow_entity: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_FOLLOW_ENTITY_MS'], 20000),
      place_block: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_PLACE_BLOCK_MS'], 12000),
      break_block: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_BREAK_BLOCK_MS'], 12000),
      craft_item: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_CRAFT_ITEM_MS'], 15000),
      drop_item: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_DROP_ITEM_MS'], 5000),
      equip_item: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_EQUIP_ITEM_MS'], 5000),
      interact_block: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_INTERACT_BLOCK_MS'], 5000),
      attack_entity: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_ATTACK_ENTITY_MS'], 5000),
      send_chat: parsePositiveNumberEnv(process.env['EXECUTOR_TIMEOUT_SEND_CHAT_MS'], 3000),
    },
  },
};
