import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/migrator.js";
import { createTestDb, type TestDb } from "../src/testing.js";

/**
 * 0009 reescreve dados gravados por versões anteriores. As tabelas usam FORCE ROW LEVEL
 * SECURITY, que vale também para o dono (o usuário das migrations): a migration precisa
 * enxergar as linhas de todos os tenants — regressão do deploy de homologação.
 */
let db: TestDb;
const tenant = randomUUID();
const meeting = randomUUID();
const signal = randomUUID();

beforeAll(async () => {
  db = await createTestDb({ until: "0008_crm_publish.sql" });
  // Dados "antigos": gravados direto (superusuário, sem checar chaves estrangeiras)
  const admin = new pg.Client({
    connectionString: db.ownerUrl.replace(/\/\/[^@]+@/, "//postgres:postgres@"),
  });
  await admin.connect();
  await admin.query("SET session_replication_role = replica");
  await admin.query(
    `INSERT INTO meeting_live_signals (id, tenant_id, meeting_id, kind, key, label, confidence, evidence_text, source, created_at)
     VALUES ($1,$2,$3,'risk','low_adoption','Baixa adoção',0.8,'usamos pouco','jev', now())`,
    [signal, tenant, meeting],
  );
  await admin.query(
    `INSERT INTO meeting_analyses (id, tenant_id, meeting_id, version, status, warnings)
     VALUES ($1,$2,$3,1,'completed', ARRAY['Conferência de evidências (Jev) indisponível nesta análise.'])`,
    [randomUUID(), tenant, meeting],
  );
  await admin.end();
});
afterAll(async () => db?.drop());

describe("migration 0009 (rótulos neutros)", () => {
  it("aplica sobre dados de todos os tenants, mesmo com RLS forçado", async () => {
    const r = await migrate(db.ownerUrl);
    expect(r.applied).toContain("0009_neutral_ai_labels.sql");
    const admin = new pg.Client({
      connectionString: db.ownerUrl.replace(/\/\/[^@]+@/, "//postgres:postgres@"),
    });
    await admin.connect();
    const s = await admin.query("SELECT source FROM meeting_live_signals WHERE id = $1", [signal]);
    const a = await admin.query("SELECT warnings FROM meeting_analyses WHERE tenant_id = $1", [tenant]);
    const forced = await admin.query(
      "SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('meeting_live_signals','meeting_analyses','playbook_versions')",
    );
    await admin.end();
    expect(s.rows[0].source).toBe("ai");
    expect(a.rows[0].warnings).toEqual(["Conferência de evidências indisponível nesta análise."]);
    // o isolamento volta a valer depois da migration
    expect(forced.rows.every((x: { relforcerowsecurity: boolean }) => x.relforcerowsecurity)).toBe(true);
  });
});
