import type { ActionItem } from '../../types';
import type { ExecutorRunContext, SkillExecutionOutcome } from '../types';

type AttemptResult = {
  success?: boolean;
  blocked?: boolean;
  unsafe?: boolean;
  reason?: string;
  stateChanges?: SkillExecutionOutcome['stateChanges'];
};

type AttemptFn = () => Promise<AttemptResult> | AttemptResult;

type InventoryMap = Record<string, number>;
type RecipeMap = Record<string, Record<string, number>>;

function compactReason(reason: string | undefined, fallback: string): string {
  if (!reason || reason.trim().length === 0) {
    return fallback;
  }

  return reason.trim().slice(0, 120);
}

function parseAttempt(params: ActionItem['params']): AttemptFn | null {
  const attempt = params['attempt'];
  return typeof attempt === 'function' ? (attempt as AttemptFn) : null;
}

function hasUnsafeReason(reason: string | undefined): boolean {
  return typeof reason === 'string' && /(unsafe|hazard|lava|fall\s*risk)/i.test(reason);
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function parseInventory(value: unknown): InventoryMap | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const output: InventoryMap = {};
  for (const [key, rawCount] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawCount !== 'number' || !Number.isFinite(rawCount) || rawCount < 0) {
      return null;
    }
    output[key] = rawCount;
  }

  return output;
}

function parseRecipes(value: unknown): RecipeMap | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const recipes: RecipeMap = {};
  for (const [outputItem, rawIngredients] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawIngredients !== 'object' || rawIngredients === null) {
      return null;
    }

    const ingredientMap: Record<string, number> = {};
    for (const [ingredient, rawCount] of Object.entries(rawIngredients as Record<string, unknown>)) {
      if (typeof rawCount !== 'number' || !Number.isFinite(rawCount) || rawCount <= 0) {
        return null;
      }
      ingredientMap[ingredient] = rawCount;
    }

    recipes[outputItem] = ingredientMap;
  }

  return recipes;
}

function parseRecipeYield(params: ActionItem['params'], item: string): number {
  const recipeYields = params['recipeYields'];
  if (typeof recipeYields !== 'object' || recipeYields === null) {
    return 1;
  }

  const value = (recipeYields as Record<string, unknown>)[item];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return 1;
  }

  return value;
}

function mergeStateChanges(base: SkillExecutionOutcome['stateChanges'], patch: SkillExecutionOutcome['stateChanges']): SkillExecutionOutcome['stateChanges'] {
  return {
    ...(base ?? {}),
    ...(patch ?? {}),
  };
}

async function evaluatePostCondition(params: ActionItem['params']): Promise<boolean> {
  const post = params['postCondition'];
  if (typeof post === 'function') {
    return Boolean(await (post as (() => Promise<boolean> | boolean))());
  }

  if (typeof post === 'boolean') {
    return post;
  }

  return true;
}

export async function executeCraftItem(
  actionItem: ActionItem,
  context: ExecutorRunContext,
): Promise<SkillExecutionOutcome> {
  void context;

  const item = actionItem.params['item'];
  const quantity = parsePositiveInt(actionItem.params['quantity']);
  const inventory = parseInventory(actionItem.params['inventory']);
  const recipes = parseRecipes(actionItem.params['recipes']);

  if (typeof item !== 'string' || item.trim().length === 0 || quantity === null || inventory === null || recipes === null) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'craft_item requires item, quantity, inventory, and recipes',
      stateChanges: {},
    };
  }

  const normalizedItem = item.trim();
  const recipe = recipes[normalizedItem];
  if (!recipe || Object.keys(recipe).length === 0) {
    return {
      success: false,
      errorCode: 'insufficient_materials',
      errorMessage: `No recipe available for ${normalizedItem}`,
      stateChanges: {},
    };
  }

  const recipeYield = parseRecipeYield(actionItem.params, normalizedItem);
  const craftOperations = Math.ceil(quantity / recipeYield);

  for (const [ingredient, requiredPerCraft] of Object.entries(recipe)) {
    const totalRequired = requiredPerCraft * craftOperations;
    const available = inventory[ingredient] ?? 0;
    if (available < totalRequired) {
      return {
        success: false,
        errorCode: 'insufficient_materials',
        errorMessage: `Missing ${ingredient}: need ${totalRequired}, have ${available}`,
        stateChanges: {},
      };
    }
  }

  const consumedInventory: InventoryMap = { ...inventory };
  for (const [ingredient, requiredPerCraft] of Object.entries(recipe)) {
    consumedInventory[ingredient] = Math.max(0, consumedInventory[ingredient] - requiredPerCraft * craftOperations);
  }
  consumedInventory[normalizedItem] = (consumedInventory[normalizedItem] ?? 0) + quantity;

  try {
    const attempt = parseAttempt(actionItem.params);
    const attemptResult = attempt ? await attempt() : { success: true };
    if (!attemptResult.success) {
      return {
        success: false,
        errorCode: attemptResult.unsafe || hasUnsafeReason(attemptResult.reason) ? 'unsafe' : 'route_blocked',
        errorMessage: compactReason(attemptResult.reason, 'craft attempt failed'),
        stateChanges: attemptResult.stateChanges ?? {},
      };
    }

    const postOk = await evaluatePostCondition(actionItem.params);
    if (!postOk) {
      const postReason = typeof actionItem.params['postReason'] === 'string'
        ? actionItem.params['postReason']
        : 'crafting post-condition failed';
      return {
        success: false,
        errorCode: hasUnsafeReason(postReason) ? 'unsafe' : 'route_blocked',
        errorMessage: compactReason(postReason, 'crafting did not persist after attempt'),
        stateChanges: attemptResult.stateChanges ?? {},
      };
    }

    return {
      success: true,
      errorCode: null,
      errorMessage: null,
      stateChanges: mergeStateChanges(attemptResult.stateChanges ?? {}, {
        inventory: consumedInventory,
      }),
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'craft_item attempt threw';
    return {
      success: false,
      errorCode: hasUnsafeReason(reason) ? 'unsafe' : 'route_blocked',
      errorMessage: compactReason(reason, 'craft_item attempt failed unexpectedly'),
      stateChanges: {},
    };
  }
}
