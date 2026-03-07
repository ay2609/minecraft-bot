import { eventBus, type TypedEventBus } from '../events/EventBus';
import { CheckpointRepository } from './CheckpointRepository';
import { MemoryDatabase } from './Database';
import { EpisodicMemoryRepository } from './EpisodicMemoryRepository';
import { SemanticMemoryRepository } from './SemanticMemoryRepository';
import { WorkingMemory } from './WorkingMemory';
import { WorkingMemoryRestore } from './WorkingMemoryRestore';

export interface InitializeMemoryOptions {
  dbPath: string;
  sqliteBusyTimeoutMs?: number;
  workingMemory?: WorkingMemory;
  events?: Pick<TypedEventBus, 'emit'>;
}

export interface InitializedMemory {
  database: MemoryDatabase;
  semantic: SemanticMemoryRepository;
  episodic: EpisodicMemoryRepository;
  checkpoint: CheckpointRepository;
  workingMemory: WorkingMemory;
  restore: WorkingMemoryRestore;
  close: () => void;
}

export function initializeMemory(options: InitializeMemoryOptions): InitializedMemory {
  const events = options.events ?? eventBus;
  const database = new MemoryDatabase({
    dbPath: options.dbPath,
    sqliteBusyTimeoutMs: options.sqliteBusyTimeoutMs,
  });

  database.initializeSchema();
  if (!database.isReady()) {
    database.close();
    throw new Error('Memory initialization failed: required tables missing after schema init');
  }

  const semantic = new SemanticMemoryRepository({
    dbPath: options.dbPath,
    sqliteBusyTimeoutMs: options.sqliteBusyTimeoutMs,
  });
  const episodic = new EpisodicMemoryRepository({
    dbPath: options.dbPath,
    sqliteBusyTimeoutMs: options.sqliteBusyTimeoutMs,
  });
  const checkpoint = new CheckpointRepository({
    dbPath: options.dbPath,
    sqliteBusyTimeoutMs: options.sqliteBusyTimeoutMs,
  });
  const workingMemory = options.workingMemory ?? new WorkingMemory();
  const restore = new WorkingMemoryRestore(workingMemory, checkpoint, events);

  try {
    restore.restoreFromCheckpoint();
    events.emit('memory:ready');
  } catch (error) {
    semantic.close();
    episodic.close();
    checkpoint.close();
    database.close();
    throw error;
  }

  return {
    database,
    semantic,
    episodic,
    checkpoint,
    workingMemory,
    restore,
    close: () => {
      semantic.close();
      episodic.close();
      checkpoint.close();
      database.close();
    },
  };
}

export { CheckpointRepository, MemoryDatabase, WorkingMemory, WorkingMemoryRestore };
export type { EpisodeInput, EpisodeRecord } from './EpisodicMemoryRepository';
export type { LocationRecord, NearbyLocation } from './SemanticMemoryRepository';
