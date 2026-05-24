import { generateText } from "ai";

import { aiEnabled, getAnthropic } from "./client";

// Return a short, human-readable explanation of a build failure given the tail
// of the build log. Falls back to the raw error if AI is not configured.
export async function explainFailure(args: { logTail: string; error: string }): Promise<string> {
  if (!aiEnabled()) return args.error;
  try {
    const { text } = await generateText({
      model: getAnthropic(),
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
    // Never throw out of an explainer — fall back to the raw error.
    return `${args.error}\n(AI explainer unavailable: ${String(e)})`;
  }
}
