import { executeAction } from './Executor';
import type { ActionItem } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createAction(skill: 'craft_item' | 'drop_item' | 'equip_item', params: Record<string, unknown>): ActionItem {
  return {
    skill,
    params,
    expectedDurationSeconds: 2,
  };
}

async function testCraftItemExecutesWithRecipeAndMaterials(): Promise<void> {
  const result = await executeAction(createAction('craft_item', {
    item: 'oak_planks',
    quantity: 4,
    inventory: {
      oak_log: 1,
    },
    recipes: {
      oak_planks: {
        oak_log: 1,
      },
    },
  }));

  assert(result.success === true, 'craft_item should succeed when recipe and materials exist');
  assert(result.errorCode === null, 'successful craft_item should have null errorCode');
}

async function testDropItemFailsWhenInventoryCountIsInsufficient(): Promise<void> {
  const result = await executeAction(createAction('drop_item', {
    item: 'cobblestone',
    quantity: 8,
    inventory: {
      cobblestone: 2,
    },
  }));

  assert(result.success === false, 'drop_item should fail when inventory is insufficient');
  assert(result.errorCode === 'insufficient_materials', `Expected insufficient_materials, got ${result.errorCode}`);
}

async function testEquipItemMapsMissingItemToToolMissing(): Promise<void> {
  const result = await executeAction(createAction('equip_item', {
    item: 'iron_pickaxe',
    slot: 'hand',
    inventory: {
      stick: 2,
    },
  }));

  assert(result.success === false, 'equip_item should fail when target item is missing from inventory');
  assert(result.errorCode === 'tool_missing', `Expected tool_missing, got ${result.errorCode}`);
}

async function run(): Promise<void> {
  await testCraftItemExecutesWithRecipeAndMaterials();
  await testDropItemFailsWhenInventoryCountIsInsufficient();
  await testEquipItemMapsMissingItemToToolMissing();
}

void run();
