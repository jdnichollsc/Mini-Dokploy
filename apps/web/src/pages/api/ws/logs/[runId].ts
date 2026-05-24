import { createReadStream, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { auth } from "@mini-dokploy/auth";
import { db } from "@mini-dokploy/db";
import { deployment, deploymentRun } from "@mini-dokploy/db/schema";
import chokidar from "chokidar";
import { and, eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";
import { WebSocketServer } from "ws";

// Bonus: live build/deploy log streaming.
// The build activity writes to ${DOKPLOY_LOG_DIR}/<runId>.log. This handler
// upgrades the request to a WebSocket, tails the file as it grows, and
// pushes each new chunk to the client.
//
// Auth contract: the caller must have an active session AND the runId must
// belong to a deployment in their active organization.

export const config = {
  api: {
    bodyParser: false,
  },
};

// Shared WebSocketServer across requests (no-server mode).
let wss: WebSocketServer | null = null;
function getWss(): WebSocketServer {
  if (!wss) wss = new WebSocketServer({ noServer: true });
  return wss;
}

function logPathFor(runId: string): string {
  const dir = process.env.DOKPLOY_LOG_DIR ?? "./.dokploy-logs";
  return resolve(dir, `${runId}.log`);
}

async function isAuthorized(req: NextApiRequest, runId: string): Promise<boolean> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
    else if (v !== undefined) headers.set(k, v);
  }
  const session = await auth.api.getSession({ headers });
  if (!session) return false;
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return false;
  const row = await db
    .select({ id: deployment.id })
    .from(deploymentRun)
    .innerJoin(deployment, eq(deploymentRun.deploymentId, deployment.id))
    .where(and(eq(deploymentRun.runId, runId), eq(deployment.organizationId, orgId)))
    .limit(1);
  return row.length > 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const runId = typeof req.query.runId === "string" ? req.query.runId : null;
  if (!runId || !/^[a-z0-9-]{1,80}$/.test(runId)) {
    res.status(400).end("invalid runId");
    return;
  }
  if (!(await isAuthorized(req, runId))) {
    res.status(403).end("forbidden");
    return;
  }

  const server = getWss();
  // Pages Router exposes the raw Node socket for upgrades.
  server.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
    const path = logPathFor(runId);

    // Send what's already on disk, then watch for appends.
    let offset = 0;
    const sendFromOffset = () => {
      if (!existsSync(path)) return;
      const size = statSync(path).size;
      if (size <= offset) return;
      const stream = createReadStream(path, { start: offset, end: size - 1 });
      stream.on("data", (chunk) => ws.readyState === ws.OPEN && ws.send(chunk));
      stream.on("end", () => {
        offset = size;
      });
    };
    sendFromOffset();

    const watcher = chokidar.watch(path, { persistent: true, ignoreInitial: true });
    watcher.on("change", sendFromOffset);
    watcher.on("add", sendFromOffset);

    ws.on("close", () => {
      watcher.close().catch(() => undefined);
    });
  });
}
