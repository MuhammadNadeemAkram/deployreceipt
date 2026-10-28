import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const query = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  const auth = {
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    verifyOtp: vi.fn(),
    getClaims: vi.fn(),
  };
  return {
    query,
    auth,
    from: vi.fn(),
    createClient: vi.fn(),
    ssr: vi.fn(),
    revalidate: vi.fn(),
    redirect: vi.fn((url: string): never => {
      throw new Error(`REDIRECT:${url}`);
    }),
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.ssr }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { requireUser } from "@/features/auth/session";
import { authenticate, signOut } from "@/features/auth/actions";
import { saveProject, deleteProject } from "@/features/projects/actions";
import { getProject } from "@/features/projects/queries";
import { GET } from "@/app/auth/callback/route";
import { proxy } from "@/proxy";
import { AuthPage } from "@/features/auth/components/auth-page";

const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
const project = () =>
  form({
    name: "Site",
    website_url: "https://example.com",
    description: "A website",
    owner_id: "forged-owner",
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_test-fixture",
  );
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.test");
  mocks.redirect.mockImplementation((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  });
  mocks.auth.getUser.mockResolvedValue({
    data: {
      user: { id: userId, email: "user@example.test", is_anonymous: false },
    },
    error: null,
  });
  mocks.auth.getClaims.mockResolvedValue({
    data: { claims: { sub: userId } },
    error: null,
  });
  mocks.createClient.mockResolvedValue({ auth: mocks.auth, from: mocks.from });
  mocks.ssr.mockReturnValue({ auth: mocks.auth });
  mocks.from.mockReturnValue(mocks.query);
  for (const method of [
    mocks.query.insert,
    mocks.query.update,
    mocks.query.delete,
    mocks.query.eq,
    mocks.query.select,
  ])
    method.mockReturnValue(mocks.query);
  mocks.query.single.mockResolvedValue({
    data: { id: projectId },
    error: null,
  });
});

describe("server authentication and actions", () => {
  it("redirects authenticated visitors away from signup and login", async () => {
    await expect(AuthPage({ mode: "login" })).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
    await expect(AuthPage({ mode: "signup" })).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
  });
  it("rejects unauthorized and anonymous users at the server boundary", async () => {
    mocks.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    await expect(saveProject(null, {}, project())).rejects.toThrow(
      "REDIRECT:/login",
    );
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.auth.getUser.mockResolvedValue({
      data: { user: { id: userId, is_anonymous: true } },
    });
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });
  it("redirects successful login and masks authentication failures", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(
      authenticate(
        "login",
        {},
        form({ email: "a@b.com", password: "existing" }),
      ),
    ).rejects.toThrow("REDIRECT:/dashboard");
    mocks.auth.signInWithPassword.mockResolvedValue({
      error: { message: "private internal error" },
    });
    const state = await authenticate(
      "login",
      {},
      form({ email: "a@b.com", password: "existing" }),
    );
    expect(state.error).toContain("Unable to sign in");
    expect(state.error).not.toContain("private internal");
  });
  it("handles email-confirmation signup without pretending a session exists", async () => {
    mocks.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const result = await authenticate(
      "signup",
      {},
      form({
        email: "a@b.com",
        password: "long-passphrase",
        confirm_password: "long-passphrase",
      }),
    );
    expect(result.success).toContain("Check your email");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.example.test/auth/callback",
        }),
      }),
    );
  });
  it("sends a reset request to the fixed callback and hides account existence", async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    expect(
      (await authenticate("forgot-password", {}, form({ email: "a@b.com" })))
        .success,
    ).toContain("If an account exists");
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith("a@b.com", {
      redirectTo: "https://app.example.test/auth/callback?next=/reset-password",
    });
  });
  it("rejects expired password resets and never updates a password", async () => {
    mocks.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "expired" },
    });
    expect(
      (
        await authenticate(
          "reset-password",
          {},
          form({
            password: "new-passphrase",
            confirm_password: "new-passphrase",
          }),
        )
      ).error,
    ).toContain("expired");
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });
  it("updates a verified user's password and signs out globally", async () => {
    mocks.auth.updateUser.mockResolvedValue({ error: null });
    mocks.auth.signOut.mockResolvedValue({ error: null });
    await expect(
      authenticate(
        "reset-password",
        {},
        form({
          password: "new-passphrase",
          confirm_password: "new-passphrase",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/login?notice=password-updated");
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
  it("signs out through a server action and reports failure", async () => {
    mocks.auth.signOut.mockResolvedValue({ error: { message: "offline" } });
    expect((await signOut()).error).toBeDefined();
    mocks.auth.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow(
      "REDIRECT:/login?notice=signed-out",
    );
  });
});

describe("project mutation boundaries", () => {
  it("creates a project and ignores client-supplied ownership", async () => {
    await expect(saveProject(null, {}, project())).rejects.toThrow(
      "REDIRECT:/dashboard?notice=created",
    );
    expect(mocks.query.insert).toHaveBeenCalledWith({
      name: "Site",
      website_url: "https://example.com/",
      description: "A website",
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard");
  });
  it("validates input before writing", async () => {
    expect(
      (
        await saveProject(
          null,
          {},
          form({ name: "", website_url: "file:///tmp" }),
        )
      ).fieldErrors,
    ).toHaveProperty("website_url");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("edits only a project belonging to the verified user", async () => {
    await expect(saveProject(projectId, {}, project())).rejects.toThrow(
      "REDIRECT:/dashboard?notice=updated",
    );
    expect(mocks.query.eq).toHaveBeenCalledWith("id", projectId);
    expect(mocks.query.eq).toHaveBeenCalledWith("owner_id", userId);
    expect(mocks.query.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ owner_id: expect.anything() }),
    );
  });
  it("reports inaccessible edits without claiming success", async () => {
    mocks.query.single.mockResolvedValue({
      data: null,
      error: { code: "PGRST116" },
    });
    expect((await saveProject(projectId, {}, project())).error).toBeDefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("requires explicit deletion confirmation and enforces ownership", async () => {
    expect(
      (await deleteProject(projectId, {}, new FormData())).error,
    ).toContain("Confirm");
    expect(mocks.query.delete).not.toHaveBeenCalled();
    await expect(
      deleteProject(projectId, {}, form({ confirmation: "delete" })),
    ).rejects.toThrow("REDIRECT:/dashboard?notice=deleted");
    expect(mocks.query.eq).toHaveBeenCalledWith("owner_id", userId);
  });
  it("does not reveal another user's project on detail routes", async () => {
    mocks.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getProject(projectId)).rejects.toThrow("NOT_FOUND");
    expect(mocks.query.eq).toHaveBeenCalledWith("owner_id", userId);
  });
});

describe("callback and session proxy", () => {
  it("redirects dashboard access when configuration is missing without contacting Auth", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const response = await proxy(new NextRequest("https://app.example.test/dashboard"));
    expect(response.headers.get("location")).toBe("https://app.example.test/login");
    expect(mocks.ssr).not.toHaveBeenCalled();
  });
  it("exchanges a PKCE code and prevents open redirects", async () => {
    mocks.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const result = await GET(
      new NextRequest(
        "https://untrusted-host.test/auth/callback?code=test&next=https://evil.test",
      ),
    );
    expect(result.headers.get("location")).toBe(
      "https://app.example.test/dashboard",
    );
    expect(mocks.auth.exchangeCodeForSession).toHaveBeenCalledWith("test");
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it("supports recovery token hashes and invalid/expired codes", async () => {
    mocks.auth.verifyOtp.mockResolvedValue({ error: null });
    const recovery = await GET(
      new NextRequest(
        "https://app.example.test/auth/callback?token_hash=test&type=recovery",
      ),
    );
    expect(recovery.headers.get("location")).toBe(
      "https://app.example.test/reset-password",
    );
    mocks.auth.exchangeCodeForSession.mockResolvedValue({
      error: { message: "expired" },
    });
    const expired = await GET(
      new NextRequest("https://app.example.test/auth/callback?code=expired"),
    );
    expect(expired.headers.get("location")).toContain(
      "/login?notice=invalid-link",
    );
  });
  it("does not exchange a code when the provider reports failure", async () => {
    const result = await GET(
      new NextRequest(
        "https://app.example.test/auth/callback?code=test&error=access_denied",
      ),
    );
    expect(result.headers.get("location")).toContain("invalid-link");
    expect(mocks.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("redirects unauthorized dashboard requests", async () => {
    mocks.auth.getClaims.mockResolvedValue({
      data: null,
      error: { message: "expired" },
    });
    const response = await proxy(
      new NextRequest("https://app.example.test/dashboard/projects/new"),
    );
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/login?notice=session-expired",
    );
  });
  it("preserves refreshed cookies when creating the proxy redirect", async () => {
    const request = new NextRequest("https://app.example.test/dashboard");
    mocks.ssr.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([
        { name: "refreshed", value: "test", options: { httpOnly: true } },
      ]);
      return { auth: mocks.auth };
    });
    mocks.auth.getClaims.mockResolvedValue({
      data: null,
      error: { message: "expired" },
    });
    const response = await proxy(request);
    expect(response.cookies.get("refreshed")?.value).toBe("test");
    expect(request.cookies.get("refreshed")?.value).toBe("test");
  });
});
