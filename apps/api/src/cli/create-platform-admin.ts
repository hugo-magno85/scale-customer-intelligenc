/**
 * Cria (ou promove) um superadmin da Academia Scale.
 * Executado no servidor com a conexão de OWNER — a aplicação, por desenho,
 * não consegue criar superadmins.
 *
 *   DATABASE_OWNER_URL=... pnpm --filter @sci/api create-platform-admin -- --email x@y --name "Nome"
 *   (a senha é lida da variável SCI_ADMIN_PASSWORD para não ficar no histórico do shell)
 */
import { Email, Password } from "@sci/contracts";
import pg from "pg";
import { parseArgs } from "node:util";
import { provisionPlatformAdmin } from "../lib/provision-admin.js";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const url = process.env.DATABASE_OWNER_URL;
const email = Email.parse(values.email);
const name = values.name?.trim();
const password = Password.parse(process.env.SCI_ADMIN_PASSWORD);
if (!url || !name) {
  console.error(
    "uso: DATABASE_OWNER_URL=... SCI_ADMIN_PASSWORD=... create-platform-admin --email E --name N",
  );
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await provisionPlatformAdmin(client, email, name, password);
await client.end();
console.warn(`superadmin pronto: ${email}`);
