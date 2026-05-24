import { auth } from "@mini-dokploy/auth";
import { toNodeHandler } from "better-auth/node";
import type { NextApiRequest, NextApiResponse } from "next";

// BetterAuth needs the raw Node request/response stream. Disable Next's
// built-in body parser so we don't consume the request body before BetterAuth
// can see it.
export const config = {
  api: {
    bodyParser: false,
  },
};

const handler = toNodeHandler(auth);

export default function handle(req: NextApiRequest, res: NextApiResponse) {
  return handler(req, res);
}
