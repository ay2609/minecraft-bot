import type { ActionItem } from '../../types';
import type { ExecutorRunContext, SkillExecutionOutcome } from '../types';

interface AttemptResult {
  success?: boolean;
  unsafe?: boolean;
  blocked?: boolean;
  targetMissing?: boolean;
  reason?: string;
  stateChanges?: SkillExecutionOutcome['stateChanges'];
}

type AttemptFn = () => Promise<AttemptResult> | AttemptResult;

function hasHazardSignal(reason: string | undefined): boolean {
  return typeof reason === 'string' && /(unsafe|hazard|lava|fall\s*risk)/i.test(reason);
}

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

function mapFailure(result: AttemptResult): SkillExecutionOutcome {
  if (result.targetMissing) {
    return {
      success: false,
      errorCode: 'target_unavailable',
      errorMessage: compactReason(result.reason, 'break target unavailable'),
      stateChanges: result.stateChanges ?? {},
    };
  }

  if (result.unsafe || hasHazardSignal(result.reason)) {
    return {
      success: false,
      errorCode: 'unsafe',
      errorMessage: compactReason(result.reason, 'break blocked by unsafe world conditions'),
      stateChanges: result.stateChanges ?? {},
    };
  }

  if (result.blocked) {
    return {
      success: false,
      errorCode: 'route_blocked',
      errorMessage: compactReason(result.reason, 'break attempt was blocked'),
      stateChanges: result.stateChanges ?? {},
    };
  }

  return {
    success: false,
    errorCode: 'invalid_state',
    errorMessage: compactReason(result.reason, 'break attempt failed'),
    stateChanges: result.stateChanges ?? {},
  };
}

export async function executeBreakBlock(
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
      errorMessage: 'break_block requires numeric x/y/z params',
      stateChanges: {},
    };
  }

  try {
    const attempt = parseAttempt(actionItem.params);
    const attemptResult = attempt ? await attempt() : { success: true };
    if (!attemptResult.success) {
      return mapFailure(attemptResult);
    }

    return {
      success: true,
      errorCode: null,
      errorMessage: null,
      stateChanges: attemptResult.stateChanges ?? {},
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'break_block attempt threw';
    return {
      success: false,
      errorCode: hasHazardSignal(reason) ? 'unsafe' : 'route_blocked',
      errorMessage: compactReason(reason, 'break_block attempt failed unexpectedly'),
      stateChanges: {},
    };
  }
}
