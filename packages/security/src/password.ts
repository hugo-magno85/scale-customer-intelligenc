import { hash, verify } from "@node-rs/argon2";

// Parâmetros recomendados pela OWASP para Argon2id (m=19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** Hash fixo usado para gastar o mesmo tempo quando o usuário não existe. */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword("scale-dummy-password-for-timing");
  return dummy;
}
