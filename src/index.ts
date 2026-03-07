import mineflayer from 'mineflayer';
import { config } from './config';
import { eventBus } from './events/EventBus';

console.log('[bot] Starting minecraft-bot...');
console.log(
  `[bot] Connecting to ${config.minecraft.host}:${config.minecraft.port} as ${config.minecraft.username}`,
);

const bot = mineflayer.createBot({
  host: config.minecraft.host,
  port: config.minecraft.port,
  username: config.minecraft.username,
  version: config.minecraft.version,
  auth: config.minecraft.auth,
});

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

console.log('[bot] Bot created, waiting for spawn...');
