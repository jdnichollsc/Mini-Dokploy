#!/usr/bin/env bash
set -euo pipefail
echo "→ Starting Temporal infrastructure (compose)..."
docker compose -f docker-compose.yml up -d
echo "✓ Temporal stack up. UI: http://localhost:8080  |  gRPC: localhost:7233"
