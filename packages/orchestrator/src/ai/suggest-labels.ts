import { generateObject } from "ai";
import { z } from "zod";

import { aiEnabled, getAnthropic } from "./client";

const LabelsSchema = z.object({
  labels: z.record(z.string(), z.string()),
  reasoning: z.string(),
});

export type LabelSuggestion = z.infer<typeof LabelsSchema>;

// Convert a natural-language prompt ("rate-limit at 50 req/s, basic auth admin:hunter2")
// into a proposed Traefik label map. The output is reviewed by the user before
// it ever reaches the hardened buildTraefikLabels filter.
export async function suggestLabels(prompt: string, deploymentId: string): Promise<LabelSuggestion> {
  if (!aiEnabled()) throw new Error("AI is not configured");
  const { object } = await generateObject({
    model: getAnthropic(),
    schema: LabelsSchema,
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
  return object;
}
