import type { ActionItem } from '../../types';
import type { ExecutorRunContext, SkillExecutionOutcome } from '../types';

type AttemptResult = {
  success?: boolean;
  blocked?: boolean;
  unsafe?: boolean;
  targetMissing?: boolean;
  reason?: string;
  stateChanges?: SkillExecutionOutcome['stateChanges'];
};

type AttemptFn = () => Promise<AttemptResult> | AttemptResult;

type InventoryMap = Record<string, number>;

const VALID_SLOTS = new Set(['hand', 'off-hand', 'head', 'chest', 'legs', 'feet']);

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

export async function executeEquipItem(
  actionItem: ActionItem,
  context: ExecutorRunContext,
): Promise<SkillExecutionOutcome> {
  void context;

  const item = actionItem.params['item'];
  const slot = actionItem.params['slot'];
  const inventory = parseInventory(actionItem.params['inventory']);

  if (typeof item !== 'string' || item.trim().length === 0 || typeof slot !== 'string' || !VALID_SLOTS.has(slot) || inventory === null) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'equip_item requires item, valid slot, and inventory',
      stateChanges: {},
    };
  }

  const normalizedItem = item.trim();
  if ((inventory[normalizedItem] ?? 0) < 1) {
    return {
      success: false,
      errorCode: 'tool_missing',
      errorMessage: `Cannot equip ${normalizedItem}: item not present in inventory`,
      stateChanges: {},
    };
  }

  try {
    const attempt = parseAttempt(actionItem.params);
    const attemptResult = attempt ? await attempt() : { success: true };

    if (!attemptResult.success) {
      if (attemptResult.targetMissing) {
        return {
          success: false,
          errorCode: 'tool_missing',
          errorMessage: compactReason(attemptResult.reason, 'equipment item is unavailable'),
          stateChanges: attemptResult.stateChanges ?? {},
        };
      }

      return {
        success: false,
        errorCode: attemptResult.unsafe || hasUnsafeReason(attemptResult.reason) ? 'unsafe' : 'route_blocked',
        errorMessage: compactReason(attemptResult.reason, 'equip attempt failed'),
        stateChanges: attemptResult.stateChanges ?? {},
      };
    }

    const postOk = await evaluatePostCondition(actionItem.params);
    if (!postOk) {
      const postReason = typeof actionItem.params['postReason'] === 'string'
        ? actionItem.params['postReason']
        : 'equip post-condition failed';
      return {
        success: false,
        errorCode: hasUnsafeReason(postReason) ? 'unsafe' : 'route_blocked',
        errorMessage: compactReason(postReason, 'equip did not persist after attempt'),
        stateChanges: attemptResult.stateChanges ?? {},
      };
    }

    return {
      success: true,
      errorCode: null,
      errorMessage: null,
      stateChanges: {
        ...(attemptResult.stateChanges ?? {}),
        equippedItem: normalizedItem,
      },
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'equip_item attempt threw';
    return {
      success: false,
      errorCode: hasUnsafeReason(reason) ? 'unsafe' : 'route_blocked',
      errorMessage: compactReason(reason, 'equip_item attempt failed unexpectedly'),
      stateChanges: {},
    };
  }
}
