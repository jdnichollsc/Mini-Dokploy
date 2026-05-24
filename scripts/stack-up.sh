#!/usr/bin/env bash
# One-command bootstrap of the entire Mini-Dokploy stack.
# Idempotent: re-running brings everything to the desired state.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "✗ .env not found. Run: cp .env.example .env && fill in BETTER_AUTH_SECRET"
  exit 1
fi

pnpm swarm:init
pnpm net:up
pnpm temporal:up
pnpm build:images

echo "→ Deploying Mini-Dokploy Swarm stack..."
# Pass the env file through to substitute ${BETTER_AUTH_SECRET}, etc.
set -a
. ./.env
set +a
docker stack deploy -c docker-compose.dokploy.yml dokploy

echo ""
echo "✓ Stack deployed."
echo "  UI:        http://dokploy.127.0.0.1.sslip.io"
echo "  Temporal:  http://localhost:8080"
echo "  Traefik:   http://localhost:8080/dashboard/ (api)"
echo ""
echo "Tail logs with: docker service logs -f dokploy_web"
