import type { ActionItem } from '../../types';
import type { ExecutorRunContext, SkillExecutionOutcome } from '../types';

export async function executeWait(
  actionItem: ActionItem,
  _context: ExecutorRunContext,
): Promise<SkillExecutionOutcome> {
  const durationMs = Math.max(0, (actionItem.expectedDurationSeconds ?? 5) * 1000);
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
  return {
    success: true,
    errorCode: null,
    errorMessage: null,
    stateChanges: {},
  };
}
