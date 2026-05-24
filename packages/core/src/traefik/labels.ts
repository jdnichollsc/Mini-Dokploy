import { ID_REGEX } from "../ids";

// Hardened Traefik label generator.
// Copied verbatim from .agents/skills/traefik/SKILL.md step 3. Treat custom
// labels as adversarial: any unfiltered value can hijack routing, rebind a
// service to a different port, or override another tenant's router.

export type LabelDeployment = {
  id: string;
  port: number;
  customLabels?: Record<string, string>;
};

export type LabelEnv = {
  hostSuffix?: string;
  entrypoint?: string;
  certResolver?: string;
};

const RESERVED_OWN_ROUTER_SUFFIXES = [
  "rule",
  "entrypoints",
  "service",
  "priority",
  "tls",
  "tls.certresolver",
  "tls.options",
  "tls.domains",
  "middlewares",
];

const RESERVED_OWN_SERVICE_SUFFIXES = [
  "loadbalancer.server.port",
  "loadbalancer.server.scheme",
  "loadbalancer.passhostheader",
  "loadbalancer.serverstransport",
];

export function buildTraefikLabels(
  d: LabelDeployment,
  env: LabelEnv = {},
): Record<string, string> {
  if (!ID_REGEX.test(d.id)) {
    throw new Error(`invalid deployment id: ${d.id}`);
  }
  if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535) {
    throw new Error(`invalid port: ${d.port}`);
  }

  const router = `app-${d.id}`;
  const service = router;
  const suffix = env.hostSuffix ?? process.env.DOKPLOY_HOST_SUFFIX ?? "127.0.0.1.sslip.io";
  const ep = env.entrypoint ?? process.env.TRAEFIK_ENTRYPOINT ?? "web";
  const cert = env.certResolver ?? process.env.TRAEFIK_CERT_RESOLVER;

  const generated: Record<string, string> = {
    "traefik.enable": "true",
    [`traefik.http.routers.${router}.rule`]: `Host(\`${router}.${suffix}\`)`,
    [`traefik.http.routers.${router}.entrypoints`]: ep,
    [`traefik.http.routers.${router}.service`]: service,
    [`traefik.http.routers.${router}.priority`]: "1",
    [`traefik.http.services.${service}.loadbalancer.server.port`]: String(d.port),
    "com.mini-dokploy.deployment": d.id,
  };
  if (cert) {
    generated[`traefik.http.routers.${router}.tls`] = "true";
    generated[`traefik.http.routers.${router}.tls.certresolver`] = cert;
  }

  for (const [k, v] of Object.entries(d.customLabels ?? {})) {
    if (k === "traefik.enable" || k === "com.mini-dokploy.deployment") continue;

    if (k.startsWith("traefik.http.routers.") && !k.startsWith(`traefik.http.routers.${router}.`)) continue;
    if (k.startsWith("traefik.http.services.") && !k.startsWith(`traefik.http.services.${service}.`)) continue;

    if (k.startsWith(`traefik.http.routers.${router}.`)) {
      const suf = k.slice(`traefik.http.routers.${router}.`.length);
      if (RESERVED_OWN_ROUTER_SUFFIXES.some((s) => suf === s || suf.startsWith(s + "."))) continue;
    }

    if (k.startsWith(`traefik.http.services.${service}.`)) {
      const suf = k.slice(`traefik.http.services.${service}.`.length);
      if (RESERVED_OWN_SERVICE_SUFFIXES.some((s) => suf === s || suf.startsWith(s + "."))) continue;
    }

    if (k.startsWith("traefik.http.middlewares.")) {
      const namePart = k.slice("traefik.http.middlewares.".length).split(".")[0] ?? "";
      if (!namePart.startsWith(`${router}-`)) continue;
    }

    if (k.startsWith("traefik.tcp.") || k.startsWith("traefik.udp.")) continue;

    if (k in generated) continue;

    generated[k] = v;
  }

  return generated;
}

export function deploymentUrl(id: string, hostSuffix?: string): string {
  const suffix = hostSuffix ?? process.env.DOKPLOY_HOST_SUFFIX ?? "127.0.0.1.sslip.io";
  return `http://app-${id}.${suffix}`;
}
