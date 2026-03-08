import { executeAction } from './Executor';
import type { ActionItem } from '../types';
import type { MovementRequest, SkillExecutionOutcome } from './types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

interface FakeMovementCoordinator {
  requestMove: (request: MovementRequest) => Promise<SkillExecutionOutcome>;
}

function createAction(skill: 'move_to' | 'follow_entity', id: string): ActionItem {
  const params: Record<string, unknown> = { id, x: 1, y: 64, z: 1 };
  if (skill === 'follow_entity') {
    params['targetId'] = `target-${id}`;
  }

  return {
    skill,
    params,
    expectedDurationSeconds: 5,
  };
}

async function testMoveAndFollowAreCoordinatorMediated(): Promise<void> {
  const seen: string[] = [];
  const movementCoordinator: FakeMovementCoordinator = {
    requestMove: (request) => {
      seen.push(request.actionItem.skill);
      return Promise.resolve({
        success: true,
        errorCode: null,
        errorMessage: null,
        stateChanges: {},
      });
    },
  };

  const moveResult = await executeAction(createAction('move_to', 'm1'), {
    movementCoordinator,
  });
  const followResult = await executeAction(createAction('follow_entity', 'f1'), {
    movementCoordinator,
  });

  assert(moveResult.success === true, 'move_to should succeed through coordinator');
  assert(followResult.success === true, 'follow_entity should succeed through coordinator');
  assert(seen.includes('move_to'), 'Coordinator should receive move_to');
  assert(seen.includes('follow_entity'), 'Coordinator should receive follow_entity');
}

async function testMovementConflictOutcomeEmitsStructuredExecutorResult(): Promise<void> {
  const emitted: SkillExecutionOutcome[] = [];
  let callCount = 0;

  const movementCoordinator: FakeMovementCoordinator = {
    requestMove: () => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({
          success: false,
          errorCode: 'interrupted',
          errorMessage: 'preempted by critical movement',
          stateChanges: {},
        });
      }

      return Promise.resolve({
        success: true,
        errorCode: null,
        errorMessage: null,
        stateChanges: {},
      });
    },
  };

  const eventBus = {
    emit: (_event: 'executor:result', result: unknown): boolean => {
      const value = result as { success: boolean; errorCode: string | null; errorMessage: string | null };
      emitted.push({
        success: value.success,
        errorCode: (value.errorCode as SkillExecutionOutcome['errorCode']) ?? null,
        errorMessage: value.errorMessage,
        stateChanges: {},
      });
      return true;
    },
  };

  const interrupted = await executeAction(createAction('move_to', 'm2'), {
    movementCoordinator,
    eventBus,
  });
  const winner = await executeAction(createAction('follow_entity', 'f2'), {
    movementCoordinator,
    eventBus,
  });

  assert(interrupted.success === false, 'First result should be interrupted from movement conflict');
  assert(interrupted.errorCode === 'interrupted', 'Conflict result should be interrupted');
  assert(winner.success === true, 'Second result should succeed');

  assert(emitted.length === 2, `Expected 2 emitted executor results, got ${emitted.length}`);
  assert(emitted.some((result) => result.errorCode === 'interrupted'), 'Expected interrupted outcome to be emitted');
}

async function run(): Promise<void> {
  await testMoveAndFollowAreCoordinatorMediated();
  await testMovementConflictOutcomeEmitsStructuredExecutorResult();
}

void run();
