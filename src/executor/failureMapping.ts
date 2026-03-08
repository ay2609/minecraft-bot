import type { ExecutorErrorCode } from '../types';
import type { FailureMapping } from './types';

interface Rule {
  code: ExecutorErrorCode;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  { code: 'timed_out', patterns: [/timed?\s*out/i, /timeout/i] },
  { code: 'interrupted', patterns: [/interrupted/i, /goalchanged/i, /pathstopped/i, /aborted/i] },
  { code: 'target_unavailable', patterns: [/target.*unavailable/i, /missing target/i, /entity.*missing/i, /block.*missing/i] },
  { code: 'insufficient_materials', patterns: [/insufficient/i, /no_scaffolding/i, /no recipe/i, /missing material/i] },
  { code: 'inventory_full', patterns: [/inventory.*full/i, /no space/i] },
  { code: 'tool_missing', patterns: [/tool.*missing/i, /requires tool/i, /pickaxe required/i] },
  { code: 'no_path', patterns: [/no[\s_-]?path/i, /cannot find path/i] },
  { code: 'route_blocked', patterns: [/route.*blocked/i, /stuck/i, /dig_error/i, /place_error/i] },
  { code: 'unsafe', patterns: [/unsafe/i, /hazard/i, /lava/i, /fall risk/i] },
];

function compactErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split('\n')[0] ?? 'unknown error';
  return firstLine.trim().slice(0, 180);
}

export function mapExecutorFailure(error: unknown): FailureMapping {
  const compact = compactErrorMessage(error);

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(compact))) {
      return { errorCode: rule.code, errorMessage: compact };
    }
  }

  return {
    errorCode: 'invalid_state',
    errorMessage: compact || 'Unknown executor failure',
  };
}
