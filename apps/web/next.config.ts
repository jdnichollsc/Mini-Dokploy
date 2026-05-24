import "@mini-dokploy/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Pages Router does not support typedRoutes (App-Router-only flag).
  // reactCompiler stays opt-in via babel plugin (already in deps); leaving it
  // off the config keeps the migration low-risk.
};

export default nextConfig;
