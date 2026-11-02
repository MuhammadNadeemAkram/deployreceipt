import ipaddr from "ipaddr.js";
import { lookup } from "node:dns/promises";
export const FIXTURE_ORIGIN = "http://fixture:8080";
export function publicUrl(value: string) {
  if (
    value.length > 2048 ||
    /[\\\s\u0000-\u001f\u007f]/.test(value) ||
    /%/.test(value.split("/").slice(0, 3).join("/"))
  )
    throw new Error("invalid_url");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname
  )
    throw new Error("invalid_url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host)) assertPublicAddress(host);
  else if (
    !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ||
    /\.(localhost|local|internal|test|invalid|example|onion)$/i.test(host)
  )
    throw new Error("invalid_host");
  const rawHost = value
    .match(/^https?:\/\/([^/?#]+)/i)?.[1]
    ?.toLowerCase()
    .replace(/:(80|443)$/, "");
  if (rawHost !== url.hostname.toLowerCase()) throw new Error("ambiguous_host");
  url.hash = "";
  return url;
}
export function assertPublicAddress(address: string) {
  const parsed = ipaddr.process(address);
  if (parsed.range() !== "unicast") throw new Error("blocked_address");
  if (parsed.kind() === "ipv6" && !parsed.match(ipaddr.parseCIDR("2000::/3")))
    throw new Error("blocked_address");
  // Additional IANA special-purpose ranges not consistently classified by parsers.
  if (
    parsed.kind() === "ipv4" &&
    ["192.0.0.0/24", "192.88.99.0/24", "198.18.0.0/15"].some((cidr) =>
      parsed.match(ipaddr.parseCIDR(cidr)),
    )
  )
    throw new Error("blocked_address");
}
export async function resolvePublic(
  value: string,
  resolver = async (host: string) =>
    lookup(host, { all: true, verbatim: true }),
) {
  const url = publicUrl(value);
  const addresses = await resolver(url.hostname.replace(/^\[|\]$/g, ""));
  if (!addresses.length) throw new Error("dns_empty");
  addresses.forEach((item) => assertPublicAddress(item.address));
  return { url, addresses };
}
// Preparatory policy only: a public browser mode is deliberately NOT implemented.
// A connection must use the validated numeric address without a second DNS lookup.
export async function withPinnedDestination<T>(
  value: string,
  resolver: Parameters<typeof resolvePublic>[1],
  connect: (destination: {
    address: string;
    family: number;
    port: number;
    servername: string;
  }) => Promise<T>,
) {
  const { url, addresses } = await resolvePublic(value, resolver);
  return connect({
    address: addresses[0].address,
    family: addresses[0].family,
    port: url.protocol === "https:" ? 443 : 80,
    servername: url.hostname,
  });
}
export function fixtureUrl(value: string) {
  if (!/^http:\/\/fixture:8080(\/|$)/.test(value))
    throw new Error("fixture_only");
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) throw new Error("fixture_only");
  const url = new URL(value);
  if (
    url.origin !== FIXTURE_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("fixture_only");
  return url;
}
export function sanitizeUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.origin + url.pathname)
      .replace(/[a-f0-9]{32,}/gi, "[redacted]")
      .slice(0, 250);
  } catch {
    return "[invalid URL]";
  }
}
export function sanitizeText(value: string) {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/g, sanitizeUrl)
    .replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(
      /(token|password|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 300);
}
export function failureCategory(message: string) {
  if (/timeout|timed.out/i.test(message)) return "timeout";
  if (/NAME_NOT_RESOLVED|DNS/i.test(message)) return "dns";
  if (/CERT_|SSL_|TLS/i.test(message)) return "tls";
  if (/BLOCKED|ABORTED|fixture_only/i.test(message)) return "blocked";
  return "navigation";
}
