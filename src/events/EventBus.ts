import { EventEmitter } from 'events';
import type { PerceptionSnapshot, GoalPlan } from '../types/index';

// Typed event map — all cross-layer events declared here
export interface BotEvents {
  'perception:updated': [snapshot: PerceptionSnapshot];
  'strategic:plan-ready': [plan: GoalPlan];
  'tactical:queue-ready': [queue: import('../types/index').ActionQueue];
  'executor:result': [result: import('../types/index').ExecutorResult];
  'escalate:to-strategic': [payload: { reason: string; consecutiveFailures: number }];
  'bot:spawned': [];
  'bot:death': [payload: { cause: string; position: import('../types/index').Vec3Like }];
  'bot:chat': [payload: { username: string; message: string }];
}

export class TypedEventBus extends EventEmitter {
  on<K extends keyof BotEvents>(event: K, listener: (...args: BotEvents[K]) => void): this {
    return super.on(event, listener);
  }

  emit<K extends keyof BotEvents>(event: K, ...args: BotEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  off<K extends keyof BotEvents>(event: K, listener: (...args: BotEvents[K]) => void): this {
    return super.off(event, listener);
  }

  once<K extends keyof BotEvents>(event: K, listener: (...args: BotEvents[K]) => void): this {
    return super.once(event, listener);
  }
}

// Singleton — import this everywhere, never construct your own
export const eventBus = new TypedEventBus();
