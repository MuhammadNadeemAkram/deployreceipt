import { sharedEgressBudget } from "./budget";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import {
  PolicyError,
  publicOrigin,
  destination,
  publicAnswers,
  validateAnswers,
  type Address,
} from "./policy";
export type GatewayResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};
export type WireRequest = {
  url: URL;
  address: string;
  family: number;
  method: string;
  signal: AbortSignal;
  maxBytes: number;
  consume: (bytes: number) => void;
};
export type WireResponse = {
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
};
// Numeric destination prevents a second DNS lookup; SNI and certificate checks use the original hostname.
export function connectPinned(input: WireRequest): Promise<WireResponse> {
  return new Promise((resolve, reject) => {
    const request = (input.url.protocol === "https:" ? https : http).request(
      {
        hostname: input.address,
        family: input.family,
        port: input.url.protocol === "https:" ? 443 : 80,
        servername: input.url.hostname,
        method: input.method,
        path: input.url.pathname + input.url.search,
        agent: false,
        rejectUnauthorized: true,
        maxHeaderSize: 16384,
        signal: input.signal,
        headers: {
          host: input.url.host,
          "accept-encoding": "identity",
          accept: "*/*",
          "user-agent": "DeployReceipt-Authorized-QA/1.0",
          connection: "close",
        },
        lookup: (_host, _options, callback) =>
          callback(new PolicyError("second_dns_lookup_forbidden"), "", 0),
      },
      (response) => {
        const peer = response.socket.remoteAddress?.replace(/^::ffff:/, "");
        if (!peer || peer !== input.address || isIP(peer) !== input.family) {
          response.destroy();
          reject(new PolicyError("peer_mismatch"));
          return;
        }
        if (
          response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity"
        ) {
          response.destroy();
          reject(new PolicyError("encoding_blocked"));
          return;
        }
        const length = Number(response.headers["content-length"] ?? 0);
        if (
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > input.maxBytes
        ) {
          response.destroy();
          reject(new PolicyError("response_limit"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          try {
            input.consume(chunk.length);
          } catch {
            response.destroy(new PolicyError("total_byte_limit"));
            return;
          }
          if (size > input.maxBytes) {
            response.destroy(new PolicyError("response_limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const headers: Record<string, string> = {};
          for (const name of [
            "content-type",
            "content-security-policy",
            "x-content-type-options",
            "location",
          ]) {
            const value = response.headers[name];
            if (typeof value === "string") headers[name] = value;
          }
          resolve({
            status: response.statusCode ?? 502,
            headers,
            bytes: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new PolicyError("upgrade_blocked"));
    });
    request.on("error", (error) => {
      if (error instanceof PolicyError) {
        reject(error);
        return;
      }
      const code = (error as NodeJS.ErrnoException).code ?? "";
      reject(
        new PolicyError(
          /CERT|TLS|SSL|SELF_SIGNED|VERIFY_LEAF/.test(code)
            ? "tls_rejected"
            : code === "ABORT_ERR"
              ? "upstream_timeout"
              : "upstream_unavailable",
        ),
      );
    });
    request.setTimeout(8000, () =>
      request.destroy(new PolicyError("upstream_timeout")),
    );
    request.end();
  });
}
export class FetchScope {
  readonly origin: string;
  readonly expires: number;
  private requests = 0;
  private bytes = 0;
  private active = 0;
  private closed = false;
  private controllers = new Set<AbortController>();
  constructor(
    target: string,
    private readonly budget: { requests: number; seconds: number },
    private readonly resolve: (
      host: string,
    ) => Promise<Address[]> = publicAnswers,
    private readonly connect: (
      input: WireRequest,
    ) => Promise<WireResponse> = connectPinned,
  ) {
    this.origin = publicOrigin(target).origin;
    if (
      !Number.isInteger(budget.requests) ||
      budget.requests < 1 ||
      budget.requests > 100 ||
      !Number.isInteger(budget.seconds) ||
      budget.seconds < 1 ||
      budget.seconds > 90
    )
      throw new PolicyError("invalid_budget");
    this.expires = Date.now() + budget.seconds * 1000;
  }
  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
  }
  async fetch(value: string, method: string): Promise<GatewayResponse> {
    if (this.closed || Date.now() >= this.expires)
      throw new PolicyError("scope_expired");
    if (this.bytes >= 16777216) throw new PolicyError("total_byte_limit");
    if (++this.requests > this.budget.requests)
      throw new PolicyError("request_limit");
    if (this.active >= 2) throw new PolicyError("concurrency_limit");
    const url = destination(value, this.origin, method);
    this.active++;
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(10000, this.expires - Date.now()),
    );
    try {
      const address = validateAnswers(await this.resolve(url.hostname));
      if (
        this.closed ||
        Date.now() >= this.expires ||
        controller.signal.aborted
      )
        throw new PolicyError("scope_expired");
      const chargePeer = sharedEgressBudget.reserve(address.address);
      let charged = 0;
      const consume = (bytes: number) => {
        chargePeer(bytes);
        charged += bytes;
        this.bytes += bytes;
        if (this.bytes > 16777216) throw new PolicyError("total_byte_limit");
      };
      const response = await this.connect({
        url,
        ...address,
        method,
        signal: controller.signal,
        maxBytes: Math.min(2097152, 16777216 - this.bytes),
        consume,
      });
      if (
        response.bytes.length > 2097152 ||
        this.closed ||
        controller.signal.aborted
      )
        throw new PolicyError("response_limit");
      if (charged < response.bytes.length)
        consume(response.bytes.length - charged);
      if (response.headers.location) {
        const next = new URL(response.headers.location, url);
        destination(next.href, this.origin, "GET");
        response.headers.location = next.href;
      }
      return {
        status: response.status,
        headers: response.headers,
        body: response.bytes.toString("base64"),
      };
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
      this.active--;
    }
  }
}
