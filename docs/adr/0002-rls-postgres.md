# ADR 0002 — Isolamento multi-tenant com RLS forçado no PostgreSQL

**Status:** aceito · 2026-11-25

Isolamento apenas na aplicação depende de nunca esquecer um `WHERE tenant_id`. Adotamos RLS
**forçado** com um papel de aplicação sem `BYPASSRLS` e sem posse das tabelas, contexto por transação
(`set_config(..., true)`), FKs compostas `(tenant_id, id)` e testes de isolamento obrigatórios.
`users` e `sessions` têm RLS habilitado (não forçado) para que funções `SECURITY DEFINER` mínimas
façam login e validação de sessão sem expor as tabelas.
