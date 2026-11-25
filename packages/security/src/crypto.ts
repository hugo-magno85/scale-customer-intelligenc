import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Criptografia de credenciais (tokens de CRM, etc.) com AES-256-GCM.
 *
 * Formato: `v1:<keyId>:<iv b64>:<tag b64>:<ciphertext b64>`.
 * O keyId permite rotação: novas cifras usam a chave ativa; as antigas
 * continuam legíveis enquanto a chave antiga estiver no keyring.
 */
export interface Keyring {
  activeKeyId: string;
  keys: Record<string, Buffer>;
}

/** Lê `SCI_ENCRYPTION_KEYS` no formato `id1:base64,id2:base64` e `SCI_ENCRYPTION_ACTIVE_KEY`. */
export function keyringFromEnv(env: NodeJS.ProcessEnv = process.env): Keyring {
  const raw = env.SCI_ENCRYPTION_KEYS;
  const active = env.SCI_ENCRYPTION_ACTIVE_KEY;
  if (!raw || !active) throw new Error("SCI_ENCRYPTION_KEYS e SCI_ENCRYPTION_ACTIVE_KEY são obrigatórias");
  const keys: Record<string, Buffer> = {};
  for (const part of raw.split(",")) {
    const [id, b64] = part.split(":");
    if (!id || !b64) throw new Error("SCI_ENCRYPTION_KEYS mal formatada");
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error(`chave ${id} precisa ter 32 bytes`);
    keys[id] = key;
  }
  if (!keys[active]) throw new Error("chave ativa não está no keyring");
  return { activeKeyId: active, keys };
}

export function encryptSecret(plaintext: string, keyring: Keyring, aad?: string): string {
  const key = keyring.keys[keyring.activeKeyId];
  if (!key) throw new Error("chave ativa ausente");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    keyring.activeKeyId,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string, keyring: Keyring, aad?: string): string {
  const [version, keyId, ivB64, tagB64, ctB64] = payload.split(":");
  if (version !== "v1" || !keyId || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error("formato de segredo inválido");
  }
  const key = keyring.keys[keyId];
  if (!key) throw new Error(`chave ${keyId} não disponível`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Token opaco aleatório (sessões, convites). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hash usado para armazenar tokens; o token em si nunca vai para o banco. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
