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
  return {
    fetch: async (url: string, method: string): Promise<GatewayResponse> =>
      call("/fetch", { id, url, method }),
    close: async () => {
      await call("/close", { id });
    },
  };
}
