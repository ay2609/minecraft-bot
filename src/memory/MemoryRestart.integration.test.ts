import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import DatabaseDriver from 'better-sqlite3';
import type { Bot } from 'mineflayer';
import { CheckpointRepository } from './CheckpointRepository';
import { MemoryDatabase } from './Database';
import type { GoalPlan } from '../types/index';
import { initializeApplication } from '../index';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createPlan(): GoalPlan {
  return {
    goal: 'Build shelter',
    goalRationale: 'Night is coming',
    priority: 'survival',
    subgoals: [
      {
        id: 'sg-build-1',
        description: 'Place temporary walls',
        requiredItems: { dirt: 20 },
        expectedOutcome: 'enclosed box shelter',
        maxAttempts: 2,
        timeoutSeconds: 90,
      },
    ],
    successConditions: ['shelter_complete'],
    abortConditions: ['hostiles_overwhelming'],
    estimatedComplexity: 'medium',
    allowedSkills: ['place_block', 'move_to'],
  };
}

function createBotStub(): Bot {
  const botLike = {
    username: 'TestBot',
    version: '1.21.11',
    entity: {
      position: { x: 0, y: 64, z: 0 },
    },
    once: () => botLike,
    on: () => botLike,
  };

  return botLike as unknown as Bot;
}

function testRestoreRunsBeforeBotStartup(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'minecraft-bot-restart-ok-test-'));
  const dbPath = join(tempDir, 'memory.db');
  const database = new MemoryDatabase({ dbPath, sqliteBusyTimeoutMs: 1000 });
  database.initializeSchema();

  const checkpointRepository = new CheckpointRepository({ dbPath, sqliteBusyTimeoutMs: 1000 });
  const checkpointId = checkpointRepository.commitCheckpoint({
    plan: createPlan(),
    activeSubgoalId: 'sg-build-1',
    actionQueue: {
      subgoalId: 'sg-build-1',
      actions: [{ skill: 'move_to', params: { x: 0, y: 64, z: 0 }, expectedDurationSeconds: 20 }],
      reasoning: 'Move to build site',
      subgoalComplete: false,
      escalate: false,
      escalateReason: null,
    },
    constraints: { avoidNightTravel: true },
    commitReason: 'test-checkpoint',
  });

  let createBotCalls = 0;
  try {
    const app = initializeApplication({
      configOverride: {
        memory: { dbPath, sqliteBusyTimeoutMs: 1000 },
      },
      dependencies: {
        createBot: () => {
          createBotCalls += 1;
          return createBotStub();
        },
      },
    });

    const snapshot = app.memory.workingMemory.getSnapshot();
    assert(snapshot.restore.restoredFromCheckpoint === true, 'Expected restore metadata to indicate checkpoint restore');
    assert(snapshot.restore.checkpointId === checkpointId, 'Expected restored checkpoint id to match committed checkpoint');
    assert(snapshot.activePlan?.goal === 'Build shelter', 'Expected plan to be restored before startup continues');
    assert(snapshot.actionQueue?.needsRevalidation === true, 'Expected restored queue to be marked for revalidation');
    assert(createBotCalls === 1, `Expected createBot to be called once, got ${createBotCalls}`);
    app.memory.close();
  } finally {
    checkpointRepository.close();
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testRestoreFailureBlocksStartup(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'minecraft-bot-restart-fail-test-'));
  const dbPath = join(tempDir, 'memory.db');
  const database = new MemoryDatabase({ dbPath, sqliteBusyTimeoutMs: 1000 });
  database.initializeSchema();

  const connection = new DatabaseDriver(dbPath);
  connection
    .prepare(
      `INSERT INTO server_facts (key, value_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run('working_memory_checkpoint', '{"invalid":');

  let createBotCalls = 0;

  try {
    let threw = false;
    try {
      initializeApplication({
        configOverride: {
          memory: { dbPath, sqliteBusyTimeoutMs: 1000 },
        },
        dependencies: {
          createBot: () => {
            createBotCalls += 1;
            return createBotStub();
          },
        },
      });
    } catch {
      threw = true;
    }

    assert(threw, 'Expected startup to throw when restore checkpoint is corrupt');
    assert(createBotCalls === 0, 'Expected createBot not to run when memory restore fails');
  } finally {
    connection.close();
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

testRestoreRunsBeforeBotStartup();
testRestoreFailureBlocksStartup();
console.log('Memory restart integration: PASS');

export {};
