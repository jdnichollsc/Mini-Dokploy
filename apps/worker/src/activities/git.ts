import { Context } from "@temporalio/activity";
import { gitClone as orchestratorGitClone } from "@mini-dokploy/orchestrator";

import type { CloneInput } from "@mini-dokploy/orchestrator";

export async function gitClone(input: CloneInput) {
  // Heartbeat once so Temporal sees the activity is alive; the clone is fast.
  Context.current().heartbeat();
  return orchestratorGitClone(input);
}
