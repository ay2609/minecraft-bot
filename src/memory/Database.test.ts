import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryDatabase } from './Database';
import { REQUIRED_MEMORY_TABLES } from './schema';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testWalModeAndSchemaBootstrap(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'minecraft-bot-memory-test-'));
  const dbPath = join(tempDir, 'memory.db');
  const database = new MemoryDatabase({ dbPath, sqliteBusyTimeoutMs: 1000 });

  try {
    database.initializeSchema();

    const journalMode = database.getJournalMode();
    assert(journalMode === 'wal', `Expected journal_mode=wal, got ${journalMode}`);

    const existingTables = new Set(database.getExistingTables());
    for (const tableName of REQUIRED_MEMORY_TABLES) {
      assert(existingTables.has(tableName), `Missing required table: ${tableName}`);
    }
    assert(database.isReady(), 'Database readiness check failed after initialization');

    database.initializeSchema();
    assert(database.isReady(), 'Database readiness check failed after second initialization');
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

testWalModeAndSchemaBootstrap();
console.log('MemoryDatabase bootstrap: PASS');

export {};
