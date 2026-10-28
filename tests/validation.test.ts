import { describe, expect, it, afterEach, vi } from "vitest";
import {
  validateAuth,
  callbackDestination,
  authDestination,
} from "@/features/auth/validation";
import { validateProject, isProjectId } from "@/features/projects/validation";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
afterEach(() => vi.unstubAllEnvs());
describe("authentication validation", () => {
  it("validates and normalizes signup fields", () => {
    const result = validateAuth(
      "signup",
      form({
        email: " User@Example.com ",
        password: "a-long-passphrase",
        confirm_password: "a-long-passphrase",
        full_name: " Jane ",
      }),
    );
    expect(result.errors).toEqual({});
    expect(result.email).toBe("user@example.com");
    expect(result.fullName).toBe("Jane");
  });
  it("rejects malformed email, weak password, mismatch and long names", () => {
    expect(
      Object.keys(
        validateAuth(
          "signup",
          form({
            email: "invalid",
            password: "short",
            confirm_password: "different",
            full_name: "a".repeat(121),
          }),
        ).errors,
      ),
    ).toEqual(["email", "password", "confirm_password", "full_name"]);
  });
  it("allows existing short passwords for login but requires strong new passwords", () => {
    expect(
      validateAuth("login", form({ email: "a@b.com", password: "old" })).errors,
    ).toEqual({});
    expect(
      validateAuth(
        "reset-password",
        form({ password: "old", confirm_password: "old" }),
      ).errors.password,
    ).toBeDefined();
  });
  it("rejects files in place of text fields", () => {
    const data = form({ password: "a-long-passphrase" });
    data.set("email", new Blob(["a@b.com"]));
    expect(validateAuth("login", data).errors.email).toBeDefined();
  });
});
describe("project validation", () => {
  it.each([
    "https://example.com",
    "http://localhost:8080/a?b=c",
    "https://[::1]/",
  ])("accepts HTTP(S) URL %s without making requests", (website_url) => {
    const result = validateProject(form({ name: " Site ", website_url }));
    expect(result.errors).toEqual({});
    expect(result.values.name).toBe("Site");
    expect(result.values.description).toBeNull();
  });
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.com",
    "example.com",
    "https://user:pass@example.com",
    "",
  ])("rejects unsafe or incomplete URL %s", (website_url) => {
    expect(
      validateProject(form({ name: "Site", website_url })).errors.website_url,
    ).toBeDefined();
  });
  it("rejects empty and oversized content", () => {
    const result = validateProject(
      form({
        name: " ",
        website_url: "https://example.com/" + "a".repeat(2048),
        description: "a".repeat(2001),
      }),
    );
    expect(Object.keys(result.errors)).toHaveLength(3);
  });
  it("validates project IDs", () => {
    expect(isProjectId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isProjectId("../new")).toBe(false);
  });
});
describe("redirects and environment", () => {
  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/reset-password?next=evil",
    null,
  ])("does not allow arbitrary callback destination %s", (value) =>
    expect(callbackDestination(value)).toBe("/dashboard"),
  );
  it("allows only the fixed reset destination", () =>
    expect(callbackDestination("/reset-password")).toBe("/reset-password"));
  it("matches dashboard boundaries", () => {
    expect(authDestination("/dashboard")).toBe(true);
    expect(authDestination("/dashboard/projects/new")).toBe(true);
    expect(authDestination("/dashboard-elsewhere")).toBe(false);
  });
  it("fails safely without credentials and rejects secret keys", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(getSupabaseConfig()).toBeNull();
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_secret_never-use-this",
    );
    expect(getSupabaseConfig()).toBeNull();
  });
  it("uses a configured origin and rejects paths or credentials", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
    expect(getSiteOrigin()).toBe("https://app.example.com");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com/other");
    expect(getSiteOrigin).toThrow();
  });
});
