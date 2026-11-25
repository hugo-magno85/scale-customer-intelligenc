import pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allTables } from "../src/schema.js";
import { createTestDb, type TestDb } from "../src/testing.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t?.drop());

describe("schema Drizzle x migrations", () => {
  it("cada coluna declarada existe no banco com a mesma nulabilidade", async () => {
    const c = new pg.Client({ connectionString: t.ownerUrl });
    await c.connect();
    const { rows } = await c.query<{ table_name: string; column_name: string; is_nullable: string }>(
      "SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema='public'",
    );
    await c.end();
    const db = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.is_nullable === "YES"]));
    for (const table of Object.values(allTables)) {
      const cfg = getTableConfig(table);
      const dbCols = rows
        .filter((r) => r.table_name === cfg.name)
        .map((r) => r.column_name)
        .sort();
      expect(cfg.columns.map((col) => col.name).sort(), cfg.name).toEqual(dbCols);
      for (const col of cfg.columns) {
        expect(db.get(`${cfg.name}.${col.name}`), `${cfg.name}.${col.name}`).toBe(!col.notNull);
      }
    }
  });
});
