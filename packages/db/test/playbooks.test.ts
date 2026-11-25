import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  csSkillVersions,
  eq,
  playbooks,
  playbookVersions,
  roles,
  tenantMemberships,
  tenants,
  users,
} from "../src/index.js";
import { createTestDb, type TestDb } from "../src/testing.js";

let t: TestDb;
const A = randomUUID();
const B = randomUUID();
const uA = randomUUID();
let playbookA = "";

async function pgErr(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  throw new Error("era esperado erro do banco");
}

beforeAll(async () => {
  t = await createTestDb();
  for (const [id, slug] of [
    [A, "pa"],
    [B, "pb"],
  ] as const) {
    await t.app.withContext({ tenantId: null, userId: null, isPlatformAdmin: true }, (tx) =>
      tx.insert(tenants).values({ id, name: slug, slug }),
    );
  }
  await t.app.withContext({ tenantId: A, userId: null }, async (tx) => {
    const [r] = await tx
      .insert(roles)
      .values({ tenantId: A, name: "Adm", systemKey: "tenant_admin" })
      .returning();
    await tx.insert(users).values({ id: uA, email: "pa@x.com", name: "pa", passwordHash: "x" });
    await tx.insert(tenantMemberships).values({ tenantId: A, userId: uA, roleId: r!.id });
    await tx.insert(csSkillVersions).values({ version: "1.0.0", contentHash: "h", releasedAt: "2026-11-25" });
    const [p] = await tx
      .insert(playbooks)
      .values({ tenantId: A, name: "Onboarding", meetingType: "onboarding" })
      .returning();
    playbookA = p!.id;
  });
});
afterAll(async () => t?.drop());

describe("playbooks no banco", () => {
  it("versão publicada é imutável", async () => {
    const id = await t.app.withContext({ tenantId: A, userId: uA }, async (tx) => {
      const [v] = await tx
        .insert(playbookVersions)
        .values({
          tenantId: A,
          playbookId: playbookA,
          number: 1,
          status: "published",
          source: "manual",
          structure: { questions: [] },
          approvedBy: uA,
          skillVersion: "1.0.0",
        })
        .returning();
      return v!.id;
    });
    const msg = await pgErr(
      t.app.withContext({ tenantId: A, userId: uA }, (tx) =>
        tx
          .update(playbookVersions)
          .set({ structure: { questions: [{ x: 1 }] } })
          .where(eq(playbookVersions.id, id)),
      ),
    );
    expect(msg).toContain("não pode ser editada");
  });

  it("só uma versão publicada por playbook", async () => {
    const msg = await pgErr(
      t.app.withContext({ tenantId: A, userId: uA }, (tx) =>
        tx.insert(playbookVersions).values({
          tenantId: A,
          playbookId: playbookA,
          number: 2,
          status: "published",
          source: "manual",
          structure: {},
          approvedBy: uA,
        }),
      ),
    );
    expect(msg).toMatch(/duplicate key|one_published/);
  });

  it("aprovação exige estrutura e aprovador", async () => {
    const msg = await pgErr(
      t.app.withContext({ tenantId: A, userId: uA }, (tx) =>
        tx
          .insert(playbookVersions)
          .values({ tenantId: A, playbookId: playbookA, number: 3, status: "approved", source: "manual" }),
      ),
    );
    expect(msg).toMatch(/check/);
  });

  it("outro tenant não vê nem cria versão no playbook de A", async () => {
    const rows = await t.app.withContext({ tenantId: B, userId: null }, (tx) => tx.select().from(playbooks));
    expect(rows).toHaveLength(0);
    const msg = await pgErr(
      t.app.withContext({ tenantId: B, userId: null }, (tx) =>
        tx
          .insert(playbookVersions)
          .values({ tenantId: B, playbookId: playbookA, number: 9, status: "draft", source: "manual" }),
      ),
    );
    expect(msg).toMatch(/foreign key/);
  });
});
