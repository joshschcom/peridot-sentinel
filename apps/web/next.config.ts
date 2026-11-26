import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  agentRules: false,
  // The local RPC URL is given to the bundle only by a local-target build, from here (this file is build
  // configuration and is not bundled). A testnet build, such as the hosted app, therefore contains no loopback
  // address at all, not even in dead code.
  env: { NEXT_PUBLIC_LOCAL_RPC_URL: process.env.NEXT_PUBLIC_PERIDOT_TARGET === "local" ? process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:18545" : "" },
  async redirects() {
    return [{ source: "/app", destination: "/sentinel", permanent: false }];
  },
};

export default nextConfig;
