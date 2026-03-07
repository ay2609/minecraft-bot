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
}

export const config: Config = {
  minecraft: {
    host: process.env['MINECRAFT_HOST'] ?? 'localhost',
    port: parseInt(process.env['MINECRAFT_PORT'] ?? '25565', 10),
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
};
