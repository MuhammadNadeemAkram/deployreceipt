import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const output = spawnSync(
  process.execPath,
  [process.env.npm_execpath, "audit", "--json"],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
);
let report;
try {
  report = JSON.parse(output.stdout);
} catch {
  throw Error("Dependency audit unavailable");
}
if (!report.metadata || report.error)
  throw Error("Dependency audit unavailable");
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const vulnerabilities = report.vulnerabilities ?? {};
function known(name, seen = new Set()) {
  if (seen.has(name)) return true;
  seen.add(name);
  const v = vulnerabilities[name];
  return (
    v &&
    v.severity === "moderate" &&
    v.nodes.every((n) => lock.packages[n]?.dev === true) &&
    v.via.every((source) =>
      typeof source === "string"
        ? known(source, seen)
        : source.url === "https://github.com/advisories/GHSA-g3hv-75wg-m249",
    )
  );
}
const expiry = Date.parse("2026-12-04T00:00:00Z");
const failed = Object.keys(vulnerabilities).filter(
  (name) => Date.now() > expiry || !known(name),
);
console.info(
  JSON.stringify({
    event: "dependency_audit",
    counts: report.metadata.vulnerabilities,
    known_dev_only_exception: "GHSA-g3hv-75wg-m249",
    exception_expires: "2026-12-04",
    unaccepted: failed,
  }),
);
if (failed.length) process.exitCode = 1;
