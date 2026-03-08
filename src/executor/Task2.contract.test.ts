import { requiredSkillNames, resolveSkill } from './SkillRegistry';
import { mapExecutorFailure } from './failureMapping';
import type { ActionItem } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testRequiredSkillsResolve(): void {
  assert(requiredSkillNames.length === 10, `Expected 10 required skills, got ${requiredSkillNames.length}`);
  for (const skill of requiredSkillNames) {
    const handler = resolveSkill(skill);
    assert(typeof handler === 'function', `Expected handler for ${skill}`);
  }
}

function testUnknownSkillLookupReturnsNull(): void {
  const missing = resolveSkill('unknown_skill');
  assert(missing === null, 'Expected unknown skills to resolve as null');
}

function testFailureMappingTimeoutPrecedence(): void {
  const mapped = mapExecutorFailure(new Error('NoPath Timeout'));
  assert(mapped.errorCode === 'timed_out', `Expected timed_out precedence, got ${mapped.errorCode}`);
}

function testFailureMappingNoPath(): void {
  const mapped = mapExecutorFailure(new Error('NoPath while resolving route'));
  assert(mapped.errorCode === 'no_path', `Expected no_path, got ${mapped.errorCode}`);
}

function testFailureMappingUnsafePrecedenceOverBlockedSignals(): void {
  const actionItem: ActionItem = {
    skill: 'place_block',
    params: {
      failureSignals: ['route_blocked', 'unsafe'],
    },
    expectedDurationSeconds: 1,
  };
  const mapped = mapExecutorFailure({ blocked: true, message: 'blocked by lava hazard' }, actionItem);
  assert(mapped.errorCode === 'unsafe', `Expected unsafe precedence over blocked, got ${mapped.errorCode}`);
}

function testFailureMappingTimeoutBeatsUnsafe(): void {
  const mapped = mapExecutorFailure({ timeout: true, unsafe: true, message: 'unsafe and timeout' });
  assert(mapped.errorCode === 'timed_out', `Expected timeout to beat unsafe, got ${mapped.errorCode}`);
}

function testFailureMappingDeterministicAcrossRepeatedCalls(): void {
  const sampleError = { unsafe: true, blocked: true, message: 'lava hazard while blocked' };
  const first = mapExecutorFailure(sampleError);
  const second = mapExecutorFailure(sampleError);
  assert(first.errorCode === second.errorCode, 'Expected deterministic error code for identical failure signal');
  assert(first.errorMessage === second.errorMessage, 'Expected deterministic error message for identical failure signal');
}

testRequiredSkillsResolve();
testUnknownSkillLookupReturnsNull();
testFailureMappingTimeoutPrecedence();
testFailureMappingNoPath();
testFailureMappingUnsafePrecedenceOverBlockedSignals();
testFailureMappingTimeoutBeatsUnsafe();
testFailureMappingDeterministicAcrossRepeatedCalls();
