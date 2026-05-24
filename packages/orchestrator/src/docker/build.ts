import { spawn } from "node:child_process";

import { appendLog, logPathFor } from "../logs";

export type BuildInput = {
  workdir: string;
  dockerfilePath: string;
  deploymentId: string;
  runId: string;
  onProgress?: () => void;
};

// Build a Docker image with `docker buildx build --load`.
// --load is critical: it loads the resulting image into the local Engine so
// Swarm can schedule it on this manager node. Without --load, buildx caches
// the image in the builder but never makes it available to Swarm, and
// `docker.createService` fails with "image not found".
export async function dockerBuild(input: BuildInput): Promise<{ imageTag: string }> {
  const imageTag = `mini-dokploy/app-${input.deploymentId}:${input.runId}`;
  const logPath = logPathFor(input.runId);

  await appendLog(logPath, `→ docker buildx build --load -t ${imageTag} -f ${input.dockerfilePath} .\n`);

  const args = [
    "buildx",
    "build",
    "--load",
    "--progress=plain",
    "-t",
    imageTag,
    "-f",
    input.dockerfilePath,
    ".",
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("docker", args, { cwd: input.workdir });
    const onChunk = (chunk: Buffer | string) => {
      appendLog(logPath, chunk.toString()).catch(() => undefined);
      input.onProgress?.();
    };
    proc.stdout.on("data", onChunk);
    proc.stderr.on("data", onChunk);
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker buildx exited with code ${code}`));
    });
  });

  await appendLog(logPath, `\n✓ Built ${imageTag}\n`);
  return { imageTag };
}
