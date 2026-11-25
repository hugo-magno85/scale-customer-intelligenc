// Build da extensão: esbuild para os bundles + manifest gerado por ambiente.
//   SCI_API_URL=https://api.exemplo.com SCI_WEB_URL=https://app.exemplo.com node build.mjs
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";

const API_URL = (process.env.SCI_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const WEB_URL = (process.env.SCI_WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = process.env.SCI_EXT_OUT ?? "dist";
const pkg = JSON.parse(await readFile("package.json", "utf8"));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const define = {
  __SCI_API_URL__: JSON.stringify(API_URL),
  __SCI_WEB_URL__: JSON.stringify(WEB_URL),
  "process.env.NODE_ENV": JSON.stringify("production"),
};
const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: "chrome120",
  define,
  logLevel: "warning",
};

// Service worker e páginas da extensão: módulos ES
await build({
  ...common,
  format: "esm",
  entryPoints: {
    background: "src/background.ts",
    offscreen: "src/offscreen.ts",
    "audio-worklet": "src/audio-worklet.ts",
    sidepanel: "src/sidepanel/main.tsx",
    permission: "src/permission.ts",
  },
  outdir: OUT,
  jsx: "automatic",
});
// Content scripts: scripts clássicos (IIFE)
await build({ ...common, format: "iife", entryPoints: { content: "src/content.ts" }, outdir: OUT });

await cp("static", OUT, { recursive: true });

const MEETING_MATCHES = [
  "https://meet.google.com/*",
  "https://app.zoom.us/*",
  "https://*.zoom.us/wc/*",
  "https://teams.microsoft.com/*",
  "https://teams.live.com/*",
];

const manifest = {
  manifest_version: 3,
  name: "Scale Assistant",
  short_name: "Scale Assistant",
  description:
    "Copiloto de Customer Success da Academia Scale para reuniões no Google Meet, Zoom e Microsoft Teams.",
  version: pkg.version,
  minimum_chrome_version: "116",
  action: { default_title: "Abrir Scale Assistant" },
  side_panel: { default_path: "sidepanel.html" },
  background: { service_worker: "background.js", type: "module" },
  permissions: ["sidePanel", "storage", "tabCapture", "offscreen", "activeTab"],
  host_permissions: [...MEETING_MATCHES, `${API_URL}/*`],
  content_scripts: [{ matches: MEETING_MATCHES, js: ["content.js"], run_at: "document_idle" }],
  externally_connectable: { matches: [`${WEB_URL}/*`] },
  content_security_policy: {
    extension_pages: `script-src 'self'; object-src 'self'; connect-src 'self' ${API_URL} ${API_URL.replace(/^http/, "ws")}`,
  },
};
await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.warn(`Scale Assistant ${pkg.version} → ${OUT} (API ${API_URL}, web ${WEB_URL})`);
