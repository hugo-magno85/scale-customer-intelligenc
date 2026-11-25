#!/usr/bin/env bash
# Inspeção SOMENTE LEITURA do servidor antes da instalação. Não altera nada.
echo "== SO";        cat /etc/os-release 2>/dev/null | head -3; uname -r
echo "== CPU/RAM";   nproc; free -h
echo "== Disco";     df -h / /opt 2>/dev/null
echo "== Docker";    docker --version 2>&1; docker compose version 2>&1
echo "== Containers"; docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>&1
echo "== Proxy";     (nginx -v 2>&1; systemctl is-active nginx caddy apache2 2>/dev/null) | cat
echo "== Portas em uso"; ss -ltnp 2>/dev/null | awk 'NR>1{print $4}' | sort -u
echo "== Firewall";  (ufw status 2>/dev/null || iptables -S 2>/dev/null | head -20)
echo "== Certificados"; ls /etc/letsencrypt/live 2>/dev/null
echo "== Postgres local"; (systemctl is-active postgresql 2>/dev/null; psql --version 2>/dev/null) | cat
echo "== Cron";      crontab -l 2>/dev/null | head -20
