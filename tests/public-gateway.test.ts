import { EgressBudget } from "../worker/gateway/budget";
import { describe, it, expect, vi } from "vitest";
import { FetchScope, type WireRequest } from "../worker/gateway/fetch";
import {
  destination,
  validateAnswers,
  publicOrigin,
} from "../worker/gateway/policy";
const origin = "https://owned.qa-fixture.net";
const safe = [{ address: "93.184.215.14", family: 4 }];
const success = async (input: WireRequest) => {
  input.consume(2);
  return {
    status: 200,
    headers: { "content-type": "text/plain" },
    bytes: Buffer.from("ok"),
  };
};
describe("public gateway destination policy", () => {
  it.each([
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:8.8.8.8]/",
    "http://[fe80::1%25eth0]/",
    "http://localhost/",
    "http://host.local/",
    "http://user:password@owned.qa-fixture.net/",
    "https://owned.qa-fixture.net:444/",
    "file:///etc/passwd",
    "https://owned.qa-fixture.net\\@127.0.0.1/",
    "http://%31%32%37.0.0.1/",
  ])("rejects ambiguous/unsafe destination %s", (value) =>
    expect(() => publicOrigin(value)).toThrow(),
  );
  it.each(["POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE", "OPTIONS"])(
    "denies method %s",
    (method) =>
      expect(() => destination(origin, origin, method)).toThrow(
        "method_blocked",
      ),
  );
  it("binds the exact origin, including sibling host, scheme and port", () => {
    for (const value of [
      "https://sibling.qa-fixture.net/",
      "http://owned.qa-fixture.net/",
      "https://owned.qa-fixture.net:8443/",
    ])
      expect(() => destination(value, origin, "GET")).toThrow();
  });
  it.each([
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "100.64.0.1",
    "192.0.0.8",
    "198.18.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:93.184.215.14",
  ])("rejects a mixed DNS answer containing %s", (address) =>
    expect(() =>
      validateAnswers([
        ...safe,
        { address, family: address.includes(":") ? 6 : 4 },
      ]),
    ).toThrow(),
  );
  it("fails closed for empty/mismatched/IPv6-only answers", () => {
    expect(() => validateAnswers([])).toThrow();
    expect(() =>
      validateAnswers([{ address: "127.0.0.1", family: 6 }]),
    ).toThrow();
    expect(() =>
      validateAnswers([{ address: "2606:4700:4700::1111", family: 6 }]),
    ).toThrow("ipv6_transport_unavailable");
  });
});
describe("bounded pinned fetch scope", () => {
  it("connects using the validated numeric address and preserves URL hostname", async () => {
    const connect = vi.fn(success),
      resolve = vi.fn(async () => safe);
    const scope = new FetchScope(
      origin,
      { requests: 5, seconds: 10 },
      resolve,
      connect,
    );
    const result = await scope.fetch(origin + "/", "GET");
    expect(result.status).toBe(200);
    expect(connect.mock.calls[0][0]).toMatchObject({
      address: safe[0].address,
      family: 4,
      method: "GET",
    });
    expect(connect.mock.calls[0][0].url.hostname).toBe("owned.qa-fixture.net");
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it("revalidates new connections and denies rebinding before connecting", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(safe)
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const connect = vi.fn(success);
    const scope = new FetchScope(
      origin,
      { requests: 5, seconds: 10 },
      resolve,
      connect,
    );
    await scope.fetch(origin, "GET");
    await expect(scope.fetch(origin, "GET")).rejects.toThrow();
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it("does not connect on DNS failures or mixed answers", async () => {
    const connect = vi.fn(success);
    for (const resolve of [
      async () => {
        throw Error("dns unavailable");
      },
      async () => [...safe, { address: "10.0.0.1", family: 4 }],
    ]) {
      const scope = new FetchScope(
        origin,
        { requests: 5, seconds: 10 },
        resolve,
        connect,
      );
      await expect(scope.fetch(origin, "GET")).rejects.toThrow();
    }
    expect(connect).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and public-to-private redirects without following them", async () => {
    for (const location of [
      "http://169.254.169.254/",
      "https://sibling.qa-fixture.net/",
      "file:///etc/passwd",
    ]) {
      const connect = vi.fn(async () => ({
        status: 302,
        headers: { location },
        bytes: Buffer.alloc(0),
      }));
      const scope = new FetchScope(
        origin,
        { requests: 5, seconds: 10 },
        async () => safe,
        connect,
      );
      await expect(scope.fetch(origin, "GET")).rejects.toThrow();
      expect(connect).toHaveBeenCalledTimes(1);
    }
  });
  it("bounds requests, response bytes, totals and expiry", async () => {
    const scope = new FetchScope(
      origin,
      { requests: 1, seconds: 10 },
      async () => safe,
      success,
    );
    await scope.fetch(origin, "GET");
    await expect(scope.fetch(origin, "GET")).rejects.toThrow("request_limit");
    scope.close();
    await expect(scope.fetch(origin, "GET")).rejects.toThrow("scope_expired");
    const huge = new FetchScope(
      origin,
      { requests: 10, seconds: 10 },
      async () => safe,
      async () => ({ status: 200, headers: {}, bytes: Buffer.alloc(2097153) }),
    );
    await expect(huge.fetch(origin, "GET")).rejects.toThrow("response_limit");
    const total = new FetchScope(
      origin,
      { requests: 10, seconds: 10 },
      async () => safe,
      async (input) => {
        input.consume(2097152);
        return { status: 200, headers: {}, bytes: Buffer.alloc(2097152) };
      },
    );
    for (let i = 0; i < 8; i++) await total.fetch(origin, "GET");
    await expect(total.fetch(origin, "GET")).rejects.toThrow(
      "total_byte_limit",
    );
  });
  it("rejects concurrent resource storms and aborts active requests on close", async () => {
    const connect = async (input: WireRequest) =>
      new Promise<never>((_resolve, reject) =>
        input.signal.addEventListener("abort", () => reject(Error("aborted")), {
          once: true,
        }),
      );
    const scope = new FetchScope(
      origin,
      { requests: 5, seconds: 10 },
      async () => safe,
      connect,
    );
    const a = scope.fetch(origin, "GET"),
      b = scope.fetch(origin, "GET");
    await expect(scope.fetch(origin, "GET")).rejects.toThrow(
      "concurrency_limit",
    );
    scope.close();
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
  });
});

it("limits aggregate per-IP and global activity across accounts/jobs", () => {
  let now = 60000;
  const budget = new EgressBudget(() => now);
  for (let i = 0; i < 60; i++) budget.reserve("93.184.215.14");
  expect(() => budget.reserve("93.184.215.14")).toThrow(
    "destination_rate_limited",
  );
  for (let i = 0; i < 59; i++) budget.reserve("93.184.215.15");
  expect(() => budget.reserve("93.184.215.16")).toThrow("gateway_rate_limited");
  now += 60000;
  const charge = budget.reserve("93.184.215.14");
  expect(() => charge(33554433)).toThrow("destination_byte_rate_limited");
});
