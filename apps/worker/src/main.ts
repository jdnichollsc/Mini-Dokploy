import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { env } from "@mini-dokploy/env/worker";
import { NativeConnection, Worker } from "@temporalio/worker";

import * as activities from "./activities";
import { reconcileStuckRuns } from "./activities/reconciliation";

async function main() {
  await reconcileStuckRuns();

  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });
  const here = dirname(fileURLToPath(import.meta.url));
  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: resolve(here, "./workflows/deploy.workflow.ts"),
    activities,
  });

  console.log(
    `✓ Worker started (task queue=${env.TEMPORAL_TASK_QUEUE}, address=${env.TEMPORAL_ADDRESS})`,
  );
  await worker.run();
}

main().catch((err) => {
  console.error("Worker fatal:", err);
  process.exit(1);
});
