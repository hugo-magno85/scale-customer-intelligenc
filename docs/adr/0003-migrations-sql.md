# ADR 0003 — Migrations em SQL escrito à mão + Drizzle como camada tipada

**Status:** aceito · 2026-11-25

Políticas RLS, funções e grants são mais claros e revisáveis em SQL. As migrations são a fonte da
verdade, imutáveis (checksum) e aplicadas com advisory lock. O schema Drizzle espelha as tabelas para
consultas tipadas; um teste de drift compara colunas e nulabilidade com o banco migrado.
