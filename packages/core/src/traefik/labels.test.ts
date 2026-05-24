import { describe, expect, it } from "vitest";

import { buildTraefikLabels } from "./labels";

describe("buildTraefikLabels", () => {
  const base = { id: "abc123", port: 3000 };

  it("generates correct sslip.io host rule and port for the deployment", () => {
    const labels = buildTraefikLabels(base, { hostSuffix: "127.0.0.1.sslip.io" });
    expect(labels["traefik.enable"]).toBe("true");
    expect(labels["traefik.http.routers.app-abc123.rule"]).toBe(
      "Host(`app-abc123.127.0.0.1.sslip.io`)",
    );
    expect(labels["traefik.http.routers.app-abc123.entrypoints"]).toBe("web");
    expect(labels["traefik.http.services.app-abc123.loadbalancer.server.port"]).toBe("3000");
    expect(labels["com.mini-dokploy.deployment"]).toBe("abc123");
  });

  it("merges a non-colliding custom label", () => {
    const labels = buildTraefikLabels({
      ...base,
      customLabels: { "com.example.app-version": "1.2.3" },
    });
    expect(labels["com.example.app-version"]).toBe("1.2.3");
  });

  it("rejects a custom label that tries to override own router.rule", () => {
    const labels = buildTraefikLabels({
      ...base,
      customLabels: {
        "traefik.http.routers.app-abc123.rule": "Host(`evil.example.com`)",
      },
    });
    expect(labels["traefik.http.routers.app-abc123.rule"]).toBe(
      "Host(`app-abc123.127.0.0.1.sslip.io`)",
    );
  });

  it("rejects a cross-tenant attempt to define another deployment's router", () => {
    const labels = buildTraefikLabels({
      ...base,
      customLabels: {
        "traefik.http.routers.app-victim.rule": "Host(`stolen.example.com`)",
      },
    });
    expect(labels["traefik.http.routers.app-victim.rule"]).toBeUndefined();
  });

  it("rejects a user middleware not prefixed with the deployment router id", () => {
    const labels = buildTraefikLabels({
      ...base,
      customLabels: {
        "traefik.http.middlewares.platform-auth.basicauth.users": "admin:hash",
      },
    });
    expect(labels["traefik.http.middlewares.platform-auth.basicauth.users"]).toBeUndefined();
  });

  it("accepts a user middleware properly namespaced under the deployment id", () => {
    const labels = buildTraefikLabels({
      ...base,
      customLabels: {
        "traefik.http.middlewares.app-abc123-rl.ratelimit.average": "100",
      },
    });
    expect(labels["traefik.http.middlewares.app-abc123-rl.ratelimit.average"]).toBe("100");
  });

  it("rejects an attempt to rebind own loadbalancer port", () => {
    const labels = buildTraefikLabels({
      ...base,
      customLabels: {
        "traefik.http.services.app-abc123.loadbalancer.server.port": "22",
      },
    });
    expect(labels["traefik.http.services.app-abc123.loadbalancer.server.port"]).toBe("3000");
  });

  it("emits TLS labels when a cert resolver is configured", () => {
    const labels = buildTraefikLabels(base, {
      hostSuffix: "apps.example.com",
      certResolver: "le",
    });
    expect(labels["traefik.http.routers.app-abc123.tls"]).toBe("true");
    expect(labels["traefik.http.routers.app-abc123.tls.certresolver"]).toBe("le");
  });

  it("throws on invalid deployment id", () => {
    expect(() => buildTraefikLabels({ id: "Bad ID!", port: 3000 })).toThrow(
      /invalid deployment id/,
    );
  });

  it("throws on invalid port", () => {
    expect(() => buildTraefikLabels({ id: "abc123", port: 99999 })).toThrow(/invalid port/);
  });
});
