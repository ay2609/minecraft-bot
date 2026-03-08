import assert from 'assert';
import { StrategicOutputSchema, ChatDecisionSchema } from './strategicSchema';

const VALID_SUBGOAL = {
  id: 'sg-1',
  description: 'Gather 8 oak logs',
  requiredItems: { oak_log: 8 },
  expectedOutcome: 'inventory has 8 oak_log',
  maxAttempts: 3,
  timeoutSeconds: 120,
};

const VALID_PLAN = {
  goal: 'Gather wood for crafting',
  goalRationale: 'No tools available — must start with wood',
  priority: 'progression' as const,
  subgoals: [VALID_SUBGOAL],
  successConditions: ['inventory has 8 oak_log'],
  abortConditions: ['health drops below 4'],
  estimatedComplexity: 'low' as const,
  allowedSkills: ['move_to', 'break_block'],
};

const VALID_OUTPUT = {
  reasoning: 'Bot is stable and has no tools. Begin progression.',
  triggerCause: 'periodic',
  plan: VALID_PLAN,
  chatDecision: null,
};

function run(): void {
  // Test 1: valid StrategicOutput with chatDecision: null passes safeParse
  {
    const result = StrategicOutputSchema.safeParse(VALID_OUTPUT);
    assert.strictEqual(result.success, true, `Expected valid output to pass safeParse. Errors: ${!result.success ? JSON.stringify(result.error.issues) : 'none'}`);
  }

  // Test 2: plan with subgoals: [] (empty array) fails safeParse
  {
    const withEmptySubgoals = {
      ...VALID_OUTPUT,
      plan: { ...VALID_PLAN, subgoals: [] },
    };
    const result = StrategicOutputSchema.safeParse(withEmptySubgoals);
    assert.strictEqual(result.success, false, 'Expected empty subgoals array to fail safeParse');
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      assert.ok(
        paths.some((p) => p.includes('subgoal')),
        `Expected 'subgoals' in issue paths, got: ${paths.join(', ')}`,
      );
    }
  }

  // Test 3: plan with abortConditions: [] (empty array) fails safeParse
  {
    const withEmptyAbort = {
      ...VALID_OUTPUT,
      plan: { ...VALID_PLAN, abortConditions: [] },
    };
    const result = StrategicOutputSchema.safeParse(withEmptyAbort);
    assert.strictEqual(result.success, false, 'Expected empty abortConditions array to fail safeParse');
  }

  // Test 4: plan with successConditions: [] fails safeParse
  {
    const withEmptySuccess = {
      ...VALID_OUTPUT,
      plan: { ...VALID_PLAN, successConditions: [] },
    };
    const result = StrategicOutputSchema.safeParse(withEmptySuccess);
    assert.strictEqual(result.success, false, 'Expected empty successConditions array to fail safeParse');
  }

  // Test 5: valid priority enum value passes; invalid string fails
  {
    const validPriority = {
      ...VALID_OUTPUT,
      plan: { ...VALID_PLAN, priority: 'survival' },
    };
    const resultValid = StrategicOutputSchema.safeParse(validPriority);
    assert.strictEqual(resultValid.success, true, 'Expected valid priority enum to pass safeParse');

    const invalidPriority = {
      ...VALID_OUTPUT,
      plan: { ...VALID_PLAN, priority: 'attack' },
    };
    const resultInvalid = StrategicOutputSchema.safeParse(invalidPriority);
    assert.strictEqual(resultInvalid.success, false, 'Expected invalid priority string to fail safeParse');
  }

  // Test 6: chatDecision with decision: 'switch' and responseMessage: null passes
  {
    const withChatDecision = {
      ...VALID_OUTPUT,
      chatDecision: {
        requestSummary: 'User asked bot to go mining',
        decision: 'switch',
        responseMessage: null,
      },
    };
    const result = StrategicOutputSchema.safeParse(withChatDecision);
    assert.strictEqual(result.success, true, `Expected chatDecision with switch to pass safeParse. Errors: ${result.success ? 'none' : JSON.stringify((result as { success: false; error: { issues: unknown[] } }).error.issues)}`);
  }

  // Test 7: chatDecision with missing 'decision' field fails
  {
    const withBadChatDecision = {
      ...VALID_OUTPUT,
      chatDecision: {
        requestSummary: 'User asked bot to go mining',
        // missing decision field
        responseMessage: null,
      },
    };
    const result = StrategicOutputSchema.safeParse(withBadChatDecision);
    assert.strictEqual(result.success, false, 'Expected chatDecision missing decision field to fail safeParse');
  }

  // Test 8: ChatDecisionSchema standalone — 'defer' decision with responseMessage string passes
  {
    const deferDecision = {
      requestSummary: 'User asked about inventory',
      decision: 'defer',
      responseMessage: 'I will check my inventory later.',
    };
    const result = ChatDecisionSchema.safeParse(deferDecision);
    assert.strictEqual(result.success, true, 'Expected defer decision with responseMessage to pass ChatDecisionSchema');
  }

  console.log('strategicSchema: all tests passed');
}

try {
  run();
} catch (err: unknown) {
  console.error('Test failed:', err);
  process.exit(1);
}
