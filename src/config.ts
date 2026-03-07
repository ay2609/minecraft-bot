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
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
};
