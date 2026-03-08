import { eventBus, type TypedEventBus } from '../events/EventBus';
import type { MemoryAttachment } from '../perception/types';
import { CheckpointRepository } from './CheckpointRepository';
import { MemoryDatabase } from './Database';
import { EpisodicMemoryRepository } from './EpisodicMemoryRepository';
import { SemanticMemoryRepository } from './SemanticMemoryRepository';
import type { PerceptionSnapshot, Vec3Like } from '../types';
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

export interface PlannerMemoryRetrieveInput {
  position: Vec3Like;
  activeGoal: string | null;
  dimension?: string;
}

export interface PlannerMemoryRetrieverOptions {
  maxDistance?: number;
  semanticLimit?: number;
  episodicLimit?: number;
}

export interface PlannerSemanticMemorySource {
  findNearby: InitializedMemory['semantic']['findNearby'];
}

export interface PlannerEpisodicMemorySource {
  listByGoal: InitializedMemory['episodic']['listByGoal'];
  listFailures: InitializedMemory['episodic']['listFailures'];
  listRecent: InitializedMemory['episodic']['listRecent'];
}

const DEFAULT_PLANNER_MEMORY_OPTIONS: Required<PlannerMemoryRetrieverOptions> = {
  maxDistance: 64,
  semanticLimit: 6,
  episodicLimit: 6,
};

function tokenizeGoal(goal: string | null): string[] {
  if (!goal) {
    return [];
  }

  return goal
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
}

function scoreLocationRelevance(label: string, goalTerms: string[]): number {
  if (goalTerms.length === 0) {
    return 0;
  }
  const lower = label.toLowerCase();
  return goalTerms.reduce((score, term) => (lower.includes(term) ? score + 1 : score), 0);
}

function compareIsoDatesDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

export function createPlannerMemoryRetriever(
  memory: {
    semantic: PlannerSemanticMemorySource;
    episodic: PlannerEpisodicMemorySource;
  },
  options: PlannerMemoryRetrieverOptions = {},
): (input: PlannerMemoryRetrieveInput) => Promise<MemoryAttachment> {
  const resolved = {
    ...DEFAULT_PLANNER_MEMORY_OPTIONS,
    ...options,
  };

  return async (input: PlannerMemoryRetrieveInput): Promise<MemoryAttachment> => {
    await Promise.resolve();
    const goalTerms = tokenizeGoal(input.activeGoal);
    const semanticCandidates = memory.semantic.findNearby({
      center: input.position,
      dimension: input.dimension ?? 'overworld',
      maxDistance: resolved.maxDistance,
      limit: resolved.semanticLimit * 3,
    });
    const prioritizedSemantic = [...semanticCandidates]
      .sort((left, right) => {
        const relevanceDelta =
          scoreLocationRelevance(right.name, goalTerms) - scoreLocationRelevance(left.name, goalTerms);
        if (relevanceDelta !== 0) {
          return relevanceDelta;
        }
        if (left.distance !== right.distance) {
          return left.distance - right.distance;
        }
        return compareIsoDatesDesc(left.lastSeenAt, right.lastSeenAt);
      })
      .slice(0, resolved.semanticLimit)
      .map((location) => ({
        label: location.name,
        position: { x: location.x, y: location.y, z: location.z },
        distance: location.distance,
        confidence: location.confidence,
        lastSeenAt: location.lastSeenAt,
      }));

    const byGoal = input.activeGoal
      ? memory.episodic.listByGoal(input.activeGoal, resolved.episodicLimit * 2)
      : [];
    const recentFailures = memory.episodic.listFailures(
      input.activeGoal ?? undefined,
      resolved.episodicLimit,
    );
    const recentFallback = memory.episodic.listRecent(resolved.episodicLimit * 2);
    const episodicPool = [...recentFailures, ...byGoal, ...recentFallback];
    const uniqueBySignature = new Map<string, (typeof episodicPool)[number]>();

    for (const episode of episodicPool) {
      const signature = `${episode.goal}|${episode.action}|${episode.createdAt}`;
      if (!uniqueBySignature.has(signature)) {
        uniqueBySignature.set(signature, episode);
      }
    }

    const episodic = [...uniqueBySignature.values()]
      .sort((left, right) => compareIsoDatesDesc(left.createdAt, right.createdAt))
      .slice(0, resolved.episodicLimit)
      .map((episode) => ({
        goal: episode.goal,
        action: episode.action,
        outcome: episode.outcome,
        failureReason: episode.failureReason,
        createdAt: episode.createdAt,
      }));

    return {
      semantic: prioritizedSemantic,
      episodic,
    };
  };
}

export function createPlannerMemoryRetrieverFromSnapshot(
  memory: {
    semantic: PlannerSemanticMemorySource;
    episodic: PlannerEpisodicMemorySource;
  },
  options: PlannerMemoryRetrieverOptions = {},
): (input: { snapshot: Pick<PerceptionSnapshot, 'position'>; activeGoal: string | null }) => Promise<MemoryAttachment> {
  const retrieve = createPlannerMemoryRetriever(memory, options);
  return async (input): Promise<MemoryAttachment> => {
    await Promise.resolve();
    return retrieve({
      position: input.snapshot.position,
      activeGoal: input.activeGoal,
    });
  };
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
