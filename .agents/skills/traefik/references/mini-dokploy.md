# Mini-Dokploy x Traefik — Extended Walkthrough (Docker Swarm edition)

This reference complements the primary mini-dokploy workflow in `SKILL.md`. Load it when wiring the API layer to Swarm, writing tests for label generation, or switching the stack between local and production.

`TASK.md:12` requires *"Docker services (not docker run / not plain compose) for orchestration — both Mini-Dokploy itself and user deployments."* The whole platform therefore runs on a single-node Swarm (locally) or a real Swarm in prod. All routing uses Traefik's **swarm provider**.

## 1. Where Traefik fits in the monorepo

```
mini-dokploy/
├── apps/web/                     # Next.js (Pages Router) + tRPC UI
├── packages/
│   ├── api/                      # tRPC routers + dockerode service mgmt (owns Traefik label generation)
│   ├── db/                       # Drizzle schema
│   ├── auth/                     # BetterAuth (bonus)
│   └── ...
├── docker-compose.yml            # Stack file deployed via `docker stack deploy`
└── turbo.json                    # All `dev` entries are persistent: true
```

`packages/api` is the only place that talks to the Docker Engine API and the only place that emits Traefik labels. Keep that boundary; do not generate labels in Next.js route handlers or in `apps/web`. Centralizing it makes auditing safe-merge logic for user-supplied labels possible.

## 2. Dockerode client (`packages/api`)

```ts
// packages/api/src/docker/client.ts
import Docker from "dockerode";

export const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export const OVERLAY = process.env.DOKPLOY_OVERLAY ?? "dokploy-network";
```

The `web` (API) service is itself a Swarm service. Its compose entry needs the socket and a manager constraint (only managers expose the Swarm API on the socket):

```yaml
services:
  web:
    image: dokploy/web:latest      # or a build target if building inside the stack
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock   # read-write — API manages services
    networks: [dokploy-network]
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints: [node.role == manager]
```

Socket access is effectively root on the host — gate it behind auth (BetterAuth) and never expose the API to the public internet without it.

## 3. Build → deploy lifecycle (Swarm services)

```ts
// packages/api/src/deployments/deploy.ts
import { docker, OVERLAY } from "../docker/client";
import { buildTraefikLabels } from "../traefik/labels";

export async function deploy(input: {
  id: string;
  imageTag: string;            // already built by the build step
  port: number;
  customLabels?: Record<string, string>;
}) {
  const serviceName = `app-${input.id}`;

  // 1. Update existing service in place if it exists (zero-downtime), else create.
  const services = await docker.listServices({ filters: { name: [serviceName] } });
  const labels = buildTraefikLabels({
    id: input.id, port: input.port, customLabels: input.customLabels,
  });
  const spec = {
    Name: serviceName,
    TaskTemplate: {
      ContainerSpec: { Image: input.imageTag },
      Networks: [{ Target: OVERLAY }],
      RestartPolicy: { Condition: "any", MaxAttempts: 0 },
    },
    Mode: { Replicated: { Replicas: 1 } },
    Labels: labels,                          // service-level — swarm provider reads these
    EndpointSpec: { Mode: "vip" },           // virtual-IP inside the overlay; clients hit the VIP
    UpdateConfig: {
      Parallelism: 1,
      Order: "start-first",                  // bring up new task before stopping old → no 502 window
      FailureAction: "rollback",
      Monitor: 5_000_000_000,                // 5s in nanoseconds
    },
  };

  if (services.length === 0) {
    await docker.createService(spec);
  } else {
    const svc = docker.getService(services[0].ID);
    const inspected = await svc.inspect();
    await svc.update({ ...spec, version: inspected.Version.Index });
  }

  const suffix = process.env.TRAEFIK_HOST_SUFFIX ?? "127.0.0.1.sslip.io";
  return { url: `http://${serviceName}.${suffix}` };
}

export async function destroy(id: string) {
  const svc = docker.getService(`app-${id}`);
  await svc.remove();
}
```

A few load-bearing details:

- **`UpdateConfig.Order: "start-first"`** — without it, Swarm stops the old task before the new one is healthy, producing a brief 502 window during redeploy.
- **`Mode: "vip"`** — Swarm assigns each service a stable virtual IP inside the overlay. Traefik resolves the service name to that VIP and Swarm round-robins to live tasks. This is why scaling replicas requires no Traefik change.
- **In-place `update`** — keeps the same service ID and labels, so Traefik never sees a route disappear (unlike create-then-remove).

## 4. Unit-testing the hardened label filter

Label generation is the highest-risk code in the system. A bug here means user A's traffic could reach user B's container. Tests must cover at least:

```ts
// packages/api/src/traefik/labels.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildTraefikLabels } from "./labels";

beforeEach(() => {
  delete process.env.TRAEFIK_HOST_SUFFIX;
  delete process.env.TRAEFIK_ENTRYPOINT;
  delete process.env.TRAEFIK_CERT_RESOLVER;
});

describe("buildTraefikLabels", () => {
  it("generates a Host rule on the sslip.io suffix by default", () => {
    const out = buildTraefikLabels({ id: "abc", port: 3000 });
    expect(out["traefik.http.routers.app-abc.rule"]).toBe("Host(`app-abc.127.0.0.1.sslip.io`)");
    expect(out["traefik.http.routers.app-abc.entrypoints"]).toBe("web");
    expect(out["traefik.http.services.app-abc.loadbalancer.server.port"]).toBe("3000");
  });

  it("switches to prod entrypoint + TLS when env vars are set", () => {
    process.env.TRAEFIK_HOST_SUFFIX = "apps.example.com";
    process.env.TRAEFIK_ENTRYPOINT = "websecure";
    process.env.TRAEFIK_CERT_RESOLVER = "le";
    const out = buildTraefikLabels({ id: "abc", port: 3000 });
    expect(out["traefik.http.routers.app-abc.rule"]).toBe("Host(`app-abc.apps.example.com`)");
    expect(out["traefik.http.routers.app-abc.tls"]).toBe("true");
    expect(out["traefik.http.routers.app-abc.tls.certresolver"]).toBe("le");
  });

  it("rejects ids that would break out of the Host backticks", () => {
    expect(() => buildTraefikLabels({ id: "abc`)Host(`evil.com", port: 3000 })).toThrow();
    expect(() => buildTraefikLabels({ id: "ABC", port: 3000 })).toThrow();   // uppercase
    expect(() => buildTraefikLabels({ id: "", port: 3000 })).toThrow();
  });

  it("rejects ports outside 1..65535", () => {
    expect(() => buildTraefikLabels({ id: "abc", port: 0 })).toThrow();
    expect(() => buildTraefikLabels({ id: "abc", port: 70000 })).toThrow();
    expect(() => buildTraefikLabels({ id: "abc", port: 1.5 })).toThrow();
  });

  // ---- Hijack scenarios ----

  it("blocks targeting another deployment's router (cross-tenant hijack)", () => {
    const out = buildTraefikLabels({
      id: "abc", port: 3000,
      customLabels: { "traefik.http.routers.app-victim.rule": "Host(`stolen.example.com`)" },
    });
    expect(out["traefik.http.routers.app-victim.rule"]).toBeUndefined();
  });

  it("blocks rewriting own router rule (self-hijack to victim host)", () => {
    const out = buildTraefikLabels({
      id: "abc", port: 3000,
      customLabels: { "traefik.http.routers.app-abc.rule": "Host(`victim.example.com`)" },
    });
    expect(out["traefik.http.routers.app-abc.rule"]).toBe("Host(`app-abc.127.0.0.1.sslip.io`)");
  });

  it("blocks rewriting own router service binding (point router at another tenant's service)", () => {
    const out = buildTraefikLabels({
      id: "abc", port: 3000,
      customLabels: { "traefik.http.routers.app-abc.service": "app-victim" },
    });
    expect(out["traefik.http.routers.app-abc.service"]).toBe("app-abc");
  });

  it("blocks rewriting own service port (expose an internal admin port)", () => {
    const out = buildTraefikLabels({
      id: "abc", port: 3000,
      customLabels: { "traefik.http.services.app-abc.loadbalancer.server.port": "22" },
    });
    expect(out["traefik.http.services.app-abc.loadbalancer.server.port"]).toBe("3000");
  });

  it("blocks moving own router to another entrypoint (e.g. internal-only port)", () => {
    const out = buildTraefikLabels({
      id: "abc", port: 3000,
      customLabels: { "traefik.http.routers.app-abc.entrypoints": "internal" },
    });
    expect(out["traefik.http.routers.app-abc.entrypoints"]).toBe("web");
  });

  it("blocks disabling traefik on own deployment", () => {
    const out = buildTraefikLabels({
      id: "abc", port: 3000, customLabels: { "traefik.enable": "false" },
    });
    expect(out["traefik.enable"]).toBe("true");
  });

  it("blocks TCP/UDP routers (outside HTTP namespace entirely)", () => {
    const out = buildTraefikLabels({
      id: "abc", port: 3000,
      customLabels: {
        "traefik.tcp.routers.evil.rule": "HostSNI(`*`)",
        "traefik.udp.routers.evil.entrypoints": "dns",
      },
    });
    expect(out["traefik.tcp.routers.evil.rule"]).toBeUndefined();
    expect(out["traefik.udp.routers.evil.entrypoints"]).toBeUndefined();
  });

  it("forces user-defined middlewares to namespace under the deployment id", () => {
    const out = buildTraefikLabels({
      id: "abc", port: 3000,
      customLabels: {
        "traefik.http.middlewares.global-redirect.redirectregex.regex": ".*",  // would shadow a platform middleware
        "traefik.http.middlewares.app-abc-rl.ratelimit.average": "100",        // namespaced — OK
      },
    });
    expect(out["traefik.http.middlewares.global-redirect.redirectregex.regex"]).toBeUndefined();
    expect(out["traefik.http.middlewares.app-abc-rl.ratelimit.average"]).toBe("100");
  });

  it("allows non-Traefik metadata labels to pass through", () => {
    const out = buildTraefikLabels({
      id: "abc", port: 3000,
      customLabels: { "io.example.tenant": "acme-corp" },
    });
    expect(out["io.example.tenant"]).toBe("acme-corp");
  });
});
```

Run with `pnpm -F @mini-dokploy/api test`. CI should require these specific tests to pass — they encode the security contract.

## 5. Local vs prod env switching

A handful of env vars flip the stack between sslip.io (local) and a real domain with Let's Encrypt:

```bash
# .env.local
TRAEFIK_HOST_SUFFIX=127.0.0.1.sslip.io
TRAEFIK_ENTRYPOINT=web
# TRAEFIK_CERT_RESOLVER intentionally unset

# .env.production
TRAEFIK_HOST_SUFFIX=apps.example.com
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERT_RESOLVER=le
```

For Traefik itself, gate the Let's Encrypt resolver flags on env using compose's `${VAR:-}` interpolation, or split into `docker-compose.yml` + `docker-compose.prod.yml` and deploy with `docker stack deploy -c docker-compose.yml -c docker-compose.prod.yml dokploy`. The latter is preferred — it keeps the local file readable.

## 6. Streaming build/deploy logs (bonus)

For the bonus "live build/deploy logs via WebSockets" requirement:

1. The build step (e.g. `docker build` via dockerode) returns a stream of NDJSON events.
2. Pipe the stream into a tRPC subscription (or a plain WebSocket server) keyed by deployment id.
3. For service logs, use `service.logs({ follow: true, stdout: true, stderr: true, tail: 100 })` and multiplex tasks (Swarm aggregates per-task logs through the service-level call).
4. Forward to the same WS topic.

Traefik does not participate in this — it only sees the service after it appears in the Swarm API. The UI just needs the deployment id to subscribe to the right topic.

## 7. Redeploy + cleanup correctness

Cleanup is easy to get wrong and silently leak services / images:

- **Redeploy** — `service.update(spec, { version })` with `UpdateConfig.Order: "start-first"`. The service ID and labels stay the same, so the Traefik router never disappears.
- **Delete** — `service.remove()`. Swarm tears down the tasks; Traefik notices the missing service within `refreshseconds` (5s by default).
- **Crash / unexpected exit** — `RestartPolicy.Condition: "any"` reschedules the task. Health check labels (if set) keep Traefik from routing mid-restart.

After many redeploys, prune dangling images on each node:

```ts
await docker.pruneImages({ filters: { dangling: { true: true } } });
```

In multi-node Swarm, run this on every node (or use a swarm-wide cleanup service).

## 8. Network gotchas under Swarm

- The overlay network must be `--attachable` so `docker run`–style debug containers can join it. Stack-internal services don't need it, but local-dev debugging does.
- `mode: host` on Traefik's published ports bypasses the routing mesh — required for accurate client IPs in rate limit / IP allowlist middlewares.
- If `docker network inspect dokploy-network` shows no peers but the service is "running", the task hasn't actually attached yet — wait or check `docker service ps <name>` for failures.
- On Docker Desktop (macOS), host-mode publishing works the same as on Linux; the overlay still goes through the VM.

## 9. Dashboard access

`--api.dashboard=true --api.insecure=true` exposes the dashboard at `http://localhost:8080/dashboard/`. For anything beyond local dev, drop `--api.insecure=true` and route the dashboard through a router with basic auth, attached to Traefik's own service:

```yaml
services:
  traefik:
    # ...
    deploy:
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.dashboard.rule=Host(`traefik.example.com`)"
        - "traefik.http.routers.dashboard.service=api@internal"
        - "traefik.http.routers.dashboard.tls.certresolver=le"
        - "traefik.http.routers.dashboard.middlewares=auth"
        - "traefik.http.middlewares.auth.basicauth.users=admin:$$apr1$$..."
        - "traefik.http.services.dashboard-dummy.loadbalancer.server.port=8080"  # swarm provider needs *some* service label even for api@internal
```

The `service=api@internal` is the magic incantation that exposes Traefik's own API as a routable backend. Under the swarm provider, you must also declare a dummy `loadbalancer.server.port` for the swarm label parser to accept the block — Traefik ignores the value since the actual service is `api@internal`.
