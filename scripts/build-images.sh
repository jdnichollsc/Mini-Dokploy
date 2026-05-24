#!/usr/bin/env bash
# Build the mini-dokploy web + worker images locally (single-node Swarm).
# `--load` puts the image into the local Engine so `docker stack deploy` can
# schedule services from it; without it, buildx caches the image in the
# builder and Swarm reports "image not found".
set -euo pipefail

echo "→ Building mini-dokploy/web:latest..."
docker buildx build \
  --load \
  -t mini-dokploy/web:latest \
  -f apps/web/Dockerfile \
  .

echo "→ Building mini-dokploy/worker:latest..."
docker buildx build \
  --load \
  -t mini-dokploy/worker:latest \
  -f apps/worker/Dockerfile \
  .

echo "✓ Images built"
