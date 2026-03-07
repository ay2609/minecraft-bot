export interface PerceptionCadenceConfig {
  baselineMinIntervalMs: number;
  baselineMaxIntervalMs: number;
  burstMaxRateHz: number;
  burstWindowMs: number;
  cooldownMs: number;
}

export type PerceptionCadenceMode = 'baseline' | 'burst' | 'cooldown';

export interface PerceptionCadenceState {
  lastEmitAt: number | null;
  lastDirtyAt: number | null;
  dirty: boolean;
  burstUntil: number | null;
  cooldownUntil: number | null;
}

export interface NextEmitAtInput {
  state: PerceptionCadenceState;
  now: number;
  config?: Partial<PerceptionCadenceConfig>;
}

export interface CadenceMutationInput {
  state: PerceptionCadenceState;
  now: number;
  config?: Partial<PerceptionCadenceConfig>;
}

export interface MarkDirtyInput extends CadenceMutationInput {
  burst?: boolean;
}

export const DEFAULT_PERCEPTION_CADENCE_CONFIG: PerceptionCadenceConfig = {
  baselineMinIntervalMs: 500,
  baselineMaxIntervalMs: 1000,
  burstMaxRateHz: 4,
  burstWindowMs: 1500,
  cooldownMs: 1000,
};

function sanitizeConfig(input?: Partial<PerceptionCadenceConfig>): PerceptionCadenceConfig {
  const merged = {
    ...DEFAULT_PERCEPTION_CADENCE_CONFIG,
    ...input,
  };

  const baselineMinIntervalMs = Math.max(50, Math.floor(merged.baselineMinIntervalMs));
  const baselineMaxIntervalMs = Math.max(baselineMinIntervalMs, Math.floor(merged.baselineMaxIntervalMs));
  const burstMaxRateHz = Math.max(1, merged.burstMaxRateHz);
  const burstWindowMs = Math.max(100, Math.floor(merged.burstWindowMs));
  const cooldownMs = Math.max(100, Math.floor(merged.cooldownMs));

  return {
    baselineMinIntervalMs,
    baselineMaxIntervalMs,
    burstMaxRateHz,
    burstWindowMs,
    cooldownMs,
  };
}

function burstIntervalMs(config: PerceptionCadenceConfig): number {
  return Math.max(50, Math.floor(1000 / config.burstMaxRateHz));
}

function applyPassiveTransitions(
  state: PerceptionCadenceState,
  now: number,
  config: PerceptionCadenceConfig,
): PerceptionCadenceState {
  let nextState = { ...state };

  if (nextState.burstUntil !== null && now >= nextState.burstUntil) {
    nextState.burstUntil = null;
    nextState.cooldownUntil = Math.max(nextState.cooldownUntil ?? 0, now + config.cooldownMs);
  }

  if (nextState.cooldownUntil !== null && now >= nextState.cooldownUntil) {
    nextState.cooldownUntil = null;
  }

  return nextState;
}

function intervalForMode(mode: PerceptionCadenceMode, state: PerceptionCadenceState, config: PerceptionCadenceConfig): number {
  if (mode === 'burst') {
    return burstIntervalMs(config);
  }
  if (mode === 'cooldown') {
    return Math.floor((config.baselineMinIntervalMs + config.baselineMaxIntervalMs) / 2);
  }
  return state.dirty ? config.baselineMinIntervalMs : config.baselineMaxIntervalMs;
}

export function createPerceptionCadenceState(now?: number): PerceptionCadenceState {
  return {
    lastEmitAt: null,
    lastDirtyAt: now ?? null,
    dirty: true,
    burstUntil: null,
    cooldownUntil: null,
  };
}

export function resolveCadenceMode(input: CadenceMutationInput): PerceptionCadenceMode {
  const config = sanitizeConfig(input.config);
  const state = applyPassiveTransitions(input.state, input.now, config);

  if (state.burstUntil !== null && input.now < state.burstUntil) {
    return 'burst';
  }
  if (state.cooldownUntil !== null && input.now < state.cooldownUntil) {
    return 'cooldown';
  }
  return 'baseline';
}

export function markCadenceDirty(input: MarkDirtyInput): PerceptionCadenceState {
  const config = sanitizeConfig(input.config);
  const baseState = applyPassiveTransitions(input.state, input.now, config);
  const burstUntil = input.burst
    ? Math.max(baseState.burstUntil ?? 0, input.now + config.burstWindowMs)
    : baseState.burstUntil;

  return {
    ...baseState,
    dirty: true,
    lastDirtyAt: input.now,
    burstUntil,
    cooldownUntil: input.burst ? null : baseState.cooldownUntil,
  };
}

export function recordCadenceEmission(input: CadenceMutationInput): PerceptionCadenceState {
  const config = sanitizeConfig(input.config);
  const baseState = applyPassiveTransitions(input.state, input.now, config);

  return {
    ...baseState,
    lastEmitAt: input.now,
    dirty: false,
  };
}

export function nextEmitAt(input: NextEmitAtInput): number {
  const config = sanitizeConfig(input.config);
  const state = applyPassiveTransitions(input.state, input.now, config);

  if (state.lastEmitAt === null) {
    return input.now;
  }

  const mode = resolveCadenceMode({
    state,
    now: input.now,
    config,
  });
  const intervalMs = intervalForMode(mode, state, config);
  const dueAt = state.lastEmitAt + intervalMs;

  return dueAt > input.now ? dueAt : input.now;
}
