# Traefik Docker Labels — Complete Dictionary

This reference is the full label syntax for the Docker provider. Load it when generating non-trivial routes (canary, sticky, TCP, gRPC) or debugging why a label isn't taking effect.

## Toplevel

| Label | Purpose |
|---|---|
| `traefik.enable=true` | Opt in. Required when `exposedByDefault=false`. |
| `traefik.docker.network=<name>` | Pin the network when the container has multiple. |
| `traefik.docker.lbswarm=true` | Use Swarm's load balancer instead of Traefik's (Swarm only). |

## Routers (HTTP)

```
traefik.http.routers.<name>.<attr>=<value>
```

| Attribute | Notes |
|---|---|
| `rule` | The matcher. See "Rule matchers" below. Required. |
| `entrypoints` | Comma-separated list (`web`, `websecure`). Defaults to all. |
| `service` | Service name this router forwards to. Defaults to a service with the same name as the router. |
| `middlewares` | Comma-separated chain. Order matters. |
| `tls` | `true` to terminate TLS (no resolver = self-signed). |
| `tls.certresolver` | Name of an ACME resolver (e.g. `le`). |
| `tls.domains[0].main` | SAN on the cert (for wildcards: `tls.domains[0].sans=*.example.com`). |
| `tls.options` | Reference a custom TLS options block (file provider). |
| `priority` | Integer; higher wins when multiple rules match. |
| `observability.accessLogs` | `false` to silence access logs for this router. |
| `observability.metrics` | `false` to skip metrics. |
| `observability.tracing` | `false` to skip tracing. |

### Rule matchers

Combine with `&&`, `||`, `!`. Use backticks around literal values.

```
Host(`a.example.com`, `b.example.com`)
HostRegexp(`^.+\.example\.com$`)
Path(`/foo`, `/bar`)
PathPrefix(`/api`)
PathRegexp(`^/api/v[12]`)
Method(`GET`, `POST`)
Headers(`X-Tenant`, `t1`)
HeaderRegexp(`X-Tenant`, `^t[0-9]+$`)
Query(`mobile`, `true`)
QueryRegexp(`token`, `^[a-f0-9]{32}$`)
ClientIP(`192.168.0.0/16`)
```

## Services (HTTP)

```
traefik.http.services.<name>.loadbalancer.<attr>=<value>
```

| Attribute | Notes |
|---|---|
| `server.port` | Container port the service forwards to. Default: first exposed port. |
| `server.scheme` | `http` (default) or `https` for TLS to backend. |
| `server.weight` | Weight for weighted-round-robin (see "Weighted services"). |
| `passhostheader` | `false` to overwrite Host with the backend address. Default `true`. |
| `responseforwarding.flushinterval` | `100ms` for SSE / streaming; `-1` to flush each write. |
| `serverstransport` | Custom transport (mTLS, skipVerify, root CAs). |
| `sticky.cookie.name` | Enable sticky sessions via cookie. |
| `sticky.cookie.secure` | `true` to set Secure flag. |
| `sticky.cookie.httpOnly` | `true` (default) to set HttpOnly. |
| `sticky.cookie.sameSite` | `none|lax|strict`. |
| `healthcheck.path` | HTTP path to probe. Required to enable health checks. |
| `healthcheck.interval` | e.g. `10s`. |
| `healthcheck.timeout` | e.g. `5s`. |
| `healthcheck.scheme` | `http|https`. |
| `healthcheck.method` | `GET` (default), `HEAD`. |
| `healthcheck.hostname` | Override Host header for the probe. |
| `healthcheck.followredirects` | `true` to follow 3xx during probe. |

### Weighted / canary services

Weighted services live above per-container services and split traffic. They're easiest to declare in the file provider, but doable in labels by combining two services under a custom weighted parent.

File-provider form (drop in `/etc/traefik/dynamic/`):

```yaml
http:
  services:
    app-canary:
      weighted:
        services:
          - name: app-v1@docker
            weight: 9
          - name: app-v2@docker
            weight: 1
```

Then a router with `service: app-canary` distributes 90/10.

### Mirroring

```yaml
http:
  services:
    app-with-shadow:
      mirroring:
        service: app-v1@docker
        mirrors:
          - name: app-shadow@docker
            percent: 10
```

Sends 10% of real traffic to a shadow backend, throws away the response (good for testing new versions).

## Middlewares

See `references/middlewares.md` for the full catalog. Declaration shape:

```
traefik.http.middlewares.<name>.<kind>.<option>=<value>
```

Attach via `traefik.http.routers.<router>.middlewares=<name1>,<name2>`.

## TCP and UDP

TCP routers exist alongside HTTP ones. They match on SNI for TLS or use `HostSNI(\`*\`)` for plain TCP.

```yaml
- "traefik.tcp.routers.pg.rule=HostSNI(`db.example.com`)"
- "traefik.tcp.routers.pg.tls=true"
- "traefik.tcp.routers.pg.tls.certresolver=le"
- "traefik.tcp.routers.pg.entrypoints=postgres"        # custom entrypoint on :5432
- "traefik.tcp.services.pg.loadbalancer.server.port=5432"
- "traefik.tcp.services.pg.loadbalancer.proxyprotocol.version=2"
```

UDP is similar but simpler — no SNI, no rule, just port-based.

```yaml
- "traefik.udp.routers.dns.entrypoints=dns"
- "traefik.udp.services.dns.loadbalancer.server.port=53"
```

## gRPC

gRPC works on standard HTTP routers, but the backend must use HTTP/2:

```yaml
- "traefik.http.services.api.loadbalancer.server.scheme=h2c"   # plaintext HTTP/2
# or for TLS-to-backend:
- "traefik.http.services.api.loadbalancer.server.scheme=https"
- "traefik.http.services.api.loadbalancer.serverstransport=insecuretransport@file"
```

## Custom transports (mTLS to backend, skipVerify)

Defined via the file provider:

```yaml
http:
  serversTransports:
    insecuretransport:
      insecureSkipVerify: true
    mtls:
      certificates:
        - certFile: /certs/client.crt
          keyFile: /certs/client.key
      rootCAs:
        - /certs/ca.crt
```

Reference from a service:

```yaml
- "traefik.http.services.api.loadbalancer.serverstransport=mtls@file"
```

## Common compose escaping gotchas

- `$` becomes `$$` (basicauth hashes, regex backreferences).
- Backticks in `rule=Host(\`x\`)` are required by Traefik's rule grammar — they survive compose YAML quoting unchanged when the whole line is double-quoted.
- Trailing whitespace in a label value silently breaks rules — strip when generating from code.
- Label keys are case-insensitive in v3 but case-sensitive across `@` references; stick to lowercase for consistency.
