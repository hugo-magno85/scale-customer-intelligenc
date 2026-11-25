import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface RequestContext {
  /** Tenant ativo; nulo em operações fora de tenant (login, listagem de tenants). */
  tenantId: string | null;
  userId: string | null;
  isPlatformAdmin?: boolean;
}

export interface Database {
  db: Db;
  pool: pg.Pool;
  /**
   * Executa `fn` dentro de uma transação com o contexto de segurança
   * aplicado via SET LOCAL. É a ÚNICA forma suportada de acessar dados
   * de tenant: fora dela, as políticas RLS não retornam nenhuma linha.
   */
  withContext<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string, opts: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    async withContext(ctx, fn) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT
          set_config('app.tenant_id', ${ctx.tenantId ?? ""}, true),
          set_config('app.user_id', ${ctx.userId ?? ""}, true),
          set_config('app.platform_admin', ${ctx.isPlatformAdmin ? "on" : ""}, true)`);
        return fn(tx);
      });
    },
    close: () => pool.end(),
  };
}
