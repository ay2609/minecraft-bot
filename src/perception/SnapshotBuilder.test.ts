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

function testSnapshotIncludesRequiredFieldContract(): void {
  const snapshot = buildPerceptionSnapshot({
    self: {
      position: { x: 1, y: 70, z: 2 },
      yaw: 0,
      health: 20,
      food: 20,
      armorPoints: 2,
      gameMode: 'survival',
      isOnGround: true,
      lightLevel: 15,
    },
    inventory: {
      items: [{ name: 'bread', count: 3 }],
      emptySlots: 34,
      equippedItem: null,
    },
    world: {
      biome: 'forest',
      timeOfDay: 8000,
      weather: 'rain',
      nearbyEntities: [],
      nearbyBlocks: [],
    },
    runtime: {
      currentAction: null,
      recentFailures: [],
    },
    scan: {
      radius: 24,
      entityLimit: 12,
      blockLimit: 16,
      recentFailureLimit: 5,
    },
  });

  const keys = Object.keys(snapshot).sort();
  const requiredKeys = [
    'armorPoints',
    'biome',
    'currentAction',
    'emptySlots',
    'equippedItem',
    'food',
    'gameMode',
    'health',
    'inventory',
    'isOnGround',
    'lightLevel',
    'nearbyBlocks',
    'nearbyEntities',
    'position',
    'recentFailures',
    'timeOfDay',
    'timestamp',
    'weather',
    'yaw',
  ].sort();

  assert(
    JSON.stringify(keys) === JSON.stringify(requiredKeys),
    `Expected exact snapshot contract keys.\nExpected: ${requiredKeys.join(', ')}\nActual: ${keys.join(', ')}`,
  );
  assert(typeof snapshot.inventory['bread'] === 'number', 'Expected compact inventory item counts');
  assert(Object.values(snapshot.inventory).every((count) => Number.isFinite(count)), 'Inventory values must be numbers');
}

function testSnapshotCapsNearbyArraysAndRecentFailures(): void {
  const snapshot = buildPerceptionSnapshot({
    self: {
      position: { x: 0, y: 64, z: 0 },
      yaw: 0,
      health: 20,
      food: 20,
      armorPoints: 0,
      gameMode: 'survival',
      isOnGround: true,
      lightLevel: 10,
    },
    inventory: {
      items: [],
      emptySlots: 36,
      equippedItem: null,
    },
    world: {
      biome: 'plains',
      timeOfDay: 12000,
      weather: 'clear',
      nearbyEntities: [
        { name: 'zombie', position: { x: 1, y: 64, z: 0 }, isHostile: true },
        { name: 'cow', position: { x: 2, y: 64, z: 0 }, isHostile: false },
        { name: 'sheep', position: { x: 3, y: 64, z: 0 }, isHostile: false },
      ],
      nearbyBlocks: [
        { name: 'stone', position: { x: 1, y: 64, z: 1 } },
        { name: 'dirt', position: { x: 2, y: 64, z: 1 } },
        { name: 'coal_ore', position: { x: 3, y: 64, z: 1 } },
      ],
    },
    runtime: {
      currentAction: null,
      recentFailures: [
        { skill: 'move_to', errorCode: 'no_path', timestamp: 1 },
        { skill: 'break_block', errorCode: 'unsafe', timestamp: 2 },
        { skill: 'craft_item', errorCode: 'insufficient_materials', timestamp: 3 },
        { skill: 'move_to', errorCode: 'route_blocked', timestamp: 4 },
      ],
    },
    scan: {
      radius: 16,
      entityLimit: 2,
      blockLimit: 2,
      recentFailureLimit: 3,
    },
  });

  assert(snapshot.nearbyEntities.length === 2, 'Expected nearbyEntities to respect configured cap');
  assert(snapshot.nearbyBlocks.length === 2, 'Expected nearbyBlocks to respect configured cap');
  assert(snapshot.recentFailures.length === 3, 'Expected recentFailures to be bounded');
  assert(snapshot.recentFailures[0]?.timestamp === 2, 'Expected oldest failures to be dropped first');
}

function testSnapshotOrderingIsStableForEquivalentCandidates(): void {
  const a = buildPerceptionSnapshot({
    self: {
      position: { x: 0, y: 64, z: 0 },
      yaw: 0,
      health: 20,
      food: 20,
      armorPoints: 0,
      gameMode: 'survival',
      isOnGround: true,
      lightLevel: 9,
    },
    inventory: {
      items: [{ name: 'torch', count: 8 }],
      emptySlots: 35,
      equippedItem: null,
    },
    world: {
      biome: 'plains',
      timeOfDay: 0,
      weather: 'clear',
      nearbyEntities: [
        { name: 'zombie', position: { x: 2, y: 64, z: 0 }, isHostile: true },
        { name: 'zombie', position: { x: -2, y: 64, z: 0 }, isHostile: true },
      ],
      nearbyBlocks: [
        { name: 'stone', position: { x: 0, y: 64, z: 2 } },
        { name: 'stone', position: { x: 0, y: 64, z: -2 } },
      ],
    },
    runtime: {
      currentAction: null,
      recentFailures: [],
    },
    scan: {
      radius: 24,
      entityLimit: 12,
      blockLimit: 16,
      recentFailureLimit: 5,
    },
  });

  const b = buildPerceptionSnapshot({
    self: {
      position: { x: 0, y: 64, z: 0 },
      yaw: 0,
      health: 20,
      food: 20,
      armorPoints: 0,
      gameMode: 'survival',
      isOnGround: true,
      lightLevel: 9,
    },
    inventory: {
      items: [{ name: 'torch', count: 8 }],
      emptySlots: 35,
      equippedItem: null,
    },
    world: {
      biome: 'plains',
      timeOfDay: 0,
      weather: 'clear',
      nearbyEntities: [
        { name: 'zombie', position: { x: -2, y: 64, z: 0 }, isHostile: true },
        { name: 'zombie', position: { x: 2, y: 64, z: 0 }, isHostile: true },
      ],
      nearbyBlocks: [
        { name: 'stone', position: { x: 0, y: 64, z: -2 } },
        { name: 'stone', position: { x: 0, y: 64, z: 2 } },
      ],
    },
    runtime: {
      currentAction: null,
      recentFailures: [],
    },
    scan: {
      radius: 24,
      entityLimit: 12,
      blockLimit: 16,
      recentFailureLimit: 5,
    },
  });

  assert(
    JSON.stringify(a.nearbyEntities) === JSON.stringify(b.nearbyEntities),
    'Expected stable nearbyEntities ordering for equivalent candidates',
  );
  assert(
    JSON.stringify(a.nearbyBlocks) === JSON.stringify(b.nearbyBlocks),
    'Expected stable nearbyBlocks ordering for equivalent candidates',
  );
}

testNearbyScanningCapsAndDeterministicTies();
testSnapshotBuilderProducesCompactContract();
testSnapshotIncludesRequiredFieldContract();
testSnapshotCapsNearbyArraysAndRecentFailures();
testSnapshotOrderingIsStableForEquivalentCandidates();

console.log('SnapshotBuilder behavior: PASS');

export {};
