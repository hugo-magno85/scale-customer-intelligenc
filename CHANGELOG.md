# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Novo visual do dashboard e "Tarefas"

- Dashboard redesenhado no Claude Design e aplicado com dados reais:
  - visual claro e vibrante, mais compacto (menos rolagem);
  - Customer Health compacto e cards com fundo em gradiente pela cor do indicador;
  - faixa de Execução: reuniões e tarefas;
  - Top 5 em risco, Top 5 oportunidades e fatores de risco;
  - análises detalhadas em "Análise completa", que abre por clique.
- Período em atalhos rápidos e demais filtros num painel com contador.
- Gráfico de evolução com escala ajustada aos dados.
- "Planos de ação" passa a se chamar "Tarefas" em todo o sistema.

### Marca própria da inteligência

- Nenhuma tela, mensagem ou resposta da API mostra os fornecedores de IA ao cliente.
  - O modelo fica só no banco, para auditoria interna.
  - Os avisos antigos foram reescritos (migration 0009).
- Bitrix24 homologado com conta real e marcado como disponível.

### Pipedrive (disponível — homologado com conta real)

- Cliente por token de API pessoal:
  - validação com conferência da empresa;
  - consulta de negócio, organização, pessoa e lead;
  - envio da análise como nota, atividades do plano e campos do negócio.
- Cadastro na tela de Integrações com validação do formato do token.

### Bitrix24 (disponível — homologado com conta real)

- Envio da análise ao card após a reunião:
  - comentário com o resumo;
  - tarefas do plano de ação;
  - campos de Customer Health, risco e data da análise, criados automaticamente.
- Envio automático configurável por conexão, status na reunião e reenvio sem duplicar (migration 0008).

- Cliente REST por webhook de entrada:
  - validação da conexão;
  - consulta de negócio, empresa, contato e lead, com responsável;
  - comentário na timeline e tarefa vinculada (só com aprovação);
  - limites e erros conforme a documentação oficial.
- A URL do webhook é validada no cadastro (https, domínio `*.bitrix24.*` e mesmo portal); a credencial fica cifrada.
- Novo status "Em homologação" na tela de Integrações; formulário específico para o webhook do Bitrix24.

### BI Executivo

- Novo dashboard executivo (`/app/dashboard`, `GET /v1/reports/bi`):
  - velocímetro de Customer Health (0–10) com as faixas do tenant e comparativo com o mês anterior e o ano anterior;
  - 10 KPIs com variação, sparkline e tooltip de origem;
  - gráficos de evolução com período de comparação e linha de tendência;
  - distribuição da carteira, movimentação de risco, inteligência de churn (fatores, receita em risco e recuperada, clientes prioritários), inteligência de expansão, desempenho dos planos e média dos indicadores.
- Atalhos de período (mês atual e anterior, mesmo mês do ano anterior, ano atual e anterior, 30/90 dias, 12 meses, personalizado), comparação com o período anterior ou o ano anterior, e "Limpar filtros".
- Drill-down dos KPIs e da distribuição até a ficha do cliente.
- Integridade: valores "ao fim do período" reconstruídos dos snapshots; nada estimado; "histórico insuficiente" quando não há base para comparar. Ver [docs/bi-executivo.md](docs/bi-executivo.md).
- Configuração opcional da faixa "excelente" do velocímetro.
- Extensão: botão "Nova reunião" no topo do painel; autorização do microfone pelo painel; captura liberada pelo clique no ícone; correção da captura presa à aba.
- Análise: notas de indicador só com fala do cliente como evidência.

### Etapa 7 — CRM Integration Hub (fundação)

- Pacote `@sci/crm-hub`: contrato universal, leitura de URL/ID por CRM (Bitrix24, Pipedrive, RD Station CRM, Zoho CRM), cliente HTTP resiliente (retry, Retry-After, rate limit) e idempotência.
- Conexões por tenant com credencial cifrada; tela de Integrações.
- Vínculo manual da reunião ao Deal/Card por URL ou ID, com histórico e permissão para alterar, na web e na extensão.
- Nenhum CRM marcado como disponível até homologação com conta real.
- Correção: o WebSocket de áudio só anuncia “pronto” depois de registrar os handlers (áudio inicial não é mais perdido).
- Correção: variáveis de Deepgram, DeepSeek, Jev e do cofre de credenciais incluídas no Compose da API e do worker.

### Etapa 6 — Dashboard e relatórios

- Visão geral filtrável (período, responsável, segmento, playbook, Customer Health, risco) com séries semanais, principais fatores de risco, médias dos indicadores e lista de clientes que compõem os números (drill-down).
- Dashboard executivo com filtros em uma linha, gráficos com tooltip e links para o detalhe; layout validado em celular.
- Exportações CSV (carteira, reuniões, indicadores, Churn Radar, oportunidades, planos de ação) em formato pt-BR (BOM, “;”, vírgula decimal), proteção contra injeção de fórmulas e registro em auditoria.

### Etapa 5 — Customer Intelligence

- Análise pós-reunião versionada (automática ao encerrar): resumo, diagnóstico, objetivos, perguntas feitas e não respondidas, necessidades, feedbacks, recomendações, 8 indicadores com evidência e confiança.
- Evidências sempre citadas do banco; conferência independente pelo Jev; análise básica explícita sem DeepSeek.
- Customer Health explicável com pesos por tenant, suavização por histórico e travas por sinais de churn.
- Churn Radar com recorrência entre reuniões, severidade prudente e receita em risco somente com receita informada.
- Oportunidades de expansão sem valores inventados (sem duplicar entre reuniões); planos de ação com responsável, prazo, prioridade e status derivado “Atrasado”.
- Telas de Health, Churn Radar, Expansão, Planos de Ação, análise na reunião, saúde no perfil do cliente e dashboard com dados reais.
- Correções no motor em tempo real: análise de todas as falas novas entre ciclos e prioridade pela gravidade do sinal (intenção de cancelamento troca a sugestão na hora).

### Etapa 4 — Inteligência em tempo real

- Motor de decisão (Camada 5): banco de candidatas (playbook + skill), checklist de cobertura, sinais de risco/oportunidade com evidência, ranking explicável, adaptação da pergunta pelo DeepSeek com fallback.
- Jev para sinais, cobertura e detecção da pergunta feita; heurística pt-BR em modo degradado, sinalizado na interface.
- Prudência: sem expansão com risco aberto, perguntas reativas só com sinal, sem repetição, intervalo mínimo entre trocas.
- Modo Preparação (primeira pergunta, checklist, pontos a investigar) e Modo Copiloto via WebSocket.
- Ações: realizada (com aprofundamento em cadeia), ignorar, outra pergunta, observação, consultar playbook, itens não investigados.
- Persistência e restauração do estado (`intelligence_suggestions`, `meeting_live_signals`, `meeting_notes`, `meetings.checklist`).
- Painel “Inteligência em tempo real” na extensão.

### Etapa 3 — Scale Assistant e transcrição

- Reuniões com cliente opcional (vínculo posterior), versão de playbook publicada e versão da skill registradas; participantes.
- Consentimento obrigatório (LGPD) antes de qualquer captura, com método registrado e auditado.
- Ticket de uso único (60 s) para o WebSocket de áudio; validação de quadros e limite de taxa.
- Relay para o Deepgram (multicanal, pt-BR, `mip_opt_out`), só segmentos finais são gravados; áudio não é armazenado.
- Extensão MV3: adaptadores Meet/Zoom/Teams, captura da aba + microfone em documento offscreen, painel lateral com preparação, consentimento e transcrição ao vivo; aviso para apps desktop.
- Conexão da extensão pela web via `externally_connectable` com allowlist de IDs.
- Web: módulo Assistente de Calls (lista e detalhe com transcrição) e linha do tempo do cliente.

### Etapa 2 — Skill de CS e Playbook Intelligence

- `@sci/cs-skill` v1.0.0: princípios, 8 indicadores com rubricas, 10 sinais de churn, 8 oportunidades, 12 tipos de pergunta, biblioteca de perguntas com aprofundamento, objetivos por tipo de reunião e regras de prudência; versionada com hash de conteúdo.
- Configuração da skill por tenant (tipos de pergunta, tom, cadência, prioridades, orientações).
- Extração de texto de PDF, DOCX, PPTX (com notas), XLSX, TXT e Markdown, com verificação de tipo pelo conteúdo e proteção contra zip bomb.
- Cliente DeepSeek (JSON mode, retry, correção guiada por validação) e cliente Jev/TypeSafe (`@typesafe-ai/sdk`) atrás de interfaces.
- Interpretação de playbooks em partes, normalização para contrato tipado, classificação do documento pelo Jev.
- Playbooks múltiplos por jornada, tipo de reunião, segmento e operação; versionamento, revisão, edição, aprovação, publicação, arquivamento, desativação e clone; versões aprovadas imutáveis no banco.
- Fila `sci.playbooks` (BullMQ) processada pelo worker; processamento inline em desenvolvimento.
- Telas: lista de playbooks, versões, editor estruturado com fluxo de aprovação e configuração da skill.

### Etapa 1 — Fundação

- Monorepo pnpm + Turborepo com TypeScript estrito.
- PostgreSQL 16 com Row Level Security **forçado**; papel `sci_app` sem BYPASSRLS; contexto por transação.
- Chaves estrangeiras compostas impedindo vínculos entre tenants.
- Autenticação por sessão (cookie httpOnly) e token revogável para a extensão; Argon2id; proteção CSRF por origem; rate limit de login.
- Multi-tenancy com superadmin (Academia Scale), papéis padrão (Administrador, Gestor, Customer Success, Analista) e permissões configuráveis por tenant.
- Trilha de auditoria imutável (somente inserção).
- Carteira de clientes e contatos; dashboard com indicadores apenas de dados reais.
- Criptografia de credenciais AES-256-GCM com rotação de chave.
- Worker BullMQ com job de retenção de sessões.
- Docker (API, worker, web), Compose para dev/homologação/produção, Caddy ou Nginx existente.
- Scripts de backup, restauração, deploy com aprovação para produção e rollback.
- GitHub Actions: lint, tipos, build, validação de migrations, testes, auditoria de dependências, gitleaks, CodeQL, publicação de imagens.
