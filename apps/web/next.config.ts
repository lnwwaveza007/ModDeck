import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production image (docker/web.Dockerfile).
  output: "standalone",
  // In production nginx sends /api/* to the api. In dev, Next does it, so the
  // SSO callback and host cookie stay on the web origin (APP_BASE_URL).
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

export default withNextIntl(nextConfig);
