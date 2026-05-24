#!/usr/bin/env bash
# Bring up Traefik so user deployments are routable on
# http://app-<id>.127.0.0.1.sslip.io. Idempotent.
#
# Architecture:
#   1. dokploy-socket-proxy — nginx that proxies the Docker socket over TCP,
#      rewriting Traefik's hardcoded /v1.24/* path to /v1.40/* (the minimum
#      the current Docker engine accepts).
#   2. dokploy-traefik — uses --providers.swarm.endpoint=tcp://dokploy-socket-proxy:2375
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

PROXY_NAME="dokploy-socket-proxy"
TRAEFIK_NAME="dokploy-traefik"

# Re-create the proxy every time so config changes take effect.
docker service rm "$PROXY_NAME" >/dev/null 2>&1 || true
sleep 1
echo "→ Deploying nginx socket-proxy (rewrites /v1.24 → /v1.40)..."
docker service create \
  --name "$PROXY_NAME" \
  --network dokploy-network \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
  --mount "type=bind,src=${ROOT}/scripts/socket-proxy.conf,dst=/etc/nginx/nginx.conf,readonly=true" \
  --constraint node.role==manager \
  --restart-condition any \
  --user 0:0 \
  nginx:1.27-alpine \
  >/dev/null
echo "✓ socket-proxy ready"

if docker service ls --filter "name=$TRAEFIK_NAME" --format '{{.Name}}' | grep -q "^${TRAEFIK_NAME}$"; then
  echo "✓ Traefik already running"
  exit 0
fi

echo "→ Deploying Traefik as a Swarm service..."
docker service create \
  --name "$TRAEFIK_NAME" \
  --network dokploy-network \
  --publish published=80,target=80,mode=host \
  --publish published=8081,target=8080,mode=host \
  --constraint node.role==manager \
  --restart-condition any \
  traefik:v3.5 \
  --api.dashboard=true \
  --api.insecure=true \
  --providers.swarm=true \
  --providers.swarm.endpoint=tcp://dokploy-socket-proxy:2375 \
  --providers.swarm.exposedbydefault=false \
  --providers.swarm.network=dokploy-network \
  --providers.swarm.refreshseconds=5 \
  --entrypoints.web.address=:80 \
  >/dev/null

echo "✓ Traefik service created."
echo "  Routing:   http://<id>.127.0.0.1.sslip.io  → user deployments"
echo "  Dashboard: http://localhost:8081/dashboard/"
