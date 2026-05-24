import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { env } from "@mini-dokploy/env/worker";
import { simpleGit } from "simple-git";

import { appendLog, logPathFor } from "../logs";

export type CloneInput = {
  repoUrl: string;
  branch?: string;
  runId: string;
  deploymentId: string;
};

export async function gitClone(input: CloneInput): Promise<{ workdir: string }> {
  const workdir = resolve(env.DOKPLOY_BUILD_DIR, input.deploymentId);
  const logPath = logPathFor(input.runId);
  await mkdir(env.DOKPLOY_BUILD_DIR, { recursive: true });
  // Start clean each run so a stale checkout never leaks into the build.
  await rm(workdir, { recursive: true, force: true });

  await appendLog(
    logPath,
    `→ git clone --depth=1 --branch=${input.branch ?? "main"} ${input.repoUrl}\n`,
  );

  const git = simpleGit();
  await git.clone(input.repoUrl, workdir, [
    "--depth=1",
    "--single-branch",
    "--branch",
    input.branch ?? "main",
  ]);

  await appendLog(logPath, "✓ Repository cloned\n");
  return { workdir };
}
