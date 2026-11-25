import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const out: MigrationFile[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    out.push({
      version: file.slice(0, 4),
      name: file,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  const versions = new Set(out.map((m) => m.version));
  if (versions.size !== out.length) throw new Error("versões de migration duplicadas");
  return out;
}

export interface MigrateResult {
  applied: string[];
  pending: string[];
}

/**
 * Aplica migrations pendentes, cada uma em sua própria transação.
 * Falha se uma migration já aplicada tiver sido alterada (checksum).
 * Usa advisory lock para impedir execuções concorrentes.
 */
export async function migrate(
  connectionString: string,
  opts: { check?: boolean; dir?: string } = {},
): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ version: string; checksum: string; name: string }>(
      "SELECT version, checksum, name FROM schema_migrations",
    );
    const done = new Map(rows.map((r) => [r.version, r]));
    const files = await loadMigrations(opts.dir);
    for (const f of files) {
      const prev = done.get(f.version);
      if (prev && prev.checksum !== f.checksum) {
        throw new Error(`migration ${f.name} foi alterada depois de aplicada; crie uma nova migration`);
      }
    }
    const pending = files.filter((f) => !done.has(f.version));
    if (opts.check) return { applied: [], pending: pending.map((p) => p.name) };
    const applied: string[] = [];
    for (const f of pending) {
      await client.query("BEGIN");
      try {
        await client.query(f.sql);
        await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
          f.version,
          f.name,
          f.checksum,
        ]);
        await client.query("COMMIT");
        applied.push(f.name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`falha em ${f.name}: ${(err as Error).message}`, { cause: err });
      }
    }
    return { applied, pending: [] };
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => undefined);
    await client.end();
  }
}
