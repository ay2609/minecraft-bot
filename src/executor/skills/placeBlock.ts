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
  if (!reason) {
    return false;
  }

  return /(unsafe|hazard|lava|fall\s*risk)/i.test(reason);
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

function mapFailure(result: AttemptResult): SkillExecutionOutcome {
  if (result.targetMissing) {
    return {
      success: false,
      errorCode: 'target_unavailable',
      errorMessage: compactReason(result.reason, 'placement target unavailable'),
      stateChanges: result.stateChanges ?? {},
    };
  }

  if (result.unsafe || hasHazardSignal(result.reason)) {
    return {
      success: false,
      errorCode: 'unsafe',
      errorMessage: compactReason(result.reason, 'placement blocked by unsafe world conditions'),
      stateChanges: result.stateChanges ?? {},
    };
  }

  if (result.blocked) {
    return {
      success: false,
      errorCode: 'route_blocked',
      errorMessage: compactReason(result.reason, 'placement attempt was blocked'),
      stateChanges: result.stateChanges ?? {},
    };
  }

  return {
    success: false,
    errorCode: 'invalid_state',
    errorMessage: compactReason(result.reason, 'placement attempt failed'),
    stateChanges: result.stateChanges ?? {},
  };
}

export async function executePlaceBlock(
  actionItem: ActionItem,
  context: ExecutorRunContext,
): Promise<SkillExecutionOutcome> {
  void context;

  const x = toFiniteNumber(actionItem.params['x']);
  const y = toFiniteNumber(actionItem.params['y']);
  const z = toFiniteNumber(actionItem.params['z']);
  const blockName = actionItem.params['blockName'];
  if (x === null || y === null || z === null || typeof blockName !== 'string' || blockName.trim().length === 0) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'place_block requires numeric x/y/z and non-empty blockName',
      stateChanges: {},
    };
  }

  try {
    const attempt = parseAttempt(actionItem.params);
    const attemptResult = attempt ? await attempt() : { success: true };
    if (!attemptResult.success) {
      return mapFailure(attemptResult);
    }

    const postOk = await evaluatePostCondition(actionItem.params);
    if (!postOk) {
      const postReason = typeof actionItem.params['postReason'] === 'string'
        ? actionItem.params['postReason']
        : 'placement post-condition failed';

      return hasHazardSignal(postReason)
        ? {
          success: false,
          errorCode: 'unsafe',
          errorMessage: compactReason(postReason, 'placement blocked by unsafe world conditions'),
          stateChanges: attemptResult.stateChanges ?? {},
        }
        : {
          success: false,
          errorCode: 'route_blocked',
          errorMessage: compactReason(postReason, 'placement did not persist after attempt'),
          stateChanges: attemptResult.stateChanges ?? {},
        };
    }

    return {
      success: true,
      errorCode: null,
      errorMessage: null,
      stateChanges: attemptResult.stateChanges ?? {},
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'place_block attempt threw';
    return {
      success: false,
      errorCode: hasHazardSignal(reason) ? 'unsafe' : 'route_blocked',
      errorMessage: compactReason(reason, 'place_block attempt failed unexpectedly'),
      stateChanges: {},
    };
  }
}
