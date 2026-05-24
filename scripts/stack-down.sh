#!/usr/bin/env bash
set -euo pipefail
echo "→ Removing dokploy stack..."
docker stack rm dokploy || true
echo "→ Stopping Temporal compose stack..."
docker compose -f docker-compose.yml down
echo "✓ Stack down"
