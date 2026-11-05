import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@clutch/shared"],
  async redirects() {
    return [
      { source: "/s/:slug", destination: "/c/:slug", permanent: true },
      { source: "/receipt/:id", destination: "/m/:id", permanent: true },
    ];
  },
};

export default nextConfig;
