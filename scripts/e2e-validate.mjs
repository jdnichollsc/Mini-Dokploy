#!/usr/bin/env node
// Programmatic end-to-end validation: sign up via BetterAuth, create org,
// trigger a deployment via tRPC, poll status, then curl the generated URL.
// Designed to run against `pnpm dev:web` + `pnpm dev:worker` natively.

const BASE = process.env.MINI_DOKPLOY_URL ?? "http://localhost:3001";
// Default to dokku/smoke-test-app: tiny Python app with a working Dockerfile
// listening on port 5000. Override with E2E_REPO / E2E_PORT / E2E_DOCKERFILE.
const REPO = process.env.E2E_REPO ?? "https://github.com/dokku/smoke-test-app";
const PORT = Number(process.env.E2E_PORT ?? 5000);
const DOCKERFILE = process.env.E2E_DOCKERFILE ?? "Dockerfile";
const NAME = process.env.E2E_NAME ?? "smoke-test";

const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const USER = {
  name: `Validator ${stamp}`,
  email: `validator+${stamp}@example.com`,
  password: "correcthorsebatterystaple",
};
const ORG = { name: `Org ${stamp}`, slug: `org-${stamp}` };

// Re-usable cookie jar that survives across fetches.
const jar = new Map();

async function http(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (jar.size) {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    headers.set("cookie", cookie);
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const [pair] = sc.split(";");
    const [k, v] = pair.split("=");
    if (k && v !== undefined) jar.set(k.trim(), v.trim());
  }
  return res;
}

async function trpc(procedure, input, method = "POST") {
  const url = `/api/trpc/${procedure}`;
  if (method === "GET") {
    const q = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : "";
    const res = await http(url + q);
    return res.json();
  }
  const res = await http(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  return res.json();
}

async function step(name, fn) {
  process.stdout.write(`→ ${name}... `);
  try {
    const out = await fn();
    console.log("✓");
    return out;
  } catch (e) {
    console.log("✗");
    throw e;
  }
}

async function main() {
  console.log(`Validating against ${BASE}`);

  await step("sign up", async () => {
    const res = await http("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(USER),
    });
    if (!res.ok) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  });

  await step("create organization", async () => {
    const res = await http("/api/auth/organization/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ORG),
    });
    if (!res.ok) throw new Error(`create org failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data;
  });

  await step("set active organization", async () => {
    // BetterAuth: /api/auth/organization/set-active
    const res = await http("/api/auth/organization/set-active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationSlug: ORG.slug }),
    });
    if (!res.ok) throw new Error(`set-active failed: ${res.status} ${await res.text()}`);
  });

  const created = await step("trpc deployments.create", async () => {
    const body = await trpc("deployments.create", {
      name: NAME,
      repoUrl: REPO,
      branch: "main",
      dockerfilePath: DOCKERFILE,
      exposedPort: PORT,
    });
    if (body.error) throw new Error(JSON.stringify(body.error));
    return body.result?.data ?? body;
  });

  const id = created.id;
  const runId = created.runId;
  console.log(`  deployment id = ${id}, runId = ${runId}`);

  // Poll status every 5s for up to 12 minutes.
  let lastStatus = null;
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    const body = await trpc("deployments.get", { id }, "GET");
    const dep = body.result?.data?.deployment;
    const run = body.result?.data?.runs?.[0];
    if (!dep) {
      console.log("? no deployment data, raw:", JSON.stringify(body).slice(0, 200));
    } else if (dep.status !== lastStatus) {
      lastStatus = dep.status;
      console.log(`  [${new Date().toISOString().slice(11, 19)}] deployment.status=${dep.status}  run.status=${run?.status}  url=${dep.url ?? "—"}`);
    }
    if (dep?.status === "running" || dep?.status === "failed" || dep?.status === "stopped") break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  const final = await trpc("deployments.get", { id }, "GET");
  const dep = final.result?.data?.deployment;
  console.log("");
  console.log(`Final status: ${dep?.status}`);
  console.log(`URL:          ${dep?.url ?? "—"}`);

  if (dep?.status !== "running") {
    const run = final.result?.data?.runs?.[0];
    console.log(`Failure:      ${run?.failureReason ?? "(none)"}`);
    process.exit(1);
  }

  await step(`curl deployment URL`, async () => {
    const res = await fetch(dep.url, { redirect: "manual" });
    console.log(`  HTTP ${res.status}`);
    if (res.status >= 500) throw new Error(`unexpected ${res.status}`);
  });

  console.log("\n✅ end-to-end validation passed");
}

main().catch((e) => {
  console.error("\n✗", e.message);
  process.exit(1);
});
