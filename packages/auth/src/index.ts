import { createDb } from "@mini-dokploy/db";
import * as schema from "@mini-dokploy/db/schema";
import { env } from "@mini-dokploy/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        organizationLimit: 10,
        membershipLimit: 50,
        creatorRole: "owner",
      }),
      // nextCookies must be the LAST plugin so it can wrap responses with
      // Set-Cookie headers consistently across all auth endpoints.
      nextCookies(),
    ],
  });
}

export const auth = createAuth();
export type Auth = typeof auth;
