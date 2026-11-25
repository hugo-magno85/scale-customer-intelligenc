import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  customers,
  contacts,
  roles,
  tenantMemberships,
  tenants,
  users,
  auditLogs,
  sql,
  eq,
} from "../src/index.js";
import { createTestDb, type TestDb } from "../src/testing.js";

/**
 * Testes de isolamento multi-tenant contra PostgreSQL real.
 * Tudo roda como sci_app (sem BYPASSRLS), exatamente como a API.
 */

/** Drizzle encapsula o erro do Postgres em `cause`; validamos a mensagem original. */
async function expectPgError(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    expect(`${e.message} ${e.cause?.message ?? ""}`).toMatch(re);
    return;
  }
  throw new Error("era esperado erro do banco");
}

let t: TestDb;
const A = randomUUID();
const B = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
let roleA = "";
let roleB = "";
let customerA = "";

async function seedTenant(tenantId: string, slug: string, userId: string) {
  await t.app.withContext({ tenantId: null, userId: null, isPlatformAdmin: true }, (tx) =>
    tx.insert(tenants).values({ id: tenantId, name: slug, slug }),
  );
  return t.app.withContext({ tenantId, userId: null }, async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({ tenantId, name: "Admin", systemKey: "tenant_admin", permissions: ["customers.read"] })
      .returning({ id: roles.id });
    await tx.insert(users).values({ id: userId, email: `${slug}@x.com`, name: slug, passwordHash: "x" });
    await tx.insert(tenantMemberships).values({ tenantId, userId, roleId: role!.id });
    return role!.id;
  });
}

beforeAll(async () => {
  t = await createTestDb();
  roleA = await seedTenant(A, "tenant-a", userA);
  roleB = await seedTenant(B, "tenant-b", userB);
  customerA = await t.app.withContext({ tenantId: A, userId: userA }, async (tx) => {
    const [c] = await tx
      .insert(customers)
      .values({ tenantId: A, name: "Cliente A", ownerUserId: userA })
      .returning();
    await tx.insert(contacts).values({ tenantId: A, customerId: c!.id, name: "Contato A" });
    return c!.id;
  });
  await t.app.withContext({ tenantId: B, userId: userB }, (tx) =>
    tx.insert(customers).values({ tenantId: B, name: "Cliente B" }),
  );
});

afterAll(async () => {
  await t?.drop();
});

describe("RLS — isolamento entre tenants", () => {
  it("sem contexto, nenhuma linha de negócio é visível", async () => {
    const rows = await t.app.withContext({ tenantId: null, userId: null }, (tx) =>
      tx.select().from(customers),
    );
    expect(rows).toHaveLength(0);
  });

  it("cada tenant só enxerga seus próprios clientes", async () => {
    const a = await t.app.withContext({ tenantId: A, userId: userA }, (tx) => tx.select().from(customers));
    const b = await t.app.withContext({ tenantId: B, userId: userB }, (tx) => tx.select().from(customers));
    expect(a.map((r) => r.name)).toEqual(["Cliente A"]);
    expect(b.map((r) => r.name)).toEqual(["Cliente B"]);
  });

  it("não permite inserir dados em outro tenant", async () => {
    await expectPgError(
      t.app.withContext({ tenantId: A, userId: userA }, (tx) =>
        tx.insert(customers).values({ tenantId: B, name: "invasão" }),
      ),
      /row-level security/,
    );
  });

  it("não permite ler, alterar ou apagar registro de outro tenant pelo id", async () => {
    await t.app.withContext({ tenantId: B, userId: userB }, async (tx) => {
      expect(await tx.select().from(customers).where(eq(customers.id, customerA))).toHaveLength(0);
      const upd = await tx
        .update(customers)
        .set({ name: "hack" })
        .where(eq(customers.id, customerA))
        .returning();
      expect(upd).toHaveLength(0);
      const del = await tx.delete(customers).where(eq(customers.id, customerA)).returning();
      expect(del).toHaveLength(0);
    });
    const still = await t.app.withContext({ tenantId: A, userId: userA }, (tx) =>
      tx.select().from(customers).where(eq(customers.id, customerA)),
    );
    expect(still[0]?.name).toBe("Cliente A");
  });

  it("não permite mover um registro para outro tenant", async () => {
    await expectPgError(
      t.app.withContext({ tenantId: A, userId: userA }, (tx) =>
        tx.update(customers).set({ tenantId: B }).where(eq(customers.id, customerA)),
      ),
      /./,
    );
  });

  it("chaves compostas impedem vínculo cruzado (contato → cliente de outro tenant)", async () => {
    await expectPgError(
      t.app.withContext({ tenantId: B, userId: userB }, (tx) =>
        tx.insert(contacts).values({ tenantId: B, customerId: customerA, name: "x" }),
      ),
      /foreign key/,
    );
  });

  it("responsável precisa ser membro do mesmo tenant", async () => {
    await expectPgError(
      t.app.withContext({ tenantId: B, userId: userB }, (tx) =>
        tx.insert(customers).values({ tenantId: B, name: "x", ownerUserId: userA }),
      ),
      /foreign key/,
    );
  });

  it("papel de membro precisa ser do mesmo tenant", async () => {
    await expectPgError(
      t.app.withContext({ tenantId: B, userId: userB }, (tx) =>
        tx.update(tenantMemberships).set({ roleId: roleA }).where(eq(tenantMemberships.userId, userB)),
      ),
      /foreign key/,
    );
    expect(roleB).not.toBe(roleA);
  });

  it("usuários de outro tenant não são visíveis", async () => {
    const rows = await t.app.withContext({ tenantId: A, userId: userA }, (tx) => tx.select().from(users));
    expect(rows.map((u) => u.id)).toEqual([userA]);
  });

  it("um usuário só lista os tenants dos quais é membro", async () => {
    const rows = await t.app.withContext({ tenantId: null, userId: userA }, (tx) =>
      tx.select().from(tenants),
    );
    expect(rows.map((r) => r.id)).toEqual([A]);
  });

  it("apenas superadmin cria tenants", async () => {
    await expectPgError(
      t.app.withContext({ tenantId: A, userId: userA }, (tx) =>
        tx.insert(tenants).values({ name: "zz", slug: "zz-x" }),
      ),
      /row-level security/,
    );
  });

  it("aplicação não consegue se promover a superadmin", async () => {
    await expectPgError(
      t.app.withContext({ tenantId: A, userId: userA }, (tx) =>
        tx.insert(users).values({ email: "evil@x.com", name: "e", passwordHash: "x", isPlatformAdmin: true }),
      ),
      /row-level security/,
    );
  });

  it("auditoria é somente inserção", async () => {
    await t.app.withContext({ tenantId: A, userId: userA }, (tx) =>
      tx.insert(auditLogs).values({ tenantId: A, actorUserId: userA, action: "test", entityType: "x" }),
    );
    await expectPgError(
      t.app.withContext({ tenantId: A, userId: userA }, (tx) => tx.update(auditLogs).set({ action: "y" })),
      /permission denied/,
    );
    await expectPgError(
      t.app.withContext({ tenantId: A, userId: userA }, (tx) => tx.delete(auditLogs)),
      /permission denied/,
    );
    const other = await t.app.withContext({ tenantId: B, userId: userB }, (tx) =>
      tx.select().from(auditLogs),
    );
    expect(other).toHaveLength(0);
  });

  it("o contexto não vaza entre transações na mesma conexão", async () => {
    await t.app.withContext({ tenantId: A, userId: userA }, (tx) => tx.select().from(customers));
    const r = await t.app.pool.query("SELECT app.current_tenant() AS t");
    expect(r.rows[0].t).toBeNull();
  });

  it("o papel da aplicação não é dono nem tem BYPASSRLS", async () => {
    const r = await t.app.pool.query(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    const owners = await t.app.pool.query(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tableowner = current_user",
    );
    expect(owners.rows[0].n).toBe(0);
  });

  it("toda tabela de negócio tem RLS habilitado", async () => {
    const owner = new pg.Client({ connectionString: t.ownerUrl });
    await owner.connect();
    const r = await owner.query(
      `SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r' AND relname <> 'schema_migrations'`,
    );
    await owner.end();
    for (const row of r.rows) expect([row.relname, row.relrowsecurity]).toEqual([row.relname, true]);
  });
});

describe("funções de autenticação", () => {
  it("localiza usuário por e-mail sem expor a tabela", async () => {
    const r = await t.app.withContext({ tenantId: null, userId: null }, (tx) =>
      tx.execute(sql`SELECT * FROM app.auth_find_user_by_email('TENANT-A@x.com')`),
    );
    expect(r.rows[0]?.id).toBe(userA);
  });
});
