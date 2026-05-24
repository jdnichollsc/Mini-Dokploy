#!/usr/bin/env bash
# Idempotent overlay-attachable network creation for mini-dokploy.
# Both networks are attachable so plain docker compose (Temporal infra) can
# join them, and Swarm services (web, worker, traefik, user deployments) can
# also join them. This single mechanism solves cross-stack DNS.
set -euo pipefail

create_overlay() {
  local name="$1"
  if docker network inspect "$name" >/dev/null 2>&1; then
    echo "✓ Network '$name' already exists"
    return 0
  fi
  echo "→ Creating overlay attachable network '$name'..."
  docker network create --driver=overlay --attachable "$name" >/dev/null
  echo "✓ Created '$name'"
}

create_overlay dokploy-network
create_overlay temporal-network
