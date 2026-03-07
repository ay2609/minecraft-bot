// Vec3-compatible position type (matches mineflayer's Vec3)
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

// Perception types
export interface NearbyEntity {
  name: string;        // e.g. 'creeper', 'player:Steve', 'cow'
  distance: number;
  isHostile: boolean;
}

export interface NearbyBlock {
  name: string;        // e.g. 'diamond_ore', 'crafting_table'
  position: Vec3Like;
  distance: number;
}

export interface FailureRecord {
  skill: string;
  errorCode: string;
  timestamp: number;
}

export interface PerceptionSnapshot {
  timestamp: number;
  // Self state
  position: Vec3Like;
  yaw: number;
  health: number;
  food: number;
  gameMode: string;
  isOnGround: boolean;
  // Inventory
  inventory: Record<string, number>;  // { 'oak_log': 12, 'crafting_table': 1 }
  equippedItem: string | null;
  emptySlots: number;
  // World context
  biome: string;
  timeOfDay: number;        // 0–24000
  weather: 'clear' | 'rain' | 'thunder';
  nearbyEntities: NearbyEntity[];
  nearbyBlocks: NearbyBlock[];
  lightLevel: number;
  // Execution context
  currentAction: string | null;
  recentFailures: FailureRecord[];
}

// Planning types
export interface Subgoal {
  id: string;                             // 'sg-1', 'sg-2'
  description: string;
  requiredItems: Record<string, number>;  // pre-conditions: inventory requirements
  expectedOutcome: string;
  maxAttempts: number;
  timeoutSeconds: number;
}

export interface GoalPlan {
  goal: string;
  goalRationale: string;
  priority: 'survival' | 'progression' | 'exploration' | 'social' | 'construction';
  subgoals: Subgoal[];
  successConditions: string[];
  abortConditions: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  allowedSkills: string[];
}

// Executor types
export type ExecutorErrorCode =
  | 'no_path'
  | 'interrupted'
  | 'insufficient_materials'
  | 'inventory_full'
  | 'tool_missing'
  | 'unsafe'
  | 'timed_out'
  | 'target_unavailable'
  | 'route_blocked'
  | 'invalid_state';

export interface ActionItem {
  skill: string;                        // 'move_to' | 'break_block' | 'craft_item' | etc.
  params: Record<string, unknown>;
  expectedDurationSeconds: number;
}

export interface ActionQueue {
  subgoalId: string;
  actions: ActionItem[];
  reasoning: string;
  subgoalComplete: boolean;
  escalate: boolean;
  escalateReason: string | null;
  needsRevalidation?: boolean;
}

export interface WorkingMemoryExecutionState {
  inFlightAction: ActionItem | null;
  lockedSkill: string | null;
}

export interface WorkingMemoryRestoreMetadata {
  restoredFromCheckpoint: boolean;
  restoredAt: string | null;
  checkpointId: string | null;
}

export interface WorkingMemorySnapshot {
  activePlan: GoalPlan | null;
  activeSubgoalId: string | null;
  actionQueue: ActionQueue | null;
  constraints: Record<string, unknown>;
  execution: WorkingMemoryExecutionState;
  restore: WorkingMemoryRestoreMetadata;
}

export interface PlanCheckpointPayload {
  plan: GoalPlan;
  activeSubgoalId: string | null;
  actionQueue: ActionQueue | null;
  constraints: Record<string, unknown>;
}

export interface PlanCheckpointRecord {
  checkpointId: string;
  committedAt: string;
  commitReason: string;
  payload: PlanCheckpointPayload;
}

export interface PlanCheckpointCommitInput extends PlanCheckpointPayload {
  commitReason: string;
}

export interface WorkingMemoryRestoreResult {
  restoredFromCheckpoint: boolean;
  checkpointId: string | null;
  restoredAt: string | null;
}

export interface WorkingMemoryRestoreCompleteEvent {
  restoredFromCheckpoint: boolean;
  checkpointId: string | null;
  restoredAt: string;
}

export interface WorkingMemoryRestoreFailedEvent {
  reason: string;
  checkpointId: string | null;
}

export interface MemoryPersistenceErrorEvent {
  operation: string;
  error: string;
}

export interface ExecutorResult {
  actionItem: ActionItem;
  success: boolean;
  errorCode: ExecutorErrorCode | null;
  errorMessage: string | null;
  durationMs: number;
  stateChanges: Partial<PerceptionSnapshot>;
}
