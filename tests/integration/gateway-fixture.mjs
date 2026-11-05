import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
let requests = 0,
  redirectTargets = 0;
const handle = (req, res) => {
  requests++;
  res.on("error", () => {});
  if (req.url === "/counts") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ requests, redirectTargets }));
  }
  if (req.url === "/redirect-private") {
    res.writeHead(302, { location: "http://169.254.169.254/" });
    return res.end();
  }
  if (req.url === "/redirect-other") {
    res.writeHead(302, { location: "https://sibling.qa-fixture.net/" });
    return res.end();
  }
  if (req.url === "/redirect-same") {
    res.writeHead(302, { location: "/target" });
    return res.end();
  }
  if (req.url === "/target") redirectTargets++;
  if (req.url === "/large") {
    res.writeHead(200, { "content-length": "2097153" });
    return res.end();
  }
  if (req.url === "/stream") {
    res.writeHead(200, { "transfer-encoding": "chunked" });
    res.write(Buffer.alloc(1048576));
    return res.end(Buffer.alloc(1048577));
  }
  if (req.url === "/encoding") {
    res.writeHead(200, { "content-encoding": "gzip" });
    return res.end("untrusted compressed data");
  }
  res.setHeader("set-cookie", "sensitive=not-forwarded");
  res.setHeader("content-type", "text/plain");
  res.end("controlled fixture");
};
http.createServer(handle).listen(80, "0.0.0.0");
https
  .createServer(
    {
      key: readFileSync("/certs/server.key"),
      cert: readFileSync("/certs/server.crt"),
    },
    handle,
  )
  .listen(443, "0.0.0.0");
