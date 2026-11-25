import { sql, type Database } from "@sci/db";

export async function purgeExpiredSessions(database: Database): Promise<number> {
  const r = await database.withContext({ tenantId: null, userId: null }, (tx) =>
    tx.execute<{ n: number }>(sql`SELECT app.purge_expired_sessions() AS n`),
  );
  return Number(r.rows[0]?.n ?? 0);
}
