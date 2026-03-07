import { buildPerceptionSnapshot } from './SnapshotBuilder';
import { scanNearbyBlocks, scanNearbyEntities } from './NearbyScanner';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testNearbyScanningCapsAndDeterministicTies(): void {
  const nearbyEntities = scanNearbyEntities({
    origin: { x: 0, y: 64, z: 0 },
    radius: 16,
    limit: 3,
    entities: [
      { name: 'zombie', position: { x: 3, y: 64, z: 0 }, isHostile: true },
      { name: 'cow', position: { x: -3, y: 64, z: 0 }, isHostile: false },
      { name: 'bat', position: { x: 0, y: 64, z: 3 }, isHostile: false },
      { name: 'creeper', position: { x: 2, y: 64, z: 0 }, isHostile: true },
    ],
  });

  assert(nearbyEntities.length === 3, `Expected 3 entities, got ${nearbyEntities.length}`);
  assert(nearbyEntities[0]?.name === 'creeper', 'Expected nearest entity first');
  assert(
    nearbyEntities[1]?.name === 'bat' &&
      nearbyEntities[2]?.name === 'cow',
    'Expected deterministic alphabetical ordering for equal-distance entities',
  );

  const nearbyBlocks = scanNearbyBlocks({
    origin: { x: 0, y: 64, z: 0 },
    radius: 10,
    limit: 2,
    blocks: [
      { name: 'stone', position: { x: 0, y: 64, z: 2 } },
      { name: 'dirt', position: { x: 0, y: 64, z: -2 } },
      { name: 'oak_log', position: { x: 0, y: 64, z: 1 } },
    ],
  });

  assert(nearbyBlocks.length === 2, `Expected 2 blocks, got ${nearbyBlocks.length}`);
  assert(nearbyBlocks[0]?.name === 'oak_log', 'Expected nearest block first');
  assert(nearbyBlocks[1]?.name === 'dirt', 'Expected deterministic ordering for ties');
}

function testSnapshotBuilderProducesCompactContract(): void {
  const snapshot = buildPerceptionSnapshot({
    timestamp: 1700000000000,
    self: {
      position: { x: 10, y: 64, z: -5 },
      yaw: 1.5,
      health: 18,
      food: 16,
      gameMode: 'survival',
      isOnGround: true,
      lightLevel: 12,
      armorPoints: 10,
    },
    inventory: {
      items: [
        { name: 'oak_log', count: 6 },
        { name: 'oak_log', count: 2 },
        { name: 'stick', count: 4 },
      ],
      emptySlots: 30,
      equippedItem: { name: 'stone_pickaxe' },
    },
    world: {
      biome: 'plains',
      timeOfDay: 6000,
      weather: 'clear',
      nearbyEntities: [
        { name: 'sheep', position: { x: 11, y: 64, z: -5 }, isHostile: false },
      ],
      nearbyBlocks: [
        { name: 'oak_log', position: { x: 10, y: 64, z: -4 } },
      ],
    },
    runtime: {
      currentAction: 'gather_wood',
      recentFailures: [
        { skill: 'move_to', errorCode: 'no_path', timestamp: 1699999999000 },
      ],
    },
    scan: {
      radius: 16,
      entityLimit: 12,
      blockLimit: 16,
      recentFailureLimit: 5,
    },
  });

  assert(snapshot.inventory['oak_log'] === 8, 'Expected inventory to aggregate duplicate items');
  assert(snapshot.equippedItem === 'stone_pickaxe', 'Expected equipped item name projection');
  assert(snapshot.armorPoints === 10, 'Expected armor signal field to be populated');
  assert(snapshot.currentAction === 'gather_wood', 'Expected current action to be mapped');
}

testNearbyScanningCapsAndDeterministicTies();
testSnapshotBuilderProducesCompactContract();

console.log('SnapshotBuilder behavior: PASS');

export {};
