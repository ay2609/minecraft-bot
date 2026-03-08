import { executeAction } from './Executor';
import { mapExecutorFailure } from './failureMapping';
import type { ActionItem, ExecutorErrorCode } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createAction(skill: ActionItem['skill'], params: Record<string, unknown>): ActionItem {
  return {
    skill,
    params,
    expectedDurationSeconds: 2,
  };
}

function testTextAndSignalCoverageForRequiredCodes(): void {
  const cases: Array<{ code: ExecutorErrorCode; error: unknown }> = [
    { code: 'timed_out', error: new Error('timed out while executing') },
    { code: 'target_unavailable', error: new Error('target unavailable: entity missing') },
    { code: 'unsafe', error: new Error('unsafe lava hazard near target') },
    { code: 'interrupted', error: new Error('goalChanged interrupted action') },
    { code: 'insufficient_materials', error: new Error('missing material for recipe') },
    { code: 'inventory_full', error: new Error('inventory full while collecting') },
    { code: 'tool_missing', error: new Error('tool missing for operation') },
    { code: 'no_path', error: new Error('cannot find path to target') },
    { code: 'route_blocked', error: new Error('route blocked by obstacle') },
    { code: 'invalid_state', error: new Error('unknown failure without known signals') },
  ];

  for (const entry of cases) {
    const mapped = mapExecutorFailure(entry.error);
    assert(mapped.errorCode === entry.code, `Expected ${entry.code}, got ${mapped.errorCode}`);
    assert(mapped.errorMessage.length > 0, `Expected non-empty error message for ${entry.code}`);
  }
}

function testDeterministicPrecedenceOrdering(): void {
  const timeoutVsUnsafe = mapExecutorFailure({ timeout: true, unsafe: true, blocked: true, message: 'timeout and unsafe' });
  assert(timeoutVsUnsafe.errorCode === 'timed_out', `Expected timed_out precedence, got ${timeoutVsUnsafe.errorCode}`);

  const targetVsUnsafe = mapExecutorFailure({ targetMissing: true, unsafe: true, message: 'missing and unsafe' });
  assert(targetVsUnsafe.errorCode === 'target_unavailable', `Expected target_unavailable precedence, got ${targetVsUnsafe.errorCode}`);

  const unsafeVsBlocked = mapExecutorFailure({ blocked: true, unsafe: true, message: 'blocked by lava hazard' });
  assert(unsafeVsBlocked.errorCode === 'unsafe', `Expected unsafe precedence, got ${unsafeVsBlocked.errorCode}`);

  const actionSignalPrecedence = mapExecutorFailure(
    { blocked: true, message: 'blocked route' },
    createAction('place_block', {
      x: 1,
      y: 64,
      z: 1,
      blockName: 'stone',
      failureSignals: ['route_blocked', 'timed_out'],
    }),
  );
  assert(actionSignalPrecedence.errorCode === 'timed_out', `Expected timed_out from action failureSignals precedence, got ${actionSignalPrecedence.errorCode}`);
}

async function testInventorySkillSpecificFailureCodes(): Promise<void> {
  const insufficientCraft = await executeAction(createAction('craft_item', {
    item: 'stick',
    quantity: 4,
    inventory: {
      plank: 1,
    },
    recipes: {
      stick: {
        plank: 2,
      },
    },
  }));

  assert(insufficientCraft.success === false, 'Expected craft_item to fail on missing materials');
  assert(insufficientCraft.errorCode === 'insufficient_materials', `Expected insufficient_materials, got ${insufficientCraft.errorCode}`);

  const missingEquipTool = await executeAction(createAction('equip_item', {
    item: 'iron_pickaxe',
    slot: 'hand',
    inventory: {
      dirt: 3,
    },
  }));

  assert(missingEquipTool.success === false, 'Expected equip_item to fail when item is missing');
  assert(missingEquipTool.errorCode === 'tool_missing', `Expected tool_missing, got ${missingEquipTool.errorCode}`);

  const inventoryFullMapped = mapExecutorFailure({ message: 'inventory full', blocked: true });
  assert(inventoryFullMapped.errorCode === 'inventory_full', `Expected inventory_full, got ${inventoryFullMapped.errorCode}`);
}

async function run(): Promise<void> {
  testTextAndSignalCoverageForRequiredCodes();
  testDeterministicPrecedenceOrdering();
  await testInventorySkillSpecificFailureCodes();
}

void run();
