import type { NearbyBlock, NearbyEntity, Vec3Like } from '../types/index';
import type { NearbyBlockCandidate, NearbyBlockScanInput, NearbyEntityCandidate, NearbyEntityScanInput } from './types';

interface MeasuredEntity {
  name: string;
  isHostile: boolean;
  position: Vec3Like;
  distance: number;
}

interface MeasuredBlock {
  name: string;
  position: Vec3Like;
  distance: number;
}

function distanceBetween(origin: Vec3Like, target: Vec3Like): number {
  const dx = origin.x - target.x;
  const dy = origin.y - target.y;
  const dz = origin.z - target.z;
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function toStableDistance(distance: number): number {
  return Math.round(distance * 1000) / 1000;
}

function comparePosition(a: Vec3Like, b: Vec3Like): number {
  if (a.x !== b.x) return a.x - b.x;
  if (a.y !== b.y) return a.y - b.y;
  return a.z - b.z;
}

function compareEntities(a: MeasuredEntity, b: MeasuredEntity): number {
  if (a.distance !== b.distance) return a.distance - b.distance;
  const nameCmp = a.name.localeCompare(b.name);
  if (nameCmp !== 0) return nameCmp;
  return comparePosition(a.position, b.position);
}

function compareBlocks(a: MeasuredBlock, b: MeasuredBlock): number {
  if (a.distance !== b.distance) return a.distance - b.distance;
  const nameCmp = a.name.localeCompare(b.name);
  if (nameCmp !== 0) return nameCmp;
  return comparePosition(a.position, b.position);
}

function projectEntity(origin: Vec3Like, entity: NearbyEntityCandidate): MeasuredEntity {
  return {
    name: entity.name,
    isHostile: entity.isHostile,
    position: { ...entity.position },
    distance: toStableDistance(distanceBetween(origin, entity.position)),
  };
}

function projectBlock(origin: Vec3Like, block: NearbyBlockCandidate): MeasuredBlock {
  return {
    name: block.name,
    position: { ...block.position },
    distance: toStableDistance(distanceBetween(origin, block.position)),
  };
}

function clampLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

function clampRadius(radius: number): number {
  return Number.isFinite(radius) ? Math.max(0, radius) : 0;
}

export function scanNearbyEntities(input: NearbyEntityScanInput): NearbyEntity[] {
  const radius = clampRadius(input.radius);
  const limit = clampLimit(input.limit);

  return input.entities
    .map((entity) => projectEntity(input.origin, entity))
    .filter((entity) => entity.distance <= radius)
    .sort(compareEntities)
    .slice(0, limit)
    .map((entity) => ({
      name: entity.name,
      distance: entity.distance,
      isHostile: entity.isHostile,
    }));
}

export function scanNearbyBlocks(input: NearbyBlockScanInput): NearbyBlock[] {
  const radius = clampRadius(input.radius);
  const limit = clampLimit(input.limit);

  return input.blocks
    .map((block) => projectBlock(input.origin, block))
    .filter((block) => block.distance <= radius)
    .sort(compareBlocks)
    .slice(0, limit)
    .map((block) => ({
      name: block.name,
      position: block.position,
      distance: block.distance,
    }));
}
