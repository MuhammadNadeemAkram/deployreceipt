import { it, expect, beforeEach, vi } from "vitest";
import type { ReleaseReview } from "@/features/releases/types";
const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rpc: vi.fn(),
  download: vi.fn(),
  rows: {} as Record<string, unknown>,
  user: {} as { id: string; email: string; email_confirmed_at?: string },
  access: true,
}));
vi.mock("@/features/auth/session", () => ({ requireUser: m.requireUser }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error("REDIRECT:" + path);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { loadReview } from "@/features/releases/queries";
import {
  createRelease,
  acceptInvitation,
  manageRelease,
  postReviewComment,
  decideRelease,
  resolveFeedback,
} from "@/features/releases/actions";
import { GET } from "@/app/api/reviews/[id]/evidence/[checkId]/route";
import { GET as reviewGet } from "@/app/api/reviews/[id]/route";
const id = "11111111-1111-4111-8111-111111111111",
  check = "22222222-2222-4222-8222-222222222222",
  future = "2099-01-01T00:00:00Z";
function form(v: Record<string, string>) {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.access = true;
  m.user = {
    id: "reviewer",
    email: "client@example.test",
    email_confirmed_at: "2026-01-01",
  };
  m.rows = {
    release_reviews: {
      id,
      owner_id: "owner",
      status: "pending_review",
      expires_at: future,
      scan_run_id: id,
      version: 1,
      snapshot_digest: "a".repeat(64),
      snapshot: { scan_date: new Date().toISOString() },
    } as ReleaseReview,
    review_invitations: [
      {
        id: check,
        review_id: id,
        status: "accepted",
        reviewer_user_id: "reviewer",
        invited_email: "client@example.test",
        expires_at: future,
      },
    ],
    review_comments: [],
    review_decisions: [],
    review_events: [],
    release_review_evidence: [
      {
        review_id: id,
        check_id: check,
        path: id + "/1/desktop.png",
        kind: "desktop",
        expires_at: future,
      },
    ],
    scan_settings: { retention_days: 7 },
  };
  const from = (table: string) => {
    const result = () => ({ data: m.rows[table] ?? null, error: null });
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      maybeSingle: async () => result(),
      single: async () => result(),
      then: (resolve: (v: ReturnType<typeof result>) => unknown) =>
        Promise.resolve(result()).then(resolve),
    };
    return q;
  };
  m.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "can_read_release_artifact"
        ? m.access
        : ["create_release_review", "accept_review_invitation"].includes(name)
          ? id
          : null,
    error: null,
  }));
  m.download.mockResolvedValue({
    data: new Blob(["PNG"], { type: "image/png" }),
    error: null,
  });
  m.requireUser.mockImplementation(async () => ({
    user: m.user,
    client: {
      from,
      rpc: m.rpc,
      storage: { from: () => ({ download: m.download }) },
    },
  }));
});
it("requires a verified current account at the server", async () => {
  m.user.email_confirmed_at = undefined;
  await expect(loadReview(id)).rejects.toThrow("NOT_FOUND");
});
it("independently rejects mismatched reviewer email", async () => {
  m.user.email = "wrong@example.test";
  await expect(loadReview(id)).rejects.toThrow("NOT_FOUND");
});
it("rejects a different authenticated reviewer ID", async () => {
  m.user.id = "other";
  await expect(loadReview(id)).rejects.toThrow("NOT_FOUND");
});
it("rejects revoked invitations", async () => {
  (m.rows.review_invitations as { status: string }[])[0].status = "revoked";
  await expect(loadReview(id)).rejects.toThrow("NOT_FOUND");
});
it("rejects expired review access", async () => {
  (m.rows.release_reviews as ReleaseReview).expires_at = "2000-01-01";
  await expect(loadReview(id)).rejects.toThrow("NOT_FOUND");
});
it("rejects owner-only pages for clients", async () => {
  await expect(loadReview(id, true)).rejects.toThrow("NOT_FOUND");
});
it("allows owner historical access after revocation", async () => {
  m.user.id = "owner";
  (m.rows.release_reviews as ReleaseReview).status = "revoked";
  expect((await loadReview(id, true)).review.id).toBe(id);
});
it("returns not found for deleted projects/reviews", async () => {
  m.rows.release_reviews = null;
  await expect(loadReview(id)).rejects.toThrow("NOT_FOUND");
});
it("bounds displayed evidence by current retention", async () => {
  const data = await loadReview(id);
  expect(Date.parse(data.evidence[0].expires_at)).toBeLessThan(
    Date.parse(future),
  );
});
const context = () => ({ params: Promise.resolve({ id, checkId: check }) });
it("streams private bytes with no-store and no signed redirect", async () => {
  const response = await GET(new Request("https://example.test"), context());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("location")).toBeNull();
  expect(m.download).toHaveBeenCalledTimes(1);
  expect(m.rpc).toHaveBeenCalledWith("can_read_release_artifact", {
    p_review: id,
    p_check: check,
  });
});
it("never fetches a supplied external artifact path", async () => {
  (m.rows.release_review_evidence as { path: string }[])[0].path =
    "http://169.254.169.254/private";
  expect(
    (await GET(new Request("https://example.test"), context())).status,
  ).toBe(404);
  expect(m.download).not.toHaveBeenCalled();
});
it("denies expired evidence before downloading", async () => {
  (m.rows.release_review_evidence as { expires_at: string }[])[0].expires_at =
    "2000-01-01";
  expect(
    (await GET(new Request("https://example.test"), context())).status,
  ).toBe(404);
  expect(m.download).not.toHaveBeenCalled();
});
it("handles missing private files", async () => {
  m.download.mockResolvedValue({ data: null, error: { statusCode: 404 } });
  expect(
    (await GET(new Request("https://example.test"), context())).status,
  ).toBe(404);
});
it("rechecks access after download if invitation is revoked", async () => {
  m.download.mockImplementation(async () => {
    m.access = false;
    return { data: new Blob(["PNG"]), error: null };
  });
  expect(
    (await GET(new Request("https://example.test"), context())).status,
  ).toBe(404);
});
it("creates via narrow scoped RPC without a supplied owner or snapshot", async () => {
  await expect(
    createRelease(
      {},
      form({
        report: id,
        title: "Release",
        email: "client@example.test",
        notes: "",
      }),
    ),
  ).rejects.toThrow("REDIRECT:/dashboard/releases/" + id);
  expect(m.rpc).toHaveBeenCalledWith("create_release_review", {
    p_report: id,
    p_title: "Release",
    p_notes: "",
    p_email: "client@example.test",
    p_previous: null,
  });
});
it("acceptance redirects only to a fixed internal review route", async () => {
  await expect(acceptInvitation(id, {})).rejects.toThrow(
    "REDIRECT:/reviews/" + id,
  );
});
it("rejects arbitrary state manipulation before RPC", async () => {
  expect(
    (await manageRelease(id, {}, form({ action: "approved" }))).error,
  ).toBeDefined();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("validates feedback before RPC", async () => {
  expect(
    (
      await postReviewComment(
        id,
        {},
        form({ content: "", author_id: "forged" }),
      )
    ).error,
  ).toBeDefined();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("requires explicit decision acknowledgements server-side", async () => {
  expect(
    (
      await decideRelease(
        id,
        {},
        form({ decision: "approved", version: "1", digest: "a".repeat(64) }),
      )
    ).error,
  ).toBeDefined();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects forged resolution parameters", async () => {
  expect(
    (
      await resolveFeedback(
        id,
        {},
        form({ comment: check, resolved: "approved" }),
      )
    ).error,
  ).toBeDefined();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("does not expose raw database errors", async () => {
  m.rpc.mockResolvedValue({
    data: null,
    error: { message: "secret SQL internals" },
  });
  const result = await manageRelease(id, {}, form({ action: "submit" }));
  expect(JSON.stringify(result)).not.toContain("internals");
});

it("returns only authorized review content with private JSON headers", async () => {
  const response = await reviewGet(new Request("https://example.test"), {
    params: Promise.resolve({ id }),
  });
  expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.json();
  expect(body.review.id).toBe(id);
  expect(body.client).toBeUndefined();
  expect(body.user).toBeUndefined();
  expect(body.invitations).toBeUndefined();
  expect(body.events).toBeUndefined();
  expect(body.evidence[0].path).toBeUndefined();
});
