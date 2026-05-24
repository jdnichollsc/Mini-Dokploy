import { auth } from "@mini-dokploy/auth";
import type { CreateNextContextOptions } from "@trpc/server/adapters/next";

export async function createContext({ req }: CreateNextContextOptions) {
  // BetterAuth's `getSession` expects a Fetch-style Headers object. The Pages
  // Router provides a Node IncomingMessage with a plain header bag, so adapt
  // it here.
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const session = await auth.api.getSession({ headers });

  return {
    auth,
    session,
    req,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
