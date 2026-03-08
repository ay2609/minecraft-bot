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
    expectedDurationSeconds: 3,
  };
}

function assertResultInvariant(result: ExecutorResult, label: string): void {
  if (result.success) {
    assert(result.errorCode === null, `${label}: successful result must have null errorCode`);
    assert(result.errorMessage === null, `${label}: successful result must have null errorMessage`);
  } else {
    assert(result.errorCode !== null, `${label}: failed result must have non-null errorCode`);
    assert(typeof result.errorMessage === 'string', `${label}: failed result must include errorMessage`);
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

async function testMixedSkillExecutionCoversSuccessAndFailureClasses(): Promise<void> {
  const movementCoordinator = {
    requestMove: () => Promise.resolve({
      success: true,
      errorCode: null,
      errorMessage: null,
      stateChanges: {},
      movement: {
        outcome: 'executed' as const,
      },
    }),
  };

  const [moveResult, craftResult, dropResult, attackResult, chatResult] = await Promise.all([
    executeAction(createAction('move_to', { x: 4, y: 64, z: 4 }), { movementCoordinator }),
    executeAction(createAction('craft_item', {
      item: 'stick',
      quantity: 2,
      inventory: { plank: 2 },
      recipes: { stick: { plank: 1 } },
    })),
    executeAction(createAction('drop_item', {
      item: 'cobblestone',
      quantity: 8,
      inventory: { cobblestone: 1 },
    })),
    executeAction(createAction('attack_entity', {
      targetId: 'skeleton-1',
      attempt: () => ({ success: false, targetMissing: true, reason: 'entity missing at tick' }),
    })),
    executeAction(createAction('send_chat', {
      message: 'ExecutorLive integration',
      attempt: () => ({ success: true }),
    })),
  ]);

  assertResultInvariant(moveResult, 'move_to');
  assertResultInvariant(craftResult, 'craft_item');
  assertResultInvariant(dropResult, 'drop_item');
  assertResultInvariant(attackResult, 'attack_entity');
  assertResultInvariant(chatResult, 'send_chat');

  assert(moveResult.success === true, 'Expected movement success in mixed scenario');
  assert(craftResult.success === true, 'Expected craft_item success in mixed scenario');
  assert(dropResult.success === false && dropResult.errorCode === 'insufficient_materials', 'Expected drop_item missing-material failure');
  assert(attackResult.success === false && attackResult.errorCode === 'target_unavailable', 'Expected attack_entity target_unavailable failure');
  assert(chatResult.success === true, 'Expected send_chat success in mixed scenario');
}

async function testMovementMutexPreservedDuringMixedSkillRuns(): Promise<void> {
  const coordinator = new MovementCoordinator({ pendingTtlMs: 1_000 });
  const firstMovementDeferred = createDeferred<SkillExecutionOutcome>();
  let movementExecuteCount = 0;

  const performMovement = (): Promise<SkillExecutionOutcome> => {
    movementExecuteCount += 1;
    if (movementExecuteCount === 1) {
      return firstMovementDeferred.promise;
    }

    return Promise.resolve({
      success: true,
      errorCode: null,
      errorMessage: null,
      stateChanges: {},
    });
  };

  const firstMove = executeAction(createAction('move_to', { x: 1, y: 64, z: 1 }), {
    movementCoordinator: coordinator,
    performMovement,
  });
  const replacedPendingMove = executeAction(createAction('move_to', { x: 2, y: 64, z: 2 }), {
    movementCoordinator: coordinator,
    performMovement,
  });
  const finalMove = executeAction(createAction('follow_entity', { targetId: 'cow-1' }), {
    movementCoordinator: coordinator,
    performMovement,
  });

  const [craftWhileMoving, equipWhileMoving] = await Promise.all([
    executeAction(createAction('craft_item', {
      item: 'torch',
      quantity: 1,
      inventory: { stick: 1, coal: 1 },
      recipes: { torch: { stick: 1, coal: 1 } },
    })),
    executeAction(createAction('equip_item', {
      item: 'stone_pickaxe',
      slot: 'hand',
      inventory: { stone_pickaxe: 1 },
      attempt: () => ({ success: true }),
    })),
  ]);

  firstMovementDeferred.resolve({
    success: true,
    errorCode: null,
    errorMessage: null,
    stateChanges: {},
  });

  const [firstResult, replacedResult, finalResult] = await Promise.all([
    firstMove,
    replacedPendingMove,
    finalMove,
  ]);

  assert(craftWhileMoving.success === true, 'craft_item should execute while movement queue is active');
  assert(equipWhileMoving.success === true, 'equip_item should execute while movement queue is active');

  assert(firstResult.success === true, 'First active movement should complete');
  assert(replacedResult.success === false, 'Replaced pending movement should fail');
  assert(replacedResult.errorCode === 'interrupted', `Expected replaced pending movement to be interrupted, got ${replacedResult.errorCode}`);
  assert(finalResult.success === true, 'Latest pending movement should execute after active movement completes');
  assert(movementExecuteCount === 2, `Expected two movement executions (active + final), got ${movementExecuteCount}`);
}

async function run(): Promise<void> {
  await testMixedSkillExecutionCoversSuccessAndFailureClasses();
  await testMovementMutexPreservedDuringMixedSkillRuns();
}

void run();
