import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

// Tenant-scoped procedure: requires an active organization. Every deployment
// query/mutation must inherit from this so cross-tenant data never leaks.
export const orgScopedProcedure = protectedProcedure.use(({ ctx, next }) => {
  const activeOrgId = ctx.session.session.activeOrganizationId;
  if (!activeOrgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Select an organization first",
    });
  }
  return next({
    ctx: {
      ...ctx,
      organizationId: activeOrgId,
    },
  });
});
