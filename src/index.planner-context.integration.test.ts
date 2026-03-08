import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { initializeApplication } from './index';
import { eventBus } from './events/EventBus';
import { FireworksLLMClient } from './planner/FireworksLLMClient';
import { WorkingMemory } from './memory/WorkingMemory';
import type { ActionItem, GoalPlan, PerceptionSnapshot } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSnapshot(): PerceptionSnapshot {
  return {
    timestamp: Date.now(),
    position: { x: 8, y: 64, z: 8 },
    yaw: 0,
    health: 20,
    food: 20,
    armorPoints: 0,
    gameMode: 'survival',
    isOnGround: true,
    inventory: { oak_log: 4 },
    equippedItem: 'stone_axe',
    emptySlots: 30,
    biome: 'plains',
    timeOfDay: 6000,
    weather: 'clear',
    nearbyEntities: [{ name: 'cow', distance: 4, isHostile: false }],
    nearbyBlocks: [{ name: 'oak_log', position: { x: 9, y: 64, z: 8 }, distance: 1 }],
    lightLevel: 14,
    currentAction: 'move_to',
    recentFailures: [],
  };
}

function createPlan(): GoalPlan {
  return {
    goal: 'collect oak logs',
    goalRationale: 'bootstrap crafting chain',
    priority: 'progression',
    subgoals: [
      {
        id: 'sg-collect',
        description: 'move and break one log',
        requiredItems: {},
        expectedOutcome: 'has logs',
        maxAttempts: 1,
        timeoutSeconds: 30,
      },
    ],
    successConditions: ['inventory contains oak_log'],
    abortConditions: ['health critical'],
    estimatedComplexity: 'low',
    allowedSkills: ['move_to', 'break_block'],
  };
}

async function run(): Promise<void> {
  const bot = new EventEmitter() as EventEmitter & {
    username: string;
    version: string;
    entity: { position: { x: number; y: number; z: number } };
    inventory: { items: () => Array<{ name: string; count: number }>; slots: Array<unknown> };
    heldItem: { name: string } | null;
    game: { gameMode: string };
    biome: string;
    time: { timeOfDay: number };
    entities: Record<string, unknown>;
  };
  bot.username = 'planner-test-bot';
  bot.version = '1.21.11';
  bot.entity = { position: { x: 8, y: 64, z: 8 } };
  bot.inventory = { items: () => [{ name: 'oak_log', count: 4 }], slots: new Array(36).fill(null) };
  bot.heldItem = { name: 'stone_axe' };
  bot.game = { gameMode: 'survival' };
  bot.biome = 'plains';
  bot.time = { timeOfDay: 6000 };
  bot.entities = {};

  const workingMemory = new WorkingMemory();
  workingMemory.setPlan(createPlan());
  workingMemory.setActiveSubgoal('sg-collect');
  const perception = {
    start(): void {
      // no-op; test emits perception:updated explicitly
    },
    stop(): void {
      // no-op
    },
  };

  const originalCallDescriptor = Object.getOwnPropertyDescriptor(FireworksLLMClient.prototype, 'call');
  const llmPayloads: Array<Record<string, unknown>> = [];
  FireworksLLMClient.prototype.call = function mockedCall(messages) {
    const userMessage = messages[1];
    const parsed: unknown = typeof userMessage?.content === 'string'
      ? JSON.parse(userMessage.content)
      : {};
    llmPayloads.push(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {});
    return Promise.resolve({
      ok: true as const,
      data: {
        reasoning: 'integration-test',
        queueOps: [],
        finalQueue: [],
        subgoalComplete: false,
        escalate: false,
        escalateReason: null,
      },
    });
  };

  let contextReadyCount = 0;
  const onContextReady = (): void => {
    contextReadyCount += 1;
  };
  eventBus.on('planner:context-ready', onContextReady);

  try {
    const app = initializeApplication({
      configOverride: {
        fireworks: {
          apiKey: 'test-key',
          modelId: 'test-model',
        },
      } as never,
      dependencies: {
        createBot: () => bot as never,
        initializeMemory: () => ({
          database: {} as never,
          semantic: {
            findNearby: () => [
              {
                id: 1,
                name: 'oak_forest',
                x: 20,
                y: 64,
                z: 20,
                dimension: 'overworld',
                confidence: 0.9,
                lastSeenAt: '2026-03-08T00:00:00.000Z',
                distance: 16,
              },
            ],
          } as never,
          episodic: {
            listByGoal: (goal: string) => [
              {
                id: 1,
                goal,
                action: 'break_block',
                outcome: 'success',
                failureReason: null,
                context: null,
                createdAt: '2026-03-08T00:01:00.000Z',
              },
            ],
            listFailures: () => [],
            listRecent: () => [],
          } as never,
          checkpoint: {} as never,
          restore: {} as never,
          workingMemory,
          close: () => {
            // no-op
          },
        }),
        createPerceptionService: () => perception as never,
      },
    });

    bot.emit('spawn');
    eventBus.emit('perception:updated', createSnapshot());
    await sleep(10);

    assert.ok(contextReadyCount >= 1, 'Expected runtime to emit planner:context-ready after perception update');

    const resultAction: ActionItem = {
      skill: 'move_to',
      params: { x: 10, y: 64, z: 10 },
      expectedDurationSeconds: 4,
    };
    eventBus.emit('executor:result', {
      actionItem: resultAction,
      success: true,
      errorCode: null,
      errorMessage: null,
      durationMs: 200,
      stateChanges: {},
    });
    await sleep(20);

    assert.ok(llmPayloads.length >= 1, 'Expected tactical LLM to be called at least once');
    const firstPayload = llmPayloads[0];
    const context = (firstPayload.context ?? null) as Record<string, unknown> | null;
    assert.notEqual(context, null, 'Expected non-null tactical context in first LLM payload');
    assert.ok(context?.position, 'Expected context position in LLM payload');
    assert.ok(context?.memory, 'Expected context memory in LLM payload');

    bot.emit('end', 'integration-test-complete');
    app.memory.close();
  } finally {
    eventBus.off('planner:context-ready', onContextReady);
    if (originalCallDescriptor) {
      Object.defineProperty(FireworksLLMClient.prototype, 'call', originalCallDescriptor);
    }
  }

  console.log('index planner context integration: PASS');
}

void run().catch((error: unknown) => {
  console.error('index planner context integration: FAIL', error);
  process.exit(1);
});
