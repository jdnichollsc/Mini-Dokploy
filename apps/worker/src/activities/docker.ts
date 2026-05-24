import { Context } from "@temporalio/activity";
import {
  createOrUpdateService,
  dockerBuild as orchestratorBuild,
  removeService,
  type BuildInput,
  type DeployServiceInput,
} from "@mini-dokploy/orchestrator";

export async function dockerBuild(input: BuildInput) {
  // Stream heartbeats during the long-running build so Temporal can detect
  // crashes well before the activity-level start-to-close timeout.
  return orchestratorBuild({
    ...input,
    onProgress: () => Context.current().heartbeat(),
  });
}

export async function dockerDeploy(input: DeployServiceInput) {
  Context.current().heartbeat();
  return createOrUpdateService(input);
}

export async function dockerDestroy(input: { deploymentId: string }) {
  Context.current().heartbeat();
  await removeService(input.deploymentId);
}
