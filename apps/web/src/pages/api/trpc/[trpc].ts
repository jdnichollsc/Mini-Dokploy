import { createContext } from "@mini-dokploy/api/context";
import { appRouter } from "@mini-dokploy/api/routers/index";
import { createNextApiHandler } from "@trpc/server/adapters/next";

export default createNextApiHandler({
  router: appRouter,
  createContext,
  onError({ error, path }) {
    if (error.code === "INTERNAL_SERVER_ERROR") {
      console.error(`[trpc] ${path ?? "<no path>"}:`, error);
    }
  },
});
