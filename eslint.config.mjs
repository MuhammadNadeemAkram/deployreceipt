import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  { files: ["tests/integration/**/*.mjs"], rules: { "no-undef": "error" } },
  globalIgnores([".next/**", "out/**", "dist/**", "next-env.d.ts"]),
]);
