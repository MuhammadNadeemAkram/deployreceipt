import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { publicUrl, assertPublicAddress } from "../security";
export class PolicyError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export function publicOrigin(value: string) {
  const url = publicUrl(value);
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")))
    throw new PolicyError("hostname_required");
  if (
    url.hostname.length > 253 ||
    url.hostname
      .split(".")
      .some(
        (label) =>
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
      )
  )
    throw new PolicyError("invalid_hostname");
  return url;
}
export async function publicAnswers(host: string) {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  resolver.setServers(["1.1.1.1"]);
  const query = async (family: 4 | 6) => {
    try {
      return (
        await (family === 4 ? resolver.resolve4(host) : resolver.resolve6(host))
      ).map((address) => ({ address, family }));
    } catch (e) {
      if (
        ["ENODATA", "ENOTFOUND"].includes(
          (e as NodeJS.ErrnoException).code ?? "",
        )
      )
        return [];
      throw new PolicyError("dns_unavailable");
    }
  };
  return (await Promise.all([query(4), query(6)])).flat();
}
export type Address = { address: string; family: number };
export function validateAnswers(answers: Address[]) {
  if (!answers.length || answers.length > 32)
    throw new PolicyError("dns_answers_rejected");
  for (const item of answers) {
    if (isIP(item.address) !== item.family)
      throw new PolicyError("dns_answer_mismatch");
    assertPublicAddress(item.address);
  }
  // The initial gateway has no IPv6 network route; IPv6-only sites fail closed.
  const chosen = answers.find((item) => item.family === 4);
  if (!chosen) throw new PolicyError("ipv6_transport_unavailable");
  return chosen;
}
export function destination(value: string, origin: string, method: string) {
  if (!["GET", "HEAD"].includes(method))
    throw new PolicyError("method_blocked");
  const url = publicOrigin(value);
  if (url.origin !== origin) throw new PolicyError("origin_blocked");
  return url;
}
