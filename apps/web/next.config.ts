import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  agentRules: false,
  async redirects() {
    return [{ source: "/app", destination: "/sentinel", permanent: false }];
  },
};

export default nextConfig;
