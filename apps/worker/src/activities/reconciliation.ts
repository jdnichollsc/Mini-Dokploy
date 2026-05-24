import { db } from "@mini-dokploy/db";
import { deployment, deploymentRun } from "@mini-dokploy/db/schema";
import { and, eq, isNull } from "drizzle-orm";

// One-shot reconciliation: any deployment_run rows still marked "running" at
// worker startup are the result of a race between DB insert and Temporal
// workflow.start (or a worker that died before persisting completion).
// Temporal will resume any workflow it actually owns on its own; the only
// rows that need cleanup here are those left in an inconsistent DB state.
export async function reconcileStuckRuns(): Promise<void> {
  const stuck = await db
    .select({
      runId: deploymentRun.runId,
      deploymentId: deploymentRun.deploymentId,
      trigger: deploymentRun.trigger,
    })
    .from(deploymentRun)
    .where(and(eq(deploymentRun.status, "running"), isNull(deploymentRun.finishedAt)));

  for (const row of stuck) {
    await db
      .update(deploymentRun)
      .set({
        status: "failed",
        failureReason: "worker_restart_reconciled",
        finishedAt: new Date(),
      })
      .where(eq(deploymentRun.runId, row.runId));

    // Roll the parent deployment back to a sane status. If the trigger was
    // destroy, leave it stopped; otherwise mark failed so the UI surfaces
    // the issue prominently.
    const target = row.trigger === "destroy" ? "stopped" : "failed";
    await db
      .update(deployment)
      .set({ status: target })
      .where(eq(deployment.id, row.deploymentId));
  }
  if (stuck.length > 0) console.log(`✓ Reconciled ${stuck.length} stuck run(s)`);
}
