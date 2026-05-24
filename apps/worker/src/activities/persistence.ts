import { db } from "@mini-dokploy/db";
import { deployment, deploymentRun } from "@mini-dokploy/db/schema";
import type { DeploymentStatus, RunStatus } from "@mini-dokploy/core";
import { eq } from "drizzle-orm";

export async function setDeploymentStatus(
  id: string,
  status: DeploymentStatus,
  patch?: { url?: string | null; imageTag?: string | null },
): Promise<void> {
  await db
    .update(deployment)
    .set({ status, ...(patch ?? {}) })
    .where(eq(deployment.id, id));
}

export async function setRunStatus(
  runId: string,
  status: RunStatus,
  patch?: { failureReason?: string | null; url?: string | null; imageTag?: string | null },
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status !== "running") updates.finishedAt = new Date();
  if (patch?.failureReason !== undefined) updates.failureReason = patch.failureReason;
  await db.update(deploymentRun).set(updates).where(eq(deploymentRun.runId, runId));
}
