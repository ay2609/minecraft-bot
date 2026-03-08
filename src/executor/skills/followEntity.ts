import type { ActionItem } from '../../types';
import type {
  ExecutorRunContext,
  MovementCoordinatorLike,
  SkillExecutionOutcome,
} from '../types';

interface FollowEntityDependencies {
  movementCoordinator?: MovementCoordinatorLike;
  performMovement?: (actionItem: ActionItem, signal: AbortSignal) => Promise<SkillExecutionOutcome>;
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

export async function executeFollowEntity(
  actionItem: ActionItem,
  context: ExecutorRunContext,
  dependencies: FollowEntityDependencies,
): Promise<SkillExecutionOutcome> {
  void context;

  const targetId = actionItem.params['targetId'];
  const targetName = actionItem.params['targetName'];
  if (typeof targetId !== 'string' && typeof targetName !== 'string') {
    return {
      success: false,
      errorCode: 'target_unavailable',
      errorMessage: 'follow_entity requires targetId or targetName',
      stateChanges: {},
    };
  }

  if (!dependencies.movementCoordinator) {
    return {
      success: false,
      errorCode: 'invalid_state',
      errorMessage: 'Movement coordinator unavailable for follow_entity',
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
