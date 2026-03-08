import type { ActionItem, ExecutorErrorCode, ExecutorResult } from '../types';

export interface SkillExecutionOutcome {
  success: boolean;
  errorCode: ExecutorErrorCode | null;
  errorMessage: string | null;
  stateChanges: ExecutorResult['stateChanges'];
}

export interface ExecutorRunContext {
  attempt: number;
  startedAtMs: number;
}

export type SkillHandler = (
  actionItem: ActionItem,
  context: ExecutorRunContext,
) => Promise<SkillExecutionOutcome>;

export interface FailureMapping {
  errorCode: ExecutorErrorCode;
  errorMessage: string;
}

export interface ExecutorDependencies {
  resolveSkill?: (skill: string) => SkillHandler | null;
  mapFailure?: (error: unknown, actionItem: ActionItem) => FailureMapping;
  timeoutMsForSkill?: (skill: string, actionItem: ActionItem) => number;
  eventBus?: {
    emit: (event: 'executor:result', result: ExecutorResult) => boolean;
  };
  now?: () => number;
}
