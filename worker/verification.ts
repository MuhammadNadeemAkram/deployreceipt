import { Resolver } from "node:dns/promises";
import { fixtureUrl, publicUrl } from "./security";
export function matchesChallenge(records: string[][], token: string) {
  return (
    /^[a-f0-9]{64}$/.test(token) &&
    records
      .slice(0, 50)
      .some((parts) => parts.join("") === `deployreceipt=${token}`)
  );
}
export async function verifyDomain(
  target: string,
  token: string,
  mode: "disabled" | "local",
  resolve?: (name: string) => Promise<string[][]>,
) {
  if (mode === "local") {
    try {
      fixtureUrl(target);
      return { verified: true, method: "local_fixture" as const };
    } catch {}
  }
  const url = publicUrl(target);
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const query = resolve ?? ((name: string) => resolver.resolveTxt(name));
  try {
    return {
      verified: matchesChallenge(
        await query(`_deployreceipt.${url.hostname}`),
        token,
      ),
      method: "dns" as const,
    };
  } catch (error) {
    if (
      ["ENODATA", "ENOTFOUND"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      return { verified: false, method: "dns" as const };
    throw new Error("verification_unavailable");
  }
}
