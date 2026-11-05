import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "256kb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  serverExternalPackages: ["pdf-lib", "@pdf-lib/fontkit"],
  outputFileTracingIncludes: {
    "/api/reports/*/pdf": [
      "./server/**/*.mjs",
      "./assets/fonts/*",
      "./node_modules/pdf-lib/**/*",
      "./node_modules/@pdf-lib/**/*",
      "./node_modules/pako/**/*",
      "./node_modules/tslib/**/*",
    ],
  },
};
export default nextConfig;
