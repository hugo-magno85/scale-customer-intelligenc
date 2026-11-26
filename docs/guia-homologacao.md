# Guia — colocar a homologação no ar

Servidor: Ubuntu 26.04, 4 vCPU, 5,8 GB (inspecionado em 2026-11-26). Nada existente é alterado.
O Scale usa a pasta `/opt/academia-scale/scale-customer-intelligence` e as portas locais 13000 (web) e 14000 (API).

## Parte 1 — GitHub (navegador)

1. **Deploy key** (leitura): no servidor rode
   `ssh-keygen -t ed25519 -N "" -f ~/.ssh/sci_deploy -C scale-ci-deploy && cat ~/.ssh/sci_deploy.pub`
   e cole a linha em _Settings → Deploy keys → Add deploy key_ (sem permissão de escrita).
2. **Variáveis** em _Settings → Secrets and variables → Actions → Variables_:
   `PUBLIC_API_URL=https://api-homolog-scale.academiascale.com.br` e
   `PUBLIC_APP_URL=https://homolog-scale.academiascale.com.br`.
3. **Gerar as imagens**: _Actions → Release images → Run workflow_ (branch `develop`).
   Ao terminar, anote a versão `dev-xxxxxxx` mostrada no passo “Versão”.
4. **Token para baixar imagens**: _github.com/settings/tokens → Generate new token (classic)_,
   escopo apenas `read:packages`, validade 1 ano. Guarde-o; será digitado no servidor.

## Parte 2 — DNS e HTTPS

1. No gerenciador de DNS de `academiascale.com.br`, crie dois registros **A** apontando para o IP do servidor:
   `homolog-scale` e `api-homolog-scale`.
2. No painel do servidor, crie um **proxy reverso / site** para cada domínio, com SSL (Let's Encrypt):
   - `homolog-scale.academiascale.com.br` → `http://127.0.0.1:13000`
   - `api-homolog-scale.academiascale.com.br` → `http://127.0.0.1:14000` (habilite **WebSocket** se houver a opção)

## Parte 3 — Servidor (terminal)

```bash
# 1. swap de 4 GB (proteção contra falta de memória; beneficia todos os serviços)
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 2. código (somente leitura, via deploy key)
cd /opt/academia-scale/scale-customer-intelligence
GIT_SSH_COMMAND="ssh -i ~/.ssh/sci_deploy -o StrictHostKeyChecking=accept-new" git clone -b develop git@github.com:hugo-magno85/scale-customer-intelligenc.git staging

# 3. configuração com senhas geradas automaticamente (não sobrescreve se já existir)
cd staging && ./infrastructure/scripts/init-env.sh staging homolog-scale.academiascale.com.br api-homolog-scale.academiascale.com.br hugo-magno85

# 4. login no registro de imagens (usuário: hugo-magno85 · senha: o token read:packages)
docker login ghcr.io -u hugo-magno85

# 5. subir a versão gerada no GitHub (troque dev-xxxxxxx)
./infrastructure/scripts/deploy.sh staging dev-xxxxxxx

# 6. criar o superadmin da Academia Scale (a senha é pedida sem aparecer na tela)
./infrastructure/scripts/create-admin.sh staging seu-email@academiascale.com.br "Seu Nome"

# 7. backup diário às 02:15
(crontab -l 2>/dev/null; echo "15 2 * * * /opt/academia-scale/scale-customer-intelligence/staging/infrastructure/scripts/backup.sh staging >> /var/log/sci-backup.log 2>&1") | crontab -
```

Guarde uma cópia segura de `infrastructure/compose/env/staging.env` (contém as senhas e a chave do cofre).

## Parte 4 — Conferir

- `https://api-homolog-scale.academiascale.com.br/health/ready` → `{"status":"ok"...}`
- `https://homolog-scale.academiascale.com.br` → tela de login; entre com o superadmin e crie o primeiro tenant em **Superadmin**.

## Chaves de IA (quando tiver)

`nano infrastructure/compose/env/staging.env` → preencher `DEEPGRAM_API_KEY`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL_*`, `TYPESAFE_API_KEY`
e reaplicar: `./infrastructure/scripts/deploy.sh staging <mesma versão>`.

## Atualizar e voltar versão

- Nova versão: rodar o workflow de novo e `./infrastructure/scripts/deploy.sh staging dev-novo`
- Voltar à anterior: `./infrastructure/scripts/rollback.sh staging`
