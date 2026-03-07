import DatabaseDriver from 'better-sqlite3';
import type { Database as SqliteConnection } from 'better-sqlite3';

export interface EpisodicMemoryRepositoryOptions {
  dbPath: string;
  sqliteBusyTimeoutMs?: number;
}

export type EpisodeOutcome = 'success' | 'failure';

export interface EpisodeInput {
  goal: string;
  action: string;
  outcome: EpisodeOutcome;
  failureReason: string | null;
  context: Record<string, unknown> | null;
}

export interface EpisodeRecord {
  id: number;
  goal: string;
  action: string;
  outcome: EpisodeOutcome;
  failureReason: string | null;
  context: Record<string, unknown> | null;
  createdAt: string;
}

interface EpisodeRow {
  id: number;
  goal: string;
  action: string;
  outcome: EpisodeOutcome;
  failure_reason: string | null;
  context_json: string | null;
  created_at: string;
}

function parseContext(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as Record<string, unknown>;
}

function mapEpisode(row: EpisodeRow): EpisodeRecord {
  return {
    id: row.id,
    goal: row.goal,
    action: row.action,
    outcome: row.outcome,
    failureReason: row.failure_reason,
    context: parseContext(row.context_json),
    createdAt: row.created_at,
  };
}

export class EpisodicMemoryRepository {
  private readonly connection: SqliteConnection;

  constructor(options: EpisodicMemoryRepositoryOptions) {
    this.connection = new DatabaseDriver(options.dbPath, {
      timeout: options.sqliteBusyTimeoutMs ?? 5000,
    });
  }

  recordEpisode(input: EpisodeInput): number {
    const result = this.connection
      .prepare(
        `INSERT INTO episodes (goal, action, outcome, failure_reason, context_json, created_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        input.goal,
        input.action,
        input.outcome,
        input.failureReason,
        input.context ? JSON.stringify(input.context) : null,
      );

    return Number(result.lastInsertRowid);
  }

  listByGoal(goal: string, limit = 50): EpisodeRecord[] {
    const rows = this.connection
      .prepare(
        `SELECT id, goal, action, outcome, failure_reason, context_json, created_at
         FROM episodes
         WHERE goal = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(goal, limit) as EpisodeRow[];

    return rows.map(mapEpisode);
  }

  listByGoalType(goalType: string, limit = 50): EpisodeRecord[] {
    const rows = this.connection
      .prepare(
        `SELECT id, goal, action, outcome, failure_reason, context_json, created_at
         FROM episodes
         WHERE context_json IS NOT NULL
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit * 5) as EpisodeRow[];

    const filtered = rows.filter((row) => {
      const context = parseContext(row.context_json);
      return context?.['goalType'] === goalType;
    });

    return filtered.slice(0, limit).map(mapEpisode);
  }

  listFailures(goal?: string, limit = 25): EpisodeRecord[] {
    const rows = goal
      ? (this.connection
          .prepare(
            `SELECT id, goal, action, outcome, failure_reason, context_json, created_at
             FROM episodes
             WHERE goal = ? AND outcome = 'failure'
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(goal, limit) as EpisodeRow[])
      : (this.connection
          .prepare(
            `SELECT id, goal, action, outcome, failure_reason, context_json, created_at
             FROM episodes
             WHERE outcome = 'failure'
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(limit) as EpisodeRow[]);

    return rows.map(mapEpisode);
  }

  listRecent(limit = 25): EpisodeRecord[] {
    const rows = this.connection
      .prepare(
        `SELECT id, goal, action, outcome, failure_reason, context_json, created_at
         FROM episodes
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as EpisodeRow[];

    return rows.map(mapEpisode);
  }

  close(): void {
    if (this.connection.open) {
      this.connection.close();
    }
  }
}
