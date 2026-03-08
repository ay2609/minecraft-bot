import { requiredSkillNames, resolveSkill } from './SkillRegistry';
import { mapExecutorFailure } from './failureMapping';

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

testRequiredSkillsResolve();
testUnknownSkillLookupReturnsNull();
testFailureMappingTimeoutPrecedence();
testFailureMappingNoPath();
