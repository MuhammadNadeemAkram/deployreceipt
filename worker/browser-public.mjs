import http from "node:http";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const codeSha = process.env.SCAN_CODE_SHA;
if (!codeSha || !/^[a-f0-9]{40}$/.test(codeSha))
  throw Error("verified_code_revision_required");
const server = await chromium.launchServer({
  host: "0.0.0.0",
  port: 9000,
  wsPath: "/scan-browser",
  headless: true,
  chromiumSandbox: true,
  args: [
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-background-networking",
    "--host-resolver-rules=MAP * ~NOTFOUND",
    "--proxy-server=http://127.0.0.1:9",
  ],
});
if (server.process().spawnargs.some((arg) => arg === "--no-sandbox"))
  throw Error("sandbox_required");
server.on("close", () => process.exit(0));
let leased = false;
let deadline;
const control = http.createServer(
  { maxHeaderSize: 4096, requestTimeout: 5000, headersTimeout: 5000 },
  async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/health" && req.method === "GET")
      return reply(200, {
        ready: server.process().exitCode === null,
        policy: "public-gateway-v1",
        code_sha: codeSha,
      });
    if (
      req.method !== "POST" ||
      req.headers["x-public-policy-revision"] !== codeSha
    )
      return reply(403, { ready: false });
    if (req.url === "/lease") {
      if (leased) return reply(409, { ready: false });
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 512) {
          req.destroy();
          return;
        }
      }
      leased = true;
      deadline = setTimeout(() => process.exit(1), 110000);
      return reply(200, { leased: true });
    }
    if (req.url === "/dispose" && leased) {
      clearTimeout(deadline);
      reply(200, { disposed: true });
      setTimeout(() => process.exit(0), 30);
      return;
    }
    reply(404, { ready: false });
  },
);
control.maxConnections = 4;
control.listen(9001, "0.0.0.0");
const beat = () =>
  writeFile(
    "/tmp/deployreceipt-browser-health.json",
    JSON.stringify({ ready: true, at: Date.now() }),
  );
await beat();
setInterval(() => void beat().catch(() => process.exit(1)), 5000).unref();
console.info(JSON.stringify({ event: "isolated_public_browser_ready" }));
