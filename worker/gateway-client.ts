import type { GatewayResponse } from "./gateway/fetch";
import { PolicyError } from "./gateway/policy";
const endpoint = "http://public-gateway:9080";
export async function openGateway(
  target: string,
  requests: number,
  seconds: number,
) {
  const key = process.env.GATEWAY_CONTROL_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key)) throw Error("gateway_key_required");
  async function call(path: string, body: unknown) {
    const response = await fetch(endpoint + path, {
      method: "POST",
      headers: {
        authorization: "Bearer " + key,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (Number(response.headers.get("content-length")) > 3000000)
      throw Error("gateway_response_limit");
    const data = await response.json();
    if (!response.ok)
      throw new PolicyError(
        typeof data.code === "string" && /^[a-z_]{1,50}$/.test(data.code)
          ? data.code
          : "policy_rejected",
      );
    return data;
  }
  const { id } = await call("/open", { target, requests, seconds });
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
    throw Error("invalid_gateway_scope");
  let active = 0,
    closed = false;
  const waiters: Array<{ resolve: () => void; reject: (e: Error) => void }> =
    [];
  async function acquire() {
    if (closed) throw new PolicyError("scope_expired");
    if (active >= 2) {
      if (waiters.length >= 100) throw new PolicyError("request_limit");
      await new Promise<void>((resolve, reject) =>
        waiters.push({ resolve, reject }),
      );
      return;
    }
    active++;
  }
  const release = () => {
    const next = waiters.shift();
    if (next) next.resolve();
    else active--;
  };
  return {
    fetch: async (url: string, method: string): Promise<GatewayResponse> => {
      await acquire();
      try {
        if (closed) throw new PolicyError("scope_expired");
        return await call("/fetch", { id, url, method });
      } finally {
        release();
      }
    },
    close: async () => {
      closed = true;
      for (const waiter of waiters.splice(0))
        waiter.reject(new PolicyError("scope_expired"));
      await call("/close", { id });
    },
  };
}
