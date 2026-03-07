import { WorkingMemory } from './WorkingMemory';
import type { ActionQueue, GoalPlan, WorkingMemorySnapshot } from '../types/index';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createPlan(): GoalPlan {
  return {
    goal: 'Gather logs',
    goalRationale: 'Need wood for early tools',
    priority: 'progression',
    subgoals: [
      {
        id: 'sg-1',
        description: 'Find and break oak logs',
        requiredItems: {},
        expectedOutcome: 'at least 8 oak logs',
        maxAttempts: 3,
        timeoutSeconds: 120,
      },
    ],
    successConditions: ['oak_log >= 8'],
    abortConditions: ['health < 6'],
    estimatedComplexity: 'low',
    allowedSkills: ['move_to', 'break_block'],
  };
}

function createQueue(subgoalId: string): ActionQueue {
  return {
    subgoalId,
    actions: [
      {
        skill: 'move_to',
        params: { x: 10, y: 64, z: 10 },
        expectedDurationSeconds: 20,
      },
      {
        skill: 'break_block',
        params: { block: 'oak_log' },
        expectedDurationSeconds: 8,
      },
    ],
    reasoning: 'Collect nearby logs quickly',
    subgoalComplete: false,
    escalate: false,
    escalateReason: null,
    needsRevalidation: false,
  };
}

function testStrictMutationApiAndSnapshotIsolation(): void {
  const memory = new WorkingMemory();
  const plan = createPlan();
  const queue = createQueue('sg-1');

  memory.setPlan(plan);
  memory.setActiveSubgoal('sg-1');
  memory.setActionQueue(queue);
  memory.setConstraints({ avoidNightTravel: true, maxDistance: 64 });

  const snapshot = memory.getSnapshot();

  assert(snapshot.activePlan?.goal === 'Gather logs', 'Plan was not stored in working memory');
  assert(snapshot.activeSubgoalId === 'sg-1', 'Active subgoal was not stored');
  assert(snapshot.actionQueue?.actions.length === 2, 'Action queue was not stored');
  assert(snapshot.constraints['avoidNightTravel'] === true, 'Constraints were not stored');

  snapshot.activePlan = null;
  snapshot.constraints['maxDistance'] = 9999;
  snapshot.actionQueue = null;

  const latest = memory.getSnapshot();
  assert(latest.activePlan?.goal === 'Gather logs', 'External mutation leaked into internal plan state');
  assert(latest.constraints['maxDistance'] === 64, 'External mutation leaked into constraints');
  assert(latest.actionQueue?.actions.length === 2, 'External mutation leaked into queue');
}

function testClearExecutionTransients(): void {
  const memory = new WorkingMemory();

  memory.setPlan(createPlan());
  memory.setActiveSubgoal('sg-1');
  memory.setActionQueue(createQueue('sg-1'));

  memory.clearExecutionTransients();

  const snapshot = memory.getSnapshot();
  assert(snapshot.actionQueue?.needsRevalidation === true, 'Queue should be marked for revalidation');
  assert(snapshot.execution.inFlightAction === null, 'In-flight action should be cleared');
  assert(snapshot.execution.lockedSkill === null, 'Execution lock should be cleared');
}

function testResetAndRestoreMetadataDefaults(): void {
  const memory = new WorkingMemory();
  memory.setPlan(createPlan());
  memory.setActiveSubgoal('sg-1');
  memory.setActionQueue(createQueue('sg-1'));
  memory.setConstraints({ hazardBuffer: 12 });

  memory.reset();

  const snapshot: WorkingMemorySnapshot = memory.getSnapshot();
  assert(snapshot.activePlan === null, 'Reset should clear plan');
  assert(snapshot.activeSubgoalId === null, 'Reset should clear active subgoal');
  assert(snapshot.actionQueue === null, 'Reset should clear action queue');
  assert(Object.keys(snapshot.constraints).length === 0, 'Reset should clear constraints');
  assert(snapshot.restore.restoredFromCheckpoint === false, 'Default restore metadata should be false');
}

testStrictMutationApiAndSnapshotIsolation();
testClearExecutionTransients();
testResetAndRestoreMetadataDefaults();

console.log('WorkingMemory behavior: PASS');

export {};
