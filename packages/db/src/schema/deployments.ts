import { sql, relations } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { organization } from "./organization";

// User-owned deployments. Status reflects the desired+observed state of the
// underlying Docker Swarm service; transitions are driven by Temporal workflows
// (apps/worker/src/workflows/deploy.workflow.ts).
export const deployment = sqliteTable(
  "deployment",
  {
    id: text("id").primaryKey(), // DNS-label-safe nanoid, 10 chars
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    repoUrl: text("repo_url").notNull(),
    branch: text("branch").notNull().default("main"),
    dockerfilePath: text("dockerfile_path").notNull().default("Dockerfile"),
    exposedPort: integer("exposed_port").notNull(),
    customLabels: text("custom_labels", { mode: "json" }).$type<Record<string, string>>(),
    status: text("status", {
      enum: ["pending", "building", "deploying", "running", "failed", "stopped"],
    })
      .notNull()
      .default("pending"),
    url: text("url"),
    imageTag: text("image_tag"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("deployment_org_idx").on(table.organizationId),
    index("deployment_status_idx").on(table.status),
  ],
);

// One row per workflow execution (create, redeploy, destroy).
// `targetStatus` lets reconciliation compute the parent deployment state
// from the run history rather than tracking a prior-status field.
export const deploymentRun = sqliteTable(
  "deployment_run",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployment.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id").notNull().unique(),
    runId: text("run_id").notNull(),
    trigger: text("trigger", { enum: ["create", "redeploy", "destroy"] }).notNull(),
    status: text("status", { enum: ["running", "success", "failed", "cancelled"] })
      .notNull()
      .default("running"),
    targetStatus: text("target_status", { enum: ["running", "stopped"] }).notNull(),
    failureReason: text("failure_reason"),
    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("deployment_run_deployment_idx").on(table.deploymentId),
    index("deployment_run_status_idx").on(table.status),
  ],
);

export const deploymentRelations = relations(deployment, ({ many, one }) => ({
  runs: many(deploymentRun),
  organization: one(organization, {
    fields: [deployment.organizationId],
    references: [organization.id],
  }),
}));

export const deploymentRunRelations = relations(deploymentRun, ({ one }) => ({
  deployment: one(deployment, {
    fields: [deploymentRun.deploymentId],
    references: [deployment.id],
  }),
}));
