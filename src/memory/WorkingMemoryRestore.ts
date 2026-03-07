import { z } from 'zod';
import { eventBus, type TypedEventBus } from '../events/EventBus';
import type {
  GoalPlan,
  PlanCheckpointRecord,
  WorkingMemoryRestoreCompleteEvent,
  WorkingMemoryRestoreFailedEvent,
  WorkingMemoryRestoreResult,
} from '../types/index';
import type { CheckpointRepository } from './CheckpointRepository';
import type { WorkingMemory } from './WorkingMemory';

const subgoalSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  requiredItems: z.record(z.string(), z.number()),
  expectedOutcome: z.string().min(1),
  maxAttempts: z.number().int().positive(),
  timeoutSeconds: z.number().int().positive(),
});

const goalPlanSchema: z.ZodType<GoalPlan> = z.object({
  goal: z.string().min(1),
  goalRationale: z.string().min(1),
  priority: z.enum(['survival', 'progression', 'exploration', 'social', 'construction']),
  subgoals: z.array(subgoalSchema),
  successConditions: z.array(z.string()),
  abortConditions: z.array(z.string()),
  estimatedComplexity: z.enum(['low', 'medium', 'high']),
  allowedSkills: z.array(z.string()),
});

const actionItemSchema = z.object({
  skill: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  expectedDurationSeconds: z.number().positive(),
});

const actionQueueSchema = z
  .object({
    subgoalId: z.string().min(1),
    actions: z.array(actionItemSchema),
    reasoning: z.string().min(1),
    subgoalComplete: z.boolean(),
    escalate: z.boolean(),
    escalateReason: z.string().nullable(),
    needsRevalidation: z.boolean().optional(),
  })
  .nullable();

const checkpointSchema: z.ZodType<PlanCheckpointRecord> = z.object({
  checkpointId: z.string().min(1),
  committedAt: z.string().datetime(),
  commitReason: z.string().min(1),
  payload: z.object({
    plan: goalPlanSchema,
    activeSubgoalId: z.string().min(1).nullable(),
    actionQueue: actionQueueSchema,
    constraints: z.record(z.string(), z.unknown()),
  }),
});

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown restore error';
}

export class WorkingMemoryRestore {
  constructor(
    private readonly workingMemory: WorkingMemory,
    private readonly checkpointRepository: Pick<CheckpointRepository, 'loadLatestActiveCheckpoint'>,
    private readonly events: Pick<TypedEventBus, 'emit'> = eventBus,
  ) {}

  restoreFromCheckpoint(): WorkingMemoryRestoreResult {
    let checkpointId: string | null = null;

    try {
      const checkpoint = this.checkpointRepository.loadLatestActiveCheckpoint();

      if (checkpoint === null) {
        const noCheckpointResult: WorkingMemoryRestoreResult = {
          restoredFromCheckpoint: false,
          checkpointId: null,
          restoredAt: null,
        };
        const noCheckpointEvent: WorkingMemoryRestoreCompleteEvent = {
          restoredFromCheckpoint: false,
          checkpointId: null,
          restoredAt: new Date().toISOString(),
        };

        this.workingMemory.setRestoreMetadata({
          restoredFromCheckpoint: false,
          restoredAt: null,
          checkpointId: null,
        });
        this.events.emit('memory:restore-complete', noCheckpointEvent);
        return noCheckpointResult;
      }

      const parsedCheckpoint = checkpointSchema.parse(checkpoint);
      checkpointId = parsedCheckpoint.checkpointId;

      this.workingMemory.reset();
      this.workingMemory.setPlan(parsedCheckpoint.payload.plan);
      this.workingMemory.setActiveSubgoal(parsedCheckpoint.payload.activeSubgoalId);
      this.workingMemory.setActionQueue(parsedCheckpoint.payload.actionQueue);
      this.workingMemory.setConstraints(parsedCheckpoint.payload.constraints);
      this.workingMemory.clearExecutionTransients();

      const restoreMetadata = {
        restoredFromCheckpoint: true,
        restoredAt: parsedCheckpoint.committedAt,
        checkpointId: parsedCheckpoint.checkpointId,
      };
      this.workingMemory.setRestoreMetadata(restoreMetadata);

      const successEvent: WorkingMemoryRestoreCompleteEvent = {
        restoredFromCheckpoint: true,
        checkpointId: parsedCheckpoint.checkpointId,
        restoredAt: parsedCheckpoint.committedAt,
      };
      this.events.emit('memory:restore-complete', successEvent);

      return restoreMetadata;
    } catch (error) {
      const reason = extractErrorMessage(error);
      const failureEvent: WorkingMemoryRestoreFailedEvent = {
        reason,
        checkpointId,
      };
      this.events.emit('memory:restore-failed', failureEvent);
      this.events.emit('memory:persistence-error', {
        operation: 'restoreFromCheckpoint',
        error: reason,
      });
      throw new Error(`Working memory restore failed: ${reason}`);
    }
  }
}
