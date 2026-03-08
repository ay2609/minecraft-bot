import { executeAction } from './Executor';
import type { ActionItem, CoreSkillName, ExecutorResult } from '../types';
import type { ExecutorDependencies } from './types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createAction(skill: CoreSkillName, params: Record<string, unknown>): ActionItem {
  return {
    skill,
    params,
    expectedDurationSeconds: 2,
  };
}

function timeoutDependencies(timeoutMs: number): ExecutorDependencies {
  return {
    timeoutMsForSkill: () => timeoutMs,
    movementCoordinator: {
      requestMove: ({ execute }) => execute(new AbortController().signal),
    },
    performMovement: async () => {
      await sleep(timeoutMs * 6);
      return {
        success: true,
        errorCode: null,
        errorMessage: null,
        stateChanges: {},
      };
    },
  };
}

function timeoutAttempt(): () => Promise<{ success: true }> {
  return async () => {
    await sleep(40);
    return { success: true };
  };
}

function assertTimedOut(result: ExecutorResult, skill: string): void {
  assert(result.success === false, `${skill} should fail when timeout budget is exceeded`);
  assert(result.errorCode === 'timed_out', `${skill} should map timeout to timed_out, got ${result.errorCode}`);
  assert(result.metadata?.timedOut === true, `${skill} should mark metadata.timedOut=true`);
}

async function testTimeoutBehaviorAcrossMovementAndInventorySkills(): Promise<void> {
  const dependencies = timeoutDependencies(5);

  const actions: ActionItem[] = [
    createAction('move_to', { x: 1, y: 64, z: 1 }),
    createAction('follow_entity', { targetId: 'target-1' }),
    createAction('craft_item', {
      item: 'torch',
      quantity: 1,
      inventory: { stick: 1, coal: 1 },
      recipes: { torch: { stick: 1, coal: 1 } },
      attempt: timeoutAttempt(),
    }),
    createAction('drop_item', {
      item: 'cobblestone',
      quantity: 1,
      inventory: { cobblestone: 10 },
      attempt: timeoutAttempt(),
    }),
    createAction('equip_item', {
      item: 'stone_pickaxe',
      slot: 'hand',
      inventory: { stone_pickaxe: 1 },
      attempt: timeoutAttempt(),
    }),
    createAction('interact_block', {
      x: 3,
      y: 64,
      z: 3,
      attempt: timeoutAttempt(),
    }),
    createAction('attack_entity', {
      targetId: 'zombie-1',
      attempt: timeoutAttempt(),
    }),
    createAction('send_chat', {
      message: 'timeout check',
      attempt: timeoutAttempt(),
    }),
  ];

  for (const action of actions) {
    const result = await executeAction(action, dependencies);
    assertTimedOut(result, action.skill);
  }
}

async function testTimeoutPrecedenceOverUnsafeSignals(): Promise<void> {
  const result = await executeAction(createAction('place_block', {
    x: 1,
    y: 64,
    z: 1,
    blockName: 'stone',
    attempt: async () => {
      await sleep(35);
      return {
        success: false,
        unsafe: true,
        reason: 'lava hazard',
      };
    },
  }), timeoutDependencies(5));

  assertTimedOut(result, 'place_block');
}

async function run(): Promise<void> {
  await testTimeoutBehaviorAcrossMovementAndInventorySkills();
  await testTimeoutPrecedenceOverUnsafeSignals();
}

void run();
