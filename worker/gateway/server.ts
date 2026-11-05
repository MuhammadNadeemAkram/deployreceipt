import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { FetchScope } from "./fetch";
import { PolicyError } from "./policy";
const codeSha = process.env.SCAN_CODE_SHA;
if (!codeSha || !/^[a-f0-9]{40}$/.test(codeSha))
  throw Error("verified_code_revision_required");
const key = process.env.GATEWAY_CONTROL_KEY;
if (!key || !/^([a-f0-9]{64})$/.test(key))
  throw Error("gateway_control_key_required");
const scopes = new Map<string, FetchScope>();
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cleanup = setInterval(() => {
  for (const [id, scope] of scopes)
    if (scope.expires <= Date.now()) {
      scope.close();
      scopes.delete(id);
    }
}, 1000);
cleanup.unref();
const server = http.createServer(
  { maxHeaderSize: 8192, requestTimeout: 12000, headersTimeout: 5000 },
  async (req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.url === "/health" && req.method === "GET")
        return reply(200, { ready: true, code_sha: codeSha });
      if (
        req.method !== "POST" ||
        !same(req.headers.authorization ?? "", "Bearer " + key)
      )
        return reply(403, { code: "not_authorized" });
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 4096) {
          req.destroy();
          return;
        }
      }
      const data = JSON.parse(body) as Record<string, unknown>;
      if (req.url === "/open") {
        if (scopes.size >= 1) throw new PolicyError("gateway_busy");
        const scope = new FetchScope(String(data.target), {
          requests: Number(data.requests),
          seconds: Number(data.seconds),
        });
        const id = randomBytes(32).toString("hex");
        scopes.set(id, scope);
        return reply(200, { id });
      }
      const scope = scopes.get(String(data.id));
      if (!scope) throw new PolicyError("scope_unavailable");
      if (req.url === "/close") {
        scope.close();
        scopes.delete(String(data.id));
        return reply(200, { closed: true });
      }
      if (req.url !== "/fetch") throw new PolicyError("endpoint_blocked");
      return reply(
        200,
        await scope.fetch(String(data.url), String(data.method)),
      );
    } catch (error) {
      const code =
        error instanceof PolicyError ? error.code : "policy_rejected";
      console.info(JSON.stringify({ event: "public_network_rejected", code }));
      reply(422, { code });
    }
  },
);
server.on("connect", (_request, socket) => socket.destroy());
server.on("upgrade", (_request, socket) => socket.destroy());
server.maxConnections = 8;
server.listen(9080, "0.0.0.0");
