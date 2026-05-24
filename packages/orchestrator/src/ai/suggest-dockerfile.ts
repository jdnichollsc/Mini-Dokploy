import { generateObject } from "ai";
import { z } from "zod";

import { aiEnabled, getAnthropic } from "./client";

const SuggestSchema = z.object({
  dockerfilePath: z.string().describe("Path to the Dockerfile relative to repo root"),
  exposedPort: z.number().int().min(1).max(65535).describe("Port the container app listens on"),
  reasoning: z.string().describe("One short sentence explaining the choice"),
});

export type DockerfileSuggestion = z.infer<typeof SuggestSchema>;

// Pull the public file tree from GitHub. Limited to the first 200 entries to
// keep prompt size small. Falls back to an empty list for non-GitHub URLs.
async function fetchGithubTree(repoUrl: string, branch = "main"): Promise<string[]> {
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) return [];
  const [, owner, repo] = match;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) return [];
  const data = (await res.json()) as { tree?: Array<{ path: string; type: string }> };
  return (data.tree ?? []).filter((e) => e.type === "blob").slice(0, 200).map((e) => e.path);
}

export async function suggestDockerfile(repoUrl: string, branch?: string): Promise<DockerfileSuggestion> {
  if (!aiEnabled()) throw new Error("AI is not configured");
  const tree = await fetchGithubTree(repoUrl, branch);
  const treeText = tree.length > 0 ? tree.join("\n") : "(tree unavailable; guess from URL)";
  const { object } = await generateObject({
    model: getAnthropic(),
    schema: SuggestSchema,
    prompt: [
      "Repository:",
      repoUrl,
      "",
      "File listing:",
      treeText,
      "",
      "Given the listing, choose the most likely Dockerfile path (default 'Dockerfile')",
      "and the port the application listens on inside the container.",
      "If multiple Dockerfiles exist, prefer the one at the repo root.",
      "Common ports: Node 3000, Next.js 3000, Python 8000, Go 8080.",
    ].join("\n"),
  });
  return object;
}
