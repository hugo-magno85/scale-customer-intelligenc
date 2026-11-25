import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@sci/db/testing";
import { purgeExpiredSessions } from "../src/jobs/maintenance.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t?.drop());

it("remove apenas sessões expiradas/revogadas há mais de 7 dias", async () => {
  const owner = new pg.Client({ connectionString: t.ownerUrl });
  await owner.connect();
  const uid = randomUUID();
  await owner.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, 'w@x.com', 'w', 'x')", [
    uid,
  ]);
  await owner.query(
    `INSERT INTO sessions (user_id, token_hash, kind, expires_at, revoked_at) VALUES
     ($1, 'a', 'web', now() - interval '30 days', null),
     ($1, 'b', 'web', now() + interval '1 day', now() - interval '10 days'),
     ($1, 'c', 'web', now() + interval '1 day', null),
     ($1, 'd', 'web', now() - interval '1 day', null)`,
    [uid],
  );
  expect(await purgeExpiredSessions(t.app)).toBe(2);
  const left = await owner.query("SELECT token_hash FROM sessions ORDER BY token_hash");
  expect(left.rows.map((r) => r.token_hash)).toEqual(["c", "d"]);
  await owner.end();
});
