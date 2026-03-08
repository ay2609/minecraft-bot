import type { ActionItem, ExecutorErrorCode, ExecutorResult } from '../types';

export interface SkillExecutionOutcome {
  success: boolean;
  errorCode: ExecutorErrorCode | null;
  errorMessage: string | null;
  stateChanges: ExecutorResult['stateChanges'];
  movement?: {
    outcome: 'executed' | 'queued' | 'preempted' | 'interrupted' | 'dropped' | 'timed_out';
    details?: string;
  };
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

export type MovementIntent = 'normal' | 'critical';

export interface MovementRequest {
  actionItem: ActionItem;
  timeoutMs: number;
  intent: MovementIntent;
  execute: (signal: AbortSignal) => Promise<SkillExecutionOutcome>;
}
