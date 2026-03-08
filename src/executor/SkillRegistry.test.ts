import { requiredSkillNames, resolveSkill } from './SkillRegistry';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testAllRequiredSkillsResolvable(): void {
  assert(requiredSkillNames.length === 10, `Expected 10 required skills, got ${requiredSkillNames.length}`);

  for (const skill of requiredSkillNames) {
    const handler = resolveSkill(skill);
    assert(typeof handler === 'function', `Skill ${skill} is not registered`);
  }
}

function testUnknownSkillReturnsNull(): void {
  const handler = resolveSkill('unknown_skill');
  assert(handler === null, 'Unknown skill lookup must return null');
}

testAllRequiredSkillsResolvable();
testUnknownSkillReturnsNull();
