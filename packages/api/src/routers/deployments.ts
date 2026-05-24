import { deploymentInput, generateDnsLabelSafeId, targetStatusFor } from "@mini-dokploy/core";
import { db } from "@mini-dokploy/db";
import { deployment, deploymentRun } from "@mini-dokploy/db/schema";
import { startDeployWorkflow, startDestroyWorkflow } from "@mini-dokploy/workflow-client";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { orgScopedProcedure, router } from "../index";

async function ensureOwnership(deploymentId: string, organizationId: string) {
  const row = await db.query.deployment.findFirst({
    where: and(eq(deployment.id, deploymentId), eq(deployment.organizationId, organizationId)),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
  return row;
}

export const deploymentsRouter = router({
  list: orgScopedProcedure.query(async ({ ctx }) => {
    return db.query.deployment.findMany({
      where: eq(deployment.organizationId, ctx.organizationId),
      orderBy: [desc(deployment.createdAt)],
    });
  }),

  get: orgScopedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const dep = await ensureOwnership(input.id, ctx.organizationId);
      const runs = await db.query.deploymentRun.findMany({
        where: eq(deploymentRun.deploymentId, input.id),
        orderBy: [desc(deploymentRun.startedAt)],
        limit: 20,
      });
      return { deployment: dep, runs };
    }),

  create: orgScopedProcedure
    .input(deploymentInput)
    .mutation(async ({ ctx, input }) => {
      const id = generateDnsLabelSafeId();
      const runId = generateDnsLabelSafeId();

      await db.insert(deployment).values({
        id,
        organizationId: ctx.organizationId,
        name: input.name,
        repoUrl: input.repoUrl,
        branch: input.branch,
        dockerfilePath: input.dockerfilePath,
        exposedPort: input.exposedPort,
        customLabels: input.customLabels,
        status: "pending",
      });
      await db.insert(deploymentRun).values({
        id: runId,
        deploymentId: id,
        workflowId: runId,
        runId,
        trigger: "create",
        status: "running",
        targetStatus: targetStatusFor("create"),
      });

      try {
        await startDeployWorkflow({
          deploymentId: id,
          runId,
          name: input.name,
          repoUrl: input.repoUrl,
          branch: input.branch,
          dockerfilePath: input.dockerfilePath,
          exposedPort: input.exposedPort,
          customLabels: input.customLabels,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await db.update(deployment).set({ status: "failed" }).where(eq(deployment.id, id));
        await db
          .update(deploymentRun)
          .set({ status: "failed", failureReason: `workflow_start_failed: ${message}` })
          .where(eq(deploymentRun.runId, runId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not start workflow: ${message}`,
        });
      }
      return { id, runId };
    }),

  redeploy: orgScopedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const dep = await ensureOwnership(input.id, ctx.organizationId);
      const runId = generateDnsLabelSafeId();
      await db.insert(deploymentRun).values({
        id: runId,
        deploymentId: dep.id,
        workflowId: runId,
        runId,
        trigger: "redeploy",
        status: "running",
        targetStatus: targetStatusFor("redeploy"),
      });
      try {
        await startDeployWorkflow({
          deploymentId: dep.id,
          runId,
          name: dep.name,
          repoUrl: dep.repoUrl,
          branch: dep.branch,
          dockerfilePath: dep.dockerfilePath,
          exposedPort: dep.exposedPort,
          customLabels: dep.customLabels ?? undefined,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await db
          .update(deploymentRun)
          .set({ status: "failed", failureReason: `workflow_start_failed: ${message}` })
          .where(eq(deploymentRun.runId, runId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not start workflow: ${message}`,
        });
      }
      return { runId };
    }),

  destroy: orgScopedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const dep = await ensureOwnership(input.id, ctx.organizationId);
      const runId = generateDnsLabelSafeId();
      await db.insert(deploymentRun).values({
        id: runId,
        deploymentId: dep.id,
        workflowId: runId,
        runId,
        trigger: "destroy",
        status: "running",
        targetStatus: targetStatusFor("destroy"),
      });
      try {
        await startDestroyWorkflow({ deploymentId: dep.id, runId });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await db
          .update(deploymentRun)
          .set({ status: "failed", failureReason: `workflow_start_failed: ${message}` })
          .where(eq(deploymentRun.runId, runId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not start workflow: ${message}`,
        });
      }
      return { runId };
    }),
});
