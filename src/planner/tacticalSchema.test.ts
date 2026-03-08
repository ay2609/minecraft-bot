import assert from 'assert';
import { TacticalOutputSchema } from './tacticalSchema';

const VALID_ACTION = { skill: 'move_to', params: { x: 0 }, expectedDurationSeconds: 5 };

const VALID_OUTPUT = {
  reasoning: 'Moving to target',
  queueOps: [],
  finalQueue: [VALID_ACTION],
  subgoalComplete: false,
  escalate: false,
  escalateReason: null,
};

function run(): void {
  // Test 1: valid object passes safeParse
  {
    const result = TacticalOutputSchema.safeParse(VALID_OUTPUT);
    assert.strictEqual(result.success, true, 'Expected valid object to pass safeParse');
  }

  // Test 2: missing finalQueue field returns success=false with path in issues
  {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { finalQueue: _omitted, ...withoutFinalQueue } = VALID_OUTPUT;
    const result = TacticalOutputSchema.safeParse(withoutFinalQueue);
    assert.strictEqual(result.success, false, 'Expected object missing finalQueue to fail safeParse');
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      assert.ok(paths.some((p) => p === 'finalQueue'), `Expected 'finalQueue' in issue paths, got: ${paths.join(', ')}`);
    }
  }

  // Test 3: invalid queueOp 'op' value returns success=false
  {
    const withBadOp = {
      ...VALID_OUTPUT,
      queueOps: [{ op: 'fly', action: VALID_ACTION }],
    };
    const result = TacticalOutputSchema.safeParse(withBadOp);
    assert.strictEqual(result.success, false, 'Expected invalid queueOp op value to fail safeParse');
  }

  console.log('tacticalSchema: all tests passed');
}

try {
  run();
} catch (err: unknown) {
  console.error('Test failed:', err);
  process.exit(1);
}
