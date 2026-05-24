import { aiEnabled, suggestDockerfile, suggestLabels } from "@mini-dokploy/ai";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { orgScopedProcedure, publicProcedure, router } from "../index";

function requireAi() {
  if (!aiEnabled()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI not configured" });
  }
}

export const aiRouter = router({
  available: publicProcedure.query(() => ({ available: aiEnabled() })),

  suggestDockerfile: orgScopedProcedure
    .input(z.object({ repoUrl: z.string().url(), branch: z.string().optional() }))
    .mutation(async ({ input }) => {
      requireAi();
      return suggestDockerfile(input.repoUrl, input.branch);
    }),

  suggestLabels: orgScopedProcedure
    .input(z.object({ deploymentId: z.string(), prompt: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      requireAi();
      return suggestLabels(input.prompt, input.deploymentId);
    }),
});
