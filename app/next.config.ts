import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@clutch/shared"],
  async rewrites() {
    const engineUrl = (process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:8787").replace(/\/+$/, "");
    // Keep HTTP requests same-origin on custom domains and Vercel deployments.
    return [{ source: "/api/engine/:path*", destination: `${engineUrl}/:path*` }];
  },
  async redirects() {
    return [
      { source: "/s/:slug", destination: "/c/:slug", permanent: true },
      { source: "/receipt/:id", destination: "/m/:id", permanent: true },
    ];
  },
};

export default nextConfig;
