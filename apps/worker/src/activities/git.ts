import { Context } from "@temporalio/activity";
import { gitClone as orchestratorGitClone } from "@mini-dokploy/orchestrator";

import type { CloneInput } from "@mini-dokploy/orchestrator";

export async function gitClone(input: CloneInput) {
  // Heartbeat once so Temporal knows we're alive; the clone itself is fast.
  Context.current().heartbeat();
  return orchestratorGitClone(input);
}
