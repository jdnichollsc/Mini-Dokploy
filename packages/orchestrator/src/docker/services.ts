import { buildTraefikLabels, deploymentUrl } from "@mini-dokploy/core";
import { env } from "@mini-dokploy/env/worker";

import { getDocker } from "./client";

export type DeployServiceInput = {
  deploymentId: string;
  imageTag: string;
  port: number;
  customLabels?: Record<string, string>;
};

// Create or in-place update a Swarm service for a user deployment.
// In-place update (`start-first`) avoids a 502 window during redeploy because
// the new task is brought up healthy before the old one is stopped.
export async function createOrUpdateService(input: DeployServiceInput): Promise<{ url: string }> {
  const docker = getDocker();
  const serviceName = `app-${input.deploymentId}`;
  const labels = buildTraefikLabels({
    id: input.deploymentId,
    port: input.port,
    customLabels: input.customLabels,
  });

  const baseSpec = {
    Name: serviceName,
    TaskTemplate: {
      ContainerSpec: { Image: input.imageTag },
      Networks: [{ Target: env.DOKPLOY_OVERLAY }],
      RestartPolicy: { Condition: "any" as const, MaxAttempts: 0 },
    },
    Mode: { Replicated: { Replicas: 1 } },
    Labels: labels,
    EndpointSpec: { Mode: "vip" as const },
    UpdateConfig: {
      Parallelism: 1,
      Order: "start-first" as const,
      FailureAction: "rollback" as const,
      Monitor: 5_000_000_000,
    },
  };

  const existing = await docker.listServices({ filters: { name: [serviceName] } });
  const first = existing[0];
  if (!first) {
    await docker.createService(baseSpec);
  } else {
    const svc = docker.getService(first.ID);
    const info = await svc.inspect();
    await svc.update({ ...baseSpec, version: info.Version.Index });
  }

  return { url: deploymentUrl(input.deploymentId, env.DOKPLOY_HOST_SUFFIX) };
}

export async function removeService(deploymentId: string): Promise<void> {
  const docker = getDocker();
  const serviceName = `app-${deploymentId}`;
  const existing = await docker.listServices({ filters: { name: [serviceName] } });
  const first = existing[0];
  if (!first) return;
  await docker.getService(first.ID).remove();
}

export async function serviceExists(deploymentId: string): Promise<boolean> {
  const docker = getDocker();
  const existing = await docker.listServices({
    filters: { name: [`app-${deploymentId}`] },
  });
  return existing.length > 0;
}
