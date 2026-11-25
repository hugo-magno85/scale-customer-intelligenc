import { SKILL_CHANGELOG, SKILL_CONTENT_HASH, SKILL_RELEASED_AT, SKILL_VERSION } from "@sci/cs-skill";
import { csSkillVersions, eq, type Tx } from "@sci/db";

/** Garante que a versão atual da skill está registrada (idempotente) e detecta conteúdo alterado sem bump. */
export async function ensureSkillVersion(tx: Tx): Promise<string> {
  const [existing] = await tx
    .select()
    .from(csSkillVersions)
    .where(eq(csSkillVersions.version, SKILL_VERSION));
  if (!existing) {
    await tx
      .insert(csSkillVersions)
      .values({
        version: SKILL_VERSION,
        contentHash: SKILL_CONTENT_HASH,
        releasedAt: SKILL_RELEASED_AT,
        changelog: SKILL_CHANGELOG,
      })
      .onConflictDoNothing();
  } else if (existing.contentHash !== SKILL_CONTENT_HASH) {
    throw new Error(
      `conteúdo da skill ${SKILL_VERSION} mudou sem alteração de versão; incremente SKILL_VERSION`,
    );
  }
  return SKILL_VERSION;
}
