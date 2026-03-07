import DatabaseDriver from 'better-sqlite3';
import type { Database as SqliteConnection } from 'better-sqlite3';
import type { Vec3Like } from '../types/index';

export interface SemanticMemoryRepositoryOptions {
  dbPath: string;
  sqliteBusyTimeoutMs?: number;
}

export interface LocationRecord {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  confidence: number;
  lastSeenAt: string;
}

export interface ResourceRecord {
  id: number;
  resourceType: string;
  x: number;
  y: number;
  z: number;
  quantity: number | null;
  source: string;
  observedAt: string;
}

export interface RouteRecord {
  id: number;
  fromLabel: string;
  toLabel: string;
  path: Vec3Like[];
  cost: number | null;
  createdAt: string;
}

export interface StructureRecord {
  id: number;
  structureType: string;
  x: number;
  y: number;
  z: number;
  notes: string | null;
  discoveredAt: string;
}

export interface NearbyLocation extends LocationRecord {
  distance: number;
}

export interface UpsertLocationInput {
  name: string;
  x: number;
  y: number;
  z: number;
  dimension?: string;
  confidence?: number;
}

export interface ResourceInput {
  resourceType: string;
  x: number;
  y: number;
  z: number;
  quantity?: number | null;
  source?: string;
}

export interface RouteInput {
  fromLabel: string;
  toLabel: string;
  path: Vec3Like[];
  cost?: number | null;
}

export interface StructureInput {
  structureType: string;
  x: number;
  y: number;
  z: number;
  notes?: string | null;
}

export interface NearbyQuery {
  dimension: string;
  center: Vec3Like;
  maxDistance: number;
  limit?: number;
}

interface LocationRow {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  confidence: number;
  last_seen_at: string;
}

interface ResourceRow {
  id: number;
  resource_type: string;
  x: number;
  y: number;
  z: number;
  quantity: number | null;
  source: string;
  observed_at: string;
}

interface RouteRow {
  id: number;
  from_label: string;
  to_label: string;
  path_json: string;
  cost: number | null;
  created_at: string;
}

interface StructureRow {
  id: number;
  structure_type: string;
  x: number;
  y: number;
  z: number;
  notes: string | null;
  discovered_at: string;
}

interface NearbyRow extends LocationRow {
  distance_sq: number;
}

interface ServerFactRow {
  value_json: string;
}

function parsePath(pathJson: string): Vec3Like[] {
  return JSON.parse(pathJson) as Vec3Like[];
}

function mapLocation(row: LocationRow): LocationRecord {
  return {
    id: row.id,
    name: row.name,
    x: row.x,
    y: row.y,
    z: row.z,
    dimension: row.dimension,
    confidence: row.confidence,
    lastSeenAt: row.last_seen_at,
  };
}

function mapResource(row: ResourceRow): ResourceRecord {
  return {
    id: row.id,
    resourceType: row.resource_type,
    x: row.x,
    y: row.y,
    z: row.z,
    quantity: row.quantity,
    source: row.source,
    observedAt: row.observed_at,
  };
}

function mapRoute(row: RouteRow): RouteRecord {
  return {
    id: row.id,
    fromLabel: row.from_label,
    toLabel: row.to_label,
    path: parsePath(row.path_json),
    cost: row.cost,
    createdAt: row.created_at,
  };
}

function mapStructure(row: StructureRow): StructureRecord {
  return {
    id: row.id,
    structureType: row.structure_type,
    x: row.x,
    y: row.y,
    z: row.z,
    notes: row.notes,
    discoveredAt: row.discovered_at,
  };
}

export class SemanticMemoryRepository {
  private readonly connection: SqliteConnection;

  constructor(options: SemanticMemoryRepositoryOptions) {
    this.connection = new DatabaseDriver(options.dbPath, {
      timeout: options.sqliteBusyTimeoutMs ?? 5000,
    });
  }

  upsertLocation(input: UpsertLocationInput): number {
    const existing = this.connection
      .prepare(
        `SELECT id
         FROM locations
         WHERE name = ? AND dimension = ?
         LIMIT 1`,
      )
      .get(input.name, input.dimension ?? 'overworld') as { id: number } | undefined;

    if (existing) {
      this.connection
        .prepare(
          `UPDATE locations
           SET x = ?, y = ?, z = ?, confidence = ?, last_seen_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(
          input.x,
          input.y,
          input.z,
          input.confidence ?? 1,
          existing.id,
        );
      return existing.id;
    }

    const result = this.connection
      .prepare(
        `INSERT INTO locations (name, x, y, z, dimension, confidence, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        input.name,
        input.x,
        input.y,
        input.z,
        input.dimension ?? 'overworld',
        input.confidence ?? 1,
      );

    return Number(result.lastInsertRowid);
  }

  listLocationsByName(name: string, dimension?: string): LocationRecord[] {
    const rows = dimension
      ? (this.connection
          .prepare(
            `SELECT id, name, x, y, z, dimension, confidence, last_seen_at
             FROM locations
             WHERE name = ? AND dimension = ?
             ORDER BY last_seen_at DESC`,
          )
          .all(name, dimension) as LocationRow[])
      : (this.connection
          .prepare(
            `SELECT id, name, x, y, z, dimension, confidence, last_seen_at
             FROM locations
             WHERE name = ?
             ORDER BY last_seen_at DESC`,
          )
          .all(name) as LocationRow[]);

    return rows.map(mapLocation);
  }

  findNearby(query: NearbyQuery): NearbyLocation[] {
    const maxDistance = Math.max(query.maxDistance, 0);
    const xMin = query.center.x - maxDistance;
    const xMax = query.center.x + maxDistance;
    const yMin = query.center.y - maxDistance;
    const yMax = query.center.y + maxDistance;
    const zMin = query.center.z - maxDistance;
    const zMax = query.center.z + maxDistance;

    const rows = this.connection
      .prepare(
        `SELECT
           id,
           name,
           x,
           y,
           z,
           dimension,
           confidence,
           last_seen_at,
           ((x - @centerX) * (x - @centerX)) +
           ((y - @centerY) * (y - @centerY)) +
           ((z - @centerZ) * (z - @centerZ)) AS distance_sq
         FROM locations
         WHERE dimension = @dimension
           AND x BETWEEN @xMin AND @xMax
           AND y BETWEEN @yMin AND @yMax
           AND z BETWEEN @zMin AND @zMax
         ORDER BY distance_sq ASC
         LIMIT @limit`,
      )
      .all({
        centerX: query.center.x,
        centerY: query.center.y,
        centerZ: query.center.z,
        dimension: query.dimension,
        xMin,
        xMax,
        yMin,
        yMax,
        zMin,
        zMax,
        limit: query.limit ?? 25,
      }) as NearbyRow[];

    const maxDistanceSq = maxDistance * maxDistance;
    return rows
      .filter((row) => row.distance_sq <= maxDistanceSq)
      .map((row) => ({
        ...mapLocation(row),
        distance: Math.sqrt(row.distance_sq),
      }));
  }

  recordResource(input: ResourceInput): number {
    const result = this.connection
      .prepare(
        `INSERT INTO resources (resource_type, x, y, z, quantity, source, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        input.resourceType,
        input.x,
        input.y,
        input.z,
        input.quantity ?? null,
        input.source ?? 'observed',
      );

    return Number(result.lastInsertRowid);
  }

  listResourcesByType(resourceType: string, limit = 50): ResourceRecord[] {
    const rows = this.connection
      .prepare(
        `SELECT id, resource_type, x, y, z, quantity, source, observed_at
         FROM resources
         WHERE resource_type = ?
         ORDER BY observed_at DESC
         LIMIT ?`,
      )
      .all(resourceType, limit) as ResourceRow[];

    return rows.map(mapResource);
  }

  recordRoute(input: RouteInput): number {
    const result = this.connection
      .prepare(
        `INSERT INTO routes (from_label, to_label, path_json, cost, created_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        input.fromLabel,
        input.toLabel,
        JSON.stringify(input.path),
        input.cost ?? null,
      );

    return Number(result.lastInsertRowid);
  }

  listRoutes(fromLabel: string, toLabel?: string, limit = 25): RouteRecord[] {
    const rows = toLabel
      ? (this.connection
          .prepare(
            `SELECT id, from_label, to_label, path_json, cost, created_at
             FROM routes
             WHERE from_label = ? AND to_label = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(fromLabel, toLabel, limit) as RouteRow[])
      : (this.connection
          .prepare(
            `SELECT id, from_label, to_label, path_json, cost, created_at
             FROM routes
             WHERE from_label = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(fromLabel, limit) as RouteRow[]);

    return rows.map(mapRoute);
  }

  recordStructure(input: StructureInput): number {
    const result = this.connection
      .prepare(
        `INSERT INTO structures (structure_type, x, y, z, notes, discovered_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        input.structureType,
        input.x,
        input.y,
        input.z,
        input.notes ?? null,
      );

    return Number(result.lastInsertRowid);
  }

  listStructuresByType(structureType: string, limit = 50): StructureRecord[] {
    const rows = this.connection
      .prepare(
        `SELECT id, structure_type, x, y, z, notes, discovered_at
         FROM structures
         WHERE structure_type = ?
         ORDER BY discovered_at DESC
         LIMIT ?`,
      )
      .all(structureType, limit) as StructureRow[];

    return rows.map(mapStructure);
  }

  setServerFact(key: string, value: unknown): void {
    this.connection
      .prepare(
        `INSERT INTO server_facts (key, value_json, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(key, JSON.stringify(value));
  }

  getServerFact<TValue>(key: string): TValue | null {
    const row = this.connection
      .prepare('SELECT value_json FROM server_facts WHERE key = ? LIMIT 1')
      .get(key) as ServerFactRow | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.value_json) as TValue;
  }

  close(): void {
    if (this.connection.open) {
      this.connection.close();
    }
  }
}
