import { EventEmitter } from 'events';
import type {
  ActionQueue,
  ExecutorResult,
  GoalPlan,
  MemoryPersistenceErrorEvent,
  PerceptionSnapshot,
  Vec3Like,
  WorkingMemoryRestoreCompleteEvent,
  WorkingMemoryRestoreFailedEvent,
} from '../types/index';

// Typed event map — all cross-layer events declared here
export interface BotEvents {
  'perception:updated': [snapshot: PerceptionSnapshot];
  'perception:dirty': [payload: { reason: string; burst: boolean }];
  'strategic:plan-ready': [plan: GoalPlan];
  'tactical:queue-ready': [queue: ActionQueue];
  'executor:result': [result: ExecutorResult];
  'escalate:to-strategic': [payload: { reason: string; consecutiveFailures: number }];
  'bot:spawned': [];
  'bot:death': [payload: { cause: string; position: Vec3Like }];
  'bot:chat': [payload: { username: string; message: string }];
  'memory:ready': [];
  'memory:restore-complete': [payload: WorkingMemoryRestoreCompleteEvent];
  'memory:restore-failed': [payload: WorkingMemoryRestoreFailedEvent];
  'memory:persistence-error': [payload: MemoryPersistenceErrorEvent];
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
