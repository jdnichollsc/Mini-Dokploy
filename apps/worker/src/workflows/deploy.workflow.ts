import type { DeployWorkflowInput, DestroyWorkflowInput } from "@mini-dokploy/core";
import { proxyActivities } from "@temporalio/workflow";

// Type-only import: workflow code MUST NOT import side-effect activity
// implementations (those run in the activity sandbox, not workflow code).
import type * as activities from "../activities";

const {
  gitClone,
  dockerBuild,
  dockerDeploy,
  dockerDestroy,
  setDeploymentStatus,
  setRunStatus,
  aiExplainFailure,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "1 minute",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5s",
    backoffCoefficient: 2,
  },
});

export async function deployWorkflow(input: DeployWorkflowInput): Promise<{ url: string }> {
  await setRunStatus(input.runId, "running");
  try {
    await setDeploymentStatus(input.deploymentId, "building");
    const { workdir } = await gitClone({
      repoUrl: input.repoUrl,
      branch: input.branch,
      runId: input.runId,
      deploymentId: input.deploymentId,
    });

    const { imageTag } = await dockerBuild({
      workdir,
      dockerfilePath: input.dockerfilePath,
      deploymentId: input.deploymentId,
      runId: input.runId,
    });

    await setDeploymentStatus(input.deploymentId, "deploying", { imageTag });
    const { url } = await dockerDeploy({
      deploymentId: input.deploymentId,
      imageTag,
      port: input.exposedPort,
      customLabels: input.customLabels,
    });

    await setDeploymentStatus(input.deploymentId, "running", { url, imageTag });
    await setRunStatus(input.runId, "success", { url, imageTag });
    return { url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setDeploymentStatus(input.deploymentId, "failed");
    const reason = await aiExplainFailure({ runId: input.runId, error: message });
    await setRunStatus(input.runId, "failed", { failureReason: reason });
    throw err;
  }
}

export async function destroyWorkflow(input: DestroyWorkflowInput): Promise<void> {
  await setRunStatus(input.runId, "running");
  try {
    await dockerDestroy({ deploymentId: input.deploymentId });
    await setDeploymentStatus(input.deploymentId, "stopped", { url: null });
    await setRunStatus(input.runId, "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setDeploymentStatus(input.deploymentId, "failed");
    await setRunStatus(input.runId, "failed", { failureReason: message });
    throw err;
  }
}
