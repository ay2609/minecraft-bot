import type { ActionQueue, GoalPlan, WorkingMemoryRestoreMetadata, WorkingMemorySnapshot } from '../types/index';

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
}

export const workingMemory = new WorkingMemory();
