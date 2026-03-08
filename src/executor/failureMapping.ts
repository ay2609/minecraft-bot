import type { ActionItem, ExecutorErrorCode } from '../types';
import type { FailureMapping } from './types';

interface TextRule {
  code: ExecutorErrorCode;
  patterns: RegExp[];
}

const TEXT_RULES: TextRule[] = [
  { code: 'timed_out', patterns: [/timed?\s*out/i, /timeout/i] },
  { code: 'target_unavailable', patterns: [/target.*unavailable/i, /missing target/i, /entity.*missing/i, /block.*missing/i] },
  { code: 'unsafe', patterns: [/unsafe/i, /hazard/i, /lava/i, /fall risk/i] },
  { code: 'interrupted', patterns: [/interrupted/i, /goalchanged/i, /pathstopped/i, /aborted/i] },
  { code: 'insufficient_materials', patterns: [/insufficient/i, /no_scaffolding/i, /no recipe/i, /missing material/i] },
  { code: 'inventory_full', patterns: [/inventory.*full/i, /no space/i] },
  { code: 'tool_missing', patterns: [/tool.*missing/i, /requires tool/i, /pickaxe required/i] },
  { code: 'no_path', patterns: [/no[\s_-]?path/i, /cannot find path/i] },
  { code: 'route_blocked', patterns: [/route.*blocked/i, /blocked/i, /stuck/i, /dig_error/i, /place_error/i] },
];

function compactErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = (error as Record<string, unknown>)['message'];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return (candidate.split('\n')[0] ?? candidate).trim().slice(0, 180);
    }
  }

  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split('\n')[0] ?? 'unknown error';
  return firstLine.trim().slice(0, 180);
}

function collectSignalsFromObject(error: unknown): Set<ExecutorErrorCode> {
  const signals = new Set<ExecutorErrorCode>();
  if (typeof error !== 'object' || error === null) {
    return signals;
  }

  const value = error as Record<string, unknown>;
  if (value['timeout'] === true || value['timedOut'] === true) {
    signals.add('timed_out');
  }
  if (value['unsafe'] === true || value['hazard'] === true) {
    signals.add('unsafe');
  }
  if (value['blocked'] === true || value['routeBlocked'] === true) {
    signals.add('route_blocked');
  }
  if (value['targetMissing'] === true || value['targetUnavailable'] === true) {
    signals.add('target_unavailable');
  }
  if (value['interrupted'] === true) {
    signals.add('interrupted');
  }

  const explicitCode = value['errorCode'];
  if (typeof explicitCode === 'string') {
    const allowed: ExecutorErrorCode[] = [
      'no_path',
      'interrupted',
      'insufficient_materials',
      'inventory_full',
      'tool_missing',
      'unsafe',
      'timed_out',
      'target_unavailable',
      'route_blocked',
      'invalid_state',
    ];
    if (allowed.includes(explicitCode as ExecutorErrorCode)) {
      signals.add(explicitCode as ExecutorErrorCode);
    }
  }

  return signals;
}

function collectSignalsFromActionItem(actionItem: ActionItem | undefined): Set<ExecutorErrorCode> {
  const signals = new Set<ExecutorErrorCode>();
  if (!actionItem) {
    return signals;
  }

  const raw = actionItem.params['failureSignals'];
  if (!Array.isArray(raw)) {
    return signals;
  }

  for (const value of raw) {
    if (typeof value !== 'string') {
      continue;
    }

    if (value === 'timed_out' || value === 'unsafe' || value === 'route_blocked' || value === 'target_unavailable') {
      signals.add(value);
    }
  }

  return signals;
}

function collectSignalsFromText(compact: string): Set<ExecutorErrorCode> {
  const signals = new Set<ExecutorErrorCode>();
  for (const rule of TEXT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(compact))) {
      signals.add(rule.code);
    }
  }

  return signals;
}

function choosePrecedence(signals: Set<ExecutorErrorCode>): ExecutorErrorCode {
  const precedence: ExecutorErrorCode[] = [
    'timed_out',
    'target_unavailable',
    'unsafe',
    'interrupted',
    'insufficient_materials',
    'inventory_full',
    'tool_missing',
    'no_path',
    'route_blocked',
    'invalid_state',
  ];

  for (const code of precedence) {
    if (signals.has(code)) {
      return code;
    }
  }

  return 'invalid_state';
}

export function mapExecutorFailure(error: unknown, actionItem?: ActionItem): FailureMapping {
  const compact = compactErrorMessage(error);
  const signals = new Set<ExecutorErrorCode>([
    ...collectSignalsFromObject(error),
    ...collectSignalsFromActionItem(actionItem),
    ...collectSignalsFromText(compact),
  ]);

  return {
    errorCode: choosePrecedence(signals),
    errorMessage: compact || 'Unknown executor failure',
  };
}
