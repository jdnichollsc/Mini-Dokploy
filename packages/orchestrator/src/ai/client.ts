import { createAnthropic } from "@ai-sdk/anthropic";
import { env } from "@mini-dokploy/env/worker";

export const AI_MODEL_ID = "claude-sonnet-4-6";

export function aiEnabled(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function getAnthropic() {
  if (!aiEnabled()) throw new Error("ANTHROPIC_API_KEY is not set");
  const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return anthropic(AI_MODEL_ID);
}
