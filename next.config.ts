import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
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
