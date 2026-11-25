# ADR 0005 — Documentos de playbook armazenados no PostgreSQL (fase inicial)

**Status:** aceito · 2026-11-25

Os documentos enviados (até 15 MB cada, 10 por versão) são guardados em `playbook_documents.content`
(bytea), sob RLS forçado, junto com o texto extraído e o SHA-256. Isso evita subir um serviço de
armazenamento de objetos antes de haver volume que o justifique ("não criar serviços desnecessários")
e herda backup, isolamento por tenant e exclusão em cascata do banco.

Revisar quando: volume de documentos > ~5 GB, ou quando áudio/arquivos grandes passarem a ser
armazenados — nesse caso migrar para armazenamento S3-compatível atrás de uma interface `FileStorage`.
