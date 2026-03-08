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

export async function executeDropItem(
  actionItem: ActionItem,
  context: ExecutorRunContext,
): Promise<SkillExecutionOutcome> {
  void context;

  const item = actionItem.params['item'];
  const quantity = parsePositiveInt(actionItem.params['quantity']);
  const inventory = parseInventory(actionItem.params['inventory']);

  if (typeof item !== 'string' || item.trim().length === 0 || quantity === null || inventory === null) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'drop_item requires item, quantity, and inventory',
      stateChanges: {},
    };
  }

  const normalizedItem = item.trim();
  const available = inventory[normalizedItem] ?? 0;
  if (available < quantity) {
    return {
      success: false,
      errorCode: 'insufficient_materials',
      errorMessage: `Cannot drop ${quantity} ${normalizedItem}: only ${available} available`,
      stateChanges: {},
    };
  }

  const nextInventory: InventoryMap = {
    ...inventory,
    [normalizedItem]: available - quantity,
  };

  try {
    const attempt = parseAttempt(actionItem.params);
    const attemptResult = attempt ? await attempt() : { success: true };
    if (!attemptResult.success) {
      return {
        success: false,
        errorCode: attemptResult.unsafe || hasUnsafeReason(attemptResult.reason) ? 'unsafe' : 'route_blocked',
        errorMessage: compactReason(attemptResult.reason, 'drop attempt failed'),
        stateChanges: attemptResult.stateChanges ?? {},
      };
    }

    const postOk = await evaluatePostCondition(actionItem.params);
    if (!postOk) {
      const postReason = typeof actionItem.params['postReason'] === 'string'
        ? actionItem.params['postReason']
        : 'drop post-condition failed';
      return {
        success: false,
        errorCode: hasUnsafeReason(postReason) ? 'unsafe' : 'route_blocked',
        errorMessage: compactReason(postReason, 'drop did not persist after attempt'),
        stateChanges: attemptResult.stateChanges ?? {},
      };
    }

    return {
      success: true,
      errorCode: null,
      errorMessage: null,
      stateChanges: {
        ...(attemptResult.stateChanges ?? {}),
        inventory: nextInventory,
      },
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'drop_item attempt threw';
    return {
      success: false,
      errorCode: hasUnsafeReason(reason) ? 'unsafe' : 'route_blocked',
      errorMessage: compactReason(reason, 'drop_item attempt failed unexpectedly'),
      stateChanges: {},
    };
  }
}
