// Executed only in the no-internet controlled gateway transport container.
import assert from "node:assert/strict";
import net from "node:net";
import { FetchScope } from "../../worker/gateway/fetch";
async function main() {
  const resolver = async () => [{ address: "11.77.0.10", family: 4 }];
  const scope = new FetchScope(
    "https://owned.qa-fixture.net/",
    { requests: 30, seconds: 90 },
    resolver,
  );
  let ready = false;
  for (let n = 0; n < 20; n++) {
    try {
      const result = await scope.fetch("https://owned.qa-fixture.net/", "GET");
      assert.equal(result.status, 200);
      assert.equal(result.headers["set-cookie"], undefined);
      assert.equal(
        Buffer.from(result.body, "base64").toString(),
        "controlled fixture",
      );
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  assert(
    ready,
    "Pinned TLS with correct hostname and trusted fixture certificate must succeed",
  );
  const wrongName = new FetchScope(
    "https://wrong.qa-fixture.net/",
    { requests: 2, seconds: 10 },
    resolver,
  );
  await assert.rejects(
    wrongName.fetch("https://wrong.qa-fixture.net/", "GET"),
    /upstream_unavailable/,
  );
  for (const path of [
    "/redirect-private",
    "/redirect-other",
    "/large",
    "/stream",
    "/encoding",
  ])
    await assert.rejects(
      scope.fetch("https://owned.qa-fixture.net" + path, "GET"),
    );
  await assert.rejects(
    scope.fetch("https://owned.qa-fixture.net/", "POST"),
    /method_blocked/,
  );
  const redirect = await scope.fetch(
    "https://owned.qa-fixture.net/redirect-same",
    "GET",
  );
  assert.equal(redirect.status, 302);
  assert.equal(
    redirect.headers.location,
    "https://owned.qa-fixture.net/target",
  );
  const counts = JSON.parse(
    Buffer.from(
      (await scope.fetch("https://owned.qa-fixture.net/counts", "GET")).body,
      "base64",
    ).toString(),
  );
  assert.equal(
    counts.redirectTargets,
    0,
    "Gateway cannot implicitly follow redirects",
  );
  const raw = (host: string, port: number) =>
    new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port });
      socket.setTimeout(800, () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
    });
  for (const host of ["127.0.0.1", "172.31.80.10", "169.254.169.254", "::1"])
    assert.equal(
      await raw(host, 80),
      false,
      "Gateway kernel firewall must deny private/loopback/metadata independently of URL checks",
    );
  assert.equal(
    await raw("11.77.0.10", 80),
    true,
    "Controlled numeric public-range fixture is reachable through enforced policy",
  );
  scope.close();
  console.info(
    JSON.stringify({
      event: "gateway_transport_passed",
      tls_hostname_verified: true,
      certificate_rejection: true,
      private_egress_denied: true,
      redirects_not_followed: true,
      body_limits: true,
      methods_bounded: true,
      cookies_stripped: true,
    }),
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
