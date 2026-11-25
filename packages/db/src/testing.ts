import { randomBytes } from "node:crypto";
import pg from "pg";
import { createDatabase, type Database } from "./client.js";
import { migrate } from "./migrator.js";

/**
 * Cria um banco PostgreSQL descartável, aplica as migrations como sci_owner
 * e devolve conexões como sci_app (sujeito a RLS) e como owner.
 *
 * Requer TEST_PG_ADMIN_URL (superusuário) — ex.: postgres://postgres:postgres@localhost:5432/postgres
 */
export interface TestDb {
  name: string;
  appUrl: string;
  ownerUrl: string;
  app: Database;
  drop(): Promise<void>;
}

const OWNER_PW = process.env.TEST_PG_OWNER_PASSWORD ?? "sci_owner_test";
const APP_PW = process.env.TEST_PG_APP_PASSWORD ?? "sci_app_test";

function withDb(url: string, db: string, user?: string, password?: string) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export async function createTestDb(): Promise<TestDb> {
  const adminUrl = process.env.TEST_PG_ADMIN_URL;
  if (!adminUrl) throw new Error("TEST_PG_ADMIN_URL não definida");
  const name = `sci_test_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sci_owner') THEN CREATE ROLE sci_owner LOGIN PASSWORD '${OWNER_PW}'; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sci_app') THEN CREATE ROLE sci_app LOGIN PASSWORD '${APP_PW}' NOBYPASSRLS; END IF;
    END $$`);
    await admin.query(`ALTER ROLE sci_app LOGIN PASSWORD '${APP_PW}'`);
    await admin.query(`ALTER ROLE sci_owner LOGIN PASSWORD '${OWNER_PW}'`);
    await admin.query(`CREATE DATABASE ${name} OWNER sci_owner`);
  } finally {
    await admin.end();
  }
  const ownerUrl = withDb(adminUrl, name, "sci_owner", OWNER_PW);
  const appUrl = withDb(adminUrl, name, "sci_app", APP_PW);
  await migrate(ownerUrl);
  const app = createDatabase(appUrl, { max: 4 });
  return {
    name,
    appUrl,
    ownerUrl,
    app,
    async drop() {
      await app.close();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
