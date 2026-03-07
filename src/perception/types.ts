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
