import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryDatabase } from './Database';
import { EpisodicMemoryRepository } from './EpisodicMemoryRepository';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testEpisodicDurabilityAndFilters(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'minecraft-bot-episodic-test-'));
  const dbPath = join(tempDir, 'memory.db');
  const database = new MemoryDatabase({ dbPath, sqliteBusyTimeoutMs: 1000 });
  database.initializeSchema();

  const episodic = new EpisodicMemoryRepository({ dbPath, sqliteBusyTimeoutMs: 1000 });

  try {
    episodic.recordEpisode({
      goal: 'collect_wood',
      action: 'break_block',
      outcome: 'success',
      failureReason: null,
      context: { goalType: 'progression', resource: 'oak_log', quantity: 8 },
    });

    episodic.recordEpisode({
      goal: 'collect_wood',
      action: 'break_block',
      outcome: 'failure',
      failureReason: 'tool_missing',
      context: { goalType: 'progression', resource: 'oak_log', quantity: 32 },
    });

    episodic.recordEpisode({
      goal: 'survive_night',
      action: 'place_block',
      outcome: 'success',
      failureReason: null,
      context: { goalType: 'survival', structure: 'wall' },
    });

    episodic.close();

    const reopened = new EpisodicMemoryRepository({ dbPath, sqliteBusyTimeoutMs: 1000 });
    try {
      const byGoal = reopened.listByGoal('collect_wood');
      assert(byGoal.length === 2, `Expected two episodes for collect_wood, got ${byGoal.length}`);

      const byGoalType = reopened.listByGoalType('progression');
      assert(byGoalType.length === 2, `Expected two progression episodes, got ${byGoalType.length}`);

      const failures = reopened.listFailures('collect_wood');
      assert(failures.length === 1, `Expected one failure for collect_wood, got ${failures.length}`);
      assert(failures[0]?.failureReason === 'tool_missing', 'Expected failure reason to persist');

      const recent = reopened.listRecent(2);
      assert(recent.length === 2, `Expected two recent episodes, got ${recent.length}`);
      assert(recent[0]?.createdAt >= recent[1]?.createdAt, 'Expected recency sorting (newest first)');
    } finally {
      reopened.close();
    }
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

testEpisodicDurabilityAndFilters();
console.log('EpisodicMemoryRepository durability: PASS');

export {};
