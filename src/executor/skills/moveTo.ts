import type { ActionItem } from '../../types';
import type {
  ExecutorRunContext,
  MovementCoordinatorLike,
  SkillExecutionOutcome,
} from '../types';

interface MoveToDependencies {
  movementCoordinator?: MovementCoordinatorLike;
  performMovement?: (actionItem: ActionItem, signal: AbortSignal) => Promise<SkillExecutionOutcome>;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function successOutcome(): SkillExecutionOutcome {
  return {
    success: true,
    errorCode: null,
    errorMessage: null,
    stateChanges: {},
    movement: {
      outcome: 'executed',
    },
  };
}

export async function executeMoveTo(
  actionItem: ActionItem,
  context: ExecutorRunContext,
  dependencies: MoveToDependencies,
): Promise<SkillExecutionOutcome> {
  void context;

  const x = toFiniteNumber(actionItem.params['x']);
  const y = toFiniteNumber(actionItem.params['y']);
  const z = toFiniteNumber(actionItem.params['z']);
  if (x === null || y === null || z === null) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'move_to requires numeric x/y/z params',
      stateChanges: {},
    };
  }

  if (!dependencies.movementCoordinator) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'Movement coordinator unavailable for move_to',
      stateChanges: {},
    };
  }

  const intent = actionItem.params['critical'] === true ? 'critical' : 'normal';
  const timeoutMs = Math.max(1_000, Math.floor(actionItem.expectedDurationSeconds * 1_000));

  return dependencies.movementCoordinator.requestMove({
    actionItem,
    timeoutMs,
    intent,
    execute: (signal) => {
      if (dependencies.performMovement) {
        return dependencies.performMovement(actionItem, signal);
      }

      return Promise.resolve(successOutcome());
    },
  });
}
