import "server-only";
import { validateEnvironment } from "../../../server/environment.mjs";
export function deployment() {
  return validateEnvironment(process.env);
}
