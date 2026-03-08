import { executeAction } from './Executor';
import type { ActionItem } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function testNoAutomaticRetryByDefault(): Promise<void> {
  let callCount = 0;
  const action: ActionItem = {
    skill: 'move_to',
    params: {},
    expectedDurationSeconds: 1,
  };

  const result = await executeAction(action, {
    resolveSkill: () => async () => {
      callCount += 1;
      return {
        success: false,
        errorCode: 'route_blocked',
        errorMessage: 'blocked',
        stateChanges: {},
      };
    },
  });

  assert(callCount === 1, `Expected one attempt only, got ${callCount}`);
  assert(result.success === false, 'Expected failed single-attempt result');
  assert(result.errorCode === 'route_blocked', `Expected route_blocked, got ${result.errorCode}`);
}

void testNoAutomaticRetryByDefault();
