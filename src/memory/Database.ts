import { dirname } from 'path';
import { mkdirSync } from 'fs';
import DatabaseDriver from 'better-sqlite3';
import type { Database as SqliteConnection } from 'better-sqlite3';
import { MEMORY_SCHEMA_STATEMENTS, REQUIRED_MEMORY_TABLES } from './schema';

export interface MemoryDatabaseOptions {
  dbPath: string;
  sqliteBusyTimeoutMs?: number;
}

interface JournalModeRow {
  journal_mode: string;
}

interface NameRow {
  name: string;
}

export class MemoryDatabase {
  private readonly connection: SqliteConnection;
  private initialized = false;

  constructor(private readonly options: MemoryDatabaseOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });

    this.connection = new DatabaseDriver(options.dbPath, {
      timeout: options.sqliteBusyTimeoutMs ?? 5000,
    });
  }

  initializeSchema(): void {
    this.connection.pragma('journal_mode = WAL');
    this.connection.pragma('synchronous = NORMAL');
    this.connection.pragma('foreign_keys = ON');
    this.connection.pragma(`busy_timeout = ${this.options.sqliteBusyTimeoutMs ?? 5000}`);

    const applySchema = this.connection.transaction((statements: readonly string[]) => {
      for (const statement of statements) {
        this.connection.exec(statement);
      }
    });

    applySchema(MEMORY_SCHEMA_STATEMENTS);
    this.initialized = true;
  }

  isReady(): boolean {
    if (!this.initialized) {
      return false;
    }

    const tables = new Set(this.getExistingTables());
    return REQUIRED_MEMORY_TABLES.every((tableName) => tables.has(tableName));
  }

  getJournalMode(): string {
    const row = this.connection.prepare('PRAGMA journal_mode;').get() as JournalModeRow;
    return row.journal_mode.toLowerCase();
  }

  getExistingTables(): string[] {
    const rows = this.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
      )
      .all() as NameRow[];
    return rows.map((row) => row.name);
  }

  close(): void {
    if (this.connection.open) {
      this.connection.close();
    }
    this.initialized = false;
  }
}
