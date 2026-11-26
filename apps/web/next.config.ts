import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  agentRules: false,
  // The local RPC URL is given to the bundle only by a local-target build, from here (this file is build
  // configuration and is not bundled). A testnet build, such as the hosted app, therefore contains no loopback
  // address at all, not even in dead code.
  env: {
    // "1" only for a test build against a private fork of chain 1952 (see IS_PRIVATE_FORK in src/lib/chains.ts).
    NEXT_PUBLIC_PERIDOT_FORK: process.env.NEXT_PUBLIC_PERIDOT_FORK === "1" && process.env.NEXT_PUBLIC_PERIDOT_TARGET !== "local" ? "1" : "",
    NEXT_PUBLIC_LOCAL_RPC_URL: process.env.NEXT_PUBLIC_PERIDOT_TARGET === "local" ? process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:18545" : "",
  },
  async redirects() {
    // Strategy-first navigation (DECISIONS D23). The old URLs keep working: each source is an exact path (so
    // /sentinel/policy is untouched), and the query string is carried over (?market=...).
    return [
      { source: "/app", destination: "/portfolio", permanent: false },
      { source: "/sentinel", destination: "/portfolio", permanent: false },
      { source: "/sentinel/activity", destination: "/activity", permanent: false },
      { source: "/automate", destination: "/strategies", permanent: false },
    ];
  },
};

export default nextConfig;
