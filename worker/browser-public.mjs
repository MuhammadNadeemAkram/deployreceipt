import http from "node:http";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
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
http
  .createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ready: server.process().exitCode === null,
        policy: "public-gateway-v1",
      }),
    );
  })
  .listen(9001, "0.0.0.0");
const beat = () =>
  writeFile(
    "/tmp/deployreceipt-browser-health.json",
    JSON.stringify({ ready: true, at: Date.now() }),
  );
await beat();
setInterval(() => void beat().catch(() => process.exit(1)), 5000).unref();
console.info(JSON.stringify({ event: "isolated_public_browser_ready" }));
