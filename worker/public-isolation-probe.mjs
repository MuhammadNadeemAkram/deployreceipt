import assert from "node:assert/strict";
import net from "node:net";
import dgram from "node:dgram";
import http from "node:http";
import { chromium } from "playwright";
const attempt = (host, port) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (value) => {
      s.destroy();
      resolve(value);
    };
    s.setTimeout(700, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
let loopbackHits = 0;
const trap = http.createServer((_req, res) => {
  loopbackHits++;
  res.end("forbidden");
});
await new Promise((resolve) => trap.listen(8765, "0.0.0.0", resolve));
for (const [host, port] of [
  ["127.0.0.1", 8765],
  ["169.254.169.254", 80],
  ["172.31.78.30", 80],
  ["172.31.81.10", 8765],
  ["172.31.79.30", 9080],
  ["11.77.0.10", 80],
  ["1.1.1.1", 443],
  ["::1", 8765],
])
  assert.equal(
    await attempt(host, port),
    false,
    "Direct browser namespace TCP must be denied",
  );
const udp = dgram.createSocket("udp4");
let gotDns = false;
udp.on("message", () => (gotDns = true));
udp.send(
  Buffer.from(
    "000001000001000000000000076578616d706c6503636f6d0000010001",
    "hex",
  ),
  53,
  "1.1.1.1",
);
await new Promise((resolve) => setTimeout(resolve, 700));
udp.close();
assert.equal(gotDns, false);
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  args: ["--disable-quic", "--proxy-bypass-list=*"],
});
try {
  const context = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  const page = await context.newPage();
  await page.goto("data:text/html,<h1>Isolated adversarial fixture</h1>");
  const network = await page.evaluate(async () => {
    const urls = [
      "http://127.0.0.1:8765/",
      "http://169.254.169.254/",
      "http://172.31.79.30:9080/health",
    ];
    return Promise.all(
      urls.map((url) =>
        Promise.race([
          fetch(url).then(
            () => true,
            () => false,
          ),
          new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
        ]),
      ),
    );
  });
  assert(network.every((result) => result === false));
  assert.equal(loopbackHits, 0);
  await context.close();
  // Fresh context has no previous job's browser state. This probe never loads public websites.
  const a = await browser.newContext(),
    b = await browser.newContext();
  await a.addCookies([
    { name: "job", value: "one", url: "https://owned.qa-fixture.net" },
  ]);
  assert.equal((await b.cookies()).length, 0);
  await a.close();
  await b.close();
  console.info(
    JSON.stringify({
      event: "public_browser_isolation_passed",
      direct_tcp_denied: true,
      ipv6_denied: true,
      dns_denied: true,
      proxy_bypass_denied: true,
      loopback_hits: loopbackHits,
    }),
  );
} finally {
  await browser.close();
  trap.close();
}
