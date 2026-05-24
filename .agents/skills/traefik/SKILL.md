---
name: traefik
description: This skill should be used when the user asks to "set up Traefik", "add Traefik to docker-compose", "route a container", "generate Traefik labels", "expose a service on a subdomain", "use sslip.io for local domains", "wire deployments to Traefik", "configure Let's Encrypt", "add reverse-proxy middleware (rate limit, basic auth, headers, IP allowlist, compression, retry, strip prefix)", or mentions Traefik routers, services, entrypoints, middlewares, IngressRoute, ACME, or the Traefik dashboard. Strongly applies whenever the mini-dokploy app needs to programmatically attach routing labels to user deployments or whenever new services land in the root docker-compose.yml.
license: Apache-2.0
compatibility: 'Docker, Docker Compose v2, Kubernetes, macOS, Linux'
metadata:
  author: mini-dokploy
  version: 2.0.0
  category: devops
  tags:
    - traefik
    - reverse-proxy
    - docker
    - docker-compose
    - sslip-io
    - letsencrypt
    - mini-dokploy
    - turborepo
---

# Traefik

## Purpose

Traefik is the edge router that turns a Docker workload into a reachable URL with TLS, without editing a config file. It watches the Docker socket (and the Swarm API), reads each service's labels, and rebuilds its routing table in milliseconds. That property is what makes mini-dokploy possible: the API creates a Swarm service for each user deployment, attaches a handful of labels, and Traefik immediately serves it on `app-<id>.127.0.0.1.sslip.io` (local) or `app-<id>.example.com` (prod) — no proxy restart, no template render, no DNS dance.

Use this skill whenever wiring services into the root stack file, generating labels from the tRPC backend, debugging "why is my deployment 404-ing", or hardening routes with middleware.

> **Orchestration note** — `TASK.md:12` requires *"Docker services (not docker run / not plain compose) for orchestration — both Mini-Dokploy itself and user deployments."* That rules out `docker run`, plain `docker compose up`, and `docker.createContainer`. Use **Docker Swarm services** throughout: `docker stack deploy` for the platform itself, `docker.createService` (via dockerode) for user deployments. Traefik's `swarm` provider replaces (or augments) the `docker` provider for this model.

## How to use this skill

- For a 60-second cheat sheet of compose snippets and a Traefik-vs-Nginx-vs-Caddy-vs-HAProxy table, run `bash .claude/skills/traefik/scripts/script.sh intro|docker|k8s` from the repo root. Use it as a quick lookup, not as the primary source — the cheat sheet predates the Swarm migration and shows the legacy docker-provider snippets; the mini-dokploy-specific guidance below supersedes it.
- For deep dives, read the files in `references/` only when actually needed (see "Additional resources" at the bottom).

## Core model (4 nouns)

Internalize these four — most label confusion disappears once they click:

1. **EntryPoint** — a port Traefik listens on (`web` = 80, `websecure` = 443). Declared once in the static config.
2. **Router** — a rule (`Host(\`x\`) && PathPrefix(\`/api\`)`) that matches an incoming request and forwards it to a Service. Attached to one or more EntryPoints.
3. **Service** — the backend (container, list of URLs, weighted pool). Owns the load-balancing, health-check, and sticky-session settings.
4. **Middleware** — a request transformer chained onto a Router (rate limit, auth, headers, strip prefix, redirect).

Label naming follows this shape: `traefik.http.<routers|services|middlewares>.<name>.<attribute>=<value>`. The `<name>` is arbitrary but must be unique per Traefik instance — generate it from the deployment ID to avoid collisions.

## Mini-dokploy workflow (turborepo monorepo, Docker Swarm)

The repo is a pnpm + turborepo workspace (`apps/web` = Next.js + tRPC, `packages/api`, `packages/db`, etc.). Mini-dokploy itself is a Swarm stack deployed via `docker stack deploy`; user deployments are individual Swarm services created at runtime by `packages/api` via dockerode. Traefik runs as a Swarm service inside the same stack and uses the **swarm provider** to discover the user services.

### Step 0 — One-time Swarm init

```bash
docker swarm init    # idempotent if already a manager
docker network create --driver=overlay --attachable dokploy-network
```

The `--attachable` flag lets non-stack containers (e.g. an `exec`'d debug shell) join the overlay. The network is created up front so the compose file can declare it as `external: true` instead of letting compose auto-create a stack-scoped one.

### Step 1 — Convert the root stack file (`docker-compose.yml`)

Swarm uses the same compose schema but only the `deploy:` block is honoured by `docker stack deploy`. Add Traefik alongside `db` and pin both to the manager.

```yaml
# Deployed with: docker stack deploy -c docker-compose.yml dokploy
version: "3.9"

services:
  traefik:
    image: traefik:v3.2
    command:
      - "--api.dashboard=true"
      - "--api.insecure=true"                       # local-only; drop in prod
      - "--providers.swarm=true"                    # read Swarm services
      - "--providers.swarm.exposedbydefault=false"  # opt-in routing
      - "--providers.swarm.network=dokploy-network" # pick the right interface
      - "--providers.swarm.refreshseconds=5"        # how often to poll Swarm
      - "--entrypoints.web.address=:80"
      # Prod-only (uncomment for real domain):
      # - "--entrypoints.websecure.address=:443"
      # - "--certificatesresolvers.le.acme.tlschallenge=true"
      # - "--certificatesresolvers.le.acme.email=admin@example.com"
      # - "--certificatesresolvers.le.acme.storage=/letsencrypt/acme.json"
    ports:
      - target: 80
        published: 80
        mode: host           # important under Swarm: bypass the mesh for ingress
      - target: 8080
        published: 8080
        mode: host
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro   # read-only — Traefik only reads
      - letsencrypt:/letsencrypt
    networks:
      - dokploy-network
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints: [node.role == manager]            # socket access requires manager
      labels:
        - "com.mini-dokploy.service=proxy"

  db:
    image: postgis/postgis:17-3.5
    # ...existing db config; just add the deploy block + the shared network
    networks: [dokploy-network]
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints: [node.role == manager]

networks:
  dokploy-network:
    external: true

volumes:
  letsencrypt:
```

Why these choices:

- **Swarm provider, not docker provider** — under Swarm, the unit of routing is the *service*, not individual task containers. The swarm provider reads service-level labels (`Spec.Labels` in the Engine API).
- **`mode: host` on the published ports** — the default `mode: ingress` puts traffic through the Swarm routing mesh, which adds a hop and (more importantly) makes the client IP unreachable for rate-limit / IP-allowlist middlewares. `host` mode publishes directly on the node.
- **`exposedbydefault=false`** — opt-in routing keeps internal services (Postgres) safe.
- **Socket read-only** — Traefik only needs to *read* the Swarm/Docker API.
- **Manager placement** — only managers can talk to the Swarm API on the socket; without the constraint a task scheduled on a worker would crash on startup.

### Step 2 — Attach user services to the same overlay

`packages/api` creates user deployments via dockerode's `createService`. Each service must be on `dokploy-network` and carry the Traefik labels at the **service** level (Swarm provider ignores task/container labels).

```ts
import Docker from "dockerode";
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

await docker.createService({
  Name: `app-${deployment.id}`,
  TaskTemplate: {
    ContainerSpec: { Image: builtImageTag },
    Networks: [{ Target: "dokploy-network" }],
    RestartPolicy: { Condition: "any" },
  },
  Mode: { Replicated: { Replicas: 1 } },
  Labels: buildTraefikLabels(deployment),   // ⬅ service-level labels, see Step 3
  EndpointSpec: { Mode: "vip" },            // ClusterIP-style virtual IP inside the overlay
});
```

If a service never appears in the Traefik dashboard, three causes account for ~95 % of cases: (a) the service is not on `dokploy-network`, (b) labels are on `TaskTemplate.ContainerSpec.Labels` instead of `Spec.Labels`, or (c) `--providers.swarm=true` was forgotten on Traefik.

### Step 3 — Generate Traefik labels with a hardened safety filter

Centralize label generation in `packages/api`. The function is pure (input → labels) so it is trivially unit-testable.

```ts
// packages/api/src/traefik/labels.ts
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;       // DNS-label-safe

type Deployment = {
  id: string;
  port: number;
  customLabels?: Record<string, string>;
};

export function buildTraefikLabels(d: Deployment): Record<string, string> {
  if (!ID_RE.test(d.id)) throw new Error(`invalid deployment id: ${d.id}`);
  if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535) {
    throw new Error(`invalid port: ${d.port}`);
  }

  const router  = `app-${d.id}`;
  const service = router;
  const suffix  = process.env.TRAEFIK_HOST_SUFFIX ?? "127.0.0.1.sslip.io";
  const ep      = process.env.TRAEFIK_ENTRYPOINT ?? "web";
  const cert    = process.env.TRAEFIK_CERT_RESOLVER;

  const generated: Record<string, string> = {
    "traefik.enable": "true",
    [`traefik.http.routers.${router}.rule`]:        `Host(\`${router}.${suffix}\`)`,
    [`traefik.http.routers.${router}.entrypoints`]: ep,
    [`traefik.http.routers.${router}.service`]:     service,
    [`traefik.http.routers.${router}.priority`]:    "1",
    [`traefik.http.services.${service}.loadbalancer.server.port`]: String(d.port),
    "com.mini-dokploy.deployment": d.id,
  };
  if (cert) {
    generated[`traefik.http.routers.${router}.tls`] = "true";
    generated[`traefik.http.routers.${router}.tls.certresolver`] = cert;
  }

  // ---- Hardened merge of user-supplied custom labels ----
  // The previous filter only rejected OTHER deployments' router/service.
  // A user could still re-key their OWN .rule to hijack a victim host, or
  // re-key their OWN loadbalancer.server.port to expose an internal port.
  // Solution: reject any key that collides with a generated key, plus block
  // entire "dangerous" prefixes on the deployment's own router/service.

  const RESERVED_OWN_ROUTER_SUFFIXES = [
    "rule", "entrypoints", "service", "priority", "tls", "tls.certresolver",
    "tls.options", "tls.domains", "middlewares",   // middlewares too — see note below
  ];
  const RESERVED_OWN_SERVICE_SUFFIXES = [
    "loadbalancer.server.port", "loadbalancer.server.scheme",
    "loadbalancer.passhostheader", "loadbalancer.serverstransport",
  ];

  for (const [k, v] of Object.entries(d.customLabels ?? {})) {
    // Never let users touch the global toggle or the ownership marker.
    if (k === "traefik.enable" || k === "com.mini-dokploy.deployment") continue;

    // Other deployments' routers / services are off-limits.
    if (k.startsWith("traefik.http.routers.") && !k.startsWith(`traefik.http.routers.${router}.`)) continue;
    if (k.startsWith("traefik.http.services.") && !k.startsWith(`traefik.http.services.${service}.`)) continue;

    // Own router: block the reserved suffixes that would hijack traffic or move the route.
    if (k.startsWith(`traefik.http.routers.${router}.`)) {
      const suffix = k.slice(`traefik.http.routers.${router}.`.length);
      if (RESERVED_OWN_ROUTER_SUFFIXES.some(s => suffix === s || suffix.startsWith(s + "."))) continue;
    }

    // Own service: block the reserved suffixes that would expose a different port.
    if (k.startsWith(`traefik.http.services.${service}.`)) {
      const suffix = k.slice(`traefik.http.services.${service}.`.length);
      if (RESERVED_OWN_SERVICE_SUFFIXES.some(s => suffix === s || suffix.startsWith(s + "."))) continue;
    }

    // Force user-defined middlewares to namespace under the deployment id so
    // they can't collide with platform-wide middlewares or with another tenant.
    if (k.startsWith("traefik.http.middlewares.")) {
      const namePart = k.slice("traefik.http.middlewares.".length).split(".")[0];
      if (!namePart.startsWith(`${router}-`)) continue;
    }

    // TCP / UDP routers are outside the user's namespace entirely.
    if (k.startsWith("traefik.tcp.") || k.startsWith("traefik.udp.")) continue;

    // Reject any direct collision with a generated key.
    if (k in generated) continue;

    generated[k] = v;
  }
  return generated;
}
```

**Threat model in one sentence**: Traefik's Swarm/Docker provider trusts every label on the service spec, so any unfiltered custom label could rewrite the deployment's own routing rule (hijack a victim host), change its service binding (steal another tenant's traffic), or re-point its load-balancer port (expose an internal admin port) — the hardened filter blocks all three classes by reserving the dangerous suffixes on the deployment's *own* router/service in addition to walling off other deployments' namespaces.

> The `middlewares` chain on the router is in the reserved list because a middleware can rewrite paths, redirect off-host, or strip auth headers. If the product later needs to expose middleware composition, add a *first-class* `Deployment.middlewares: string[]` field that the function maps to a namespaced chain — never accept the raw label.

### Step 4 — Use sslip.io for local domains (no DNS work)

`sslip.io` resolves `<anything>.127.0.0.1.sslip.io` to `127.0.0.1`. Combined with Traefik listening on :80 in host mode, every deployment gets a unique URL with zero `/etc/hosts` edits:

- `app-abc123.127.0.0.1.sslip.io` → 127.0.0.1:80 → Traefik → `app-abc123` Swarm service → port 3000
- `app-def456.127.0.0.1.sslip.io` → 127.0.0.1:80 → Traefik → `app-def456` Swarm service → port 8080

For production, set `TRAEFIK_HOST_SUFFIX=apps.example.com` and `TRAEFIK_CERT_RESOLVER=le`, uncomment the websecure entrypoint + ACME resolver in Step 1, and `buildTraefikLabels` will emit the TLS labels automatically.

### Step 5 — One-command stack (handle `turbo dev` being persistent)

`turbo.json` declares `dev` with `"persistent": true`, so naive chaining like `turbo dev && docker stack deploy …` never reaches the deploy. Use `concurrently` and a pre-deploy step instead:

```jsonc
{
  "scripts": {
    "swarm:init":   "docker info --format '{{.Swarm.LocalNodeState}}' | grep -q active || docker swarm init",
    "net:up":       "docker network inspect dokploy-network >/dev/null 2>&1 || docker network create --driver=overlay --attachable dokploy-network",
    "stack:up":     "pnpm swarm:init && pnpm net:up && docker stack deploy -c docker-compose.yml dokploy",
    "stack:down":   "docker stack rm dokploy",
    "stack:logs":   "docker service logs -f dokploy_traefik",
    "predev":       "pnpm stack:up",
    "dev":          "turbo run dev"
  }
}
```

`pnpm dev` now: (1) initialises Swarm if needed, (2) creates the overlay network if missing, (3) deploys the stack (Traefik + db + web), (4) runs `turbo dev` for the workspace packages' watchers. The persistent `turbo dev` becomes the foreground process; the stack runs in the background as Swarm services. `pnpm stack:down` cleans up.

If `concurrently` is preferred (e.g., to see Traefik logs interleaved with turbo's), use:

```jsonc
"dev": "concurrently -k -n stack,turbo \"pnpm stack:logs\" \"turbo run dev\""
```

Run `pnpm stack:up` once beforehand in this variant.

### Step 6 — Verify routing

After `pnpm stack:up`:

```bash
# Stack is running
docker stack services dokploy

# Traefik sees the service (after creating a user deployment)
curl -s http://localhost:8080/api/http/routers | jq '.[] | select(.name | startswith("app-"))'

# Reach the deployment
curl -I http://app-<id>.127.0.0.1.sslip.io
```

A 404 from Traefik (HTML "page not found") means no router matched — check the Host rule, the network, and that labels live on `Spec.Labels`. A 502/504 means the router matched but the backend is unreachable — check the network and the port label.

## Common label patterns

The full label dictionary lives in `references/docker-labels.md`. The handful that come up in nearly every deployment:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.app.rule=Host(`app.example.com`)"
  - "traefik.http.routers.app.entrypoints=websecure"
  - "traefik.http.routers.app.tls.certresolver=le"
  - "traefik.http.services.app.loadbalancer.server.port=3000"
  - "traefik.http.services.app.loadbalancer.healthcheck.path=/health"
  - "traefik.http.services.app.loadbalancer.healthcheck.interval=10s"
```

For path-based routing, strip-prefix, weighted/canary services, sticky sessions, and TCP routers, consult `references/docker-labels.md`.

## Middlewares (one-liners)

The full catalog with use-when guidance lives in `references/middlewares.md`. Most common:

```yaml
# Rate limit (per-IP token bucket): 100 rps average, 200 burst
- "traefik.http.middlewares.rl.ratelimit.average=100"
- "traefik.http.middlewares.rl.ratelimit.burst=200"

# HTTPS redirect (attach to an HTTP-entrypoint router)
- "traefik.http.middlewares.https.redirectscheme.scheme=https"
- "traefik.http.middlewares.https.redirectscheme.permanent=true"

# Basic auth — double the $ to escape in compose
- "traefik.http.middlewares.auth.basicauth.users=admin:$$apr1$$xyz$$hashed"

# Strip /api prefix before forwarding (/api/users -> /users)
- "traefik.http.middlewares.strip.stripprefix.prefixes=/api"

# Chain on a router (comma-separated, order matters)
- "traefik.http.routers.api.middlewares=rl,strip,auth"
```

## Troubleshooting checklist

1. **Service not in dashboard** — missing `traefik.enable=true`, labels stored on `TaskTemplate.ContainerSpec.Labels` instead of `Spec.Labels`, or service is on a different overlay than Traefik (re-check `--providers.swarm.network`).
2. **404 from Traefik** — Host rule does not match the request's `Host` header. Try `curl -H "Host: …" http://localhost`.
3. **502/504** — router matched, backend unreachable. Confirm `loadbalancer.server.port` matches what the service actually listens on (the *internal* port, not the published one), and that the service has at least one running task.
4. **Traefik task crashes immediately** — under Swarm, the socket-reading Traefik task must run on a manager node. Check `docker service ps dokploy_traefik` for "no suitable node (scheduling constraints not satisfied)".
5. **Certificate stuck on staging / not issuing** — for HTTP challenge, port 80 must be reachable from the public internet; for TLS challenge, port 443. Persist `/letsencrypt` on a volume or rate limits will block re-issuance.
6. **Labels with `$`** — compose treats `$` as variable interpolation. Escape with `$$` (basicauth hashes, htpasswd output).
7. **User-supplied labels overriding system ones** — review the hardened merge filter in `buildTraefikLabels`. The reserved-suffix list must include any new generated key (e.g., when adding sticky sessions or health checks).

## Guidelines

- Keep the Docker socket mount read-only — Traefik never needs write access.
- Always set `exposedbydefault=false` on the swarm/docker provider. Opt-in routing is the difference between a controlled edge and accidentally publishing the database.
- Pin the Traefik major version (`traefik:v3.2`, not `traefik:latest`) — v2 → v3 changed label names (`ipwhitelist` → `ipallowlist`) and silently broke production for many users.
- Persist `acme.json` on a named volume. Losing it forces Let's Encrypt re-issuance, which hits rate limits fast (20 certs/week per registered domain).
- For high-traffic production, attach a health check to every service. Without one, Traefik routes to tasks that may be starting up or shutting down.
- When generating labels from code, name routers and services after the deployment ID (`app-<id>`). Globally unique names prevent two deployments from clobbering each other's routes.
- Prefer Swarm service labels over file-based config in this monorepo — the autodiscovery is the whole reason Traefik was chosen.
- Under Swarm, always put labels on `Spec.Labels` (the service), not `TaskTemplate.ContainerSpec.Labels` (the task). The swarm provider ignores task-level labels.
- Publish Traefik ports in `mode: host`, not the default `mode: ingress` — the routing mesh hides client IPs and adds a hop.
- Treat every key starting with `traefik.` in `customLabels` as adversarial. The hardened filter must explicitly allow each safe key, not deny known-bad ones.

## Additional resources

### Scripts
- **`scripts/script.sh`** — Quick BytesAgain-style cheat sheets. Run `bash .claude/skills/traefik/scripts/script.sh intro` (overview + comparison table), `… docker` (compose/docker-provider patterns, canary, path routing), or `… k8s` (IngressRoute, middleware CRDs, file provider). Treat the docker-provider patterns as legacy reference — for mini-dokploy, use the Swarm-provider workflow above.

### References (load only when needed)
- **`references/mini-dokploy.md`** — Extended walkthrough of the monorepo wiring: dockerode setup in `packages/api`, label-generation unit tests, integration test patterns, prod-vs-local env switching, log streaming for build/deploy output.
- **`references/middlewares.md`** — Full middleware catalog with picking guidance: rate limit (per-IP vs per-route), forward-auth for external SSO, circuit breaker expressions, retry with exponential backoff, IP allow/deny lists, security headers (HSTS, CSP, frame-deny), CORS, replace-path, response compression.
- **`references/docker-labels.md`** — Complete label dictionary: weighted/mirrored services, sticky cookies, TCP/UDP routers, gRPC, HTTP/3, custom transports (skipVerify, mTLS to backend), priority and rule-matcher syntax (`Host`, `HostRegexp`, `PathPrefix`, `Header`, `Query`, `Method`).
