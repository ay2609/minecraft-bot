import type { ActionItem } from '../../types';
import type { ExecutorRunContext, SkillExecutionOutcome } from '../types';

interface AttemptResult {
  success?: boolean;
  unsafe?: boolean;
  targetMissing?: boolean;
  blocked?: boolean;
  reason?: string;
  stateChanges?: SkillExecutionOutcome['stateChanges'];
}

type AttemptFn = () => Promise<AttemptResult> | AttemptResult;

function compactReason(reason: string | undefined, fallback: string): string {
  if (!reason || reason.trim().length === 0) {
    return fallback;
  }

  return reason.trim().slice(0, 120);
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseAttempt(params: ActionItem['params']): AttemptFn | null {
  const attempt = params['attempt'];
  return typeof attempt === 'function' ? (attempt as AttemptFn) : null;
}

function hasUnsafeReason(reason: string | undefined): boolean {
  return typeof reason === 'string' && /(unsafe|hazard|lava|fall\s*risk)/i.test(reason);
}

export async function executeInteractBlock(
  actionItem: ActionItem,
  context: ExecutorRunContext,
): Promise<SkillExecutionOutcome> {
  void context;

  const x = toFiniteNumber(actionItem.params['x']);
  const y = toFiniteNumber(actionItem.params['y']);
  const z = toFiniteNumber(actionItem.params['z']);
  if (x === null || y === null || z === null) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'interact_block requires numeric x/y/z params',
      stateChanges: {},
    };
  }

  try {
    const attempt = parseAttempt(actionItem.params);
    const result = attempt ? await attempt() : { success: true };
    if (result.success) {
      return {
        success: true,
        errorCode: null,
        errorMessage: null,
        stateChanges: result.stateChanges ?? {},
      };
    }

    if (result.targetMissing) {
      return {
        success: false,
        errorCode: 'target_unavailable',
        errorMessage: compactReason(result.reason, 'interaction target unavailable'),
        stateChanges: result.stateChanges ?? {},
      };
    }

    if (result.unsafe || hasUnsafeReason(result.reason)) {
      return {
        success: false,
        errorCode: 'unsafe',
        errorMessage: compactReason(result.reason, 'interaction blocked by unsafe world conditions'),
        stateChanges: result.stateChanges ?? {},
      };
    }

    return {
      success: false,
      errorCode: result.blocked ? 'route_blocked' : 'invalid_state',
      errorMessage: compactReason(result.reason, 'block interaction failed'),
      stateChanges: result.stateChanges ?? {},
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'interact_block attempt threw';
    return {
      success: false,
      errorCode: hasUnsafeReason(reason) ? 'unsafe' : 'route_blocked',
      errorMessage: compactReason(reason, 'interact_block attempt failed unexpectedly'),
      stateChanges: {},
    };
  }
}
