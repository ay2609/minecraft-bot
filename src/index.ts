import mineflayer from 'mineflayer';
import type { Bot } from 'mineflayer';
import { goals, Movements, pathfinder } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { config, type Config } from './config';
import { executeAction } from './executor/Executor';
import { MovementCoordinator } from './executor/MovementCoordinator';
import type { ExecutorDependencies, SkillExecutionOutcome } from './executor/types';
import { eventBus } from './events/EventBus';
import {
  createPlannerMemoryRetriever,
  initializeMemory,
  type InitializeMemoryOptions,
  type InitializedMemory,
} from './memory';
import { buildPerceptionSnapshot } from './perception/SnapshotBuilder';
import { ContextAssembler } from './perception/ContextAssembler';
import { PerceptionService, type PerceptionServiceOptions } from './perception/PerceptionService';
import { FireworksLLMClient } from './planner/FireworksLLMClient';
import { TacticalPlanner } from './planner/TacticalPlanner';
import { StrategicPlanner } from './planner/StrategicPlanner';
import type { PlannerContextBundle, SnapshotBuildInput } from './perception/types';
import type {
  ActionItem,
  ActionQueue,
  ExecutorResult,
  FailureRecord,
  PerceptionSnapshot,
  Vec3Like,
} from './types/index';

type BotFactory = (options: Parameters<typeof mineflayer.createBot>[0]) => Bot;
type MemoryInitializer = (options: InitializeMemoryOptions) => InitializedMemory;
type PerceptionServiceFactory = (options: PerceptionServiceOptions) => PerceptionService;

export interface StartupConfigOverride {
  memory?: Partial<Config['memory']>;
  minecraft?: Partial<Config['minecraft']>;
}

export interface StartupDependencies {
  createBot?: BotFactory;
  initializeMemory?: MemoryInitializer;
  createPerceptionService?: PerceptionServiceFactory;
}

export interface InitializeApplicationOptions {
  configOverride?: StartupConfigOverride;
  dependencies?: StartupDependencies;
}

export interface InitializedApplication {
  memory: InitializedMemory;
  bot: Bot;
  perception: PerceptionService;
}

function resolveMemoryConfig(override?: Partial<Config['memory']>): Config['memory'] {
  return {
    ...config.memory,
    ...override,
  };
}

function resolveMinecraftConfig(override?: Partial<Config['minecraft']>): Config['minecraft'] {
  return {
    ...config.minecraft,
    ...override,
  };
}

interface BotRuntimeEntity {
  name?: string;
  position?: Vec3Like;
}

interface BotRuntimeLike {
  health?: number;
  food?: number;
  rainState?: number;
  thunderState?: number;
  entity?: {
    position?: Vec3Like;
    yaw?: number;
    onGround?: boolean;
  };
  game?: {
    gameMode?: string;
  };
  inventory?: {
    items?: () => Array<{ name: string; count: number }>;
    slots?: Array<unknown>;
  };
  heldItem?: { name: string } | null;
  biome?: string | { name?: string };
  time?: {
    timeOfDay?: number;
  };
  entities?: Record<string, BotRuntimeEntity>;
}

interface BotEventEmitterLike {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

type RuntimeBlock = NonNullable<ReturnType<Bot['blockAt']>>;

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function toVec3Like(position: unknown, fallback: Vec3Like): Vec3Like {
  if (typeof position !== 'object' || position === null) {
    return fallback;
  }
  const vec = position as Partial<Vec3Like>;
  return {
    x: toFiniteNumber(vec.x, fallback.x),
    y: toFiniteNumber(vec.y, fallback.y),
    z: toFiniteNumber(vec.z, fallback.z),
  };
}

function toFiniteParam(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRuntimeBlock(value: unknown): value is RuntimeBlock {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    name?: unknown;
    position?: unknown;
  };
  return typeof candidate.name === 'string' && typeof candidate.position === 'object' && candidate.position !== null;
}

function findNearbyBlockByName(bot: Bot, blockName: string, targetPos: Vec3): RuntimeBlock | null {
  const botState = bot as unknown as {
    findBlock?: (options: {
      matching: number | ((block: { name?: string; position?: Vec3Like } | null) => boolean);
      maxDistance: number;
      point?: Vec3;
    }) => unknown;
    registry?: {
      blocksByName?: Record<string, { id: number }>;
    };
    entity?: {
      position?: Vec3Like;
    };
  };

  if (!botState.findBlock || !botState.registry?.blocksByName) {
    return null;
  }

  const blockId = botState.registry.blocksByName[blockName]?.id;
  if (typeof blockId !== 'number') {
    return null;
  }
  const referenceY = botState.entity?.position?.y ?? targetPos.y;
  const matching = (candidate: { name?: string; position?: Vec3Like } | null): boolean => {
    if (!candidate || candidate.name !== blockName || !candidate.position) {
      return false;
    }
    return Math.abs(candidate.position.y - referenceY) <= 2.5;
  };

  const aroundTarget = botState.findBlock({
    matching,
    maxDistance: 6,
    point: targetPos,
  });
  if (isRuntimeBlock(aroundTarget)) {
    return aroundTarget;
  }

  if (!botState.entity?.position) {
    return null;
  }

  const aroundSelf = botState.findBlock({
    matching,
    maxDistance: 8,
    point: new Vec3(
      Math.floor(botState.entity.position.x),
      Math.floor(botState.entity.position.y),
      Math.floor(botState.entity.position.z),
    ),
  });

  return isRuntimeBlock(aroundSelf) ? aroundSelf : null;
}

function safeJsonPreview(value: unknown, maxChars = 220): string {
  try {
    const serialized = JSON.stringify(
      value,
      (_key: string, nestedValue: unknown): unknown => (typeof nestedValue === 'function' ? '[Function]' : nestedValue),
    );

    if (!serialized) {
      return '{}';
    }

    return serialized.length > maxChars ? `${serialized.slice(0, maxChars)}...` : serialized;
  } catch {
    return '[unserializable]';
  }
}

function summarizeAction(actionItem: ActionItem): string {
  return `${actionItem.skill} params=${safeJsonPreview(actionItem.params)} eta=${actionItem.expectedDurationSeconds}s`;
}

function summarizeQueue(queue: ActionQueue): string {
  if (queue.actions.length === 0) {
    return '[empty queue]';
  }

  return queue.actions
    .map((action, index) => `${index + 1}:${summarizeAction(action)}`)
    .join(' | ');
}

function isLikelySameAction(candidate: ActionItem, executed: ActionItem): boolean {
  return candidate.skill === executed.skill;
}

function isLogBlockName(name: string): boolean {
  return name.endsWith('_log');
}

function buildLocalWoodQueue(snapshot: PerceptionSnapshot, subgoalId: string | null): ActionQueue | null {
  const nearbyLogs = snapshot.nearbyBlocks
    .filter((block) => isLogBlockName(block.name) && Math.abs(block.position.y - snapshot.position.y) <= 2.5)
    .slice()
    .sort((a, b) => a.distance - b.distance);

  const primary = nearbyLogs[0];
  if (!primary) {
    return null;
  }

  const actions: ActionItem[] = [];
  if (primary.distance > 2.2) {
    actions.push({
      skill: 'move_to',
      params: {
        x: Math.floor(primary.position.x),
        y: Math.floor(snapshot.position.y),
        z: Math.floor(primary.position.z),
      },
      expectedDurationSeconds: 4,
    });
  }

  actions.push({
    skill: 'break_block',
    params: {
      x: Math.floor(primary.position.x),
      y: Math.floor(primary.position.y),
      z: Math.floor(primary.position.z),
      blockType: primary.name,
    },
    expectedDurationSeconds: 3,
  });

  const secondary = nearbyLogs.find((block) => {
    if (block === primary) {
      return false;
    }
    const dx = Math.abs(block.position.x - primary.position.x);
    const dz = Math.abs(block.position.z - primary.position.z);
    return dx <= 1.5 && dz <= 1.5;
  });

  if (secondary) {
    actions.push({
      skill: 'break_block',
      params: {
        x: Math.floor(secondary.position.x),
        y: Math.floor(secondary.position.y),
        z: Math.floor(secondary.position.z),
        blockType: secondary.name,
      },
      expectedDurationSeconds: 3,
    });
  }

  return {
    subgoalId: subgoalId ?? 'none',
    actions: actions.slice(0, 3),
    reasoning: 'runtime-heuristic: continue nearby wood harvesting without replanning round-trip',
    subgoalComplete: false,
    escalate: false,
    escalateReason: null,
  };
}

function toInventoryMap(bot: Bot): Record<string, number> {
  const items = bot.inventory.items();
  const inventory: Record<string, number> = {};
  for (const item of items) {
    const next = (inventory[item.name] ?? 0) + item.count;
    inventory[item.name] = next;
  }
  return inventory;
}

function inferCraftRecipe(
  item: string,
  inventory: Record<string, number>,
): { recipes: Record<string, Record<string, number>>; recipeYields?: Record<string, number> } | null {
  if (item.endsWith('_planks')) {
    const woodPrefix = item.replace(/_planks$/, '');
    return {
      recipes: {
        [item]: {
          [`${woodPrefix}_log`]: 1,
        },
      },
      recipeYields: {
        [item]: 4,
      },
    };
  }

  if (item === 'crafting_table') {
    const plankIngredient = Object.keys(inventory).find((name) => name.endsWith('_planks')) ?? 'oak_planks';
    return {
      recipes: {
        crafting_table: {
          [plankIngredient]: 4,
        },
      },
    };
  }

  return null;
}

function isWoodCollectionGoal(goal: string | null): boolean {
  if (!goal) {
    return false;
  }
  return /(wood|log|tree|planks|crafting table)/i.test(goal);
}

function buildLocalExploreQueue(
  snapshot: PerceptionSnapshot,
  subgoalId: string | null,
  waypointIndex: number,
): { queue: ActionQueue; nextWaypointIndex: number } {
  const offsets: Array<{ x: number; z: number }> = [
    { x: 10, z: 0 },
    { x: 0, z: 10 },
    { x: -10, z: 0 },
    { x: 0, z: -10 },
    { x: 12, z: 12 },
    { x: -12, z: 12 },
    { x: -12, z: -12 },
    { x: 12, z: -12 },
  ];
  const selected = offsets[waypointIndex % offsets.length] ?? offsets[0];
  const targetX = Math.floor(snapshot.position.x + selected.x);
  const targetY = Math.floor(snapshot.position.y);
  const targetZ = Math.floor(snapshot.position.z + selected.z);

  return {
    queue: {
      subgoalId: subgoalId ?? 'none',
      actions: [
        {
          skill: 'move_to',
          params: { x: targetX, y: targetY, z: targetZ },
          expectedDurationSeconds: 8,
        },
      ],
      reasoning: 'runtime-heuristic: continue exploration without waiting for replan round-trip',
      subgoalComplete: false,
      escalate: false,
      escalateReason: null,
    },
    nextWaypointIndex: waypointIndex + 1,
  };
}

const POST_BREAK_DROP_COLLECTION_TIMEOUT_MS = 300;

async function collectNearbyDrop(bot: Bot): Promise<void> {
  const botState = bot as unknown as {
    entity?: { position?: Vec3Like };
    entities?: Record<string, { name?: string; position?: Vec3Like }>;
    pathfinder?: { goto: (goal: goals.Goal) => Promise<void> };
  };

  if (!botState.entity?.position || !botState.entities || !botState.pathfinder) {
    return;
  }

  const origin = toVec3Like(botState.entity.position, { x: 0, y: 0, z: 0 });
  const nearestDrop = Object.values(botState.entities)
    .filter((entity) => entity.name === 'item' && entity.position)
    .map((entity) => {
      const position = toVec3Like(entity.position, { x: 0, y: 0, z: 0 });
      const dx = position.x - origin.x;
      const dy = position.y - origin.y;
      const dz = position.z - origin.z;
      return {
        position,
        distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
      };
    })
    .sort((a, b) => a.distance - b.distance)[0];

  if (!nearestDrop || nearestDrop.distance > 6) {
    return;
  }

  try {
    await Promise.race([
      botState.pathfinder.goto(
        new goals.GoalNear(
          Math.floor(nearestDrop.position.x),
          Math.floor(nearestDrop.position.y),
          Math.floor(nearestDrop.position.z),
          1,
        ),
      ),
      new Promise<void>((resolve) => {
        setTimeout(resolve, POST_BREAK_DROP_COLLECTION_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Drop collection failures are non-fatal; tactical loop can replan.
  }
}

function withRuntimeSkillAttempts(actionItem: ActionItem, bot: Bot): ActionItem {
  const runtimeParams = { ...actionItem.params };

  if (actionItem.skill === 'send_chat') {
    const message = runtimeParams['message'];
    if (typeof message === 'string' && message.trim().length > 0) {
      runtimeParams['attempt'] = (): { success: boolean; reason?: string } => {
        try {
          bot.chat(message);
          return { success: true };
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          return { success: false, reason };
        }
      };
    }
  }

  if (actionItem.skill === 'break_block') {
    const expectedBlockType = typeof runtimeParams['blockType'] === 'string' ? runtimeParams['blockType'] : null;
    const hasNumericTarget =
      toFiniteParam(runtimeParams['x']) !== null &&
      toFiniteParam(runtimeParams['y']) !== null &&
      toFiniteParam(runtimeParams['z']) !== null;
    if (!hasNumericTarget && expectedBlockType) {
      const currentPosition = toVec3Like(bot.entity.position, { x: 0, y: 0, z: 0 });
      const fallbackBlock = findNearbyBlockByName(
        bot,
        expectedBlockType,
        new Vec3(
          Math.floor(currentPosition.x),
          Math.floor(currentPosition.y),
          Math.floor(currentPosition.z),
        ),
      );
      if (fallbackBlock) {
        const fallbackX = Math.floor(fallbackBlock.position.x);
        const fallbackY = Math.floor(fallbackBlock.position.y);
        const fallbackZ = Math.floor(fallbackBlock.position.z);
        runtimeParams['x'] = fallbackX;
        runtimeParams['y'] = fallbackY;
        runtimeParams['z'] = fallbackZ;
        console.warn(
          `[executor] break_block filled-missing-target to=(${fallbackX},${fallbackY},${fallbackZ}) type=${expectedBlockType}`,
        );
      }
    }

    runtimeParams['attempt'] = async (): Promise<{
      success: boolean;
      targetMissing?: boolean;
      blocked?: boolean;
      reason?: string;
    }> => {
      const x = toFiniteParam(runtimeParams['x']);
      const y = toFiniteParam(runtimeParams['y']);
      const z = toFiniteParam(runtimeParams['z']);
      if (x === null || y === null || z === null) {
        return {
          success: false,
          targetMissing: true,
          reason: 'break_block runtime attempt missing numeric x/y/z',
        };
      }

      const targetPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
      let block = bot.blockAt(targetPos);
      const targetMatches =
        block !== null &&
        block.name !== 'air' &&
        (expectedBlockType === null || block.name === expectedBlockType);

      if (!targetMatches && expectedBlockType) {
        const fallbackBlock = findNearbyBlockByName(bot, expectedBlockType, targetPos);
        if (fallbackBlock) {
          console.warn(
            `[executor] break_block retarget from=(${targetPos.x},${targetPos.y},${targetPos.z}) to=(${Math.floor(fallbackBlock.position.x)},${Math.floor(fallbackBlock.position.y)},${Math.floor(fallbackBlock.position.z)}) type=${fallbackBlock.name}`,
          );
          block = fallbackBlock;
        }
      }

      if (!block || block.name === 'air' || (expectedBlockType !== null && block.name !== expectedBlockType)) {
        return {
          success: false,
          targetMissing: true,
          reason: `No breakable block at (${targetPos.x},${targetPos.y},${targetPos.z})`,
        };
      }

      if (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(block)) {
        return {
          success: false,
          blocked: true,
          reason: `Bot cannot dig ${block.name} at target position`,
        };
      }

      await bot.dig(block);
      // Keep drop pickup best-effort, but cap post-break idle to preserve action cadence.
      await collectNearbyDrop(bot);
      return { success: true };
    };
  }

  if (actionItem.skill === 'craft_item') {
    if (typeof runtimeParams['item'] !== 'string' && typeof runtimeParams['recipe'] === 'string') {
      runtimeParams['item'] = runtimeParams['recipe'];
    }
    if (
      (typeof runtimeParams['quantity'] !== 'number' || !Number.isFinite(runtimeParams['quantity'])) &&
      typeof runtimeParams['count'] === 'number' &&
      Number.isFinite(runtimeParams['count'])
    ) {
      runtimeParams['quantity'] = runtimeParams['count'];
    }
    if (typeof runtimeParams['quantity'] !== 'number' || !Number.isFinite(runtimeParams['quantity'])) {
      runtimeParams['quantity'] = 1;
    }

    if (typeof runtimeParams['inventory'] !== 'object' || runtimeParams['inventory'] === null) {
      runtimeParams['inventory'] = toInventoryMap(bot);
    }

    const craftItemName = typeof runtimeParams['item'] === 'string' ? runtimeParams['item'] : null;
    if (
      craftItemName &&
      (typeof runtimeParams['recipes'] !== 'object' || runtimeParams['recipes'] === null)
    ) {
      const inventory = runtimeParams['inventory'] as Record<string, number>;
      const inferredRecipe = inferCraftRecipe(craftItemName, inventory);
      if (inferredRecipe) {
        runtimeParams['recipes'] = inferredRecipe.recipes;
        if (inferredRecipe.recipeYields) {
          runtimeParams['recipeYields'] = inferredRecipe.recipeYields;
        }
      }
    }
  }

  return {
    ...actionItem,
    params: runtimeParams,
  };
}

function mapMovementFailure(error: unknown): SkillExecutionOutcome {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (/no path|cannot find|no route/.test(normalized)) {
    return {
      success: false,
      errorCode: 'no_path',
      errorMessage: message,
      stateChanges: {},
    };
  }

  if (/abort|cancel|interrupted/.test(normalized)) {
    return {
      success: false,
      errorCode: 'interrupted',
      errorMessage: message,
      stateChanges: {},
      movement: { outcome: 'interrupted' },
    };
  }

  if (/timed out|timeout/.test(normalized)) {
    return {
      success: false,
      errorCode: 'timed_out',
      errorMessage: message,
      stateChanges: {},
      movement: { outcome: 'timed_out' },
    };
  }

  return {
    success: false,
    errorCode: 'route_blocked',
    errorMessage: message,
    stateChanges: {},
  };
}

function resolveFollowTargetPosition(bot: Bot, targetId: string): Vec3Like | null {
  const entities = bot.entities as Record<string, { name?: string; username?: string; position?: Vec3Like }>;
  const direct = entities[targetId];
  if (direct?.position) {
    return toVec3Like(direct.position, { x: 0, y: 0, z: 0 });
  }

  const normalizedTarget = targetId.toLowerCase();
  const match = Object.values(entities).find((entity) => {
    const name = entity.name?.toLowerCase();
    const username = entity.username?.toLowerCase();
    return name === normalizedTarget || username === normalizedTarget;
  });

  return match?.position ? toVec3Like(match.position, { x: 0, y: 0, z: 0 }) : null;
}

function createPerformMovement(
  bot: Bot,
  ensurePathfinderReady: () => boolean,
): ExecutorDependencies['performMovement'] {
  return (actionItem, signal) => {
    if (!ensurePathfinderReady()) {
      return Promise.resolve({
        success: false,
        errorCode: 'invalid_state',
        errorMessage: 'mineflayer-pathfinder is not initialized on this bot instance',
        stateChanges: {},
      });
    }

    const runGoal = (goal: goals.Goal): Promise<SkillExecutionOutcome> => new Promise((resolve) => {
      let settled = false;

      const settle = (outcome: SkillExecutionOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(outcome);
      };

      const onAbort = (): void => {
        bot.pathfinder.stop();
        bot.pathfinder.setGoal(null);
        settle({
          success: false,
          errorCode: 'interrupted',
          errorMessage: 'Movement aborted by coordinator',
          stateChanges: {},
          movement: { outcome: 'interrupted' },
        });
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });

      void bot.pathfinder
        .goto(goal)
        .then(() => {
          settle({
            success: true,
            errorCode: null,
            errorMessage: null,
            stateChanges: {},
            movement: { outcome: 'executed' },
          });
        })
        .catch((error: unknown) => {
          settle(mapMovementFailure(error));
        });
    });

    if (actionItem.skill === 'move_to') {
      const x = toFiniteParam(actionItem.params['x']);
      const y = toFiniteParam(actionItem.params['y']);
      const z = toFiniteParam(actionItem.params['z']);
      if (x === null || y === null || z === null) {
        return Promise.resolve({
          success: false,
          errorCode: 'invalid_state',
          errorMessage: 'move_to runtime movement requires numeric x/y/z params',
          stateChanges: {},
        });
      }

      return runGoal(new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 1));
    }

    if (actionItem.skill === 'follow_entity') {
      const targetId = actionItem.params['targetId'];
      if (typeof targetId !== 'string' || targetId.trim().length === 0) {
        return Promise.resolve({
          success: false,
          errorCode: 'invalid_state',
          errorMessage: 'follow_entity runtime movement requires targetId',
          stateChanges: {},
        });
      }

      const targetPosition = resolveFollowTargetPosition(bot, targetId);
      if (!targetPosition) {
        return Promise.resolve({
          success: false,
          errorCode: 'target_unavailable',
          errorMessage: `follow_entity target not found: ${targetId}`,
          stateChanges: {},
        });
      }

      return runGoal(
        new goals.GoalNear(
          Math.floor(targetPosition.x),
          Math.floor(targetPosition.y),
          Math.floor(targetPosition.z),
          2,
        ),
      );
    }

    return Promise.resolve({
      success: false,
      errorCode: 'invalid_state',
      errorMessage: `Unsupported movement skill for runtime performer: ${actionItem.skill}`,
      stateChanges: {},
    });
  };
}

function createExecutorDependencies(bot: Bot): ExecutorDependencies {
  const botWithPlugin = bot as unknown as {
    loadPlugin?: (plugin: (target: Bot) => void) => void;
    pathfinder?: { setMovements: (movements: Movements) => void };
  };
  let movementsConfigured = false;
  let warnedUnavailable = false;

  const ensurePathfinderReady = (): boolean => {
    if (typeof botWithPlugin.loadPlugin === 'function' && !botWithPlugin.pathfinder) {
      try {
        botWithPlugin.loadPlugin(pathfinder);
      } catch (error: unknown) {
        if (!warnedUnavailable) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[executor] Failed to load mineflayer-pathfinder plugin: ${message}`);
          warnedUnavailable = true;
        }
      }
    }

    if (!botWithPlugin.pathfinder || typeof botWithPlugin.pathfinder.setMovements !== 'function') {
      if (!warnedUnavailable) {
        console.warn('[executor] mineflayer-pathfinder unavailable; movement skills will fail closed');
        warnedUnavailable = true;
      }
      return false;
    }

    if (!movementsConfigured) {
      botWithPlugin.pathfinder.setMovements(new Movements(bot));
      movementsConfigured = true;
      console.log('[executor] mineflayer-pathfinder initialized for runtime movement');
    }

    return true;
  };

  return {
    movementCoordinator: new MovementCoordinator({
      pendingTtlMs: config.executor.movement.pendingTtlMs,
    }),
    performMovement: createPerformMovement(bot, ensurePathfinderReady),
  };
}

function isHostileEntityName(name: string): boolean {
  const hostileNames = new Set([
    'blaze',
    'creeper',
    'drowned',
    'enderman',
    'evoker',
    'ghast',
    'guardian',
    'hoglin',
    'husk',
    'magma_cube',
    'phantom',
    'pillager',
    'ravager',
    'shulker',
    'silverfish',
    'skeleton',
    'slime',
    'spider',
    'stray',
    'vex',
    'vindicator',
    'warden',
    'witch',
    'wither_skeleton',
    'zoglin',
    'zombie',
    'zombie_villager',
  ]);

  return hostileNames.has(name);
}

function toNearbyEntities(botState: BotRuntimeLike): SnapshotBuildInput['world']['nearbyEntities'] {
  if (!botState.entities) {
    return [];
  }

  return Object.values(botState.entities)
    .map((entity) => {
      const name = toStringValue(entity.name, 'unknown');
      return {
        name,
        position: toVec3Like(entity.position, { x: 0, y: 0, z: 0 }),
        isHostile: isHostileEntityName(name),
      };
    })
    .slice(0, config.perception.nearbyEntityLimit * 2);
}

function toNearbyBlocks(bot: Bot, origin: Vec3Like): SnapshotBuildInput['world']['nearbyBlocks'] {
  const botWithBlocks = bot as unknown as {
    findBlocks?: (options: {
      matching: (block: { name?: string; boundingBox?: string } | null) => boolean;
      maxDistance: number;
      count: number;
    }) => Array<{ x: number; y: number; z: number }>;
    blockAt?: (position: Vec3) => { name?: string; position?: Vec3Like } | null;
  };

  if (typeof botWithBlocks.findBlocks !== 'function' || typeof botWithBlocks.blockAt !== 'function') {
    return [];
  }

  try {
    const found = botWithBlocks.findBlocks({
      matching: (block) =>
        Boolean(block && block.name && block.name !== 'air' && block.boundingBox !== 'empty'),
      maxDistance: config.perception.nearbyScanRadius,
      count: Math.max(config.perception.nearbyBlockLimit * 6, config.perception.nearbyBlockLimit),
    });

    const nearby = found
      .map((pos) => {
        const block = botWithBlocks.blockAt?.(new Vec3(pos.x, pos.y, pos.z));
        if (!block?.name || block.name === 'air' || !block.position) {
          return null;
        }

        const position = toVec3Like(block.position, { x: pos.x, y: pos.y, z: pos.z });
        const dx = position.x - origin.x;
        const dy = position.y - origin.y;
        const dz = position.z - origin.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        return {
          name: block.name,
          position,
          distance,
        };
      })
      .filter((value): value is { name: string; position: Vec3Like; distance: number } => value !== null)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, config.perception.nearbyBlockLimit)
      .map((block) => ({
        name: block.name,
        position: block.position,
      }));

    return nearby;
  } catch {
    return [];
  }
}

function toWeather(botState: BotRuntimeLike): SnapshotBuildInput['world']['weather'] {
  if (toFiniteNumber(botState.thunderState, 0) > 0) {
    return 'thunder';
  }
  if (toFiniteNumber(botState.rainState, 0) > 0) {
    return 'rain';
  }
  return 'clear';
}

function toBiomeName(biome: BotRuntimeLike['biome']): string {
  if (typeof biome === 'string') {
    return biome;
  }
  if (biome && typeof biome === 'object') {
    return toStringValue(biome.name, 'unknown');
  }
  return 'unknown';
}

function createSnapshotFactory(
  bot: Bot,
  memory: InitializedMemory,
  recentFailures: FailureRecord[],
): () => PerceptionSnapshot {
  return () => {
    const botState = bot as unknown as BotRuntimeLike;
    const workingMemorySnapshot = memory.workingMemory.getSnapshot();
    const position = toVec3Like(botState.entity?.position, { x: 0, y: 0, z: 0 });
    const inventoryItems = botState.inventory?.items?.() ?? [];
    const emptySlots = botState.inventory?.slots?.filter((slot) => slot === null).length ?? 36;
    const currentAction = workingMemorySnapshot.execution.inFlightAction?.skill ?? null;

    return buildPerceptionSnapshot({
      self: {
        position,
        yaw: toFiniteNumber(botState.entity?.yaw, 0),
        health: toFiniteNumber(botState.health, 20),
        food: toFiniteNumber(botState.food, 20),
        armorPoints: 0,
        gameMode: toStringValue(botState.game?.gameMode, 'survival'),
        isOnGround: Boolean(botState.entity?.onGround),
        lightLevel: 15,
      },
      inventory: {
        items: inventoryItems.map((item) => ({
          name: toStringValue(item.name, 'unknown'),
          count: toFiniteNumber(item.count, 0),
        })),
        equippedItem: botState.heldItem?.name ? { name: botState.heldItem.name } : null,
        emptySlots,
      },
      world: {
        biome: toBiomeName(botState.biome),
        timeOfDay: toFiniteNumber(botState.time?.timeOfDay, 0),
        weather: toWeather(botState),
        nearbyEntities: toNearbyEntities(botState),
        nearbyBlocks: toNearbyBlocks(bot, position),
      },
      runtime: {
        currentAction,
        recentFailures,
      },
      scan: {
        radius: config.perception.nearbyScanRadius,
        entityLimit: config.perception.nearbyEntityLimit,
        blockLimit: config.perception.nearbyBlockLimit,
        recentFailureLimit: config.perception.recentFailureLimit,
      },
    });
  };
}

function wireBotEvents(bot: Bot, onShutdown: () => void): void {
  bot.once('spawn', () => {
    console.log(`[bot] Spawned as ${bot.username} on Minecraft ${bot.version}`);
    console.log(`[bot] Position: ${JSON.stringify(bot.entity.position)}`);
    eventBus.emit('bot:spawned');
    eventBus.emit('perception:dirty', { reason: 'bot:spawned', burst: true });
    console.log('[bot] EventBus bot:spawned emitted');
  });

  bot.on('error', (err: Error) => {
    console.error('[bot] Connection error:', err.message);
  });

  bot.once('end', (reason: string) => {
    console.log('[bot] Disconnected:', reason);
    onShutdown();
  });

  bot.on('death', () => {
    console.log('[bot] Bot died');
    eventBus.emit('bot:death', {
      cause: 'unknown',
      position: {
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z,
      },
    });
    eventBus.emit('perception:dirty', { reason: 'bot:death', burst: true });
  });

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    console.log(`[chat] <${username}> ${message}`);
    eventBus.emit('bot:chat', { username, message });
    eventBus.emit('perception:dirty', { reason: 'bot:chat', burst: true });
  });

  const emitter = bot as unknown as BotEventEmitterLike;
  emitter.on('move', () => {
    eventBus.emit('perception:dirty', { reason: 'bot:move', burst: true });
  });
  emitter.on('health', () => {
    eventBus.emit('perception:dirty', { reason: 'bot:health', burst: true });
  });
  emitter.on('entityMoved', () => {
    eventBus.emit('perception:dirty', { reason: 'bot:entityMoved', burst: false });
  });
  emitter.on('physicsTick', () => {
    eventBus.emit('perception:dirty', { reason: 'bot:physicsTick', burst: false });
  });

  eventBus.once('bot:spawned', () => {
    console.log('[eventbus] bot:spawned subscriber confirmed working');
  });
}

export function initializeApplication(options: InitializeApplicationOptions = {}): InitializedApplication {
  const memoryConfig = resolveMemoryConfig(options.configOverride?.memory);
  const minecraftConfig = resolveMinecraftConfig(options.configOverride?.minecraft);
  const initializeMemoryFn = options.dependencies?.initializeMemory ?? initializeMemory;
  const createBotFn = options.dependencies?.createBot ?? mineflayer.createBot;
  const createPerceptionServiceFn =
    options.dependencies?.createPerceptionService ?? ((serviceOptions: PerceptionServiceOptions) => new PerceptionService(serviceOptions));

  const memory = initializeMemoryFn({
    dbPath: memoryConfig.dbPath,
    sqliteBusyTimeoutMs: memoryConfig.sqliteBusyTimeoutMs,
  });

  try {
    const bot = createBotFn({
      host: minecraftConfig.host,
      port: minecraftConfig.port,
      username: minecraftConfig.username,
      version: minecraftConfig.version,
      auth: minecraftConfig.auth,
    });
    const executorDependencies = createExecutorDependencies(bot);
    let lastPerceptionLogAt = 0;
    let lastContextLogAt = 0;
    let lastContextSignature = '';
    let lastExecutorResultAtMs: number | null = null;
    let lastDispatchAtMs: number | null = null;
    let latestPerceptionSnapshot: PerceptionSnapshot | null = null;
    let localExploreWaypointIndex = 0;

    const dispatchAction = (actionItem: ActionItem, source: 'tactical-queue-ready' | 'executor-fast-path'): void => {
      const runtimeAction = withRuntimeSkillAttempts(actionItem, bot);
      const dispatchAtMs = Date.now();
      const gapSinceResultMs = lastExecutorResultAtMs === null ? 'n/a' : String(dispatchAtMs - lastExecutorResultAtMs);
      const queueLen = memory.workingMemory.getSnapshot().actionQueue?.actions.length ?? 0;

      memory.workingMemory.setInFlightAction(actionItem);
      lastDispatchAtMs = dispatchAtMs;
      console.log(
        `[executor] dispatch source=${source} gapSinceResultMs=${gapSinceResultMs} queueLen=${queueLen} ${summarizeAction(runtimeAction)}`,
      );

      void executeAction(runtimeAction, executorDependencies).catch((err: unknown) => {
        memory.workingMemory.setInFlightAction(null);
        console.error('[Executor] Unexpected error from executeAction:', err);
      });
    };

    const recentFailures: FailureRecord[] = [];
    const onExecutorResult = (result: ExecutorResult): void => {
      const handledAtMs = Date.now();
      const sinceDispatchMs = lastDispatchAtMs === null ? 'n/a' : String(handledAtMs - lastDispatchAtMs);
      lastExecutorResultAtMs = handledAtMs;
      memory.workingMemory.setInFlightAction(null);

      const snapshot = memory.workingMemory.getSnapshot();
      const queue = snapshot.actionQueue;
      let remainingQueue: ActionQueue | null = queue;
      if (queue && queue.actions.length > 0 && isLikelySameAction(queue.actions[0], result.actionItem)) {
        const remaining = queue.actions.slice(1);
        remainingQueue = remaining.length > 0
          ? {
              ...queue,
              actions: remaining,
            }
          : null;
        memory.workingMemory.setActionQueue(remainingQueue);
        console.log(`[executor] queue-consume consumed=${result.actionItem.skill} remaining=${remaining.length}`);
      } else if (queue && queue.actions.length > 0) {
        console.warn(
          `[executor] queue-consume mismatch executed=${result.actionItem.skill} head=${queue.actions[0].skill} queueLen=${queue.actions.length}`,
        );
      }

      console.log(
        `[executor] result skill=${result.actionItem.skill} success=${result.success} error=${result.errorCode ?? 'none'} durationMs=${result.durationMs} sinceDispatchMs=${sinceDispatchMs} msg=${result.errorMessage ?? 'none'} movement=${result.metadata?.movement?.outcome ?? 'n/a'}`,
      );

      if (result.success && remainingQueue?.actions.length) {
        console.log(
          `[executor] fast-path next=${remainingQueue.actions[0].skill} remaining=${remainingQueue.actions.length}`,
        );
        dispatchAction(remainingQueue.actions[0], 'executor-fast-path');
      } else if (result.success && latestPerceptionSnapshot) {
        const heuristicQueue = buildLocalWoodQueue(
          latestPerceptionSnapshot,
          snapshot.activeSubgoalId,
        );
        if (heuristicQueue && heuristicQueue.actions.length > 0) {
          memory.workingMemory.setActionQueue(heuristicQueue);
          console.log(
            `[executor] local-heuristic queue-ready actions=${heuristicQueue.actions.length} ${summarizeQueue(heuristicQueue)}`,
          );
          dispatchAction(heuristicQueue.actions[0], 'executor-fast-path');
        } else if (isWoodCollectionGoal(snapshot.activePlan?.goal ?? null)) {
          const exploration = buildLocalExploreQueue(
            latestPerceptionSnapshot,
            snapshot.activeSubgoalId,
            localExploreWaypointIndex,
          );
          localExploreWaypointIndex = exploration.nextWaypointIndex;
          memory.workingMemory.setActionQueue(exploration.queue);
          console.log(
            `[executor] local-explore queue-ready waypoint=${localExploreWaypointIndex} ${summarizeQueue(exploration.queue)}`,
          );
          dispatchAction(exploration.queue.actions[0], 'executor-fast-path');
        }
      }

      if (!result.success && result.errorCode !== null) {
        recentFailures.push({
          skill: result.actionItem.skill,
          errorCode: result.errorCode,
          timestamp: Date.now(),
        });

        if (recentFailures.length > config.perception.recentFailureLimit) {
          recentFailures.splice(0, recentFailures.length - config.perception.recentFailureLimit);
        }
      }
    };

    eventBus.on('executor:result', onExecutorResult);

    const perception = createPerceptionServiceFn({
      buildSnapshot: createSnapshotFactory(bot, memory, recentFailures),
      eventBus,
    });
    const contextAssembler = new ContextAssembler();
    const retrievePlannerMemory = createPlannerMemoryRetriever({
      semantic: memory.semantic,
      episodic: memory.episodic,
    });

    const llmClient = new FireworksLLMClient(config.fireworks.apiKey, config.fireworks.modelId);
    const tacticalPlanner = new TacticalPlanner(llmClient, memory.workingMemory, eventBus, config.tactical);
    const strategicPlanner = new StrategicPlanner(llmClient, memory.workingMemory, eventBus, config.strategic);

    const onBotSpawned = (): void => {
      tacticalPlanner.start();
      strategicPlanner.start();
    };

    const onTacticalQueueReady = (queue: ActionQueue): void => {
      console.log(
        `[tactical] queue-ready subgoal=${queue.subgoalId} actions=${queue.actions.length} complete=${queue.subgoalComplete} escalate=${queue.escalate} reason=${queue.escalateReason ?? 'none'} reasoning=${queue.reasoning}`,
      );
      console.log(`[tactical] queue-detail ${summarizeQueue(queue)}`);
      const snapshot = memory.workingMemory.getSnapshot();
      const inFlightAction = snapshot.execution.inFlightAction;
      if (inFlightAction) {
        console.log(
          `[tactical] queue-ready deferred inFlight=${inFlightAction.skill} queueLen=${queue.actions.length}`,
        );
        return;
      }

      const nextAction = queue.actions[0];
      if (!nextAction) {
        return;
      }
      dispatchAction(nextAction, 'tactical-queue-ready');
    };

    const onPerceptionUpdated = (snapshot: PerceptionSnapshot): void => {
      latestPerceptionSnapshot = snapshot;
      const workingMemorySnapshot = memory.workingMemory.getSnapshot();
      const activeGoal = workingMemorySnapshot.activePlan?.goal ?? null;
      const activeSubgoalId = workingMemorySnapshot.activeSubgoalId;
      const inFlightSkill = workingMemorySnapshot.execution.inFlightAction?.skill ?? null;

      const retrieveMemory = () => retrievePlannerMemory({
        position: snapshot.position,
        activeGoal,
      });

      void contextAssembler
        .assembleAndPublishPlannerContext(
          {
            snapshot,
            intent: {
              activeGoal,
              activeSubgoalId,
              inFlightSkill,
            },
            retrieveMemory,
          },
          eventBus,
        )
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[planner-context] assemble failed: ${message}`);
        });

      const now = Date.now();
      if (now - lastPerceptionLogAt >= 5_000) {
        lastPerceptionLogAt = now;
        console.log(
          `[perception] pos=(${snapshot.position.x.toFixed(1)},${snapshot.position.y.toFixed(1)},${snapshot.position.z.toFixed(1)}) health=${snapshot.health} food=${snapshot.food} currentAction=${snapshot.currentAction ?? 'none'} nearbyEntities=${snapshot.nearbyEntities.length} nearbyBlocks=${snapshot.nearbyBlocks.length}`,
        );
      }
    };

    const onStrategicChatReply = (message: string): void => {
      console.log(`[strategic] chat-reply "${message}"`);
      bot.chat(message);
    };

    const onPlannerContextReady = (bundle: PlannerContextBundle): void => {
      const signature = [
        bundle.intent.activeGoal ?? 'none',
        bundle.intent.activeSubgoalId ?? 'none',
        bundle.intent.inFlightSkill ?? 'none',
        bundle.snapshot.currentAction ?? 'none',
      ].join('|');
      const now = Date.now();
      const shouldLog = signature !== lastContextSignature || now - lastContextLogAt >= 5_000;
      if (!shouldLog) {
        return;
      }
      lastContextSignature = signature;
      lastContextLogAt = now;

      console.log(
        `[planner-context] ready goal=${bundle.intent.activeGoal ?? 'none'} subgoal=${bundle.intent.activeSubgoalId ?? 'none'} inFlight=${bundle.intent.inFlightSkill ?? 'none'} memorySource=${bundle.meta.memorySource} semantic=${bundle.memory.semantic.length} episodic=${bundle.memory.episodic.length}`,
      );
      console.log(
        `[planner-context] snapshot pos=(${bundle.snapshot.position.x.toFixed(1)},${bundle.snapshot.position.y.toFixed(1)},${bundle.snapshot.position.z.toFixed(1)}) biome=${bundle.snapshot.biome} action=${bundle.snapshot.currentAction ?? 'none'} entities=${bundle.snapshot.nearbyEntities.join(',') || 'none'}`,
      );
    };

    eventBus.on('bot:spawned', onBotSpawned);
    eventBus.on('tactical:queue-ready', onTacticalQueueReady);
    eventBus.on('perception:updated', onPerceptionUpdated);
    eventBus.on('strategic:chat-reply', onStrategicChatReply);
    eventBus.on('planner:context-ready', onPlannerContextReady);

    const shutdownPerception = (): void => {
      eventBus.off('executor:result', onExecutorResult);
      eventBus.off('bot:spawned', onBotSpawned);
      eventBus.off('tactical:queue-ready', onTacticalQueueReady);
      eventBus.off('perception:updated', onPerceptionUpdated);
      eventBus.off('strategic:chat-reply', onStrategicChatReply);
      eventBus.off('planner:context-ready', onPlannerContextReady);
      tacticalPlanner.stop();
      strategicPlanner.stop();
      perception.stop();
    };

    wireBotEvents(bot, shutdownPerception);
    perception.start();

    return { memory, bot, perception };
  } catch (error) {
    memory.close();
    throw error;
  }
}

export function startApplication(): InitializedApplication {
  console.log('[bot] Starting minecraft-bot...');
  console.log(
    `[bot] Connecting to ${config.minecraft.host}:${config.minecraft.port} as ${config.minecraft.username}`,
  );

  const app = initializeApplication();
  console.log('[bot] Memory initialized and restored');
  console.log('[bot] Bot created, waiting for spawn...');
  return app;
}

if (require.main === module) {
  try {
    startApplication();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    console.error('[bot] Startup failed:', message);
    process.exitCode = 1;
  }
}
