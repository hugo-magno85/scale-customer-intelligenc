# ADR 0004 — Papéis do DeepSeek e do Jev

**Status:** aceito · 2026-11-25

- **Jev (TypeSafe):** decisões estruturadas e rápidas (sim/não, escolha, score com probabilidades):
  classificar sinais, verificar cobertura do playbook, priorizar candidatos, conferir evidências.
- **DeepSeek:** linguagem e raciocínio — interpretar playbooks, redigir perguntas e motivos, resumos,
  diagnósticos e planos de ação, sempre em JSON validado por Zod.
- **Código:** cálculos determinísticos (Customer Health, agregações, pesos do tenant).

Ambos ficam atrás de interfaces (`DecisionProvider`, `ReasoningProvider`) para testes e para operar
em modo degradado se um provedor ficar indisponível.
