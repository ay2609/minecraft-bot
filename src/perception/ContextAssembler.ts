import type { TypedEventBus } from '../events/EventBus';
import type {
  ContextAssemblerOptions,
  MemoryAttachment,
  PlannerContextBundle,
  PlannerContextInput,
  PlannerSnapshotDigest,
  SemanticMemorySlice,
} from './types';

interface MemoryResolution {
  memory: MemoryAttachment;
  source: PlannerContextBundle['meta']['memorySource'];
  timedOut: boolean;
}

const EMPTY_MEMORY: MemoryAttachment = {
  semantic: [],
  episodic: [],
};

const DEFAULT_OPTIONS: Required<ContextAssemblerOptions> = {
  memoryTimeoutMs: 40,
  maxChars: 4500,
  semanticLimit: 8,
  episodicLimit: 8,
};

export class ContextAssembler {
  private readonly options: Required<ContextAssemblerOptions>;
  private cachedMemory: MemoryAttachment = EMPTY_MEMORY;

  constructor(options: ContextAssemblerOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  async assemblePlannerContext(input: PlannerContextInput): Promise<PlannerContextBundle> {
    const memoryResolution = await this.resolveMemory(input);
    const semantic = this.prioritizeSemantic(memoryResolution.memory.semantic).slice(0, this.options.semanticLimit);
    const episodic = [...memoryResolution.memory.episodic]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, this.options.episodicLimit);

    const bundle: PlannerContextBundle = {
      snapshot: this.toSnapshotDigest(input.snapshot),
      intent: {
        activeGoal: input.intent.activeGoal,
      },
      memory: {
        semantic,
        episodic,
      },
      meta: {
        memorySource: memoryResolution.source,
        memoryTimedOut: memoryResolution.timedOut,
        truncation: {
          applied: false,
          droppedEpisodic: 0,
          droppedSemantic: 0,
          reason: null,
        },
      },
    };

    this.applyBudget(bundle);
    return bundle;
  }

  async assembleAndPublishPlannerContext(
    input: PlannerContextInput,
    events: Pick<TypedEventBus, 'emit'>,
  ): Promise<PlannerContextBundle> {
    const bundle = await this.assemblePlannerContext(input);
    events.emit('planner:context-ready', bundle);
    return bundle;
  }

  async assembleFromLatestSnapshot(
    options: {
      getLatestSnapshot: () => PlannerContextInput['snapshot'] | null;
      intent: PlannerContextInput['intent'];
      retrieveMemory: PlannerContextInput['retrieveMemory'];
    },
  ): Promise<PlannerContextBundle | null> {
    const snapshot = options.getLatestSnapshot();
    if (snapshot === null) {
      return null;
    }

    return this.assemblePlannerContext({
      snapshot,
      intent: options.intent,
      retrieveMemory: options.retrieveMemory,
    });
  }

  private async resolveMemory(input: PlannerContextInput): Promise<MemoryResolution> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const memoryPromise = input
      .retrieveMemory()
      .then((memory) => this.sanitizeMemory(memory))
      .catch(() => EMPTY_MEMORY);

    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), this.options.memoryTimeoutMs);
    });

    const raceResult = await Promise.race([
      memoryPromise,
      timeoutPromise,
    ]);

    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }

    if (raceResult === 'timeout') {
      void memoryPromise.then((memory) => {
        this.cachedMemory = memory;
      });
      if (this.hasCachedMemory()) {
        return {
          memory: this.cachedMemory,
          source: 'stale-cache',
          timedOut: true,
        };
      }
      return {
        memory: EMPTY_MEMORY,
        source: 'empty',
        timedOut: true,
      };
    }

    this.cachedMemory = raceResult;
    return {
      memory: raceResult,
      source: 'live',
      timedOut: false,
    };
  }

  private applyBudget(bundle: PlannerContextBundle): void {
    while (JSON.stringify(bundle).length > this.options.maxChars) {
      if (bundle.memory.episodic.length > 1) {
        bundle.memory.episodic.pop();
        bundle.meta.truncation.applied = true;
        bundle.meta.truncation.droppedEpisodic += 1;
        bundle.meta.truncation.reason = 'budget';
        continue;
      }

      if (bundle.memory.semantic.length > 0) {
        bundle.memory.semantic.pop();
        bundle.meta.truncation.applied = true;
        bundle.meta.truncation.droppedSemantic += 1;
        bundle.meta.truncation.reason = 'budget';
        continue;
      }

      if (bundle.memory.episodic.length > 0) {
        bundle.memory.episodic.pop();
        bundle.meta.truncation.applied = true;
        bundle.meta.truncation.droppedEpisodic += 1;
        bundle.meta.truncation.reason = 'budget';
        continue;
      }

      break;
    }
  }

  private sanitizeMemory(memory: MemoryAttachment): MemoryAttachment {
    return {
      semantic: memory.semantic.map((entry) => ({
        label: entry.label,
        position: entry.position,
        distance: entry.distance,
        confidence: entry.confidence,
        lastSeenAt: entry.lastSeenAt,
      })),
      episodic: memory.episodic.map((entry) => ({
        goal: entry.goal,
        action: entry.action,
        outcome: entry.outcome,
        failureReason: entry.failureReason,
        createdAt: entry.createdAt,
      })),
    };
  }

  private hasCachedMemory(): boolean {
    return this.cachedMemory.semantic.length > 0 || this.cachedMemory.episodic.length > 0;
  }

  private prioritizeSemantic(entries: SemanticMemorySlice[]): SemanticMemorySlice[] {
    return [...entries].sort((left, right) => {
      if (left.confidence !== right.confidence) {
        return right.confidence - left.confidence;
      }
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      if (left.lastSeenAt !== right.lastSeenAt) {
        return right.lastSeenAt.localeCompare(left.lastSeenAt);
      }
      return left.label.localeCompare(right.label);
    });
  }

  private toSnapshotDigest(snapshot: PlannerContextInput['snapshot']): PlannerSnapshotDigest {
    return {
      position: snapshot.position,
      biome: snapshot.biome,
      currentAction: snapshot.currentAction,
      nearbyEntities: snapshot.nearbyEntities.slice(0, 6).map((entity) => entity.name),
      nearbyBlocks: snapshot.nearbyBlocks.slice(0, 6).map((block) => block.name),
    };
  }
}
