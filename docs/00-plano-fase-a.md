# Scale Customer Intelligence — Plano da Fase A

> Status: **proposta aguardando aprovação**. Nenhum repositório, servidor, banco ou serviço foi criado ou alterado.
> Data: 2026-11-25 · Ordem do roadmap ajustada: **integrações com CRM ficam por último**.

---

## 0. O que foi verificado antes de planejar

| Item            | Resultado                                                                                                                                                                                                                                                                              | Impacto                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub          | O token deste ambiente (`GH_TOKEN`) é **inválido**. Não consigo criar o repositório.                                                                                                                                                                                                   | Preciso que você reconecte o GitHub (Settings → Connectors) ou crie o repositório vazio `scale-customer-intelligence` e me dê acesso.                     |
| Servidor        | A conta Hostinger conectada **não tem nenhuma VPS** (`vps_virtual-machines_list` retornou vazio).                                                                                                                                                                                      | Preciso saber qual é o servidor da Academia Scale e como acessá-lo (SSH). A inspeção (SO, CPU, RAM, Docker, Nginx, portas, DNS) só acontece depois disso. |
| JEV Typesafe    | Existe: **Jev** é um modelo da **TypeSafe AI** (lançado em 15/09/2026) que responde perguntas tipadas sobre texto/JSON e devolve **apenas valores estruturados** (classes, scores, probabilidades), nunca prosa. SDK oficial TypeScript: `@typesafe-ai/sdk`. Está em **early access**. | Encaixa como camada de **decisão tipada** (classificar sinais, priorizar perguntas, verificar saídas do DeepSeek). Precisamos de acesso/chave à API.      |
| Diretório local | Vazio. Projeto nasce do zero, sem nenhuma referência ao Sales Copilot.                                                                                                                                                                                                                 | —                                                                                                                                                         |

---

## 1. Arquitetura proposta

### 1.1 Visão geral

```
 ┌──────────────── Chrome (Scale Assistant · MV3) ────────────────┐
 │ Content scripts (Meet / Teams web / Zoom web)  →  metadados    │
 │ Offscreen document: tabCapture (cliente) + microfone (CS)      │
 │ Side Panel: Preparação · Copiloto (tempo real) · Análise       │
 │ Service Worker: auth, API client, estado da sessão             │
 └───────────────┬──────────────────────────────▲─────────────────┘
       áudio PCM │ WebSocket (token curto)      │ sugestões / checklist (WS)
                 ▼                              │
 ┌──────────────────────── Backend (API) ─────────────────────────┐
 │ REST (OpenAPI) + WebSocket Gateway · Auth · RBAC · Tenant ctx  │
 │ Audio Relay ──► Deepgram streaming (chave só no backend)       │
 │ Realtime Intelligence Loop (estado da reunião em memória/Redis)│
 └───────┬───────────────────┬───────────────────┬────────────────┘
         │ filas (BullMQ)    │                   │
         ▼                   ▼                   ▼
 ┌──────────────┐   ┌──────────────────┐  ┌────────────────────────┐
 │ Worker       │   │ Intelligence     │  │ PostgreSQL 16 + RLS    │
 │ - playbooks  │   │ Engine           │  │ Redis (fila + estado)  │
 │ - pós-call   │   │  Skill CS (v.)   │  │ Object storage (docs)  │
 │ - health     │   │  Playbook ctx    │  └────────────────────────┘
 │ - CRM (E7)   │   │  DeepSeek (texto)│
 └──────────────┘   │  Jev (decisões)  │      Frontend SaaS (Next.js)
                    │  Contratos Zod   │      consome a mesma API
                    └──────────────────┘
```

### 1.2 Componentes e responsabilidades

| #   | Componente                                                 | Responsabilidade                                                     | Contrato                                        |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | **Frontend SaaS** (`apps/web`)                             | Os 11 módulos de navegação                                           | Consome API via cliente gerado do OpenAPI       |
| 2   | **Backend/API** (`apps/api`)                               | Auth, RBAC, tenant context, REST, WebSocket, relay de áudio          | OpenAPI gerado dos schemas Zod                  |
| 3   | **Banco** (`packages/db`)                                  | Schema, migrations, políticas RLS, seeds de dev                      | Migrations SQL versionadas                      |
| 4   | **Motor de inteligência** (`packages/intelligence`)        | Orquestra as 5 camadas, chama DeepSeek e Jev, valida saídas          | Entradas/saídas tipadas em `packages/contracts` |
| 5   | **Skill de CS** (`packages/cs-skill`)                      | Conhecimento especialista versionado (semver)                        | Arquivos de conhecimento + suíte de avaliação   |
| 6   | **Playbook Intelligence** (`packages/playbooks` + worker)  | Upload → extração → interpretação → estrutura → revisão → publicação | `PlaybookStructure` (Zod)                       |
| 7   | **Pipeline de áudio** (`apps/api/audio`)                   | Relay WS extensão ↔ Deepgram, transcrição consolidada                | Eventos `TranscriptSegment`                     |
| 8   | **Scale Assistant** (`apps/extension`)                     | Extensão MV3                                                         | Mesmo `packages/contracts`                      |
| 9   | **Meeting Connectors** (`apps/extension/adapters`)         | Um adaptador por plataforma                                          | Interface `MeetingAdapter`                      |
| 10  | **CRM Integration Hub** (`packages/crm-hub`) — **Etapa 7** | Interface universal + 4 provedores                                   | Interface `CrmProvider`                         |
| 11  | **Infra/observabilidade** (`infrastructure/`)              | Compose, proxy, backups, logs, métricas                              | —                                               |

### 1.3 Como as 5 camadas da inteligência se combinam

| Camada                 | Fonte                                         | Implementação                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Conhecimento CS     | `packages/cs-skill` versionado                | Princípios, taxonomia de sinais (risco/oportunidade/necessidade), biblioteca de perguntas por tipo (12 tipos do briefing), rubricas de score, regras de prudência ("nunca churn iminente por frase isolada") |
| 2. Playbook            | `PlaybookVersion` publicada do tenant         | Objetivos, etapas, perguntas, critérios, pesos, gatilhos                                                                                                                                                     |
| 3. Contexto do cliente | Histórico interno do Scale (E1–E6) + CRM (E7) | Resumo das análises anteriores, health atual, sinais abertos, planos de ação                                                                                                                                 |
| 4. Contexto da reunião | Transcrição em tempo real                     | Estado incremental: tópicos cobertos, perguntas feitas, respostas incompletas, lacunas do checklist                                                                                                          |
| 5. Motor de decisão    | Código determinístico + Jev + DeepSeek        | Ver abaixo                                                                                                                                                                                                   |

**Divisão de trabalho entre os modelos (decisão central):**

- **Jev (decisões tipadas, rápidas):** a cada trecho final da transcrição, responde perguntas como "este trecho contém sinal de risco? de qual categoria?", "o item X do checklist foi coberto?", "a resposta à pergunta Y foi completa?", "qual a prioridade deste candidato?". Também atua como **verificador** das saídas do DeepSeek (ex.: "a evidência citada sustenta a classificação?").
- **DeepSeek (raciocínio e linguagem):** redige/adapta a pergunta recomendada, o "por que perguntar", o resumo executivo, o diagnóstico e o plano de ação, sempre em **JSON mode**, validado por Zod.
- **Código (determinístico e explicável):** Customer Health, agregações, pesos do tenant, deduplicação de sugestões, regras de quando sugerir (cooldown, máximo 1 pergunta principal visível).

Para baixa latência, no **Modo Preparação** o motor gera um **banco de perguntas candidatas** (playbook + skill + histórico). Durante a call, o trabalho principal é **reordenar e adaptar** candidatos, não gerar do zero. Meta: sugestão em ≤ 3–5 s após o fim da fala relevante.

Cada sugestão persiste: pergunta, motivo, objetivo, indicador, prioridade, referência ao playbook, **trecho de evidência (timestamp)**, versão da skill, versão do playbook e status (exibida / realizada / ignorada / substituída).

---

## 2. Stack e justificativas

Versões exatas serão confirmadas contra a documentação oficial no início da Fase B (regra 9).

| Camada          | Escolha                                                                                                        | Por quê                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Linguagem       | **TypeScript** em tudo                                                                                         | Um único sistema de tipos entre web, API, worker e extensão; SDK oficial do Jev é TS                                            |
| Monorepo        | **pnpm workspaces + Turborepo**                                                                                | Build/test por pacote, cache de CI, deploy independente                                                                         |
| Contratos       | **Zod** em `packages/contracts` → OpenAPI                                                                      | Validação em runtime nas fronteiras (API, saídas de LLM, mensagens da extensão)                                                 |
| API             | **Fastify** + WebSocket                                                                                        | Baixo overhead para streaming de áudio; plugins maduros de OpenAPI                                                              |
| Filas           | **BullMQ + Redis**                                                                                             | Processamento assíncrono de playbooks, pós-reunião, recálculo de health, retries                                                |
| Banco           | **PostgreSQL 16** + **Row Level Security**                                                                     | Isolamento por tenant no próprio banco; busca textual em português (`tsvector`) para trechos de playbook                        |
| ORM/migrations  | **Drizzle ORM** + migrations SQL                                                                               | SQL explícito facilita políticas RLS e revisão das migrations                                                                   |
| Frontend        | **Next.js (App Router) + Tailwind + shadcn/ui + Recharts**                                                     | SaaS premium com componentes acessíveis; gráficos do dashboard                                                                  |
| Extensão        | **Manifest V3** com Vite (avaliar WXT) + React no Side Panel                                                   | Side Panel API, offscreen document, HMR em dev                                                                                  |
| Transcrição     | **Deepgram** streaming, pt-BR, **multicanal**                                                                  | Canal 1 = microfone (profissional de CS), canal 2 = áudio da aba (cliente): identifica quem falou sem depender só de diarização |
| Raciocínio      | **DeepSeek API** (`deepseek-chat` em tempo real; modelo de raciocínio no pós-call)                             | Definido no briefing; modelo rápido onde latência importa                                                                       |
| Decisão tipada  | **Jev (TypeSafe)** via `@typesafe-ai/sdk`                                                                      | Definido no briefing; classificações estruturadas, sem prosa                                                                    |
| Auth            | Sessão própria (cookie httpOnly) no web + **tokens curtos** para a extensão (fluxo de login pela web com PKCE) | A extensão nunca guarda segredos de terceiros, só um token de usuário revogável                                                 |
| Arquivos        | Object storage S3-compatível (MinIO no servidor)                                                               | Playbooks enviados; áudio bruto **não é armazenado por padrão** (LGPD)                                                          |
| Observabilidade | Logs JSON (pino) + OpenTelemetry + Prometheus/Grafana + Uptime checks                                          | Métricas de latência por etapa (áudio → transcrição → sugestão)                                                                 |
| Testes          | Vitest, Playwright (web e extensão), testcontainers (Postgres real com RLS)                                    | Testes de isolamento entre tenants rodam contra Postgres real                                                                   |

---

## 3. Estrutura de diretórios

```
scale-customer-intelligence/
├── apps/
│   ├── web/                 # Frontend SaaS (Next.js)
│   ├── api/                 # REST + WebSocket + relay de áudio
│   ├── worker/              # Jobs BullMQ
│   └── extension/           # Scale Assistant (MV3)
│       ├── src/background/  # service worker
│       ├── src/offscreen/   # captura e mixagem de áudio
│       ├── src/sidepanel/   # UI Preparação/Copiloto/Análise
│       └── src/adapters/    # meet/, teams/, zoom/
├── packages/
│   ├── contracts/           # Schemas Zod compartilhados
│   ├── db/                  # Schema, migrations, RLS
│   ├── intelligence/        # Motor de decisão (5 camadas)
│   ├── cs-skill/            # Skill de CS versionada + evals
│   ├── playbooks/           # Extração e estruturação
│   ├── providers/           # Clientes Deepgram, DeepSeek, Jev
│   ├── crm-hub/             # Etapa 7
│   ├── ui/                  # Design system
│   └── config/              # eslint, tsconfig, prettier
├── infrastructure/
│   ├── docker/              # Dockerfiles
│   ├── compose/             # dev.yml, staging.yml, production.yml
│   ├── proxy/               # config do proxy reverso
│   ├── monitoring/
│   └── scripts/             # backup, restore, deploy, rollback
├── docs/                    # arquitetura, ADRs, instalação, deploy, integrações, LGPD
├── .github/workflows/
├── .env.example · README.md · CONTRIBUTING.md · CHANGELOG.md
```

No servidor: `/opt/academia-scale/scale-customer-intelligence/{staging,production}/` com `compose/`, `env/` (fora do Git, permissões 600), `backups/` e `logs/`.

---

## 4. Modelo de dados inicial

Todas as tabelas de negócio têm `tenant_id NOT NULL`, índice começando por `tenant_id`, e política RLS `tenant_id = current_setting('app.tenant_id')::uuid`. A aplicação conecta com um papel **sem** `BYPASSRLS` e usa `FORCE ROW LEVEL SECURITY`; o contexto do tenant é definido por transação (`SET LOCAL`). Superadmin usa um papel e endpoints separados, auditados.

**Identidade e acesso**

- `tenants` (id, nome, slug, plano, status, configurações de retenção e de publicação)
- `users` · `tenant_memberships` (user_id, tenant_id, role_id) — um usuário pode pertencer a mais de um tenant
- `roles` (superadmin, tenant_admin, gestor, cs, analista + personalizados) · `permissions` · `role_permissions`
- `audit_logs` (tenant_id, actor, ação, entidade, antes/depois, ip, timestamp) — somente inserção

**Carteira**

- `customers` (empresa, segmento, responsável, início do relacionamento, receita recorrente opcional + origem do dado)
- `contacts` · `customer_contacts`
- `customer_external_identities` · `crm_connections` · `crm_external_records` — **tabelas criadas cedo, usadas na E7**

**Reuniões**

- `meetings` (customer_id nulo permitido, plataforma, objetivo, tipo, playbook_version_id, cs_skill_version, status, consentimento registrado)
- `meeting_participants` (nome, e-mail se disponível, papel interno/cliente, contact_id opcional)
- `meeting_transcript_segments` (canal, falante, início/fim ms, texto, confiança) · `meeting_transcripts` (consolidada)
- `meeting_crm_links` (todos os campos do item 11 do briefing + origem automática/manual + histórico de alterações)
- `meeting_analyses` (resumo, diagnóstico, objetivos atingidos, perguntas não respondidas, versões usadas, modelo e prompt hash)

**Playbooks e skill**

- `playbooks` (nome, jornada, tipo de reunião, segmento, operação, status)
- `playbook_versions` (número, status rascunho/em revisão/aprovado/publicado/desativado, aprovado_por, estrutura JSON validada)
- `playbook_documents` (arquivo, hash, texto extraído) · `playbook_chunks` (texto + `tsvector` pt)
- `playbook_questions` · `playbook_criteria` (peso, gatilho, indicador) · `playbook_stages`
- `cs_skill_versions` (semver, hash do conteúdo, changelog) · `tenant_skill_settings` (ajustes permitidos ao tenant)

**Inteligência**

- `intelligence_suggestions` (pergunta, motivo, objetivo, indicador, prioridade, evidence_segment_ids, playbook_question_id, status, feedback)
- `intelligence_indicators` (análise, indicador [8 tipos], score, classificação, confiança, evidências)
- `customer_health_snapshots` (score, classificação, fatores +/−, pesos usados, indicadores ausentes)
- `churn_signals` (fator, severidade, evidência, recorrência, status)
- `expansion_opportunities` (tipo, necessidade, evidência, produto, potencial **só se houver dado**, status)
- `action_plans` · `action_tasks` (responsável, prazo, prioridade, status, evidência, publicado_no_crm)
- `integration_syncs` (E7: provedor, operação, idempotency_key, tentativas, resultado)

Regra transversal: valores financeiros e de receita são **nulos** quando não há fonte confiável; nunca estimados pelo modelo.

---

## 5. Serviços necessários (por ambiente)

| Serviço       | Imagem                                                 | Observação                                                                              |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `web`         | Next.js standalone                                     |                                                                                         |
| `api`         | Node                                                   | REST + WS + relay de áudio                                                              |
| `worker`      | Node (mesma base do api)                               | escala separado                                                                         |
| `postgres`    | postgres:16                                            | volume dedicado, backups                                                                |
| `redis`       | redis                                                  | filas + estado da reunião ativa                                                         |
| `minio`       | minio                                                  | arquivos de playbook                                                                    |
| `proxy`       | Caddy (TLS automático) **ou** vhost no Nginx existente | decidido após inspecionar o servidor; nada existente é alterado sem autorização         |
| monitoramento | Grafana + Prometheus + Loki (leve)                     | pode ser compartilhado entre staging e produção do **Scale**, nunca com o Sales Copilot |

Não haverá serviço de embeddings nem banco vetorial na primeira versão: a busca em playbooks usa a estrutura extraída + busca textual do Postgres, sem trazer um fornecedor de IA fora da stack definida.

---

## 6. Dimensionamento preliminar

O servidor não processa áudio localmente (Deepgram e DeepSeek fazem o trabalho pesado); o custo local é relay de WebSocket, banco e jobs.

| Ambiente          | vCPU           | RAM                    | Disco      | Capacidade estimada                                         |
| ----------------- | -------------- | ---------------------- | ---------- | ----------------------------------------------------------- |
| Desenvolvimento   | local (Docker) | 8 GB na máquina do dev | —          | —                                                           |
| Homologação       | 2              | 4 GB                   | 40 GB SSD  | testes internos                                             |
| Produção (início) | 4              | 8 GB                   | 100 GB SSD | ~20–30 reuniões simultâneas, a confirmar com teste de carga |

Recomendo **homologação e produção em máquinas separadas**. Se só houver um servidor, ficam em projetos Compose, redes, bancos e domínios separados, com limites de CPU/memória por container. Backup diário do Postgres com retenção de 30 dias, cópia fora do servidor e teste de restauração mensal.

---

## 7. Estratégia GitHub

- Repositório `scale-customer-intelligence` (privado). Branches: `main` (produção, protegida), `develop` (integração, protegida), `feature/*`, `fix/*`, `release/*`.
- PR obrigatório para `develop` e `main`, CI verde obrigatório, Conventional Commits, SemVer com tags `vX.Y.Z` e CHANGELOG.
- **Workflows:** `ci.yml` (install, lint, typecheck, testes unitários e de integração com Postgres, build de todos os apps, validação de migrations contra banco limpo, testes de RLS), `security.yml` (`pnpm audit`, Dependabot, CodeQL, gitleaks), `evals.yml` (suíte da skill de CS com transcrições de referência, sem dados reais), `release.yml` (build e push das imagens no GHCR quando houver tag).
- Segredos só em GitHub Environments (`staging`, `production`) com aprovação manual em `production`.

## 8. Estratégia de deploy

1. Merge em `develop` → imagens `:sha` → deploy automático em **homologação**.
2. Tag `vX.Y.Z` em `main` → imagens versionadas → deploy em **produção somente com aprovação manual** (sua).
3. Deploy = `docker compose pull && migrate && up -d` com health checks; migrations no padrão expand/contract para permitir rollback.
4. Rollback = voltar a tag anterior (o banco continua compatível por causa do expand/contract) + script de restore em caso extremo.
5. Extensão: build por ambiente (URL da API de homologação/produção), distribuição inicial como **unlisted** na Chrome Web Store ou via política gerenciada do Google Workspace.

---

## 9. Dependências externas

| Dependência      | O que preciso                                                           | Quando                 |
| ---------------- | ----------------------------------------------------------------------- | ---------------------- |
| GitHub           | Acesso válido para criar/escrever no repositório                        | Fase B                 |
| Servidor         | Host, acesso SSH, autorização para instalar Docker se faltar            | Fase B (inspeção)      |
| Domínios         | Ex.: `app.` e `api.` de um domínio da Academia Scale + acesso ao DNS    | Homologação            |
| Deepgram         | Chave de API (projeto próprio do Scale)                                 | Etapa 3                |
| DeepSeek         | Chave de API (conta própria do Scale)                                   | Etapa 2                |
| TypeSafe Jev     | Acesso ao early access + chave                                          | Etapa 2                |
| Chrome Web Store | Conta de desenvolvedor da Academia Scale                                | Etapa 3 (distribuição) |
| CRMs             | Apps OAuth/contas de teste em Pipedrive, Zoho, Bitrix24, RD Station CRM | **Etapa 7**            |

---

## 10. Riscos técnicos

| Risco                                                                                                      | Gravidade | Mitigação                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zoom e Teams em aplicativo desktop** não são capturáveis por extensão do Chrome.                         | Alta      | Suportar as versões **web** (Meet, Teams web, Zoom Web Client). Mostrar aviso claro quando a reunião estiver no app desktop. Avaliar no futuro APIs oficiais (Zoom RTMS, bots Teams), fora do escopo inicial.                                                                           |
| **DeepSeek e LGPD:** a API oficial processa dados fora do Brasil (China). Transcrições têm dados pessoais. | Alta      | Decisão sua (ver perguntas). Opções: aceitar com base legal, DPA e aviso aos titulares; ou usar modelos DeepSeek de pesos abertos hospedados em provedor com contrato adequado. Em qualquer caso: minimizar e pseudonimizar dados enviados (nomes/e-mails substituídos por marcadores). |
| **Jev em early access:** disponibilidade, limites e preço podem mudar.                                     | Média     | Isolado atrás da interface `DecisionProvider`; modo degradado usando DeepSeek com saída validada, apenas se o Jev ficar indisponível.                                                                                                                                                   |
| Latência em tempo real (Deepgram + DeepSeek).                                                              | Média     | Banco de candidatos pré-gerado, modelo rápido, decisões curtas no Jev, métricas de latência por etapa.                                                                                                                                                                                  |
| Mudanças no DOM do Meet/Teams/Zoom quebram a detecção de participantes.                                    | Média     | Adaptadores isolados, seletores centralizados, testes E2E agendados, a captura de áudio não depende do DOM.                                                                                                                                                                             |
| Qualidade da transcrição pt-BR com ruído/sotaques.                                                         | Média     | Multicanal, modelo pt-BR do Deepgram, vocabulário personalizado (keyterms) por tenant.                                                                                                                                                                                                  |
| Vazamento entre tenants.                                                                                   | Crítica   | RLS forçado + testes automatizados de acesso cruzado no CI + nenhum cache ou prompt compartilha dados entre tenants.                                                                                                                                                                    |
| Classificações sem fundamento ("alucinação").                                                              | Alta      | Toda classificação exige evidência com timestamp; verificação pelo Jev; regra de recorrência/gravidade para churn; confiança exibida.                                                                                                                                                   |
| Consentimento de gravação.                                                                                 | Alta      | Aviso obrigatório antes de iniciar, indicador visível durante a captura, registro do consentimento na reunião, botão de pausa.                                                                                                                                                          |
| APIs dos CRMs (limites, formatos de URL, aprovação de apps).                                               | Média     | Tratado na Etapa 7, com documentação oficial validada antes de cada provedor.                                                                                                                                                                                                           |

---

## 11. Cronograma por etapas (CRM por último)

Estimativas em semanas de desenvolvimento, para uma pessoa com Claude Code; serão recalibradas ao final da Etapa 1.

| Etapa                                      | Conteúdo                                                                                                                                                                                                                  | Estimativa | Critério de saída                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| **1. Fundação**                            | Monorepo, Docker local, Postgres + RLS, auth, multi-tenant, RBAC, auditoria, CI, shell do frontend, homologação no servidor                                                                                               | 2–3 sem    | Testes de isolamento passando; login, tenants e usuários funcionando em homologação                          |
| **2. Skill de CS + Playbook Intelligence** | Skill v1.0 com evals; clientes DeepSeek e Jev; upload (PDF, DOCX, PPTX, XLSX, TXT, MD), extração, interpretação, revisão, edição, versionamento, aprovação, publicação; cadastro manual de playbook                       | 3–4 sem    | Playbook real carregado, revisado e publicado; evals da skill no CI                                          |
| **3. Scale Assistant**                     | Extensão MV3, login, Side Panel, adaptador **Meet** primeiro, depois Teams web e Zoom web; captura autorizada; relay Deepgram; transcrição ao vivo                                                                        | 3–4 sem    | Reunião real no Meet transcrita ao vivo com consentimento; Teams/Zoom web validados ou limitação documentada |
| **4. Inteligência em tempo real**          | Modo Preparação, banco de candidatos, perguntas adaptativas, checklist, lacunas, alertas, ações (realizada/ignorar/outra/observação/consultar playbook)                                                                   | 3–4 sem    | Sugestões com motivo e evidência em reunião real, latência medida                                            |
| **5. Customer Intelligence**               | Análise pós-reunião, 8 indicadores, Customer Health com pesos por tenant, Churn Radar, Expansão, Planos de Ação                                                                                                           | 3 sem      | Análise completa e explicável de reuniões reais                                                              |
| **6. Dashboard e relatórios**              | Dashboard executivo com filtros e drill-down, carteira com linha do tempo, relatórios, exportações                                                                                                                        | 2–3 sem    | Números rastreáveis até reuniões e clientes, sem dados fictícios                                             |
| **7. CRM Integration Hub**                 | Interface universal; Pipedrive → Zoho → Bitrix24 → RD Station CRM; OAuth, tokens criptografados, vínculo automático e **manual (URL/ID)**, consulta, validação, publicação com aprovação, retry, idempotência, rate limit | 4–6 sem    | Cada CRM só é marcado como pronto após autenticação, consulta real, validação, publicação e testes           |

**Até a Etapa 7**, clientes e contatos são cadastrados no Scale (manual ou importação CSV), e as reuniões funcionam sem CRM, como exige o briefing. O campo "Vincular registro do CRM" aparece na extensão a partir da Etapa 7; o modelo de dados já nasce preparado para ele.

---

## 12. Decisões que preciso de você para iniciar a Fase B

1. **Aprovação** desta arquitetura e da ordem das etapas.
2. **GitHub:** reconectar o acesso ou criar o repositório vazio e me dar permissão de escrita.
3. **Servidor:** qual máquina usar e como acessá-la (a conta Hostinger conectada não tem VPS).
4. **DeepSeek e LGPD:** usar a API oficial (com DPA, aviso e pseudonimização) ou pesos abertos DeepSeek hospedados em outro provedor?
5. **Jev:** a Academia Scale já tem acesso ao early access da TypeSafe?
6. **Domínios** para homologação e produção.
