import { z } from 'zod';

export const SubgoalSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  requiredItems: z.record(z.string(), z.number()),
  expectedOutcome: z.string(),
  maxAttempts: z.number().int().positive(),
  timeoutSeconds: z.number().positive(),
});

export const GoalPlanSchema = z.object({
  goal: z.string(),
  goalRationale: z.string(),
  priority: z.enum(['survival', 'progression', 'exploration', 'social', 'construction']),
  subgoals: z.array(SubgoalSchema).min(1),
  successConditions: z.array(z.string()).min(1),
  abortConditions: z.array(z.string()).min(1),
  estimatedComplexity: z.enum(['low', 'medium', 'high']),
  allowedSkills: z.array(z.string()),
});

export const ChatDecisionSchema = z.object({
  requestSummary: z.string(),
  decision: z.enum(['switch', 'defer']),
  responseMessage: z.string().nullable(),
});

export const StrategicOutputSchema = z.object({
  reasoning: z.string(),
  triggerCause: z.string(),
  plan: GoalPlanSchema,
  chatDecision: ChatDecisionSchema.nullable(),
});

export type StrategicOutput = z.infer<typeof StrategicOutputSchema>;
