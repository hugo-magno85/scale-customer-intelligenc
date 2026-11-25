import { describe, expect, it } from "vitest";
import { CreateTenantRequest, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, LoginRequest } from "./index.js";

describe("contracts", () => {
  it("normaliza e-mail no login", () => {
    expect(LoginRequest.parse({ email: "  Ana@Exemplo.COM ", password: "x" }).email).toBe("ana@exemplo.com");
  });

  it("rejeita slug inválido e senha curta", () => {
    const r = CreateTenantRequest.safeParse({
      name: "Acme",
      slug: "Acme Corp",
      admin: { name: "Ana", email: "ana@acme.com", password: "curta" },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("slug");
      expect(paths).toContain("admin.password");
    }
  });

  it("papéis padrão só usam permissões do catálogo", () => {
    for (const perms of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) expect(PERMISSIONS).toContain(p);
    }
    expect(DEFAULT_ROLE_PERMISSIONS.analyst).not.toContain("customers.manage");
  });
});
