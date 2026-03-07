import type {
  PerceptionSnapshot,
  GoalPlan,
  Subgoal,
  ActionQueue,
  ActionItem,
  ExecutorResult,
  ExecutorErrorCode,
} from './index';

// Type-level assertions: these assignments must compile
const _errorCode: ExecutorErrorCode = 'no_path';
const _allCodes: ExecutorErrorCode[] = [
  'no_path', 'interrupted', 'insufficient_materials', 'inventory_full',
  'tool_missing', 'unsafe', 'timed_out', 'target_unavailable',
  'route_blocked', 'invalid_state',
];

// ExecutorResult errorCode must be nullable
const _result: ExecutorResult = {
  actionItem: { skill: 'move_to', params: {}, expectedDurationSeconds: 10 },
  success: true,
  errorCode: null,
  errorMessage: null,
  durationMs: 500,
  stateChanges: {},
};

// GoalPlan.priority must be one of the 5 literals
const _plan: GoalPlan = {
  goal: 'test',
  goalRationale: 'test',
  priority: 'survival',
  subgoals: [],
  successConditions: [],
  abortConditions: [],
  estimatedComplexity: 'low',
  allowedSkills: [],
};

// Suppress "unused" warnings
void _errorCode; void _allCodes; void _result; void _plan;
export {};
