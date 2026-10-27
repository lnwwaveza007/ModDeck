import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin(); // keep whatever arguments you already have

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:4000/:path*" }];
  },
};

export default withNextIntl(nextConfig);
