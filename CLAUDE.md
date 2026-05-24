# Claude Code instructions — Mini-Dokploy

Canonical agent rules live in [`AGENTS.md`](./AGENTS.md). **Follow them.**
This file only adds Claude-Code-specific guidance.

## Skills installed for this project

| Skill | When to invoke |
|---|---|
| `/traefik` | Adding/editing Traefik labels, debugging routing, writing new label safety tests. |
| `/temporal` | Writing or modifying workflows/activities, debugging non-determinism, designing signal/query/retry behaviour. |
| `/docker-development` | Editing any `Dockerfile`, optimising image size, auditing security, adding compose services. |
| `/typescript-drizzle-orm` | Adding tables, relations, indexes, or queries in `packages/db/src/schema/`. |
| `/better-auth-best-practices` | Touching `packages/auth` (session config, secret handling, plugins). |
| `/organization-best-practices` | Org plugin work — multi-tenant, members, invitations, roles, active-org. |
| `/email-and-password-best-practices` | Email-verification, password reset, sign-up validation. |
| `/two-factor-authentication-best-practices` | Adding TOTP, backup codes, MFA. |
| `/better-auth-security-best-practices` | Rate limiting, CSRF, trusted origins, cookie hardening. |
| `/next-best-practices` | Pages Router patterns (file conventions, runtime selection, route handlers). |
| `/seldon` | Independent review of a non-trivial plan or design doc. Has caught real architecture mistakes here. |
| `/shape` then `/impeccable` | Designing a new UI surface (shape interview → impeccable build). |

## Working style for this repo

- **Trust `AGENTS.md` package boundaries** more than your defaults. If you
  feel like importing `dockerode` from `packages/api`, re-read the rules.
  The right answer is almost always to call into `packages/workflow-client`
  or `packages/orchestrator` instead.
- **Treat workflows as code in an alien sandbox.** When editing
  `apps/worker/src/workflows/*`, mentally check every line for non-
  determinism (`Math.random`, `new Date()`, `process.env`, top-level
  side-effectful imports). Side effects belong in activities.
- **Anchor edits to one of the runtime modes** (`pnpm dev` vs
  `pnpm stack:up`). Some bugs only repro in stack mode (image build paths,
  socket access). Note which mode you exercised in the PR description.
- **Plan-first for non-trivial work.** Update `docs/PLAN.md`, then run
  `/seldon` for an independent review before writing code.

## Things to not say or do

- Don't suggest `docker run` for user deployments. The brief mandates Docker Swarm services — we use `dockerode.createService` for user apps and `docker stack deploy` for mini-dokploy itself.
- Don't suggest `dokku/smoke-test-app` as a test repo — it's buildpack-only, no Dockerfile. Use `docker/welcome-to-docker` instead.
- Don't auto-populate branch as `main` — many older repos default to `master`. Check the upstream first.
- Don't claim a feature is shipped because it typechecks. Verify with the smoke test or by exercising the UI.
- Don't reach for `kubectl`, `helm`, or any cloud SDK — this project is intentionally local-only (no VPS, no cloud).
