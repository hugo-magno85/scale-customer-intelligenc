# Segurança, multi-tenancy e LGPD

## Papéis de banco

| Papel       | Uso                | Privilégios                                                           |
| ----------- | ------------------ | --------------------------------------------------------------------- |
| `sci_owner` | Somente migrations | Dono do schema. RLS **forçado** também para ele nas tabelas de tenant |
| `sci_app`   | API e worker       | DML com RLS; `audit_logs` só `SELECT/INSERT`; sem `BYPASSRLS`         |

Superadmins só são criados pelo CLI `create-platform-admin` com a conexão de owner — a aplicação não
consegue criar nem promover superadmins (política `users_insert`).

## Autenticação

- Senhas com Argon2id (parâmetros OWASP), mínimo de 12 caracteres.
- Resposta de login idêntica para e-mail inexistente e senha errada; verificação de hash sempre executada.
- Sessões com token aleatório de 256 bits, armazenado como SHA-256; revogação em logout.
- Cookie `httpOnly`, `SameSite=Lax`, `Secure` obrigatório em homologação/produção.
- Token da extensão emitido apenas a partir de sessão web, revogável, sem acesso a segredos de terceiros.
- Rate limit global e específico para login.

## Credenciais de terceiros

Tokens de CRM (Etapa 7) são cifrados com AES-256-GCM (`@sci/security`), com o `tenant_id` como dado
autenticado adicional (AAD) — um segredo copiado para outro tenant não decifra. Chaves com rotação
(`SCI_ENCRYPTION_KEYS`). Chaves de DeepSeek, Deepgram e TypeSafe ficam **somente no backend**.

## LGPD (diretrizes para as próximas etapas)

- Consentimento e indicador visível de captura antes e durante a reunião (Etapa 3).
- Áudio bruto **não** é armazenado por padrão; transcrições seguem política de retenção por tenant.
- Pseudonimização de nomes/e-mails antes do envio a provedores de IA quando aplicável.
- Exclusão por titular e por tenant (cascatas já definidas no schema).
- Transferência internacional: a API oficial do DeepSeek processa dados fora do Brasil — decisão pendente
  com a Academia Scale (ver plano, seção 10).

## Logs

JSON estruturado (pino) com `reqId`; cabeçalhos `authorization`, `cookie` e campos `password` são redigidos.

## Fornecedores de IA são informação interna

Os clientes nunca veem quais fornecedores de IA a plataforma usa (raciocínio, decisões tipadas, transcrição):

- a API não devolve o nome do modelo: `model` e `interpretationModel` vêm sempre `null`. O valor fica só no banco, para auditoria interna;
- avisos e erros são escritos de forma neutra, como "análise avançada indisponível" ou "modo básico";
- a origem dos sinais em tempo real é `ai` (motor da plataforma) ou `heuristic`;
- a migration `0009` reescreveu os avisos que já estavam gravados.

Variáveis de ambiente, logs do servidor e esta documentação técnica continuam com os nomes reais, porque são de uso interno.
