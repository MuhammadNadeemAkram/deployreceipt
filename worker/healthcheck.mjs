// No credentials or report contents are written to health files.
import { readFile } from "node:fs/promises";
const file = process.argv[2] ?? "/tmp/deployreceipt-worker-health.json";
try {
  const state = JSON.parse(await readFile(file, "utf8"));
  if (
    !state.ready ||
    !Number.isFinite(state.at) ||
    state.at > Date.now() + 1000 ||
    Date.now() - state.at > 45000
  )
    process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
