import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryDatabase } from './Database';
import { SemanticMemoryRepository } from './SemanticMemoryRepository';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testSemanticDurabilityAndNearbyQueries(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'minecraft-bot-semantic-test-'));
  const dbPath = join(tempDir, 'memory.db');
  const database = new MemoryDatabase({ dbPath, sqliteBusyTimeoutMs: 1000 });
  database.initializeSchema();

  const semantic = new SemanticMemoryRepository({ dbPath, sqliteBusyTimeoutMs: 1000 });

  try {
    semantic.upsertLocation({
      name: 'home',
      x: 0,
      y: 64,
      z: 0,
      dimension: 'overworld',
      confidence: 0.9,
    });
    semantic.upsertLocation({
      name: 'mine',
      x: 12,
      y: 42,
      z: 8,
      dimension: 'overworld',
      confidence: 0.7,
    });
    semantic.upsertLocation({
      name: 'village',
      x: 120,
      y: 70,
      z: 120,
      dimension: 'overworld',
      confidence: 0.8,
    });

    semantic.recordResource({
      resourceType: 'coal_ore',
      x: 10,
      y: 43,
      z: 6,
      quantity: 18,
      source: 'mining',
    });

    semantic.recordRoute({
      fromLabel: 'home',
      toLabel: 'mine',
      path: [{ x: 0, y: 64, z: 0 }, { x: 12, y: 42, z: 8 }],
      cost: 16.5,
    });

    semantic.recordStructure({
      structureType: 'base',
      x: 0,
      y: 64,
      z: 0,
      notes: 'starter shelter',
    });

    semantic.setServerFact('active_dimension', {
      value: 'overworld',
      confidence: 1,
    });

    semantic.close();

    const reopened = new SemanticMemoryRepository({ dbPath, sqliteBusyTimeoutMs: 1000 });
    try {
      const locations = reopened.listLocationsByName('home');
      assert(locations.length === 1, `Expected one named location, got ${locations.length}`);
      assert(locations[0]?.name === 'home', 'Expected persisted location "home"');

      const nearby = reopened.findNearby({
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        maxDistance: 30,
      });
      assert(nearby.length === 2, `Expected two nearby locations, got ${nearby.length}`);
      assert(nearby[0]?.name === 'home', 'Expected nearest location to be home');
      assert(nearby[1]?.name === 'mine', 'Expected second nearest location to be mine');
      assert(
        nearby[0] !== undefined && nearby[1] !== undefined && nearby[0].distance <= nearby[1].distance,
        'Expected nearby results sorted by ascending distance',
      );

      const resources = reopened.listResourcesByType('coal_ore');
      assert(resources.length === 1, `Expected one resource row, got ${resources.length}`);

      const routes = reopened.listRoutes('home', 'mine');
      assert(routes.length === 1, `Expected one route row, got ${routes.length}`);

      const structures = reopened.listStructuresByType('base');
      assert(structures.length === 1, `Expected one structure row, got ${structures.length}`);

      const fact = reopened.getServerFact<{ value: string; confidence: number }>('active_dimension');
      assert(fact !== null, 'Expected server fact to persist');
      assert(fact?.value === 'overworld', 'Expected server fact value to round-trip');
    } finally {
      reopened.close();
    }
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

testSemanticDurabilityAndNearbyQueries();
console.log('SemanticMemoryRepository durability: PASS');

export {};
