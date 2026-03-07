import type { FailureRecord, Vec3Like } from '../types/index';

export interface NearbyEntityCandidate {
  name: string;
  position: Vec3Like;
  isHostile: boolean;
}

export interface NearbyBlockCandidate {
  name: string;
  position: Vec3Like;
}

export interface NearbyEntityScanInput {
  origin: Vec3Like;
  entities: NearbyEntityCandidate[];
  radius: number;
  limit: number;
}

export interface NearbyBlockScanInput {
  origin: Vec3Like;
  blocks: NearbyBlockCandidate[];
  radius: number;
  limit: number;
}

export interface SnapshotBuildInput {
  timestamp?: number;
  self: {
    position: Vec3Like;
    yaw: number;
    health: number;
    food: number;
    armorPoints: number;
    gameMode: string;
    isOnGround: boolean;
    lightLevel: number;
  };
  inventory: {
    items: Array<{
      name: string;
      count: number;
    }>;
    equippedItem: { name: string } | null;
    emptySlots: number;
  };
  world: {
    biome: string;
    timeOfDay: number;
    weather: 'clear' | 'rain' | 'thunder';
    nearbyEntities: NearbyEntityCandidate[];
    nearbyBlocks: NearbyBlockCandidate[];
  };
  runtime: {
    currentAction: string | null;
    recentFailures: FailureRecord[];
  };
  scan: {
    radius: number;
    entityLimit: number;
    blockLimit: number;
    recentFailureLimit: number;
  };
}

export interface PlannerContextIntent {
  activeGoal: string | null;
  activeSubgoalId: string | null;
  inFlightSkill: string | null;
}

export interface SemanticMemorySlice {
  label: string;
  position: Vec3Like;
  distance: number;
  confidence: number;
  lastSeenAt: string;
}

export interface EpisodicMemorySlice {
  goal: string;
  action: string;
  outcome: 'success' | 'failure';
  failureReason: string | null;
  createdAt: string;
}

export interface MemoryAttachment {
  semantic: SemanticMemorySlice[];
  episodic: EpisodicMemorySlice[];
}

export interface PlannerContextInput {
  snapshot: import('../types/index').PerceptionSnapshot;
  intent: PlannerContextIntent;
  retrieveMemory: () => Promise<MemoryAttachment>;
}

export interface PlannerContextTruncationMeta {
  applied: boolean;
  droppedEpisodic: number;
  droppedSemantic: number;
  reason: string | null;
}

export interface PlannerContextMeta {
  memorySource: 'live' | 'stale-cache' | 'empty';
  memoryTimedOut: boolean;
  truncation: PlannerContextTruncationMeta;
}

export interface PlannerContextBundle {
  snapshot: PlannerSnapshotDigest;
  intent: {
    activeGoal: string | null;
  };
  memory: MemoryAttachment;
  meta: PlannerContextMeta;
}

export interface ContextAssemblerOptions {
  memoryTimeoutMs?: number;
  maxChars?: number;
  semanticLimit?: number;
  episodicLimit?: number;
}

export interface PlannerSnapshotDigest {
  position: Vec3Like;
  biome: string;
  currentAction: string | null;
  nearbyEntities: string[];
  nearbyBlocks: string[];
}
