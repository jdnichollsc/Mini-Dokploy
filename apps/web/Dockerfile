# Multi-stage build for the Next.js web app.
# Uses output: "standalone" so the final image only ships the trimmed server.js
# + the minimum needed node_modules.

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/ai/package.json ./packages/ai/
COPY packages/api/package.json ./packages/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/env/package.json ./packages/env/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/ui/package.json ./packages/ui/
COPY packages/workflow-client/package.json ./packages/workflow-client/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm -F web build

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Next.js standalone bundle: includes a minimal server.js with the deps it
# actually needs. Public + static go in the same shape Next expects them.
COPY --from=build /repo/apps/web/.next/standalone/ ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public 2>/dev/null || true

# Migrations bundle so the entrypoint can apply them inside the container.
COPY --from=build /repo/packages/db/src/migrations ./packages/db/src/migrations

# Entrypoint runs migrations against /data/local.db then exec's the server.
COPY apps/web/docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/entrypoint"]
