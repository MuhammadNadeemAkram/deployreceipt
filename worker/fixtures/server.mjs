import { createServer } from "node:http";
export function fixtureServer() {
  return createServer((request, response) => {
    const path = new URL(request.url, "http://fixture").pathname;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (path === "/redirect-private") {
      response.writeHead(302, {
        Location: "http://169.254.169.254/latest/meta-data",
      });
      response.end();
      return;
    }
    if (path === "/redirect-external") {
      response.writeHead(302, { Location: "https://example.com/" });
      response.end();
      return;
    }
    if (path === "/broken") {
      response.statusCode = 404;
      response.end("<h1>Missing fixture page</h1>");
      return;
    }
    if (path === "/slow") {
      const timer = setTimeout(
        () => response.end("<h1>Slow fixture</h1>"),
        20000,
      );
      response.on("close", () => clearTimeout(timer));
      return;
    }
    response.end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DeployReceipt controlled fixture</title><style>body{font:20px Arial;max-width:900px;margin:40px;background:#f4f8f3;color:#153d30}a{display:block;margin:12px}</style><h1>Controlled scan fixture</h1><p>This is local test content, not a customer website.</p><a href="/healthy">Healthy page</a><a href="/broken">Broken page</a><a href="/redirect-private">Blocked redirect</a><a href="/healthy#section">Duplicate healthy link</a><a href="https://example.com/">External link (not eligible)</a><img src="/broken" alt="Intentionally missing image"><script>console.error("Fixture console error token=do-not-store");setTimeout(()=>{throw new Error("Fixture page error")},10);</script></html>`,
    );
  });
}
if (process.env.DEPLOYRECEIPT_FIXTURE === "1")
  fixtureServer().listen(8080, "0.0.0.0", () =>
    console.info("Controlled fixture listening on 8080"),
  );
