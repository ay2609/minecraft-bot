export const REQUIRED_MEMORY_TABLES = [
  'locations',
  'resources',
  'routes',
  'structures',
  'server_facts',
  'episodes',
] as const;

export const MEMORY_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    dimension TEXT NOT NULL DEFAULT 'overworld',
    confidence REAL NOT NULL DEFAULT 1.0,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_locations_dimension_name ON locations(dimension, name);`,
  `CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_type TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    quantity INTEGER,
    source TEXT NOT NULL DEFAULT 'observed',
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(resource_type);`,
  `CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_label TEXT NOT NULL,
    to_label TEXT NOT NULL,
    path_json TEXT NOT NULL,
    cost REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_routes_labels ON routes(from_label, to_label);`,
  `CREATE TABLE IF NOT EXISTS structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    structure_type TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    notes TEXT,
    discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_structures_type ON structures(structure_type);`,
  `CREATE TABLE IF NOT EXISTS server_facts (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal TEXT NOT NULL,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,
    failure_reason TEXT,
    context_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_episodes_goal_created_at ON episodes(goal, created_at DESC);`,
];
