// Garante que todo pacote importado pelo código de produção de um app esteja em "dependencies"
// (e não só em devDependencies), para a imagem Docker não quebrar ao iniciar.
//   node infrastructure/scripts/check-prod-deps.mjs apps/api apps/worker
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { builtinModules } from "node:module";

let failed = false;
for (const app of process.argv.slice(2)) {
  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  const deps = new Set(Object.keys(pkg.dependencies ?? {}));
  const walk = (d) =>
    readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const file of walk(join(app, "src")).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))) {
    for (const m of readFileSync(file, "utf8").matchAll(
      /^import\s+(?!type\b)[^'"]*from\s+["']([^."'][^"']*)["']/gm,
    )) {
      const spec = m[1];
      if (spec.startsWith("node:") || builtinModules.includes(spec)) continue;
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!deps.has(name)) {
        console.error(`${app}: "${name}" é importado em ${file} mas não está em dependencies`);
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
console.log("dependências de produção ok");
