import type { DeployWorkflowInput, DestroyWorkflowInput } from "@mini-dokploy/core";
import { Client, Connection } from "@temporalio/client";

// Lazy singleton: avoids opening a connection at import time, which would
// block app startup if Temporal is briefly unavailable.
let cached: { client: Client; connection: Connection } | null = null;

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export async function getTemporalClient(): Promise<Client> {
  if (cached) return cached.client;
  const address = envOr("TEMPORAL_ADDRESS", "localhost:7233");
  const namespace = envOr("TEMPORAL_NAMESPACE", "default");
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  cached = { client, connection };
  return client;
}

export async function closeTemporalClient(): Promise<void> {
  if (!cached) return;
  await cached.connection.close();
  cached = null;
}

export const TASK_QUEUE = envOr("TEMPORAL_TASK_QUEUE", "deploy");

export async function startDeployWorkflow(input: DeployWorkflowInput) {
  const client = await getTemporalClient();
  return client.workflow.start("deployWorkflow", {
    taskQueue: TASK_QUEUE,
    workflowId: input.runId,
    args: [input],
  });
}

export async function startDestroyWorkflow(input: DestroyWorkflowInput) {
  const client = await getTemporalClient();
  return client.workflow.start("destroyWorkflow", {
    taskQueue: TASK_QUEUE,
    workflowId: input.runId,
    args: [input],
  });
}

export async function describeWorkflow(workflowId: string) {
  const client = await getTemporalClient();
  try {
    return await client.workflow.getHandle(workflowId).describe();
  } catch {
    return null;
  }
}
