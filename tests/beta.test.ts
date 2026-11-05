import { describe, it, expect, vi, afterEach } from "vitest";
import { validateEnvironment } from "../server/environment.mjs";
import { operationalLog } from "@/lib/operations/log";
const staging = {
  APP_ENV: "staging",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  NEXT_PUBLIC_SITE_URL: "https://beta.example.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://staging-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  STAGING_SUPABASE_PROJECT_REF: "staging-ref",
  PRODUCTION_SUPABASE_PROJECT_REF: "production-ref",
};
afterEach(() => vi.unstubAllEnvs());
describe("deployment boundaries", () => {
  it("validates separated staging configuration", () =>
    expect(validateEnvironment(staging)).toMatchObject({
      environment: "staging",
      hosted: true,
      scanning: false,
    }));
  it.each([
    { APP_ENV: "local" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://production-ref.supabase.co" },
    { PRODUCTION_SUPABASE_PROJECT_REF: "staging-ref" },
    { NEXT_PUBLIC_SITE_URL: "http://beta.example.test" },
    {
      NEXT_PUBLIC_SUPABASE_URL:
        "https://secret:password@staging-ref.supabase.co",
    },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_never-log" },
    { SCANNING_AVAILABLE: "public" },
    { STAGING_SUPABASE_PROJECT_REF: "" },
  ])("rejects unsafe preview configuration %o", (patch) =>
    expect(() => validateEnvironment({ ...staging, ...patch })).toThrow(),
  );
  it("blocks production activation unless explicitly approved", () => {
    expect(() =>
      validateEnvironment({
        ...staging,
        APP_ENV: "production",
        VERCEL_ENV: "production",
      }),
    ).toThrow("production_not_activated");
  });
  it("allows an unconfigured local public landing page", () =>
    expect(validateEnvironment({})).toMatchObject({
      configured: false,
      hosted: false,
    }));
  it("logs only an allowlisted operational envelope", () => {
    vi.stubEnv("OPERATIONAL_LOGS", "enabled");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    operationalLog("dependency_request", {
      code: "unavailable",
      duration_ms: 12,
      ...{ secret: "do-not-log", request_id: "token=secret" },
    });
    const output = String(log.mock.calls[0][0]);
    expect(output).not.toContain("do-not-log");
    expect(output).not.toContain("token=");
    expect(JSON.parse(output).code).toBe("unavailable");
    log.mockRestore();
  });
});
