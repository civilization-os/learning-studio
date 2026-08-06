import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";
import { mkdirSync } from "node:fs";

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataDir = join(rootDir, "data");
mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.APP_DB_PATH ?? join(dataDir, "learning-studio.db");
export const sqlite = new Database(dbPath);

sqlite.pragma("foreign_keys = ON");
sqlite.pragma("journal_mode = WAL");

const migrateDatabase = sqlite.transaction(() => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '',
      nickname TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ai_settings TEXT NOT NULL,
      web_search_settings TEXT NOT NULL,
      encrypted_secrets TEXT
    );

    CREATE TABLE IF NOT EXISTS verification_codes (
      email TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS projects_user_updated_idx
      ON projects(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS verification_codes_expiry_idx
      ON verification_codes(expires_at);
  `);

  const userColumns = sqlite
    .prepare("PRAGMA table_info(users)")
    .all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "nickname")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT '';");
  }

  sqlite.pragma("user_version = 1");
});

migrateDatabase();

export const db = drizzle(sqlite, { schema });
