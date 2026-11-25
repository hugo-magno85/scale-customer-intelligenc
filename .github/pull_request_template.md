## O que muda

## Como foi testado

## Checklist

- [ ] Testes passando localmente (`pnpm test`)
- [ ] Nenhum segredo, token ou dado real de cliente no diff
- [ ] Migrations novas são aditivas (expand/contract) e não editam migrations já aplicadas
- [ ] Novas tabelas de tenant têm `tenant_id`, RLS forçado e teste de isolamento
- [ ] Documentação/CHANGELOG atualizados
