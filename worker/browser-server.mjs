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
    "--host-resolver-rules=MAP fixture 172.30.77.10, MAP * ~NOTFOUND",
  ],
});
console.info("Restricted fixture browser ready");

server.on("close", () => process.exit(1));
const heartbeat = async () => {
  await writeFile(
    "/tmp/deployreceipt-browser-health.json",
    JSON.stringify({
      ready: server.process()?.exitCode === null,
      at: Date.now(),
    }),
  );
};
await heartbeat();
setInterval(() => {
  void heartbeat().catch(() => process.exit(1));
}, 5000).unref();
