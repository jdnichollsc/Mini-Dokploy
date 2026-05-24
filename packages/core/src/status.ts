// Deployment status state machine.
// Single source of truth so workflow code, UI, and reconciliation agree.

export const DEPLOYMENT_STATUSES = [
  "pending",
  "building",
  "deploying",
  "running",
  "failed",
  "stopped",
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const RUN_STATUSES = ["running", "success", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRIGGERS = ["create", "redeploy", "destroy"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const RUN_TARGET_STATUSES = ["running", "stopped"] as const;
export type RunTargetStatus = (typeof RUN_TARGET_STATUSES)[number];

export function targetStatusFor(trigger: RunTrigger): RunTargetStatus {
  return trigger === "destroy" ? "stopped" : "running";
}
