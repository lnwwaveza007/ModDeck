import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production image (docker/web.Dockerfile).
  output: "standalone",
};

export default nextConfig;
