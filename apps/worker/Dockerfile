# Worker image: needs Docker CLI + buildx plugin + git, plus the worker JS.
ARG NODE_VERSION=22-bookworm

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

FROM node:${NODE_VERSION} AS runtime
# Install Docker CLI + buildx + git (required by the build/git activities).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
COPY --from=deps /repo /repo
COPY . .

# Entrypoint joins the host's docker socket gid so a non-root user can call dockerd.
COPY apps/worker/docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

ENV NODE_ENV=production
ENTRYPOINT ["/usr/local/bin/entrypoint"]
