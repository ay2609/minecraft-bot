import { executeAction } from './Executor';
import type { ActionItem } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function testUnknownSkillReturnsInvalidState(): Promise<void> {
  const action: ActionItem = {
    skill: 'missing_skill',
    params: {},
    expectedDurationSeconds: 1,
  };

  const result = await executeAction(action, {
    resolveSkill: () => null,
  });

  assert(result.success === false, 'Expected unknown skill to fail');
  assert(result.errorCode === 'invalid_state', 'Expected invalid_state for unknown skill');
  assert(result.durationMs >= 0, 'Expected durationMs to be non-negative');
}

async function testThrowingSkillNormalizesFailure(): Promise<void> {
  const action: ActionItem = {
    skill: 'move_to',
    params: {},
    expectedDurationSeconds: 1,
  };

  const result = await executeAction(action, {
    resolveSkill: () => () => Promise.reject(new Error('boom')),
    mapFailure: () => ({
      errorCode: 'route_blocked',
      errorMessage: 'mapped failure',
    }),
  });

  assert(result.success === false, 'Expected throw to normalize to failure result');
  assert(result.errorCode === 'route_blocked', 'Expected mapped error code');
  assert(result.errorMessage === 'mapped failure', 'Expected mapped message');
}

async function testTimeoutProducesTimedOutCode(): Promise<void> {
  const action: ActionItem = {
    skill: 'move_to',
    params: {},
    expectedDurationSeconds: 1,
  };

  const result = await executeAction(action, {
    resolveSkill: () => async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        success: true,
        errorCode: null,
        errorMessage: null,
        stateChanges: {},
      };
    },
    timeoutMsForSkill: () => 5,
  });

  assert(result.success === false, 'Expected timeout to fail');
  assert(result.errorCode === 'timed_out', 'Expected timed_out code');
}

async function run(): Promise<void> {
  await testUnknownSkillReturnsInvalidState();
  await testThrowingSkillNormalizesFailure();
  await testTimeoutProducesTimedOutCode();
}

void run();
