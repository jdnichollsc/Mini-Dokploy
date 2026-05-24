import { protectedProcedure, publicProcedure, router } from "../index";

import { aiRouter } from "./ai";
import { deploymentsRouter } from "./deployments";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => "OK"),

  me: protectedProcedure.query(({ ctx }) => ({
    user: ctx.session.user,
    activeOrganizationId: ctx.session.session.activeOrganizationId ?? null,
  })),

  deployments: deploymentsRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;
