import type { CheckpointRepository } from './CheckpointRepository';
import type {
  ActionQueue,
  GoalPlan,
  PlanCheckpointCommitInput,
  WorkingMemoryRestoreMetadata,
  WorkingMemorySnapshot,
} from '../types/index';

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function createDefaultRestoreMetadata(): WorkingMemoryRestoreMetadata {
  return {
    restoredFromCheckpoint: false,
    restoredAt: null,
    checkpointId: null,
  };
}

function createInitialState(): WorkingMemorySnapshot {
  return {
    activePlan: null,
    activeSubgoalId: null,
    actionQueue: null,
    constraints: {},
    execution: {
      inFlightAction: null,
      lockedSkill: null,
    },
    restore: createDefaultRestoreMetadata(),
  };
}

export class WorkingMemory {
  private state: WorkingMemorySnapshot = createInitialState();

  getSnapshot(): WorkingMemorySnapshot {
    return cloneValue(this.state);
  }

  setPlan(plan: GoalPlan | null): void {
    this.state.activePlan = cloneValue(plan);
    if (plan === null) {
      this.state.activeSubgoalId = null;
      this.state.actionQueue = null;
    }
  }

  setActiveSubgoal(subgoalId: string | null): void {
    this.state.activeSubgoalId = subgoalId;
  }

  setActionQueue(actionQueue: ActionQueue | null): void {
    this.state.actionQueue = cloneValue(actionQueue);
  }

  setConstraints(constraints: Record<string, unknown>): void {
    this.state.constraints = cloneValue(constraints);
  }

  clearExecutionTransients(): void {
    this.state.execution = {
      inFlightAction: null,
      lockedSkill: null,
    };

    if (this.state.actionQueue !== null) {
      this.state.actionQueue.needsRevalidation = true;
    }
  }

  setRestoreMetadata(restore: WorkingMemoryRestoreMetadata): void {
    this.state.restore = cloneValue(restore);
  }

  reset(): void {
    this.state = createInitialState();
  }

  commitCheckpoint(
    checkpointRepository: Pick<CheckpointRepository, 'commitCheckpoint'>,
    commitReason: string,
  ): string {
    if (this.state.activePlan === null) {
      throw new Error('Cannot commit checkpoint without an active plan');
    }

    const payload: PlanCheckpointCommitInput = {
      plan: cloneValue(this.state.activePlan),
      activeSubgoalId: this.state.activeSubgoalId,
      actionQueue: cloneValue(this.state.actionQueue),
      constraints: cloneValue(this.state.constraints),
      commitReason,
    };

    const checkpointId = checkpointRepository.commitCheckpoint(payload);
    this.state.restore = {
      restoredFromCheckpoint: true,
      restoredAt: new Date().toISOString(),
      checkpointId,
    };

    return checkpointId;
  }
}

export const workingMemory = new WorkingMemory();
