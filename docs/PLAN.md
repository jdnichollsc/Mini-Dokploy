# Mini-Dokploy — Implementation Plan v3

> Revised after `/seldon` v2 review. Resolves all 5 blocking + 5 non-blocking
> findings structurally (not via patches). Reflects the user-validated brief
> (Pages Router + tRPC, SQLite + Drizzle, Docker Swarm services for the
> product surface, one-command stack, BetterAuth + WebSocket logs bonuses).

## 0. Locked decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Next.js router | **Pages Router** (`apps/web/src/pages/`) — migrate from BTS App Router scaffold | Brief requires Pages Router. |
| 2 | App DB | **SQLite** via `@libsql/client` + Drizzle (`dialect: "turso"`) | Brief requires SQLite + Drizzle. |
| 3 | Temporal DB | `temporal-postgresql` container, isolated, named volume | User compose layout. |
| 4 | Orchestration | **Hybrid**: plain compose for Temporal infra; **Docker Swarm** for Traefik, mini-dokploy `web`, `worker`, all user deployments. `pnpm stack:up` is the canonical "one command" for the brief's stack requirement. | Brief mandates Docker services (not `docker run` / not plain compose) for the product surface. |
| 5 | Workflow engine | **Temporal** for the deploy lifecycle | Durability, retries, replay. |
| 6 | Package boundaries (v3) | **Two new packages**: `packages/core` (pure: types, labels, id helpers, zod schemas, **zero runtime side-effects**) + `packages/orchestrator` (worker-only: dockerode, simple-git, buildx wrapper, Temporal client, AI clients). `packages/api` imports only `core`. `apps/worker` imports both. | Fixes seldon-v2 blocker #3 — no dockerode/AI/git pulled into Next runtime. |
| 7 | AI | **Vercel AI SDK** with Claude — three activities (suggest Dockerfile/port, explain failure, label suggester) | User-validated. |
| 8 | Auth | **BetterAuth + organization plugin** for multi-tenant | Bonus from the brief. |
| 9 | Logs (bonus) | WebSocket streaming a single canonical log path with tenant auth | Bonus from the brief. |

## 1. Network topology

Two **overlay attachable** networks created idempotently by `scripts/network-up.sh` BEFORE
either compose or stack runs. Attachable means: plain compose can join them, and Swarm
services can join them too — that's the single mechanism that solves cross-stack DNS.

| Network | Driver | Members |
|---|---|---|
| `dokploy-network` | overlay, attachable | Traefik, web, worker, all `app-*` user services |
| `temporal-network` | overlay, attachable | temporal-postgresql, temporal, temporal-admin-tools, temporal-ui, **+ web, + worker** |

`TEMPORAL_ADDRESS` uniformly = `temporal:7233` in containers. For native dev outside
containers it's `localhost:7233` (port published by compose). Resolved in
`packages/env/src/server.ts` via env var with a sensible default.

## 2. Two runtime modes

| Command | Use | What runs |
|---|---|---|
| `pnpm dev` | inner loop | overlays + Temporal compose + Traefik swarm service + native `turbo dev` for `apps/web` and `apps/worker`. |
| `pnpm stack:up` | **canonical one-command stack** | overlays + Temporal compose + full Swarm stack (`web` + `worker` + `traefik`). Acceptance runs against this. |
| `pnpm stack:down` | teardown | `docker stack rm dokploy` + `docker compose down` |

README labels `pnpm stack:up` as the evaluator-facing one and explains the split.

## 3. Final monorepo layout (v3 — fixes seldon-v2 #3)

```
mini-dokploy/
├── apps/
│   ├── web/                              # Next.js Pages Router + tRPC
│   │   ├── Dockerfile                    # node:22-bookworm-slim, multi-stage → mini-dokploy/web:latest
│   │   ├── docker-entrypoint.sh          # runs `pnpm -F @mini-dokploy/db migrate` then `node server.js`
│   │   ├── next.config.ts                # output: "standalone"  (so we get a runnable server.js)
│   │   ├── src/pages/
│   │   │   ├── _app.tsx, _document.tsx
│   │   │   ├── index.tsx                 # SSR redirect to /deployments
│   │   │   ├── login.tsx
│   │   │   ├── organizations/index.tsx
│   │   │   ├── deployments/index.tsx
│   │   │   ├── deployments/new.tsx
│   │   │   ├── deployments/[id].tsx
│   │   │   └── api/
│   │   │       ├── trpc/[trpc].ts        # @trpc/server/adapters/next createNextApiHandler
│   │   │       ├── auth/[...all].ts      # toNodeHandler(auth) — config: api.bodyParser=false, externalResolver=true
│   │   │       └── ws/logs/[runId].ts    # WS upgrade; tenant-checks runId before accepting (see §13)
│   │   └── src/utils/trpc.ts             # createTRPCNext + httpBatchLink
│   └── worker/                           # NEW — Temporal worker process
│       ├── Dockerfile                    # node:22-bookworm + docker-ce-cli + buildx plugin + git (see §6)
│       ├── docker-entrypoint.sh          # joins docker socket gid, then exec node dist/main.js
│       ├── src/main.ts                   # @temporalio/worker bootstrap + reconciliation kickoff
│       ├── src/workflows/
│       │   ├── deploy.workflow.ts        # type-only imports from ../activities
│       │   └── destroy.workflow.ts
│       └── src/activities/
│           ├── index.ts                  # barrel
│           ├── git.ts                    # @mini-dokploy/orchestrator → simple-git
│           ├── docker.ts                 # @mini-dokploy/orchestrator → services + buildx
│           ├── persistence.ts            # @mini-dokploy/db → Drizzle writes
│           ├── reconciliation.ts         # @mini-dokploy/db → fix stuck rows on worker startup
│           └── ai.ts                     # @mini-dokploy/orchestrator → Vercel AI SDK
├── packages/
│   ├── core/                             # PURE — no I/O, no side-effects, no Node-only deps
│   │   ├── src/
│   │   │   ├── traefik/
│   │   │   │   ├── labels.ts             # buildTraefikLabels (hardened, pure)
│   │   │   │   └── labels.test.ts
│   │   │   ├── ids.ts                    # generateDnsLabelSafeId, validateId
│   │   │   ├── status.ts                 # deployment status state machine
│   │   │   └── schemas.ts                # zod schemas for deployment input, used by tRPC + worker
│   │   └── package.json                  # deps: zod, nanoid — that's it
│   ├── orchestrator/                     # NEW — worker-only side-effect code
│   │   ├── src/
│   │   │   ├── docker/
│   │   │   │   ├── client.ts             # singleton dockerode, socket auto-detect
│   │   │   │   ├── services.ts           # createOrUpdateService, removeService — uses core/traefik
│   │   │   │   └── build.ts              # spawn `docker buildx build` + tee stdout to log file
│   │   │   ├── git/clone.ts              # simple-git shallow clone + heartbeat
│   │   │   ├── ai/
│   │   │   │   ├── client.ts             # @ai-sdk/anthropic
│   │   │   │   ├── suggest-dockerfile.ts
│   │   │   │   └── explain-failure.ts
│   │   │   └── temporal/client.ts        # @temporalio/client lazy singleton
│   │   └── package.json                  # deps: dockerode, simple-git, ai, @ai-sdk/anthropic, @temporalio/client, @mini-dokploy/core, @mini-dokploy/db
│   ├── api/                              # tRPC only — imports `core` (pure) + `orchestrator/temporal/client`
│   │   └── src/
│   │       ├── routers/
│   │       │   ├── index.ts              # appRouter
│   │       │   └── deployments.ts        # list/get/create/redeploy/destroy → start Temporal workflows
│   │       └── (existing)
│   ├── db/                               # SQLite + Drizzle
│   │   ├── src/
│   │   │   ├── index.ts                  # createDb, db
│   │   │   ├── migrate.ts                # NEW — programmatic migrator (called from web entrypoint)
│   │   │   ├── migrations/               # checked-in SQL migrations from drizzle-kit generate
│   │   │   └── schema/
│   │   │       ├── auth.ts, organization.ts (NEW), deployments.ts (NEW)
│   │   ├── drizzle.config.ts             # reads DATABASE_URL from process.env (no .env file load)
│   │   └── package.json                  # scripts: db:generate, db:migrate (programmatic), db:push (dev only)
│   ├── auth/                             # BetterAuth + organization plugin
│   │   └── src/
│   │       ├── index.ts                  # betterAuth({ plugins: [organization(), nextCookies()] })
│   │       └── client.ts                 # createAuthClient({ plugins: [organizationClient()] })
│   ├── env/                              # adds TEMPORAL_ADDRESS, ANTHROPIC_API_KEY, DOKPLOY_LOG_DIR
│   └── ui/                               # shadcn additions: table, dialog, form, sheet, badge, tabs, scroll-area
├── scripts/                              # bash, called from package.json
│   ├── swarm-init.sh
│   ├── network-up.sh                     # creates BOTH overlays attachable
│   ├── temporal-up.sh, temporal-down.sh
│   ├── build-images.sh                   # builds mini-dokploy/web:latest + mini-dokploy/worker:latest
│   ├── stack-up.sh                       # see §6
│   ├── stack-down.sh
│   └── temporal/                         # bind-mounted; setup-postgres.sh + create-namespace.sh
├── dynamicconfig/development-sql.yaml    # required by temporal server
├── docker-compose.yml                    # Temporal infra ONLY
├── docker-compose.dokploy.yml            # Swarm stack
├── .env.example                          # see §4
└── package.json                          # see §6
```

**Dependency direction enforced by tsconfig project refs** (no cycles, no leaks):

```
core   ← orchestrator ← apps/worker
core   ← api          ← apps/web
core   ← db
db     ← orchestrator
db     ← api
auth   ← api          (auth ← db)
```

`packages/api` package.json never lists `dockerode`, `simple-git`, `ai`, or
`@ai-sdk/*`. Verified with a CI check (`pnpm depcruise` or simple grep).

## 4. docker-compose.yml (Temporal infra — full rewrite, fixes seldon-v2 NB #2)

Adopt the user's latest layout. Replace the current postgis-based compose entirely.
Changes from current file:

- `db` (postgis) → `temporal-postgresql` (postgres:17-alpine) on `temporal-network`.
- Bridge → **external overlay** `temporal-network` (created by `network-up.sh`).
- Bind-mounts `./deployment/scripts/temporal` → `./scripts/temporal` (moves into repo
  root for clarity; matches the planned layout).
- `DYNAMIC_CONFIG_FILE_PATH=config/dynamicconfig/development.yaml` →
  `…/development-sql.yaml` (matches the file we'll ship).
- Postgres data: anonymous `/var/lib/postgresql/data` → **named** volume
  `temporal_postgres_data` so `compose down` doesn't lose Temporal history.
- Adds `temporal-ui` (already in user's example).

`.env.example`:

```
# Better-Auth
BETTER_AUTH_SECRET=                       # openssl rand -base64 32
BETTER_AUTH_URL=http://dokploy.127.0.0.1.sslip.io
CORS_ORIGIN=http://dokploy.127.0.0.1.sslip.io
# App DB (SQLite)
DATABASE_URL=file:./local.db              # dev only; stack overrides to file:/data/local.db
# Temporal (versions)
POSTGRESQL_VERSION=17-alpine
TEMPORAL_VERSION=1.29.2
TEMPORAL_ADMINTOOLS_VERSION=1.29.1-tctl-1.18.4-cli-1.5.0
TEMPORAL_UI_VERSION=2.44.1
# AI
ANTHROPIC_API_KEY=                        # optional; feature-flags AI activities
```

## 5. docker-compose.dokploy.yml (Swarm stack — fixes seldon-v2 #2 PORT)

```yaml
services:
  traefik:
    image: traefik:v3.2
    command:
      - --api.dashboard=true --api.insecure=true
      - --providers.swarm=true
      - --providers.swarm.exposedbydefault=false
      - --providers.swarm.network=dokploy-network
      - --providers.swarm.refreshseconds=5
      - --entrypoints.web.address=:80
    ports:
      - { target: 80,   published: 80,   mode: host }
      - { target: 8080, published: 8080, mode: host }
    volumes: [ "/var/run/docker.sock:/var/run/docker.sock:ro" ]
    networks: [ dokploy-network ]
    deploy:
      placement: { constraints: [node.role == manager] }

  web:
    image: mini-dokploy/web:latest
    environment:
      IN_CONTAINER: "1"
      PORT: "3001"                                  # ← seldon-v2 #2 fix: Next start listens on 3001
      DATABASE_URL: file:/data/local.db
      TEMPORAL_ADDRESS: temporal:7233
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      DOKPLOY_LOG_DIR: /data/logs
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: http://dokploy.127.0.0.1.sslip.io
      CORS_ORIGIN: http://dokploy.127.0.0.1.sslip.io
    volumes:
      - dokploy-data:/data
      - /var/run/docker.sock:/var/run/docker.sock   # web does NOT need this in v3 — drop
    networks: [ dokploy-network, temporal-network ]
    deploy:
      replicas: 1                                   # WebSocket file-tail is single-replica only (§13)
      placement: { constraints: [node.role == manager] }
      labels:
        - traefik.enable=true
        - traefik.http.routers.dokploy.rule=Host(`dokploy.127.0.0.1.sslip.io`)
        - traefik.http.routers.dokploy.entrypoints=web
        - traefik.http.services.dokploy.loadbalancer.server.port=3001

  worker:
    image: mini-dokploy/worker:latest
    environment:
      IN_CONTAINER: "1"
      DATABASE_URL: file:/data/local.db
      TEMPORAL_ADDRESS: temporal:7233
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      DOKPLOY_LOG_DIR: /data/logs
    volumes:
      - dokploy-data:/data                          # shares SQLite + logs with web
      - /var/run/docker.sock:/var/run/docker.sock   # worker IS the one that talks to Docker
    networks: [ dokploy-network, temporal-network ]
    deploy:
      replicas: 1
      placement: { constraints: [node.role == manager] }

networks:
  dokploy-network:  { external: true }
  temporal-network: { external: true }

volumes:
  dokploy-data:
```

The web image drops the Docker socket mount — only the worker needs it. tRPC mutations
call `temporalClient.workflow.start()` and the worker executes activities that touch
Docker. This shrinks the web container's attack surface.

## 6. Root scripts + stack-up (fixes seldon-v2 #1 — migrations)

```jsonc
// package.json
{
  "scripts": {
    "swarm:init":     "bash scripts/swarm-init.sh",
    "net:up":         "bash scripts/network-up.sh",
    "temporal:up":    "bash scripts/temporal-up.sh",
    "temporal:down":  "bash scripts/temporal-down.sh",
    "build:images":   "bash scripts/build-images.sh",
    "stack:up":       "bash scripts/stack-up.sh",
    "stack:down":     "bash scripts/stack-down.sh",
    "dev:setup":      "pnpm swarm:init && pnpm net:up && pnpm temporal:up",
    "dev":            "pnpm dev:setup && turbo dev"
  }
}
```

`scripts/stack-up.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
pnpm swarm:init
pnpm net:up
pnpm temporal:up
pnpm build:images
docker stack deploy -c docker-compose.dokploy.yml dokploy
echo "✅ Web booting; migrations run inside web container at entrypoint"
echo "✅ http://dokploy.127.0.0.1.sslip.io"
```

**Critical**: migrations run **inside** the `web` container at entrypoint
(`docker-entrypoint.sh`), not on the host. This guarantees the SQLite file at
`/data/local.db` (the Swarm-named volume) is the one that gets migrated.

```sh
# apps/web/docker-entrypoint.sh
#!/usr/bin/env sh
set -e
node -e "import('@mini-dokploy/db/migrate').then(m => m.runMigrations())"
exec node server.js
```

```typescript
// packages/db/src/migrate.ts
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

export async function runMigrations() {
  const client = createClient({ url: process.env.DATABASE_URL! });
  await migrate(drizzle(client), { migrationsFolder: "./packages/db/src/migrations" });
}
```

`drizzle.config.ts` is changed to read `DATABASE_URL` directly from
`process.env` (no `dotenv.config({ path: "../../apps/web/.env" })` — that was App
Router specific and confuses stack mode). For dev, the user exports DATABASE_URL or
the package.json prepends it.

## 7. Worker Dockerfile (fixes seldon-v2 #4)

```dockerfile
# apps/worker/Dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/core/package.json ./packages/core/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/db/package.json ./packages/db/
COPY packages/env/package.json ./packages/env/
RUN corepack enable && pnpm install --frozen-lockfile --filter=worker...

FROM deps AS build
COPY . .
RUN pnpm -F worker build

FROM node:22-bookworm-slim AS runtime
# Docker CLI + buildx plugin + git — required by the build activity
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
COPY apps/worker/docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint"]
```

```sh
# apps/worker/docker-entrypoint.sh — joins the host's docker socket gid so non-root can call dockerd
#!/usr/bin/env sh
set -e
DOCKER_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo 0)"
if [ "$DOCKER_GID" != "0" ]; then
  getent group docker >/dev/null || addgroup --gid "$DOCKER_GID" docker
fi
exec node apps/worker/dist/main.js
```

`apps/web/Dockerfile` is similar but without the docker-ce-cli / buildx layer (web
does no Docker work in v3).

## 8. Drizzle schema (`packages/db/src/schema/`)

`organization.ts` — generated by `npx @better-auth/cli@latest generate` with the
organization plugin enabled. Produces `organization`, `member`, `invitation` and
adds `session.activeOrganizationId TEXT`. Commit the generated file.

`deployments.ts` — adds **`targetStatus`** to `deploymentRun` so reconciliation is
deterministic (fixes seldon-v2 #5):

```typescript
export const deployment = sqliteTable("deployment", {
  id: text("id").primaryKey(),                          // DNS-label-safe nanoid (10 chars, validated)
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  repoUrl: text("repo_url").notNull(),
  branch: text("branch").notNull().default("main"),
  dockerfilePath: text("dockerfile_path").notNull().default("Dockerfile"),
  exposedPort: integer("exposed_port").notNull(),
  customLabels: text("custom_labels", { mode: "json" }).$type<Record<string, string>>(),
  status: text("status", { enum: ["pending","building","deploying","running","failed","stopped"] })
    .notNull().default("pending"),
  url: text("url"),
  imageTag: text("image_tag"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(sql`...`).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$onUpdate(() => new Date()).notNull(),
}, (t) => [index("deployment_org_idx").on(t.organizationId)]);

export const deploymentRun = sqliteTable("deployment_run", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id").notNull().references(() => deployment.id, { onDelete: "cascade" }),
  workflowId: text("workflow_id").notNull().unique(),
  runId: text("run_id").notNull(),
  trigger: text("trigger", { enum: ["create","redeploy","destroy"] }).notNull(),
  status: text("status", { enum: ["running","success","failed","cancelled"] }).notNull(),
  targetStatus: text("target_status", { enum: ["running","stopped"] }).notNull(), // ← what success looks like
  failureReason: text("failure_reason"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).default(sql`...`).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});
```

## 9. Workflow + reconciliation (fixes seldon-v2 #5)

Reconciliation is deterministic and doesn't claim to restore "prior state":

- Worker startup invokes `reconcileStuckRuns()` once.
- For each `deployment_run` with `status="running"` AND no live Temporal workflow:
  - Set `deployment_run.status = "failed"`, `failureReason = "worker_restart"`,
    `finishedAt = now`.
  - Set parent `deployment.status` based on **the last successful run's
    `targetStatus`**: `"running"` if the prior successful trigger was `create` or
    `redeploy`; `"stopped"` if it was `destroy`. If no successful prior run,
    default to `"failed"`.
- No prior-status field is needed because the run history is the source of truth.

```typescript
// apps/worker/src/workflows/deploy.workflow.ts
const { gitClone, dockerBuild, dockerDeploy, setStatus, setRunStatus, aiExplainFailure }
  = proxyActivities<typeof activities>({
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "1 minute",
    retry: { maximumAttempts: 3, initialInterval: "5s", backoffCoefficient: 2 },
  });

export async function deployWorkflow(input: DeployInput) {
  await setRunStatus(input.runId, "running");
  try {
    await setStatus(input.deploymentId, "building");
    const workdir = await gitClone({ ...input });
    const imageTag = await dockerBuild({ workdir, ...input });
    await setStatus(input.deploymentId, "deploying");
    const { url } = await dockerDeploy({ ...input, imageTag });
    await setStatus(input.deploymentId, "running");
    await setRunStatus(input.runId, "success", { url, imageTag });
  } catch (err) {
    await setStatus(input.deploymentId, "failed");
    const reason = await aiExplainFailure({ runId: input.runId, error: String(err) });
    await setRunStatus(input.runId, "failed", { failureReason: reason });
    throw err;
  }
}
```

## 10. tRPC routers (`packages/api/src/routers/deployments.ts`)

```typescript
import { z } from "zod";
import { deploymentInput } from "@mini-dokploy/core/schemas";
import { generateDnsLabelSafeId } from "@mini-dokploy/core/ids";
import { getTemporalClient } from "@mini-dokploy/orchestrator/temporal/client";  // only entry point used in web

export const orgScoped = protectedProcedure.use(({ ctx, next }) => {
  const orgId = ctx.session.session.activeOrganizationId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Select an organization" });
  return next({ ctx: { ...ctx, organizationId: orgId } });
});

export const deploymentsRouter = router({
  list: orgScoped.query(/* deployments scoped by organizationId */),
  get:  orgScoped.input(z.object({ id: z.string() })).query(/* + ownership check */),
  create: orgScoped.input(deploymentInput).mutation(async ({ ctx, input }) => {
    const id = generateDnsLabelSafeId();
    const runId = generateDnsLabelSafeId();
    await db.transaction(async (tx) => {
      await tx.insert(deployment).values({ id, organizationId: ctx.organizationId, ...input });
      await tx.insert(deploymentRun).values({ id: runId, deploymentId: id, workflowId: runId, runId, trigger: "create", status: "running", targetStatus: "running" });
    });
    try {
      const client = await getTemporalClient();
      await client.workflow.start("deployWorkflow", { taskQueue: "deploy", workflowId: runId, args: [{ deploymentId: id, runId, ...input }] });
    } catch (e) {
      await db.update(deployment).set({ status: "failed" }).where(eq(deployment.id, id));
      await db.update(deploymentRun).set({ status: "failed", failureReason: String(e) }).where(eq(deploymentRun.id, runId));
      throw e;
    }
    return { deployment: { id }, runId };
  }),
  redeploy: orgScoped.input(/* id */).mutation(/* same but trigger: "redeploy" */),
  destroy:  orgScoped.input(/* id */).mutation(/* trigger: "destroy", targetStatus: "stopped" */),
});
```

The only `@mini-dokploy/orchestrator` import in `packages/api` is `temporal/client`
(thin wrapper). No dockerode, no AI, no git. CI grep prevents accidental imports.

## 11. Hardened Traefik labels (`packages/core/src/traefik/labels.ts`)

Copy verbatim from `.agents/skills/traefik/SKILL.md` Step 3. Tests required:

1. Generated labels: correct sslip.io host rule + port.
2. Non-colliding custom label merged.
3. Own router `rule` collision rejected.
4. Cross-tenant attempt rejected.
5. Non-prefixed user middleware rejected.

Lives in `packages/core` (pure — no I/O) so it's importable everywhere with zero deps.

## 12. AI activities (`packages/orchestrator/src/ai/`)

Three activities, all flagged behind `process.env.ANTHROPIC_API_KEY`:

- `suggestDockerfile(repoUrl)` → `generateObject` returning `{ dockerfilePath, exposedPort, reasoning }`.
- `suggestLabels(prompt, deploymentId)` → reviewed by user before submit.
- `explainFailure(logTail)` → `generateText` on last 80 lines.

Hash-cached in a SQLite table to make Temporal retries free. If key missing,
`suggestDockerfile`/`suggestLabels` throw a typed error the UI catches to hide
buttons; `explainFailure` returns the raw error string.

## 13. WebSocket logs (fixes seldon-v2 NB #5)

- Single canonical path: `${DOKPLOY_LOG_DIR}/<runId>.log` (default `/data/logs`).
  Both worker (writer) and web (reader) reference the same env var.
- Pages Router handler `apps/web/src/pages/api/ws/logs/[runId].ts`:
  - **Auth check**: load session via BetterAuth's server API; reject if no session.
  - **Tenant check**: `SELECT deployment.organization_id FROM deployment_run JOIN
    deployment ... WHERE deployment_run.run_id = $1`. Reject if not in active org.
  - Upgrade with `ws` package using `req.socket`.
  - Tail the file via `chokidar` + read appended bytes.
- Single-replica only (`replicas: 1` in stack). Document this. Future: Redis pub/sub.

## 14. Pages Router migration (fixes seldon-v2 NB #3 — bundle as one task)

Convert these **together** (mechanical file moves alone won't work):

| Current (App Router) | New (Pages Router) |
|---|---|
| `apps/web/src/app/layout.tsx` | `apps/web/src/pages/_app.tsx` (+`_document.tsx`) |
| `apps/web/src/app/page.tsx`, `dashboard/`, `login/` | `apps/web/src/pages/index.tsx`, `dashboard/index.tsx`, `login.tsx` |
| `apps/web/src/app/api/trpc/[trpc]/route.ts` (uses `fetchRequestHandler`, `NextRequest`) | `apps/web/src/pages/api/trpc/[trpc].ts` using `@trpc/server/adapters/next.createNextApiHandler` |
| `apps/web/src/app/api/auth/[...all]/route.ts` | `apps/web/src/pages/api/auth/[...all].ts` using `toNodeHandler(auth)` + `export const config = { api: { bodyParser: false } }` |
| `packages/api/src/context.ts` (`NextRequest`-typed) | Accepts `CreateNextContextOptions` (req: `NextApiRequest`); `auth.api.getSession({ headers: new Headers(req.headers as any) })` |
| `apps/web/src/utils/trpc.ts` (`createTRPCOptionsProxy` + `@trpc/tanstack-react-query`) | `createTRPCNext<AppRouter>({ ... })` from `@trpc/next` + Tanstack Query provider |
| `apps/web/src/components/providers.tsx` mounted in App layout | Mounted in `_app.tsx` |

Replace BTS's `@trpc/tanstack-react-query` with `@trpc/next`. Server Components and
Server Actions are not used. `reactCompiler: true` stays.

## 15. BetterAuth organization plugin (fixes seldon-v2 NB #4)

Three concrete additions (not just "add the plugin"):

1. **Server** (`packages/auth/src/index.ts`):
   ```typescript
   import { organization } from "better-auth/plugins/organization";
   plugins: [ organization({ allowUserToCreateOrganization: true }), nextCookies() ]
   ```
2. **Client** (`packages/auth/src/client.ts` — NEW file, exported separately):
   ```typescript
   export const authClient = createAuthClient({ plugins: [organizationClient()] });
   ```
   `apps/web/src/lib/auth-client.ts` re-exports from `@mini-dokploy/auth/client`.
3. **Schema regen** + commit:
   `npx @better-auth/cli@latest generate --config packages/auth/src/index.ts --output packages/db/src/schema/organization.ts`
   then `pnpm db:generate && commit`. Re-export from `packages/db/src/schema/index.ts`.
4. **Active org**: `/organizations` page lists orgs + sets active via
   `authClient.organization.setActive({ organizationId })`. tRPC `orgScoped` middleware
   reads `ctx.session.session.activeOrganizationId` (BetterAuth populates this).

## 16. Cut-line order (if behind schedule)

User chose "keep all features". Cut these in this order, each leaving a working MVP:

1. AI label suggester (keep dockerfile-suggest + failure-explain).
2. WebSocket live logs → "View logs" tRPC query returning last 200 lines.
3. `explainFailure` AI → raw error in `deployment_run.failureReason`.
4. `suggestDockerfile` AI → manual form only.
5. BetterAuth `organization` plugin → single-user mode (every deployment owned by the signed-in user).
6. Redeploy/destroy via Temporal → direct `@mini-dokploy/orchestrator` from tRPC mutation; keep `deployWorkflow` only.

## 17. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Docker socket = root | Auth-gate every mutation; tenant-scope all deployment IDs; hardened label filter. Web container does NOT mount socket. |
| Workflow non-determinism | Workflows only call `proxyActivities`. tsconfig in `apps/worker/src/workflows/tsconfig.json` bans imports from `@mini-dokploy/orchestrator/docker`, `/ai`, `/git`. Type-only imports allowed. |
| Long builds time out | `startToCloseTimeout: "30m"` + 5s heartbeats. |
| AI key missing → broken UX | Server-side flag; UI hides AI buttons when env unset. |
| Stack vs dev confusion | README documents both. Acceptance uses `pnpm stack:up`. |
| ID collisions | `generateDnsLabelSafeId()` — 10 lowercase-alphanumeric, regex-validated. |
| Cross-stack DNS for Temporal | Both networks attachable overlays; `temporal:7233` resolves uniformly. |
| Stuck rows on crash | `reconcileStuckRuns()` on worker startup (§9). |
| WebSocket tenant bypass | `runId` joined to deployment.organization_id, checked before upgrade (§13). |
| Pages Router adapter mistakes | §14 bundle — all 5 files change together, smoke test after. |

## 18. Rollout (in build order)

1. **Pages Router migration bundle** (§14). Verify `pnpm dev:web` boots, login still works.
2. **Foundation scripts** + `dynamicconfig/development-sql.yaml`. Verify Temporal UI at `:8080`.
3. **Drizzle schemas** + `packages/db/src/migrate.ts` + initial migration. `pnpm db:generate`.
4. **BetterAuth org plugin bundle** (§15). Schema regen committed.
5. **`packages/core`** — labels, ids, schemas + tests.
6. **`packages/orchestrator`** scaffold — docker client, services, build, git, temporal client.
7. **`apps/worker`** scaffold — Worker bootstrap + activities + `deployWorkflow`.
8. **End-to-end Phase 1**: tRPC `deployments.create` → workflow → `expressjs/express` deployed reachable on sslip.io.
9. **UI** — list/new/[id] pages.
10. **Redeploy + destroy** workflows.
11. **Reconciliation activity** + worker startup hook.
12. **Image build scripts** + `apps/web/Dockerfile` + `apps/worker/Dockerfile` (§7).
13. **`docker-compose.dokploy.yml`** + `scripts/stack-up.sh`. Run acceptance checklist on stack mode.
14. **AI** — `suggestDockerfile` + `explainFailure` + `suggestLabels`.
15. **WebSocket logs** (bonus, §13).
16. **README** — setup, architecture diagram, tradeoffs, AI usage.

Cut after step 13 if at the 8-hour ceiling.

## 19. Acceptance checklist

Run against `pnpm stack:up` (NOT `pnpm dev`):

- [ ] `pnpm stack:up` exits 0; `dokploy.127.0.0.1.sslip.io` loads UI on port 80 (Traefik → web:3001).
- [ ] Sign up → create org → set active → land on `/deployments`.
- [ ] Create deployment for `https://github.com/expressjs/express` → workflow visible in Temporal UI → status `running` → URL reachable.
- [ ] Redeploy reuses the same hostname with zero downtime.
- [ ] Destroy removes the Swarm service + soft-deletes + URL returns 404.
- [ ] Custom non-colliding label merged; hijack attempt dropped (verify in Traefik dashboard :8080).
- [ ] Bad Dockerfile path → AI explanation in `deployment_run.failureReason`.
- [ ] Worker crash mid-deploy → restart → reconciliation transitions row to `failed` with reason `"worker_restart"`.
- [ ] `packages/api/package.json` does not list `dockerode`, `simple-git`, `ai`, `@ai-sdk/*` (CI grep).
- [ ] README has the four required sections.
