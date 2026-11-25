# ADR 0001 — Monorepo TypeScript (pnpm + Turborepo)

**Status:** aceito · 2026-11-25

Web, API, worker e extensão compartilham contratos. Um monorepo TypeScript permite um único sistema
de tipos ponta a ponta, CI com cache por pacote e deploy independente de cada app. O SDK oficial do
Jev é TypeScript. TypeScript fixado em 6.0.x porque o typescript-eslint ainda não suporta a 7.x.
