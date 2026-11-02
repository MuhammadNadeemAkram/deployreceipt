// Run inside the isolated browser container, as pwuser. No app credentials.
import net from "node:net";
function dial(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
const loopback = net
  .createServer((socket) => socket.end())
  .listen(8123, "127.0.0.1");
await new Promise((resolve) => loopback.once("listening", resolve));
if (!(await dial("172.30.77.10", 8080)))
  throw new Error("Allowed fixture connection failed");
for (const [host, port] of [
  ["127.0.0.1", 8123],
  ["172.30.77.10", 80],
  ["169.254.169.254", 80],
  ["1.1.1.1", 443],
  ["::1", 9000],
]) {
  if (await dial(host, port)) throw new Error("Forbidden egress succeeded");
}
loopback.close();
console.info(
  "Fixture allowed; loopback, wrong port, metadata, public, IPv6 connections denied.",
);
