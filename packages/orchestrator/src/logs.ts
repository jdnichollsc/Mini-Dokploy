import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { env } from "@mini-dokploy/env/worker";

export function logPathFor(runId: string): string {
  return resolve(env.DOKPLOY_LOG_DIR, `${runId}.log`);
}

export async function appendLog(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, content, "utf8");
}

export async function readLogTail(runId: string, maxBytes = 8 * 1024): Promise<string> {
  try {
    const buf = await readFile(logPathFor(runId));
    if (buf.byteLength <= maxBytes) return buf.toString("utf8");
    return buf.subarray(buf.byteLength - maxBytes).toString("utf8");
  } catch {
    return "";
  }
}
