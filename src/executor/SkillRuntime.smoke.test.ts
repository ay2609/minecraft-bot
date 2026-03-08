import { executeAction } from './Executor';
import { MovementCoordinator } from './MovementCoordinator';
import type { ActionItem, CoreSkillName, ExecutorResult } from '../types';
import type { SkillExecutionOutcome } from './types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createAction(skill: CoreSkillName, params: Record<string, unknown>): ActionItem {
  return {
    skill,
    params,
    expectedDurationSeconds: 2,
  };
}

function assertInvariant(result: ExecutorResult): void {
  if (result.success) {
    assert(result.errorCode === null, 'Successful results must have null errorCode');
    assert(result.errorMessage === null, 'Successful results must have null errorMessage');
  } else {
    assert(result.errorCode !== null, 'Failed results must have non-null errorCode');
    assert(typeof result.errorMessage === 'string', 'Failed results must include an errorMessage');
  }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function testStructuredRuntimeInvariantsAcrossSuccessAndFailure(): Promise<void> {
  const success = await executeAction(createAction('send_chat', {
    message: 'runtime smoke',
    attempt: () => ({ success: true }),
  }));
  assertInvariant(success);

  const failure = await executeAction(createAction('place_block', {
    x: 1,
    y: 64,
    z: 1,
    blockName: 'stone',
    attempt: () => ({ success: false, reason: 'lava hazard', unsafe: true }),
  }));
  assertInvariant(failure);
  assert(failure.errorCode === 'unsafe', `Expected unsafe failure, got ${failure.errorCode}`);
}

async function testMovementMutexStaysStableWhileNonMovementSkillsRun(): Promise<void> {
  let movementExecuteCount = 0;
  const movementDeferred = createDeferred<SkillExecutionOutcome>();
  const movementCoordinator = new MovementCoordinator({ pendingTtlMs: 1_000 });

  const moving = executeAction(createAction('move_to', { x: 4, y: 64, z: 4 }), {
    movementCoordinator,
    performMovement: async () => {
      movementExecuteCount += 1;
      return movementDeferred.promise;
    },
  });

  const place = executeAction(createAction('place_block', {
    x: 2,
    y: 64,
    z: 2,
    blockName: 'stone',
    attempt: () => ({ success: true }),
  }));
  const chat = executeAction(createAction('send_chat', {
    message: 'still moving',
    attempt: () => ({ success: true }),
  }));

  movementDeferred.resolve({ success: true, errorCode: null, errorMessage: null, stateChanges: {} });

  const [moveResult, placeResult, chatResult] = await Promise.all([moving, place, chat]);
  assert(moveResult.success === true, 'Movement action should complete');
  assert(placeResult.success === true, 'place_block should succeed while movement is in progress');
  assert(chatResult.success === true, 'send_chat should succeed while movement is in progress');
  assert(movementExecuteCount === 1, `Expected one movement execution, got ${movementExecuteCount}`);
}

async function testMovementOutcomeIsPreservedInExecutorMetadata(): Promise<void> {
  const action = createAction('move_to', { x: 0, y: 64, z: 0 });
  const result = await executeAction(action, {
    movementCoordinator: {
      requestMove: () => Promise.resolve({
        success: false,
        errorCode: 'interrupted',
        errorMessage: 'preempted by higher priority',
        stateChanges: {},
        movement: {
          outcome: 'preempted',
          details: 'critical_override',
        },
      }),
    },
  });

  assert(result.success === false, 'Expected interrupted movement result');
  assert(result.metadata?.movement?.outcome === 'preempted', 'Expected movement outcome metadata to be preserved');
}

async function run(): Promise<void> {
  await testStructuredRuntimeInvariantsAcrossSuccessAndFailure();
  await testMovementMutexStaysStableWhileNonMovementSkillsRun();
  await testMovementOutcomeIsPreservedInExecutorMetadata();
}

void run();
