import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";

export const AI_MODEL_ID = "claude-sonnet-4-6";

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getModel() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return createAnthropic({ apiKey })(AI_MODEL_ID);
}

// --- Suggest Dockerfile + port ---

const SuggestSchema = z.object({
  dockerfilePath: z.string().describe("Path to the Dockerfile relative to repo root"),
  exposedPort: z.number().int().min(1).max(65535).describe("Port the container app listens on"),
  reasoning: z.string().describe("One short sentence explaining the choice"),
});
export type DockerfileSuggestion = z.infer<typeof SuggestSchema>;

async function fetchGithubTree(repoUrl: string, branch = "main"): Promise<string[]> {
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) return [];
  const [, owner, repo] = match;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) return [];
  const data = (await res.json()) as { tree?: Array<{ path: string; type: string }> };
  return (data.tree ?? [])
    .filter((e) => e.type === "blob")
    .slice(0, 200)
    .map((e) => e.path);
}

export async function suggestDockerfile(
  repoUrl: string,
  branch?: string,
): Promise<DockerfileSuggestion> {
  if (!aiEnabled()) throw new Error("AI is not configured");
  const tree = await fetchGithubTree(repoUrl, branch);
  const treeText = tree.length > 0 ? tree.join("\n") : "(tree unavailable; guess from URL)";
  const { output } = await generateText({
    model: getModel(),
    output: Output.object({ schema: SuggestSchema }),
    prompt: [
      "Repository:",
      repoUrl,
      "",
      "File listing:",
      treeText,
      "",
      "Given the listing, choose the most likely Dockerfile path (default 'Dockerfile')",
      "and the port the application listens on inside the container.",
      "Common defaults: Node 3000, Next.js 3000, Python 8000, Go 8080.",
    ].join("\n"),
  });
  return output;
}

// --- Explain build failure ---

export async function explainFailure(args: { logTail: string; error: string }): Promise<string> {
  if (!aiEnabled()) return args.error;
  try {
    const { text } = await generateText({
      model: getModel(),
      prompt: [
        "A Docker image build for a user deployment just failed.",
        "Build log (last lines):",
        "```",
        args.logTail.slice(-6000),
        "```",
        "Error message:",
        args.error,
        "",
        "In one short paragraph (max 80 words), explain what went wrong and one concrete fix the user can try.",
      ].join("\n"),
    });
    return text.trim();
  } catch (e) {
    return `${args.error}\n(AI explainer unavailable: ${String(e)})`;
  }
}

// --- Suggest labels ---

const LabelsSchema = z.object({
  labels: z.record(z.string(), z.string()),
  reasoning: z.string(),
});
export type LabelSuggestion = z.infer<typeof LabelsSchema>;

export async function suggestLabels(
  prompt: string,
  deploymentId: string,
): Promise<LabelSuggestion> {
  if (!aiEnabled()) throw new Error("AI is not configured");
  const { output } = await generateText({
    model: getModel(),
    output: Output.object({ schema: LabelsSchema }),
    prompt: [
      "You generate Traefik v3 Docker labels for a deployment.",
      `The deployment id is "${deploymentId}". User-defined middlewares MUST be`,
      `prefixed with "app-${deploymentId}-" to satisfy the platform's namespace rules.`,
      "Do not emit traefik.http.routers.<id>.rule, .entrypoints, .service, .priority,",
      ".tls*, .middlewares, or traefik.http.services.<id>.loadbalancer.server.port —",
      "the platform generates these. Only emit additive labels.",
      "",
      "User request:",
      prompt,
    ].join("\n"),
  });
  return output;
}
