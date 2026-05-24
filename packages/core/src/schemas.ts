import { z } from "zod";

// Reusable input schemas shared between tRPC routers and Temporal workflows.
// Keep these pure (no I/O imports) so they can live in this package.

const labelKey = z
  .string()
  .min(1)
  .max(200)
  // Allow Traefik dotted keys, custom org keys, hyphens, digits, alphanum, slashes for SemVer-style values.
  .regex(/^[A-Za-z0-9._-][A-Za-z0-9._/-]*$/, "Invalid label key");

const labelValue = z.string().max(1000);

export const deploymentInput = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9 _-]+$/, "Letters, digits, spaces, dashes, underscores only"),
  repoUrl: z.string().url(),
  branch: z.string().min(1).max(80).default("main"),
  dockerfilePath: z.string().min(1).max(200).default("Dockerfile"),
  exposedPort: z.number().int().min(1).max(65535),
  customLabels: z.record(labelKey, labelValue).optional(),
});

export type DeploymentInput = z.infer<typeof deploymentInput>;

// Workflow argument shape (DB-side fields + id resolved by the caller).
export const deployWorkflowInput = deploymentInput.extend({
  deploymentId: z.string(),
  runId: z.string(),
});
export type DeployWorkflowInput = z.infer<typeof deployWorkflowInput>;

export const destroyWorkflowInput = z.object({
  deploymentId: z.string(),
  runId: z.string(),
});
export type DestroyWorkflowInput = z.infer<typeof destroyWorkflowInput>;
