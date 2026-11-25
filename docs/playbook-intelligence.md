# Skill de CS e Playbook Intelligence (Etapa 2)

## Camadas

| Camada                       | Implementação                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Conhecimento especialista | `packages/cs-skill` — versionado (SemVer + hash de conteúdo), registrado em `cs_skill_versions` |
| 2. Playbook da empresa       | `playbooks` / `playbook_versions` (estrutura validada por `PlaybookStructure`)                  |
| 3. Contexto do cliente       | Etapas 5 e 7                                                                                    |
| 4. Contexto da reunião       | Etapas 3 e 4                                                                                    |
| 5. Motor de decisão          | Etapa 4 (usa `renderSkillInstructions`, biblioteca de perguntas, sinais e regras)               |

A skill **não** é um prompt solto no código: é conhecimento estruturado (princípios, 8 indicadores com
rubrica 0–4, 10 sinais de churn, 8 tipos de oportunidade, 12 tipos de pergunta, biblioteca de perguntas
com cadeias de aprofundamento, objetivos por tipo de reunião e regras de prudência), com testes de
integridade. Alterar conteúdo sem incrementar `SKILL_VERSION` faz o registro falhar de propósito.

Cada tenant ajusta: tipos de pergunta habilitados, tom, intervalo entre sugestões, número de
alternativas, prioridades estratégicas e orientações adicionais (`tenant_skill_settings`).

## Fluxo do playbook

1. **Upload** (PDF, DOCX, PPTX, XLSX, TXT, MD; tipo verificado pelo conteúdo, não pelo nome) → versão `processing`.
2. **Extração** no worker (texto salvo para auditoria e reprocessamento).
3. **Classificação** (Jev): é um playbook? para qual tipo de reunião? — gera avisos, não bloqueia.
4. **Interpretação** (DeepSeek, JSON validado; 1 nova tentativa com o erro devolvido ao modelo).
5. **Estruturação**: normalização para o contrato (chaves únicas, enums válidos, referências coerentes).
6. **Revisão** (`in_review`) com avisos → **edição** → **aprovação** (`playbooks.approve`) → **publicação**.
7. A publicada anterior é **arquivada**; versões aprovadas/publicadas/arquivadas são **imutáveis** (trigger no banco).
8. Perguntas e critérios da versão publicada são normalizados em `playbook_questions`/`playbook_criteria`
   com id estável para as sugestões em tempo real referenciarem.

Também é possível o **cadastro manual** e criar nova versão a partir de outra (clone).

## Segurança

- Conteúdo do documento é delimitado e tratado como dado no prompt (defesa contra prompt injection).
- Saída do modelo nunca é gravada sem passar pelo contrato Zod.
- Sem chave do DeepSeek, a versão falha com mensagem clara; o texto extraído fica salvo para reprocessar.

## Pendências desta etapa

- Validar com chaves reais: `DEEPSEEK_API_KEY` (e confirmar os IDs de modelo vigentes em
  api-docs.deepseek.com — o host não estava acessível no ambiente de desenvolvimento) e `TYPESAFE_API_KEY`.
- Suíte de avaliação da interpretação com playbooks reais da Academia Scale (precisa de material e chaves).
