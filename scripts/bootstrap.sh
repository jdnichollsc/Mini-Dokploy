#!/usr/bin/env bash
# One-command bootstrap for `pnpm dev`. Idempotent.
# - Verifies Docker is running
# - Creates .env with a generated BETTER_AUTH_SECRET if missing
# - Initializes Swarm + overlay networks
# - Brings up Temporal infra in compose, waits until healthy
# - Applies Drizzle migrations
set -euo pipefail
cd "$(dirname "$0")/.."

# --- 1. Docker preflight -------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  cat <<EOF
✗ Docker daemon is not reachable.

   Start Docker Desktop (or your engine of choice) and re-run \`pnpm dev\`.
   On macOS: open -a Docker
EOF
  exit 1
fi

# --- 2. .env --------------------------------------------------------------
if [ ! -f .env ]; then
  echo "→ Creating .env from .env.example..."
  cp .env.example .env
  secret="$(openssl rand -base64 32)"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${secret}|" .env
  else
    sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${secret}|" .env
  fi
  echo "  ✓ generated BETTER_AUTH_SECRET"
fi

# --- 3. Swarm + overlay networks -----------------------------------------
bash scripts/swarm-init.sh
bash scripts/network-up.sh
bash scripts/traefik-up.sh

# --- 4. Temporal infra ---------------------------------------------------
bash scripts/temporal-up.sh

echo -n "→ Waiting for Temporal to be healthy"
for i in $(seq 1 60); do
  if docker exec temporal tctl --address localhost:7233 cluster health >/dev/null 2>&1; then
    echo " ✓"
    break
  fi
  echo -n "."
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo
    echo "✗ Temporal did not become healthy in 120s. Check: docker compose -f docker-compose.yml logs temporal"
    exit 1
  fi
done

# --- 5. Migrations -------------------------------------------------------
# Load the repo-root .env into this shell and pass DATABASE_URL through
# explicitly. Belt-and-braces: packages/env/load-env.ts also walks up looking
# for .env, but doing it here means we never depend on cwd resolution.
set -a
. ./.env
set +a
if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL not found in .env. Add a line like:"
  echo "    DATABASE_URL=file:./local.db"
  exit 1
fi
echo "→ Applying Drizzle migrations against ${DATABASE_URL}..."
DATABASE_URL="${DATABASE_URL}" pnpm -F @mini-dokploy/db db:migrate

echo ""
echo "✓ Bootstrap complete."
echo "  Next.js:    http://localhost:3001"
echo "  Temporal:   http://localhost:8080"
echo ""
