import type { AppRouter } from "@mini-dokploy/api/routers/index";
import { createTRPCReact } from "@trpc/react-query";

export const trpc = createTRPCReact<AppRouter>();
