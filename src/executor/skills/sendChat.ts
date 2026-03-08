import type { ActionItem } from '../../types';
import type { ExecutorRunContext, SkillExecutionOutcome } from '../types';

interface AttemptResult {
  success?: boolean;
  unsafe?: boolean;
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

function hasUnsafeReason(reason: string | undefined): boolean {
  return typeof reason === 'string' && /(unsafe|hazard|moderation|policy)/i.test(reason);
}

function parseAttempt(params: ActionItem['params']): AttemptFn | null {
  const attempt = params['attempt'];
  return typeof attempt === 'function' ? (attempt as AttemptFn) : null;
}

export async function executeSendChat(
  actionItem: ActionItem,
  context: ExecutorRunContext,
): Promise<SkillExecutionOutcome> {
  void context;

  const message = actionItem.params['message'];
  if (typeof message !== 'string' || message.trim().length === 0) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'send_chat requires a non-empty message',
      stateChanges: {},
    };
  }

  if (message.length > 256) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'send_chat message exceeds 256 character limit',
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

    if (result.unsafe || hasUnsafeReason(result.reason)) {
      return {
        success: false,
        errorCode: 'unsafe',
        errorMessage: compactReason(result.reason, 'chat attempt blocked by safety policy'),
        stateChanges: result.stateChanges ?? {},
      };
    }

    return {
      success: false,
      errorCode: result.blocked ? 'route_blocked' : 'invalid_state',
      errorMessage: compactReason(result.reason, 'chat attempt failed'),
      stateChanges: result.stateChanges ?? {},
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'send_chat attempt threw';
    return {
      success: false,
      errorCode: hasUnsafeReason(reason) ? 'unsafe' : 'route_blocked',
      errorMessage: compactReason(reason, 'send_chat attempt failed unexpectedly'),
      stateChanges: {},
    };
  }
}
