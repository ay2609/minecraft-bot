import { z } from 'zod';

export const ActionItemSchema = z.object({
  skill: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  expectedDurationSeconds: z.number().positive(),
});

export const QueueOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('append'), action: ActionItemSchema }),
  z.object({ op: z.literal('prepend'), action: ActionItemSchema }),
  z.object({ op: z.literal('insert'), index: z.number().int().nonnegative(), action: ActionItemSchema }),
  z.object({ op: z.literal('delete'), index: z.number().int().nonnegative() }),
  z.object({ op: z.literal('clear') }),
]);

export const TacticalOutputSchema = z.object({
  reasoning: z.string(),
  queueOps: z.array(QueueOpSchema),
  finalQueue: z.array(ActionItemSchema),
  subgoalComplete: z.boolean(),
  escalate: z.boolean(),
  escalateReason: z.string().nullable(),
});

export type TacticalOutput = z.infer<typeof TacticalOutputSchema>;
