import { executeAction } from './Executor';
import type { ActionItem, CoreSkillName } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createAction(skill: CoreSkillName, params: Record<string, unknown>): ActionItem {
  return {
    skill,
    params,
    expectedDurationSeconds: 2,
  };
}

async function testPlaceBlockUnsafeIsAttemptDerived(): Promise<void> {
  let attempts = 0;
  const action = createAction('place_block', {
    x: 10,
    y: 65,
    z: 10,
    blockName: 'cobblestone',
    attempt: async () => {
      attempts += 1;
      return {
        success: false,
        reason: 'lava hazard next to target face',
      };
    },
  });

  const result = await executeAction(action);

  assert(attempts === 1, `Expected place_block to attempt execution once, got ${attempts}`);
  assert(result.success === false, 'Expected unsafe place attempt to fail');
  assert(result.errorCode === 'unsafe', `Expected unsafe code, got ${result.errorCode}`);
}

async function testBreakBlockHardInvalidRejectsBeforeAttempt(): Promise<void> {
  let attempts = 0;
  const action = createAction('break_block', {
    x: 'bad',
    y: 64,
    z: 8,
    attempt: async () => {
      attempts += 1;
      return { success: true };
    },
  });

  const result = await executeAction(action);
  assert(attempts === 0, `Hard-invalid break_block params should not attempt execution, got ${attempts}`);
  assert(result.success === false, 'Invalid break_block request should fail');
  assert(result.errorCode === 'invalid_state', `Expected invalid_state, got ${result.errorCode}`);
}

async function testAttackEntityTargetUnavailableFromAttemptSignal(): Promise<void> {
  let attempts = 0;
  const action = createAction('attack_entity', {
    targetId: 'zombie-1',
    attempt: async () => {
      attempts += 1;
      return {
        success: false,
        targetMissing: true,
        reason: 'entity missing at attack tick',
      };
    },
  });

  const result = await executeAction(action);
  assert(attempts === 1, `Expected attack_entity attempt, got ${attempts}`);
  assert(result.success === false, 'Expected missing target to fail');
  assert(result.errorCode === 'target_unavailable', `Expected target_unavailable, got ${result.errorCode}`);
}

async function testSendChatUsesAttemptOutcomeInsteadOfGlobalRiskGate(): Promise<void> {
  let attempts = 0;
  const action = createAction('send_chat', {
    message: 'hello world',
    safetyClass: 'risky',
    attempt: async () => {
      attempts += 1;
      return {
        success: true,
      };
    },
  });

  const result = await executeAction(action);
  assert(attempts === 1, `Expected send_chat to attempt once, got ${attempts}`);
  assert(result.success === true, 'Expected send_chat to succeed from attempt signal');
  assert(result.errorCode === null, 'Expected successful chat to have null errorCode');
}

async function run(): Promise<void> {
  await testPlaceBlockUnsafeIsAttemptDerived();
  await testBreakBlockHardInvalidRejectsBeforeAttempt();
  await testAttackEntityTargetUnavailableFromAttemptSignal();
  await testSendChatUsesAttemptOutcomeInsteadOfGlobalRiskGate();
}

void run();
