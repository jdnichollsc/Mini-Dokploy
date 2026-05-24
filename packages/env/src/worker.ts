import "./load-env";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
    TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
    TEMPORAL_TASK_QUEUE: z.string().min(1).default("deploy"),
    ANTHROPIC_API_KEY: z.string().optional(),
    DOKPLOY_LOG_DIR: z.string().min(1).default("./.dokploy-logs"),
    DOKPLOY_BUILD_DIR: z.string().min(1).default("./.dokploy-builds"),
    DOKPLOY_OVERLAY: z.string().min(1).default("dokploy-network"),
    DOKPLOY_HOST_SUFFIX: z.string().min(1).default("127.0.0.1.sslip.io"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
