import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  hashToken,
  keyringFromEnv,
  verifyPassword,
} from "./index.js";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");

describe("criptografia de credenciais", () => {
  it("cifra e decifra com AAD", () => {
    const ring = keyringFromEnv({ SCI_ENCRYPTION_KEYS: `k1:${k1}`, SCI_ENCRYPTION_ACTIVE_KEY: "k1" });
    const enc = encryptSecret("token-secreto", ring, "tenant-a");
    expect(enc).not.toContain("token-secreto");
    expect(decryptSecret(enc, ring, "tenant-a")).toBe("token-secreto");
  });

  it("falha se o AAD (tenant) for outro", () => {
    const ring = keyringFromEnv({ SCI_ENCRYPTION_KEYS: `k1:${k1}`, SCI_ENCRYPTION_ACTIVE_KEY: "k1" });
    const enc = encryptSecret("token-secreto", ring, "tenant-a");
    expect(() => decryptSecret(enc, ring, "tenant-b")).toThrow();
  });

  it("suporta rotação de chave", () => {
    const old = keyringFromEnv({ SCI_ENCRYPTION_KEYS: `k1:${k1}`, SCI_ENCRYPTION_ACTIVE_KEY: "k1" });
    const enc = encryptSecret("abc", old);
    const rotated = keyringFromEnv({
      SCI_ENCRYPTION_KEYS: `k1:${k1},k2:${k2}`,
      SCI_ENCRYPTION_ACTIVE_KEY: "k2",
    });
    expect(decryptSecret(enc, rotated)).toBe("abc");
    expect(encryptSecret("abc", rotated).split(":")[1]).toBe("k2");
  });

  it("rejeita chave de tamanho errado", () => {
    expect(() =>
      keyringFromEnv({ SCI_ENCRYPTION_KEYS: "k1:YWJj", SCI_ENCRYPTION_ACTIVE_KEY: "k1" }),
    ).toThrow();
  });
});

describe("senhas e tokens", () => {
  it("hash argon2 verifica a senha correta", async () => {
    const h = await hashPassword("senha-muito-segura");
    expect(await verifyPassword(h, "senha-muito-segura")).toBe(true);
    expect(await verifyPassword(h, "errada")).toBe(false);
  });

  it("hashToken é determinístico", () => {
    expect(hashToken("a")).toBe(hashToken("a"));
    expect(hashToken("a")).not.toBe("a");
  });
});
