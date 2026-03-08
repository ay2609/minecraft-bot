import { TypedEventBus } from '../events/EventBus';
import {
  createPlannerMemoryRetriever,
  type PlannerEpisodicMemorySource,
  type PlannerSemanticMemorySource,
} from '../memory';
import { ContextAssembler } from './ContextAssembler';
import type { PlannerContextInput } from './types';
import type { PerceptionSnapshot } from '../types/index';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createSnapshot(now: number): PerceptionSnapshot {
  return {
    timestamp: now,
    position: { x: 16, y: 64, z: 16 },
    yaw: 0,
    health: 20,
    food: 20,
    armorPoints: 0,
    gameMode: 'survival',
    isOnGround: true,
    inventory: { oak_log: 12 },
    equippedItem: 'stone_axe',
    emptySlots: 30,
    biome: 'forest',
    timeOfDay: 7000,
    weather: 'clear',
    nearbyEntities: [{ name: 'cow', distance: 6, isHostile: false }],
    nearbyBlocks: [{ name: 'oak_log', position: { x: 18, y: 64, z: 15 }, distance: 2 }],
    lightLevel: 14,
    currentAction: 'gather',
    recentFailures: [],
  };
}

function createAssemblerInput(
  retrieveMemory: PlannerContextInput['retrieveMemory'],
): PlannerContextInput {
  return {
    snapshot: createSnapshot(1_000),
    intent: {
      activeGoal: 'collect oak logs',
      activeSubgoalId: 'sg-collect',
      inFlightSkill: 'gather',
    },
    retrieveMemory,
  };
}

function createMemoryStub(): {
  semantic: PlannerSemanticMemorySource;
  episodic: PlannerEpisodicMemorySource;
} {
  return {
    semantic: {
      findNearby: () => [
        {
          id: 1,
          name: 'oak_forest',
          x: 20,
          y: 64,
          z: 24,
          dimension: 'overworld',
          confidence: 0.91,
          lastSeenAt: '2026-03-07T10:15:00.000Z',
          distance: 9,
        },
        {
          id: 2,
          name: 'home_base',
          x: 5,
          y: 64,
          z: 4,
          dimension: 'overworld',
          confidence: 0.88,
          lastSeenAt: '2026-03-07T09:45:00.000Z',
          distance: 16,
        },
      ],
    },
    episodic: {
      listByGoal: (goal: string) => [
        {
          id: 10,
          goal,
          action: 'gather',
          outcome: 'success',
          failureReason: null,
          context: { raw: true },
          createdAt: '2026-03-07T10:20:00.000Z',
        },
      ],
      listFailures: () => [
        {
          id: 9,
          goal: 'collect oak logs',
          action: 'move_to',
          outcome: 'failure',
          failureReason: 'no_path',
          context: { raw: true },
          createdAt: '2026-03-07T10:22:00.000Z',
        },
      ],
      listRecent: () => [],
    },
  };
}

async function testPlannerContextBoundaryEventIsEmitted(): Promise<void> {
  const bus = new TypedEventBus();
  const assembler = new ContextAssembler({ memoryTimeoutMs: 50, maxChars: 4_000 });
  const retrieveMemory = createPlannerMemoryRetriever(createMemoryStub(), {
    semanticLimit: 4,
    episodicLimit: 4,
  });

  let receivedCount = 0;
  let receivedGoal: string | null = null;
  bus.on('planner:context-ready', (payload) => {
    receivedCount += 1;
    receivedGoal = payload.intent.activeGoal;
  });

  const bundle = await assembler.assembleAndPublishPlannerContext(createAssemblerInput(() => retrieveMemory({
    position: { x: 16, y: 64, z: 16 },
    activeGoal: 'collect oak logs',
  })), bus);

  assert(receivedCount === 1, `Expected mandatory planner:context-ready boundary event once, got ${receivedCount}`);
  assert(
    receivedGoal === 'collect oak logs',
    'Expected goal to survive context boundary',
  );
  assert(bundle.memory.semantic.length > 0, 'Expected semantic memory attachment in bundle');
  assert(bundle.memory.episodic.length > 0, 'Expected episodic memory attachment in bundle');
  const serialized = JSON.stringify(bundle.memory);
  assert(!serialized.includes('"id"'), 'Expected no raw repository ids in planner context');
  assert(!serialized.includes('"context"'), 'Expected no raw episodic context dump in planner context');
}

async function testMemoryQueryUsesGoalAndProximityRelevance(): Promise<void> {
  const retrieveMemory = createPlannerMemoryRetriever(createMemoryStub(), {
    semanticLimit: 2,
    episodicLimit: 2,
  });

  const memory = await retrieveMemory({
    position: { x: 16, y: 64, z: 16 },
    activeGoal: 'collect oak logs',
  });

  assert(memory.semantic.length === 2, `Expected semantic limit to apply, got ${memory.semantic.length}`);
  assert(memory.semantic[0]?.label === 'oak_forest', 'Expected goal-relevant semantic entry to rank first');
  assert(memory.episodic[0]?.failureReason === 'no_path', 'Expected recent failure to stay in episodic slice');
}

async function testSlowMemoryDoesNotBlockContextAssemblyCadence(): Promise<void> {
  const bus = new TypedEventBus();
  const assembler = new ContextAssembler({
    memoryTimeoutMs: 10,
    maxChars: 4_000,
  });

  const warmMemory = async () => {
    await Promise.resolve();
    return {
      semantic: [
        {
          label: 'oak_forest',
          position: { x: 20, y: 64, z: 24 },
          distance: 9,
          confidence: 0.91,
          lastSeenAt: '2026-03-07T10:15:00.000Z',
        },
      ],
      episodic: [
        {
          goal: 'collect oak logs',
          action: 'gather',
          outcome: 'success' as const,
          failureReason: null,
          createdAt: '2026-03-07T10:20:00.000Z',
        },
      ],
    };
  };

  await assembler.assembleAndPublishPlannerContext(createAssemblerInput(warmMemory), bus);

  const startedAt = Date.now();
  const bundle = await assembler.assembleAndPublishPlannerContext(
    createAssemblerInput(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return warmMemory();
    }),
    bus,
  );
  const elapsedMs = Date.now() - startedAt;

  assert(elapsedMs < 40, `Expected non-blocking assembly under slow memory, took ${elapsedMs}ms`);
  assert(bundle.meta.memoryTimedOut, 'Expected timeout metadata when memory backend is slow');
  assert(
    bundle.meta.memorySource === 'stale-cache',
    `Expected stale-cache fallback source, got ${bundle.meta.memorySource}`,
  );
}

async function testAssembleFromLatestSnapshotPublishesPlannerBoundary(): Promise<void> {
  const bus = new TypedEventBus();
  const assembler = new ContextAssembler({ memoryTimeoutMs: 30, maxChars: 4_000 });
  let boundaryEvents = 0;

  bus.on('planner:context-ready', () => {
    boundaryEvents += 1;
  });

  const bundle = await assembler.assembleFromLatestSnapshot({
    getLatestSnapshot: () => createSnapshot(2_000),
    intent: {
      activeGoal: 'collect oak logs',
      activeSubgoalId: 'sg-collect',
      inFlightSkill: 'gather',
    },
    retrieveMemory: async () => ({
      semantic: [],
      episodic: [],
    }),
    events: bus,
  });

  assert(bundle !== null, 'Expected assembled context from latest snapshot');
  assert(boundaryEvents === 1, `Expected planner boundary event once, got ${boundaryEvents}`);
}

async function run(): Promise<void> {
  await testPlannerContextBoundaryEventIsEmitted();
  await testMemoryQueryUsesGoalAndProximityRelevance();
  await testSlowMemoryDoesNotBlockContextAssemblyCadence();
  await testAssembleFromLatestSnapshotPublishesPlannerBoundary();
  console.log('Perception planner-context integration: PASS');
}

void run();
