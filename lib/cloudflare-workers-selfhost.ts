import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type SqlValue = string | number | bigint | null | Uint8Array;

function normalizeValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value);
}

class LocalPreparedStatement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private readonly values: SqlValue[];

  constructor(database: DatabaseSync, sql: string, values: SqlValue[] = []) {
    this.database = database; this.sql = sql; this.values = values;
  }

  bind(...values: unknown[]) {
    return new LocalPreparedStatement(this.database, this.sql, values.map(normalizeValue));
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }

  execute() {
    if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(this.sql)) return { results: this.database.prepare(this.sql).all(...this.values), success: true, meta: {} };
    const result = this.database.prepare(this.sql).run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

class LocalD1Database {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql: string) {
    return new LocalPreparedStatement(this.database, sql);
  }

  async batch(statements: LocalPreparedStatement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      // Do not yield inside a DatabaseSync transaction on this shared connection.
      for (const statement of statements) results.push(statement.execute());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

type ObjectMetadata = { contentType?: string; customMetadata?: Record<string, string> };

class LocalBucket {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  private resolve(key: string) {
    const safeKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const target = path.resolve(this.root, safeKey);
    const relative = path.relative(path.resolve(this.root), target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("非法文件路径");
    return target;
  }

  async put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value instanceof Uint8Array ? value : new Uint8Array(value));
    const metadata: ObjectMetadata = { contentType: options?.httpMetadata?.contentType, customMetadata: options?.customMetadata };
    await writeFile(`${target}.metadata.json`, JSON.stringify(metadata));
    return { key };
  }

  async get(key: string) {
    const target = this.resolve(key);
    try {
      const buffer = await readFile(target);
      let metadata: ObjectMetadata = {};
      try { metadata = JSON.parse(readFileSync(`${target}.metadata.json`, "utf8")) as ObjectMetadata; } catch { /* optional metadata */ }
      return {
        body: new Blob([buffer]).stream(),
        httpMetadata: { contentType: metadata.contentType },
        customMetadata: metadata.customMetadata,
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", metadata.contentType || "application/octet-stream");
          headers.set("Content-Length", String(buffer.byteLength));
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    const target = this.resolve(key);
    await Promise.all([rm(target, { force: true }), rm(`${target}.metadata.json`, { force: true })]);
  }
}

const dataDirectory = process.env.DATA_DIR || "/data";
const databasePath = process.env.DATABASE_PATH || path.join(dataDirectory, "forgehub.sqlite");
const fileStoragePath = process.env.FILE_STORAGE_DIR || path.join(dataDirectory, "files");

export const env = {
  DB: new LocalD1Database(databasePath) as unknown as D1Database,
  FIRMWARE_BUCKET: new LocalBucket(fileStoragePath) as unknown as R2Bucket,
};
