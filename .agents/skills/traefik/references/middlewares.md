# Traefik Middlewares — Full Catalog

Middlewares transform requests/responses between the EntryPoint and the Service. They are declared via labels (or file/CRD) and attached to one or more Routers. Order matters when chaining.

## Declaration shape

```
traefik.http.middlewares.<name>.<kind>.<option>=<value>
traefik.http.routers.<router-name>.middlewares=<name1>,<name2>,...
```

Cross-provider references use the `@docker` / `@kubernetescrd` / `@file` suffix (e.g. `ratelimit@docker`).

## Catalog

### Rate limit (`ratelimit`)

Token bucket per source IP.

```yaml
- "traefik.http.middlewares.rl.ratelimit.average=100"     # tokens/sec
- "traefik.http.middlewares.rl.ratelimit.burst=200"       # bucket size
- "traefik.http.middlewares.rl.ratelimit.period=1s"       # window (default 1s)
- "traefik.http.middlewares.rl.ratelimit.sourcecriterion.ipstrategy.depth=1"  # if behind a CDN, count XFF
```

Pick: per-router for tenant fairness; per-entrypoint via file provider for global protection.

### Basic auth (`basicauth`)

```yaml
- "traefik.http.middlewares.auth.basicauth.users=user1:$$apr1$$hash1,user2:$$apr1$$hash2"
- "traefik.http.middlewares.auth.basicauth.realm=traefik"
- "traefik.http.middlewares.auth.basicauth.removeheader=true"   # don't pass Authorization to backend
```

Generate hashes with `htpasswd -nbB user password`. Double `$` in compose. Prefer a `usersFile` if the list grows.

### Forward auth (`forwardauth`)

Delegates auth to an external endpoint (Authelia, oauth2-proxy, custom JWT validator).

```yaml
- "traefik.http.middlewares.fa.forwardauth.address=http://auth:4181"
- "traefik.http.middlewares.fa.forwardauth.trustForwardHeader=true"
- "traefik.http.middlewares.fa.forwardauth.authResponseHeaders=X-Forwarded-User,X-Forwarded-Email"
```

The auth server returns 2xx to allow, 4xx/5xx to deny. Response headers from `authResponseHeaders` are forwarded to the backend.

### IP allow/deny (`ipallowlist`, formerly `ipwhitelist` in v2)

```yaml
- "traefik.http.middlewares.ipallow.ipallowlist.sourcerange=10.0.0.0/8,192.168.1.0/24,2001:db8::/32"
- "traefik.http.middlewares.ipallow.ipallowlist.ipstrategy.depth=1"   # XFF depth when behind a CDN
```

`ipstrategy.excludedips` to ignore certain proxies in the chain.

### Security headers (`headers`)

```yaml
# HSTS
- "traefik.http.middlewares.sec.headers.stsSeconds=31536000"
- "traefik.http.middlewares.sec.headers.stsIncludeSubdomains=true"
- "traefik.http.middlewares.sec.headers.stsPreload=true"
- "traefik.http.middlewares.sec.headers.forceSTSHeader=true"

# Browser hardening
- "traefik.http.middlewares.sec.headers.contentTypeNosniff=true"
- "traefik.http.middlewares.sec.headers.browserXssFilter=true"
- "traefik.http.middlewares.sec.headers.frameDeny=true"
- "traefik.http.middlewares.sec.headers.referrerPolicy=strict-origin-when-cross-origin"

# Custom CSP
- "traefik.http.middlewares.sec.headers.contentSecurityPolicy=default-src 'self'"

# Custom request/response headers
- "traefik.http.middlewares.sec.headers.customRequestHeaders.X-Forwarded-Proto=https"
- "traefik.http.middlewares.sec.headers.customResponseHeaders.Server="            # blank = remove
```

### CORS (`headers`, again)

```yaml
- "traefik.http.middlewares.cors.headers.accesscontrolallowmethods=GET,POST,OPTIONS"
- "traefik.http.middlewares.cors.headers.accesscontrolalloworiginlist=https://app.example.com"
- "traefik.http.middlewares.cors.headers.accesscontrolallowheaders=Authorization,Content-Type"
- "traefik.http.middlewares.cors.headers.accesscontrolmaxage=600"
- "traefik.http.middlewares.cors.headers.addvaryheader=true"
```

### Redirect (`redirectscheme`, `redirectregex`)

```yaml
# HTTP -> HTTPS
- "traefik.http.middlewares.https.redirectscheme.scheme=https"
- "traefik.http.middlewares.https.redirectscheme.permanent=true"

# www -> apex
- "traefik.http.middlewares.apex.redirectregex.regex=^https?://www\\.(.+)"
- "traefik.http.middlewares.apex.redirectregex.replacement=https://$${1}"
- "traefik.http.middlewares.apex.redirectregex.permanent=true"
```

In compose, `$1` becomes `$${1}` (double-escape both for compose and Go template).

### Strip / add prefix (`stripprefix`, `addprefix`, `replacepath`)

```yaml
# /api/users -> /users
- "traefik.http.middlewares.strip.stripprefix.prefixes=/api"

# /users -> /v1/users
- "traefik.http.middlewares.addv1.addprefix.prefix=/v1"

# Arbitrary rewrite
- "traefik.http.middlewares.rewrite.replacepathregex.regex=^/old/(.*)"
- "traefik.http.middlewares.rewrite.replacepathregex.replacement=/new/$${1}"
```

### Compression (`compress`)

```yaml
- "traefik.http.middlewares.compress.compress=true"
- "traefik.http.middlewares.compress.compress.minResponseBodyBytes=1024"
- "traefik.http.middlewares.compress.compress.excludedContentTypes=text/event-stream"
```

Exclude SSE / streaming responses, or buffering will break them.

### Retry (`retry`)

```yaml
- "traefik.http.middlewares.retry.retry.attempts=3"
- "traefik.http.middlewares.retry.retry.initialInterval=100ms"
```

Exponential backoff between attempts. Only retries on connection errors, never on HTTP 5xx.

### Circuit breaker (`circuitbreaker`)

```yaml
# Open when 50%-quantile latency > 100ms over the window
- "traefik.http.middlewares.cb.circuitbreaker.expression=LatencyAtQuantileMS(50.0) > 100"

# Other expressions:
# NetworkErrorRatio() > 0.5
# ResponseCodeRatio(500, 600, 0, 600) > 0.25
```

When open, requests return 503 immediately. Recovers automatically after the configured cooldown.

### Buffering (`buffering`)

Useful for slow uploads — buffers the whole request body before forwarding.

```yaml
- "traefik.http.middlewares.buf.buffering.maxRequestBodyBytes=10485760"     # 10 MB
- "traefik.http.middlewares.buf.buffering.memRequestBodyBytes=2097152"      # spill to disk above 2 MB
- "traefik.http.middlewares.buf.buffering.retryExpression=IsNetworkError() && Attempts() < 2"
```

### In-flight limit (`inflightreq`)

Cap concurrent in-flight requests per source.

```yaml
- "traefik.http.middlewares.inflight.inflightreq.amount=10"
- "traefik.http.middlewares.inflight.inflightreq.sourcecriterion.ipstrategy.depth=1"
```

### Errors page (`errors`)

Render a custom backend for matching status codes.

```yaml
- "traefik.http.middlewares.errors.errors.status=500-599"
- "traefik.http.middlewares.errors.errors.service=errorpages"
- "traefik.http.middlewares.errors.errors.query=/{status}.html"
```

## Chaining order

Order in `middlewares=a,b,c` matters: request flows `a → b → c → backend`, response flows backend → c → b → a. Sensible defaults:

```
ipallow → rl → auth → strip → headers → compress → backend
```

Auth before the expensive backend, rate limit before auth (don't burn auth quota on rejected IPs), compression last on the response side.
