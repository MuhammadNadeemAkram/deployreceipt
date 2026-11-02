import { chromium } from "playwright";
await chromium.launchServer({
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
