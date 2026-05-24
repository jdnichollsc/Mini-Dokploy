import Docker from "dockerode";

// Socket auto-detection mirrors the upstream Dokploy approach:
// honor DOCKER_HOST first, then Rancher Desktop, then the standard socket.
function resolveSocket(): { socketPath: string } | { host: string; port: number } {
  const dockerHost = process.env.DOCKER_HOST;
  if (dockerHost && dockerHost.startsWith("tcp://")) {
    const url = new URL(dockerHost);
    return { host: url.hostname, port: Number(url.port) || 2375 };
  }
  if (dockerHost && dockerHost.startsWith("unix://")) {
    return { socketPath: dockerHost.replace("unix://", "") };
  }
  // Rancher Desktop on macOS
  const home = process.env.HOME ?? "";
  const rancher = `${home}/.rd/docker.sock`;
  try {
    // Synchronous existence check is fine at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    if (fs.existsSync(rancher)) return { socketPath: rancher };
  } catch {
    // ignore — fall through to default
  }
  return { socketPath: "/var/run/docker.sock" };
}

let cached: Docker | null = null;
export function getDocker(): Docker {
  if (cached) return cached;
  cached = new Docker(resolveSocket());
  return cached;
}
