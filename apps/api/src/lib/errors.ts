export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "unauthorized", "Autenticação necessária");
export const forbidden = (msg = "Permissão insuficiente") => new HttpError(403, "forbidden", msg);
export const notFound = (what = "Recurso") => new HttpError(404, "not_found", `${what} não encontrado`);
export const conflict = (msg: string) => new HttpError(409, "conflict", msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "bad_request", msg, details);

/** Código SQLSTATE do erro do Postgres (Drizzle encapsula em `cause`). */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}
