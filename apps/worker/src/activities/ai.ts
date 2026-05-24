import { explainFailure as orchestratorExplain, readLogTail } from "@mini-dokploy/orchestrator";

// Workflow-facing AI activity. Reads the run's build log from disk and asks
// Claude (via the Vercel AI SDK) for a 1-paragraph explanation.
// If ANTHROPIC_API_KEY is unset, returns the raw error.
export async function aiExplainFailure(input: { runId: string; error: string }): Promise<string> {
  const logTail = await readLogTail(input.runId);
  return orchestratorExplain({ logTail, error: input.error });
}
