#!/usr/bin/env bash
# Idempotent Docker Swarm initialization.
set -euo pipefail

state="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo inactive)"
if [ "$state" = "active" ]; then
  echo "✓ Swarm already initialized"
  exit 0
fi

echo "→ Initializing Docker Swarm (single-node)..."
docker swarm init --advertise-addr 127.0.0.1 >/dev/null
echo "✓ Swarm initialized"
