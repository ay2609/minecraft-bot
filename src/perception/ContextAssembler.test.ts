import { ContextAssembler } from './ContextAssembler';
import type {
  MemoryAttachment,
  PlannerContextBundle,
  PlannerContextInput,
} from './types';
import type { PerceptionSnapshot } from '../types/index';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<TValue>(actual: TValue, expected: TValue, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function createSnapshot(timestamp: number): PerceptionSnapshot {
  return {
    timestamp,
    position: { x: 100, y: 64, z: 100 },
    yaw: 90,
    health: 20,
    food: 20,
    armorPoints: 2,
    gameMode: 'survival',
    isOnGround: true,
    inventory: { oak_log: 8, cobblestone: 12 },
    equippedItem: 'stone_pickaxe',
    emptySlots: 30,
    biome: 'plains',
    timeOfDay: 6500,
    weather: 'clear',
    nearbyEntities: [{ name: 'cow', distance: 4, isHostile: false }],
    nearbyBlocks: [{ name: 'oak_log', position: { x: 102, y: 64, z: 98 }, distance: 3 }],
    lightLevel: 14,
    currentAction: 'move_to',
    recentFailures: [],
  };
}

function createMemory(goal: string): MemoryAttachment {
  return {
    semantic: [
      {
        label: 'home_base',
        position: { x: 90, y: 64, z: 90 },
        distance: 14.14,
        confidence: 0.95,
        lastSeenAt: '2026-03-07T10:00:00.000Z',
      },
      {
        label: 'oak_forest',
        position: { x: 140, y: 66, z: 120 },
        distance: 44.72,
        confidence: 0.8,
        lastSeenAt: '2026-03-07T10:05:00.000Z',
      },
    ],
    episodic: [
      {
        goal,
        action: 'move_to',
        outcome: 'failure',
        failureReason: 'no_path',
        createdAt: '2026-03-06T09:00:00.000Z',
      },
      {
        goal,
        action: 'gather',
        outcome: 'success',
        failureReason: null,
        createdAt: '2026-03-07T09:30:00.000Z',
      },
      {
        goal,
        action: 'craft',
        outcome: 'success',
        failureReason: null,
        createdAt: '2026-03-07T09:45:00.000Z',
      },
    ],
  };
}

function createInput(overrides: Partial<PlannerContextInput> = {}): PlannerContextInput {
  const goal = 'collect logs';

  return {
    snapshot: createSnapshot(1000),
    intent: {
      activeGoal: goal,
      activeSubgoalId: 'sg-1',
      inFlightSkill: 'move_to',
    },
    retrieveMemory: async () => createMemory(goal),
    ...overrides,
  };
}

function expectNoRawRepositoryLeak(bundle: PlannerContextBundle): void {
  const serialized = JSON.stringify(bundle.memory);
  assert(!serialized.includes('"id"'), 'Context should not leak repository IDs');
  assert(!serialized.includes('"context"'), 'Context should not leak raw episode context payloads');
}

async function testAssemblesCompactStructuredContext(): Promise<void> {
  const assembler = new ContextAssembler({
    memoryTimeoutMs: 50,
    maxChars: 5000,
    semanticLimit: 6,
    episodicLimit: 6,
  });

  const bundle = await assembler.assemblePlannerContext(createInput());

  assertEqual(bundle.intent.activeGoal, 'collect logs', 'Expected active goal in context');
  assert(bundle.memory.semantic.length === 2, 'Expected semantic memory slice to be included');
  assert(bundle.memory.episodic.length === 3, 'Expected episodic memory slice to be included');
  assertEqual(bundle.meta.memorySource, 'live', 'Expected live memory source for normal path');
  expectNoRawRepositoryLeak(bundle);
}

async function testBudgetDropsOlderEpisodicEntriesFirst(): Promise<void> {
  const assembler = new ContextAssembler({
    memoryTimeoutMs: 50,
    maxChars: 700,
    semanticLimit: 4,
    episodicLimit: 6,
  });

  const bundle = await assembler.assemblePlannerContext(createInput());
  const episodicCreatedAt = bundle.memory.episodic.map((entry) => entry.createdAt);

  assert(bundle.meta.truncation.applied, 'Expected truncation metadata to indicate budget pressure');
  assert(
    !episodicCreatedAt.includes('2026-03-06T09:00:00.000Z'),
    'Expected oldest episodic detail to be dropped first',
  );
  assert(
    episodicCreatedAt.includes('2026-03-07T09:45:00.000Z'),
    'Expected newest episodic detail to be preserved under trimming',
  );
}

async function testTimeoutFallsBackToCachedMemory(): Promise<void> {
  const assembler = new ContextAssembler({
    memoryTimeoutMs: 10,
    maxChars: 5000,
  });

  await assembler.assemblePlannerContext(createInput());

  const delayedBundle = await assembler.assemblePlannerContext(
    createInput({
      retrieveMemory: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return createMemory('collect logs');
      },
    }),
  );

  assertEqual(
    delayedBundle.meta.memorySource,
    'stale-cache',
    'Expected timeout path to reuse cached memory',
  );
  assert(delayedBundle.meta.memoryTimedOut, 'Expected timeout metadata to be true');
}

async function run(): Promise<void> {
  await testAssemblesCompactStructuredContext();
  await testBudgetDropsOlderEpisodicEntriesFirst();
  await testTimeoutFallsBackToCachedMemory();
  console.log('ContextAssembler behavior: PASS');
}

void run();
