import type { FailureRecord, PerceptionSnapshot } from '../types/index';
import { scanNearbyBlocks, scanNearbyEntities } from './NearbyScanner';
import type { SnapshotBuildInput } from './types';

function clampTimeOfDay(timeOfDay: number): number {
  const normalized = Math.floor(timeOfDay) % 24000;
  return normalized >= 0 ? normalized : normalized + 24000;
}

function summarizeInventory(items: SnapshotBuildInput['inventory']['items']): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const item of items) {
    const count = Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0;
    if (count === 0) {
      continue;
    }
    summary[item.name] = (summary[item.name] ?? 0) + count;
  }
  return summary;
}

function cloneFailureRecord(record: FailureRecord): FailureRecord {
  return {
    skill: record.skill,
    errorCode: record.errorCode,
    timestamp: record.timestamp,
  };
}

export function buildPerceptionSnapshot(input: SnapshotBuildInput): PerceptionSnapshot {
  return {
    timestamp: input.timestamp ?? Date.now(),
    position: { ...input.self.position },
    yaw: input.self.yaw,
    health: input.self.health,
    food: input.self.food,
    armorPoints: input.self.armorPoints,
    gameMode: input.self.gameMode,
    isOnGround: input.self.isOnGround,
    inventory: summarizeInventory(input.inventory.items),
    equippedItem: input.inventory.equippedItem?.name ?? null,
    emptySlots: input.inventory.emptySlots,
    biome: input.world.biome,
    timeOfDay: clampTimeOfDay(input.world.timeOfDay),
    weather: input.world.weather,
    nearbyEntities: scanNearbyEntities({
      origin: input.self.position,
      entities: input.world.nearbyEntities,
      radius: input.scan.radius,
      limit: input.scan.entityLimit,
    }),
    nearbyBlocks: scanNearbyBlocks({
      origin: input.self.position,
      blocks: input.world.nearbyBlocks,
      radius: input.scan.radius,
      limit: input.scan.blockLimit,
    }),
    lightLevel: input.self.lightLevel,
    currentAction: input.runtime.currentAction,
    recentFailures: input.runtime.recentFailures.map(cloneFailureRecord),
  };
}
