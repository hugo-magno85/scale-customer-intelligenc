import { hashPassword } from "@sci/security";
import type pg from "pg";

/**
 * Cria ou promove um superadmin. Deve receber um cliente conectado como
 * sci_owner (a aplicação, por desenho, não consegue criar superadmins).
 */
export async function provisionPlatformAdmin(
  client: pg.Client,
  email: string,
  name: string,
  password: string,
) {
  const hash = await hashPassword(password);
  await client.query("BEGIN");
  try {
    const r = await client.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_platform_admin) VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO UPDATE SET is_platform_admin = true, password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [email, name, hash],
    );
    const id = r.rows[0]!.id;
    // audit_logs tem RLS forçado inclusive para o owner: define o ator no contexto.
    await client.query("SELECT set_config('app.user_id', $1, true)", [id]);
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id)
       VALUES ($1::uuid, 'platform_admin.provisioned', 'user', $1::text)`,
      [id],
    );
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
