import { describe, it, expect } from "vitest";
import {
  reviewInput,
  commentInput,
  decisionInput,
  hasControls,
} from "@/features/releases/validation";
const id = "11111111-1111-4111-8111-111111111111";
function form(values: Record<string, string | undefined>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) if (v !== undefined) f.set(k, v);
  return f;
}
describe("release review validation", () => {
  it("accepts a bounded named version and normalizes invited email", () => {
    expect(
      reviewInput(
        form({
          report: id,
          title: " v1 ",
          email: " Client@Example.test ",
          notes: "<script>literal text</script>",
        }),
      ),
    ).toMatchObject({
      title: "v1",
      email: "client@example.test",
      previous: null,
    });
  });
  it.each([
    { report: "bad" },
    { title: "" },
    { title: "a".repeat(121) },
    { email: "bad" },
    { notes: "a".repeat(4001) },
    { previous: "https://evil.test" },
    { notes: "\u0000" },
  ])("rejects invalid review fields %o", (invalid) => {
    expect(
      reviewInput(
        form({
          report: id,
          title: "v1",
          email: "client@example.test",
          notes: "",
          ...invalid,
        }),
      ),
    ).toBeNull();
  });
  it("validates comment references and preserves plain text safely for React rendering", () => {
    expect(
      commentInput(form({ content: " <img src=x> ", finding: id })),
    ).toMatchObject({ content: "<img src=x>", finding: id });
  });
  it.each([
    { content: "" },
    { content: "x".repeat(2001) },
    { content: "\u0000" },
    { finding: "foreign" },
    { parent: "https://evil" },
    { kind: "approve" },
  ])("rejects malformed feedback %o", (invalid) => {
    expect(commentInput(form({ content: "Valid", ...invalid }))).toBeNull();
  });
  const approval = {
    decision: "approved",
    digest: "a".repeat(64),
    version: "2",
    notes: "",
    scope_ack: "on",
    observations_ack: "on",
    evidence_ack: "on",
  };
  it("binds an explicit approval to its version and digest", () => {
    expect(decisionInput(form(approval))).toMatchObject({
      decision: "approved",
      version: 2,
      scope: true,
      observations: true,
      evidence: true,
    });
  });
  it.each(["scope_ack", "observations_ack", "evidence_ack"])(
    "requires %s",
    (key) => {
      expect(decisionInput(form({ ...approval, [key]: "" }))).toBeNull();
    },
  );
  it.each([
    { version: "0" },
    { version: "1.5" },
    { digest: "bad" },
    { decision: "deployed" },
    { notes: "x".repeat(2001) },
  ])("rejects manipulated decision %o", (invalid) => {
    expect(decisionInput(form({ ...approval, ...invalid }))).toBeNull();
  });
  it("requires feedback for changes and accepts a general review message", () => {
    expect(
      decisionInput(
        form({ ...approval, decision: "changes_requested", notes: "" }),
      ),
    ).toBeNull();
    expect(
      decisionInput(
        form({
          ...approval,
          decision: "changes_requested",
          notes: "Fix navigation",
          scope_ack: "",
        }),
      ),
    ).toMatchObject({ notes: "Fix navigation", scope: false });
  });
  it("rejects control characters", () =>
    expect(hasControls("text\u0007")).toBe(true));
});
