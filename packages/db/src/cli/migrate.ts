import { migrate } from "../migrator.js";

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error("DATABASE_OWNER_URL não definida");
  process.exit(1);
}
const check = process.argv.includes("--check");
migrate(url, { check })
  .then((r) => {
    if (check) {
      console.warn(r.pending.length ? `pendentes: ${r.pending.join(", ")}` : "nenhuma migration pendente");
    } else {
      console.warn(r.applied.length ? `aplicadas: ${r.applied.join(", ")}` : "banco já atualizado");
    }
  })
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
