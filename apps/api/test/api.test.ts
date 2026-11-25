import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, login, ORIGIN, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
let superCookie = "";
let tenantA = "";
let tenantB = "";
let adminA = "";
let adminB = "";

beforeAll(async () => {
  ctx = await setup();
  superCookie = await login(ctx, "super@scale.com", "super-senha-segura");
  const s = client(ctx, superCookie);
  const a = await s.post("/platform/tenants", {
    name: "Empresa A",
    slug: "empresa-a",
    admin: { name: "Admin A", email: "admin@a.com", password: "senha-admin-a-123" },
  });
  const b = await s.post("/platform/tenants", {
    name: "Empresa B",
    slug: "empresa-b",
    admin: { name: "Admin B", email: "admin@b.com", password: "senha-admin-b-123" },
  });
  expect(a.statusCode).toBe(201);
  expect(b.statusCode).toBe(201);
  tenantA = a.json().id;
  tenantB = b.json().id;
  adminA = await login(ctx, "admin@a.com", "senha-admin-a-123");
  adminB = await login(ctx, "admin@b.com", "senha-admin-b-123");
});

afterAll(async () => ctx?.close());

describe("health", () => {
  it("live e ready", async () => {
    expect((await ctx.app.inject("/health/live")).statusCode).toBe(200);
    expect((await ctx.app.inject("/health/ready")).json()).toMatchObject({ checks: { database: "ok" } });
  });
});

describe("autenticação", () => {
  it("rejeita senha errada e e-mail inexistente com a mesma resposta", async () => {
    const r1 = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "admin@a.com", password: "x" },
    });
    const r2 = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "nao@existe.com", password: "x" },
    });
    expect(r1.statusCode).toBe(401);
    expect(r2.json()).toEqual(r1.json());
  });

  it("cookie de sessão é httpOnly", async () => {
    const r = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "admin@a.com", password: "senha-admin-a-123" },
    });
    expect(r.cookies[0]).toMatchObject({ name: "sci_session", httpOnly: true, sameSite: "Lax" });
  });

  it("/me lista apenas os tenants do usuário", async () => {
    const me = (await client(ctx, adminA).get("/auth/me")).json();
    expect(me.memberships.map((m: { tenantId: string }) => m.tenantId)).toEqual([tenantA]);
    expect(me.memberships[0].permissions).toContain("users.manage");
  });

  it("sem sessão → 401", async () => {
    expect((await ctx.app.inject("/v1/auth/me")).statusCode).toBe(401);
  });

  it("logout revoga a sessão", async () => {
    const c = await login(ctx, "admin@a.com", "senha-admin-a-123");
    expect((await client(ctx, c).post("/auth/logout")).statusCode).toBe(204);
    expect((await client(ctx, c).get("/auth/me")).statusCode).toBe(401);
  });

  it("bloqueia mutação com cookie vinda de origem não permitida (CSRF)", async () => {
    const r = await ctx.app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { origin: "https://malicioso.com", "x-tenant-id": tenantA },
      cookies: { sci_session: adminA },
      payload: { name: "X" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("token da extensão funciona como Bearer e não emite outro token", async () => {
    const r = await client(ctx, adminA).post("/auth/extension-token");
    expect(r.statusCode).toBe(201);
    const token = r.json().token as string;
    const me = await ctx.app.inject({ url: "/v1/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    const again = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/extension-token",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(again.statusCode).toBe(401);
  });
});

describe("plataforma (superadmin)", () => {
  it("admin de tenant não acessa rotas de plataforma", async () => {
    expect((await client(ctx, adminA).get("/platform/tenants")).statusCode).toBe(403);
  });
  it("superadmin lista tenants e slug duplicado gera 409", async () => {
    const s = client(ctx, superCookie);
    expect((await s.get("/platform/tenants")).json()).toHaveLength(2);
    const dup = await s.post("/platform/tenants", {
      name: "Outra",
      slug: "empresa-a",
      admin: { name: "Xavier", email: "x@x.com", password: "senha-longa-12345" },
    });
    expect(dup.statusCode, dup.body).toBe(409);
  });
});

describe("isolamento entre tenants pela API", () => {
  it("usuário não acessa tenant do qual não é membro", async () => {
    expect((await client(ctx, adminA, tenantB).get("/customers")).statusCode).toBe(403);
  });

  it("dados criados em A não aparecem em B, nem por id", async () => {
    const created = await client(ctx, adminA, tenantA).post("/customers", {
      name: "Cliente Exclusivo A",
      segment: "SaaS",
      mrrCents: 500000,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ mrrSource: "manual", mrrCents: 500000 });
    const id = created.json().id;
    const listB = (await client(ctx, adminB, tenantB).get("/customers")).json();
    expect(listB.items).toHaveLength(0);
    expect((await client(ctx, adminB, tenantB).get(`/customers/${id}`)).statusCode).toBe(404);
    expect((await client(ctx, adminB, tenantB).patch(`/customers/${id}`, { name: "x" })).statusCode).toBe(
      404,
    );
    expect((await client(ctx, adminB, tenantB).del(`/customers/${id}`)).statusCode).toBe(404);
    expect(
      (await client(ctx, adminB, tenantB).post(`/customers/${id}/contacts`, { name: "x" })).statusCode,
    ).toBe(404);
    expect((await client(ctx, adminA, tenantA).get(`/customers/${id}`)).json().name).toBe(
      "Cliente Exclusivo A",
    );
  });

  it("não permite usar como responsável um usuário de outro tenant", async () => {
    const meB = (await client(ctx, adminB).get("/auth/me")).json();
    const r = await client(ctx, adminA, tenantA).post("/customers", { name: "Y", ownerUserId: meB.id });
    expect(r.statusCode).toBe(400);
  });

  it("não permite atribuir papel de outro tenant", async () => {
    const rolesB = (await client(ctx, adminB, tenantB).get("/roles")).json();
    const r = await client(ctx, adminA, tenantA).post("/members", {
      name: "Novo",
      email: "novo@a.com",
      password: "senha-novo-12345",
      roleId: rolesB[0].id,
    });
    expect(r.statusCode).toBe(400);
  });

  it("auditoria de A não mostra eventos de B", async () => {
    const logs = (await client(ctx, adminA, tenantA).get("/audit-logs")).json();
    expect(logs.length).toBeGreaterThan(0);
    const logsB = (await client(ctx, adminB, tenantB).get("/audit-logs")).json();
    const idsA = new Set(logs.map((l: { id: string }) => l.id));
    expect(logsB.some((l: { id: string }) => idsA.has(l.id))).toBe(false);
  });
});

describe("RBAC", () => {
  let analystCookie = "";
  beforeAll(async () => {
    const roles = (await client(ctx, adminA, tenantA).get("/roles")).json();
    const analyst = roles.find((r: { systemKey: string }) => r.systemKey === "analyst");
    const r = await client(ctx, adminA, tenantA).post("/members", {
      name: "Analista",
      email: "analista@a.com",
      password: "senha-analista-123",
      roleId: analyst.id,
    });
    expect(r.statusCode).toBe(201);
    analystCookie = await login(ctx, "analista@a.com", "senha-analista-123");
  });

  it("analista lê clientes mas não cria", async () => {
    const c = client(ctx, analystCookie, tenantA);
    expect((await c.get("/customers")).statusCode).toBe(200);
    expect((await c.post("/customers", { name: "Z" })).statusCode).toBe(403);
    expect((await c.get("/members")).statusCode).toBe(403);
  });

  it("permissões configuráveis por papel", async () => {
    const a = client(ctx, adminA, tenantA);
    const analyst = (await a.get("/roles"))
      .json()
      .find((r: { systemKey: string }) => r.systemKey === "analyst");
    const upd = await a.put(`/roles/${analyst.id}/permissions`, {
      permissions: [...analyst.permissions, "customers.manage"],
    });
    expect(upd.statusCode).toBe(200);
    expect(
      (await client(ctx, analystCookie, tenantA).post("/customers", { name: "Agora pode" })).statusCode,
    ).toBe(201);
  });

  it("não permite reduzir o papel de administrador nem ficar sem admin", async () => {
    const a = client(ctx, adminA, tenantA);
    const roles = (await a.get("/roles")).json();
    const admin = roles.find((r: { systemKey: string }) => r.systemKey === "tenant_admin");
    const cs = roles.find((r: { systemKey: string }) => r.systemKey === "cs");
    expect((await a.put(`/roles/${admin.id}/permissions`, { permissions: [] })).statusCode).toBe(400);
    const me = (await a.get("/auth/me")).json();
    expect((await a.patch(`/members/${me.id}`, { roleId: cs.id })).statusCode).toBe(400);
    expect((await a.patch(`/members/${me.id}`, { status: "disabled" })).statusCode).toBe(400);
  });

  it("usuário desativado perde acesso ao tenant", async () => {
    const a = client(ctx, adminA, tenantA);
    const me = (await client(ctx, analystCookie).get("/auth/me")).json();
    expect((await a.patch(`/members/${me.id}`, { status: "disabled" })).statusCode).toBe(200);
    expect((await client(ctx, analystCookie, tenantA).get("/customers")).statusCode).toBe(403);
  });
});

describe("carteira e dashboard", () => {
  it("busca, contatos e resumo sem números fictícios", async () => {
    const a = client(ctx, adminA, tenantA);
    const c = (await a.post("/customers", { name: "Busca 100%_teste" })).json();
    const found = (await a.get(`/customers?q=${encodeURIComponent("100%_")}`)).json();
    expect(found.items.map((i: { id: string }) => i.id)).toEqual([c.id]);
    expect(
      (await a.post(`/customers/${c.id}/contacts`, { name: "Maria", email: "maria@cliente.com" })).statusCode,
    ).toBe(201);
    expect((await a.get(`/customers/${c.id}/contacts`)).json()).toHaveLength(1);
    const dash = (await a.get("/dashboard/summary")).json();
    expect(dash.activeCustomers).toBeGreaterThan(0);
    expect(dash.averageHealth).toBeNull();
    expect(dash.revenueAtRiskCents).toBeNull();
  });

  it("validação retorna 400 estruturado", async () => {
    const r = await client(ctx, adminA, tenantA).post("/customers", { name: "" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("validation_error");
  });

  it("CORS só libera a origem configurada", async () => {
    const ok = await ctx.app.inject({
      method: "OPTIONS",
      url: "/v1/customers",
      headers: { origin: ORIGIN, "access-control-request-method": "GET" },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe(ORIGIN);
    const bad = await ctx.app.inject({
      method: "OPTIONS",
      url: "/v1/customers",
      headers: { origin: "https://x.com", "access-control-request-method": "GET" },
    });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
