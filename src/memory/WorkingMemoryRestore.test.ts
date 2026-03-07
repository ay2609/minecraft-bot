import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import DatabaseDriver from 'better-sqlite3';
import { MemoryDatabase } from './Database';
import { CheckpointRepository } from './CheckpointRepository';
import { WorkingMemory } from './WorkingMemory';
import { WorkingMemoryRestore } from './WorkingMemoryRestore';
import { eventBus } from '../events/EventBus';
import type { ActionQueue, GoalPlan, WorkingMemoryRestoreCompleteEvent, WorkingMemoryRestoreFailedEvent } from '../types/index';

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

function createQueue(): ActionQueue {
  return {
    subgoalId: 'sg-build-1',
    actions: [
      {
        skill: 'move_to',
        params: { x: 0, y: 64, z: 0 },
        expectedDurationSeconds: 15,
      },
      {
        skill: 'place_block',
        params: { block: 'dirt', count: 20 },
        expectedDurationSeconds: 45,
      },
    ],
    reasoning: 'Quick emergency shelter',
    subgoalComplete: false,
    escalate: false,
    escalateReason: null,
    needsRevalidation: false,
  };
}

function testRestoreFromCommittedCheckpoint(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'minecraft-bot-restore-test-'));
  const dbPath = join(tempDir, 'memory.db');
  const database = new MemoryDatabase({ dbPath, sqliteBusyTimeoutMs: 1000 });
  database.initializeSchema();

  const checkpointRepository = new CheckpointRepository({ dbPath, sqliteBusyTimeoutMs: 1000 });
  const workingMemory = new WorkingMemory();
  const plan = createPlan();
  const queue = createQueue();

  const completeEvents: WorkingMemoryRestoreCompleteEvent[] = [];
  const failureEvents: WorkingMemoryRestoreFailedEvent[] = [];
  eventBus.on('memory:restore-complete', (payload) => completeEvents.push(payload));
  eventBus.on('memory:restore-failed', (payload) => failureEvents.push(payload));

  try {
    workingMemory.setPlan(plan);
    workingMemory.setActiveSubgoal('sg-build-1');
    workingMemory.setActionQueue(queue);
    workingMemory.setConstraints({ stayNearSpawn: true });
    const checkpointId = workingMemory.commitCheckpoint(checkpointRepository, 'subgoal-boundary');

    workingMemory.reset();

    const restore = new WorkingMemoryRestore(workingMemory, checkpointRepository);
    const result = restore.restoreFromCheckpoint();
    const snapshot = workingMemory.getSnapshot();

    assert(result.restoredFromCheckpoint === true, 'Restore should report a committed checkpoint was loaded');
    assert(result.checkpointId === checkpointId, 'Restore should report the loaded checkpoint id');
    assert(snapshot.activePlan?.goal === 'Build shelter', 'Plan should be restored');
    assert(snapshot.activeSubgoalId === 'sg-build-1', 'Active subgoal should be restored');
    assert(snapshot.actionQueue?.actions.length === 2, 'Action queue should be restored');
    assert(snapshot.constraints['stayNearSpawn'] === true, 'Constraints should be restored');
    assert(snapshot.actionQueue?.needsRevalidation === true, 'Queue should be marked for revalidation');

    assert(completeEvents.length === 1, `Expected exactly 1 restore-complete event, got ${completeEvents.length}`);
    assert(failureEvents.length === 0, 'Restore success should not emit restore-failed');
  } finally {
    eventBus.removeAllListeners('memory:restore-complete');
    eventBus.removeAllListeners('memory:restore-failed');
    checkpointRepository.close();
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testCorruptCheckpointEmitsFailureEvent(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'minecraft-bot-restore-corrupt-test-'));
  const dbPath = join(tempDir, 'memory.db');
  const database = new MemoryDatabase({ dbPath, sqliteBusyTimeoutMs: 1000 });
  database.initializeSchema();
  const checkpointRepository = new CheckpointRepository({ dbPath, sqliteBusyTimeoutMs: 1000 });
  const workingMemory = new WorkingMemory();

  const completeEvents: WorkingMemoryRestoreCompleteEvent[] = [];
  const failureEvents: WorkingMemoryRestoreFailedEvent[] = [];
  eventBus.on('memory:restore-complete', (payload) => completeEvents.push(payload));
  eventBus.on('memory:restore-failed', (payload) => failureEvents.push(payload));

  const connection = new DatabaseDriver(dbPath);

  try {
    connection
      .prepare(
        `INSERT INTO server_facts (key, value_json)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`,
      )
      .run('working_memory_checkpoint', '{"invalid":');

    const restore = new WorkingMemoryRestore(workingMemory, checkpointRepository);

    let failed = false;
    try {
      restore.restoreFromCheckpoint();
    } catch {
      failed = true;
    }

    assert(failed, 'Corrupt checkpoint should throw');
    assert(completeEvents.length === 0, 'Corrupt checkpoint should not emit restore-complete');
    assert(failureEvents.length === 1, 'Corrupt checkpoint should emit restore-failed once');
  } finally {
    eventBus.removeAllListeners('memory:restore-complete');
    eventBus.removeAllListeners('memory:restore-failed');
    connection.close();
    checkpointRepository.close();
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

testRestoreFromCommittedCheckpoint();
testCorruptCheckpointEmitsFailureEvent();
console.log('WorkingMemoryRestore workflow: PASS');

export {};
