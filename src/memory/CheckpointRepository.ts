import DatabaseDriver from 'better-sqlite3';
import type { Database as SqliteConnection } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { PlanCheckpointCommitInput, PlanCheckpointRecord } from '../types/index';

const DEFAULT_CHECKPOINT_KEY = 'working_memory_checkpoint';

export interface CheckpointRepositoryOptions {
  dbPath: string;
  sqliteBusyTimeoutMs?: number;
  checkpointFactKey?: string;
}

interface ServerFactRow {
  value_json: string;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export class CheckpointRepository {
  private readonly checkpointFactKey: string;
  private readonly connection: SqliteConnection;

  constructor(options: CheckpointRepositoryOptions) {
    this.checkpointFactKey = options.checkpointFactKey ?? DEFAULT_CHECKPOINT_KEY;
    this.connection = new DatabaseDriver(options.dbPath, {
      timeout: options.sqliteBusyTimeoutMs ?? 5000,
    });
  }

  commitCheckpoint(input: PlanCheckpointCommitInput): string {
    const checkpointId = randomUUID();
    const committedAt = new Date().toISOString();
    const record: PlanCheckpointRecord = {
      checkpointId,
      committedAt,
      commitReason: input.commitReason,
      payload: {
        plan: cloneValue(input.plan),
        activeSubgoalId: input.activeSubgoalId,
        actionQueue: cloneValue(input.actionQueue),
        constraints: cloneValue(input.constraints),
      },
    };

    this.connection
      .prepare(
        `INSERT INTO server_facts (key, value_json, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(this.checkpointFactKey, JSON.stringify(record));

    return checkpointId;
  }

  loadLatestActiveCheckpoint(): PlanCheckpointRecord | null {
    const row = this.connection
      .prepare('SELECT value_json FROM server_facts WHERE key = ? LIMIT 1')
      .get(this.checkpointFactKey) as ServerFactRow | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.value_json) as PlanCheckpointRecord;
  }

  close(): void {
    if (this.connection.open) {
      this.connection.close();
    }
  }
}

export { DEFAULT_CHECKPOINT_KEY };
