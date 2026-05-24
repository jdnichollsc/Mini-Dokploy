#!/usr/bin/env bash
set -euo pipefail
echo "→ Stopping Temporal infrastructure..."
docker compose -f docker-compose.yml down
echo "✓ Temporal stack down (volumes preserved)"
