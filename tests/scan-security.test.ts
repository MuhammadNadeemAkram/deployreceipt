import { describe, it, expect, vi } from "vitest";
import {
  publicUrl,
  assertPublicAddress,
  resolvePublic,
  withPinnedDestination,
  fixtureUrl,
  sanitizeText,
  sanitizeUrl,
} from "../worker/security";
import { matchesChallenge, verifyDomain } from "../worker/verification";
import { internalLinks } from "../worker/engine";
describe("destination policy", () => {
  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://127.1",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://169.254.169.254",
    "http://10.0.0.1",
    "http://100.100.100.200",
    "http://192.168.1.1",
    "http://224.0.0.1",
    "http://192.0.2.1",
    "http://[fd00::1]",
    "http://[fe80::1]",
    "http://[ff02::1]",
    "http://[2001:db8::1]",
    "http://[4000::1]",
    "https://user:pass@example.com",
    "https://example.com:8443/",
    "file:///etc/passwd",
    "ftp://example.com",
    "https://%65xample.com",
    "http://example.com\\@127.0.0.1",
    "https://example.com\n",
  ])("rejects unsafe/ambiguous URL %s", (url) =>
    expect(() => publicUrl(url)).toThrow(),
  );
  it.each([
    "0.0.0.0",
    "127.0.0.2",
    "10.1.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "198.18.0.1",
    "192.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:7f00:1",
    "fc00::1",
    "ff00::1",
  ])("blocks special address %s", (address) =>
    expect(() => assertPublicAddress(address)).toThrow(),
  );
  it("accepts normalized public destinations", () => {
    expect(publicUrl("https://example.com/a#b").href).toBe(
      "https://example.com/a",
    );
    expect(() => assertPublicAddress("8.8.8.8")).not.toThrow();
    expect(() => assertPublicAddress("2606:4700:4700::1111")).not.toThrow();
  });
  it("rejects DNS answers containing even one private address", async () => {
    await expect(
      resolvePublic("https://example.com", async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow("blocked_address");
  });
  it("pins the validated numeric destination without a second DNS resolution", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const connect = vi.fn().mockResolvedValue("connected");
    await withPinnedDestination("https://example.com", resolver, connect);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({
      address: "8.8.8.8",
      family: 4,
      port: 443,
      servername: "example.com",
    });
  });
  it("limits the actual worker to a literal fixture origin", () => {
    expect(fixtureUrl("http://fixture:8080/a").hostname).toBe("fixture");
    for (const url of [
      "http://%66ixture:8080/",
      "https://fixture:8080/",
      "http://fixture:8081/",
      "http://127.0.0.1:8080/",
      "http://fixture:8080/?token=x",
      "http://fixture:8080.evil/",
    ])
      expect(() => fixtureUrl(url)).toThrow();
  });
  it("redacts URL query secrets and common credential patterns", () => {
    expect(sanitizeUrl("https://example.com/a?token=secret#x")).toBe(
      "https://example.com/a",
    );
    const message = sanitizeText(
      "https://example.com/a?token=hidden password=private Bearer abcdef",
    );
    expect(message).not.toContain("hidden");
    expect(message).not.toContain("private");
    expect(message).not.toContain("abcdef");
  });
  it("bounds and deduplicates same-origin links", () => {
    const result = internalLinks(
      [
        "/a",
        "/a#b",
        "https://evil.test/",
        "javascript:alert(1)",
        "/b",
        "/c",
        "/d",
        "/e",
        "/f",
      ],
      "http://fixture:8080/",
      fixtureUrl,
      5,
    );
    expect(result).toHaveLength(5);
    expect(result).toContain("http://fixture:8080/a");
    expect(result.some((url) => url.includes("evil"))).toBe(false);
  });
});
describe("DNS challenge verification", () => {
  const token = "a".repeat(64);
  it("matches chunked TXT records exactly", () => {
    expect(matchesChallenge([["deployreceipt=", token]], token)).toBe(true);
    expect(
      matchesChallenge([["deployreceipt=" + token + "extra"]], token),
    ).toBe(false);
  });
  it("checks only the project domain", async () => {
    const resolve = vi.fn().mockResolvedValue([["deployreceipt=" + token]]);
    expect(
      await verifyDomain("https://example.com/a", token, "disabled", resolve),
    ).toEqual({ verified: true, method: "dns" });
    expect(resolve).toHaveBeenCalledWith("_deployreceipt.example.com");
  });
  it("keeps a wrong token unverified", async () =>
    expect(
      (
        await verifyDomain(
          "https://example.com",
          token,
          "disabled",
          async () => [["wrong"]],
        )
      ).verified,
    ).toBe(false));
  it("has an explicit local-fixture authorization separate from DNS", async () =>
    expect(await verifyDomain("http://fixture:8080/", token, "local")).toEqual({
      verified: true,
      method: "local_fixture",
    }));
  it("cannot authorize a private target through a token match", async () => {
    const resolve = vi.fn();
    await expect(
      verifyDomain("http://169.254.169.254/", token, "disabled", resolve),
    ).rejects.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });
});
