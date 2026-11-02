import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  storage: vi.fn(),
  sign: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error("REDIRECT:" + url);
  }),
}));
vi.mock("@/features/auth/session", () => ({ requireUser: m.requireUser }));
vi.mock("next/navigation", () => ({
  redirect: m.redirect,
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { requestScan, requestVerification } from "@/features/scans/actions";
import { ownedScan } from "@/features/scans/queries";
import { GET } from "@/app/api/scans/[id]/artifacts/[checkId]/route";
const id = "11111111-1111-4111-8111-111111111111",
  checkId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.resetAllMocks();
  m.redirect.mockImplementation((url: string): never => {
    throw new Error("REDIRECT:" + url);
  });
  const query = { select: m.select, eq: m.eq, maybeSingle: m.single };
  m.from.mockReturnValue(query);
  m.select.mockReturnValue(query);
  m.eq.mockReturnValue(query);
  m.requireUser.mockResolvedValue({
    client: { from: m.from, rpc: m.rpc, storage: { from: m.storage } },
    user: { id: "owner" },
  });
  m.single.mockResolvedValue({ data: { id }, error: null });
  m.storage.mockReturnValue({ createSignedUrl: m.sign });
  m.sign.mockResolvedValue({
    data: { signedUrl: "https://storage.example.test/signed" },
    error: null,
  });
});
it("derives scan target from the database RPC, never from submitted URL parameters", async () => {
  m.rpc.mockResolvedValue({ data: id, error: null });
  await expect(
    requestScan(id, { error: "https://attacker.test" }),
  ).rejects.toThrow("REDIRECT:/dashboard/scans/" + id);
  expect(m.rpc).toHaveBeenCalledWith("request_scan", { p_project_id: id });
  expect(m.eq).toHaveBeenCalledWith("owner_id", "owner");
});
it("rejects unauthorized requests before enqueueing", async () => {
  m.requireUser.mockRejectedValue(new Error("REDIRECT:/login"));
  await expect(requestScan(id, {})).rejects.toThrow("/login");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects cross-user scan requests", async () => {
  m.single.mockResolvedValue({ data: null, error: null });
  expect((await requestScan(id, {})).error).toBe("Project not found.");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("explains quotas and disabled mode without raw database errors", async () => {
  m.rpc.mockResolvedValue({
    data: null,
    error: { message: "daily_allowance" },
  });
  expect((await requestScan(id, {})).error).toContain("daily");
  m.rpc.mockResolvedValue({
    data: null,
    error: { message: "private SQL details" },
  });
  expect((await requestScan(id, {})).error).not.toContain("SQL");
});
it("queues challenge checks without a client-controlled verification outcome", async () => {
  m.rpc.mockResolvedValue({ error: null });
  expect((await requestVerification(id, {})).success).toContain("queued");
  expect(m.rpc).toHaveBeenCalledWith("request_domain_verification", {
    p_project_id: id,
  });
});
it("does not reveal scans when RLS returns no record", async () => {
  m.single.mockResolvedValue({ data: null, error: null });
  await expect(ownedScan(id)).rejects.toThrow("NOT_FOUND");
});
it("refuses screenshot access for a different user before signing", async () => {
  m.single
    .mockResolvedValueOnce({ data: { id, project_id: id }, error: null })
    .mockResolvedValueOnce({ data: null, error: null });
  await expect(
    GET(new Request("https://app.test"), {
      params: Promise.resolve({ id, checkId }),
    }),
  ).rejects.toThrow("NOT_FOUND");
  expect(m.sign).not.toHaveBeenCalled();
});
it("signs only the stored artifact of an owned scan for 60 seconds", async () => {
  m.single
    .mockResolvedValueOnce({ data: { id, project_id: id }, error: null })
    .mockResolvedValueOnce({ data: { id }, error: null })
    .mockResolvedValueOnce({
      data: { screenshot_path: id + "/1/desktop.png" },
      error: null,
    });
  const response = await GET(new Request("https://app.test"), {
    params: Promise.resolve({ id, checkId }),
  });
  expect(m.sign).toHaveBeenCalledWith(id + "/1/desktop.png", 60);
  expect(response.status).toBe(303);
  expect(response.headers.get("cache-control")).toContain("no-store");
});
