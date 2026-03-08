import { executeAction } from './Executor';
import type { ActionItem, ExecutorResult } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertResultInvariant(result: ExecutorResult): void {
  if (result.success) {
    assert(result.errorCode === null, 'Successful result must have null errorCode');
    assert(result.errorMessage === null, 'Successful result must have null errorMessage');
  } else {
    assert(result.errorCode !== null, 'Failed result must have non-null errorCode');
    assert(typeof result.errorMessage === 'string', 'Failed result must include errorMessage');
  }

  assert(Number.isFinite(result.durationMs) && result.durationMs >= 0, 'durationMs must be non-negative');
}

async function testExecutorNeverThrowsAcrossFailurePaths(): Promise<void> {
  const failureAction: ActionItem = {
    skill: 'move_to',
    params: {},
    expectedDurationSeconds: 1,
  };

  const throwingResult = await executeAction(failureAction, {
    resolveSkill: () => () => Promise.reject(new Error('NoPath')),
  });
  assertResultInvariant(throwingResult);

  const timedOutResult = await executeAction(failureAction, {
    resolveSkill: () => () => new Promise((resolve) => setTimeout(() => resolve({
      success: true,
      errorCode: null,
      errorMessage: null,
      stateChanges: {},
    }), 25)),
    timeoutMsForSkill: () => 5,
  });
  assertResultInvariant(timedOutResult);
  assert(timedOutResult.errorCode === 'timed_out', 'Expected timed_out for timeout path');

  const malformedResult = await executeAction({ skill: '', params: {}, expectedDurationSeconds: 0 } as ActionItem);
  assertResultInvariant(malformedResult);
  assert(malformedResult.errorCode === 'invalid_state', 'Malformed action should map to invalid_state');
}

async function testUnknownSkillStructuredInvalidState(): Promise<void> {
  const unknownAction: ActionItem = {
    skill: 'totally_unknown',
    params: {},
    expectedDurationSeconds: 1,
  };

  const result = await executeAction(unknownAction);
  assertResultInvariant(result);
  assert(result.errorCode === 'invalid_state', 'Unknown skill should map to invalid_state');
  assert(result.errorMessage === 'Unknown skill request', 'Unknown skill message must remain compact and generic');
}

async function run(): Promise<void> {
  await testExecutorNeverThrowsAcrossFailurePaths();
  await testUnknownSkillStructuredInvalidState();
}

void run();
