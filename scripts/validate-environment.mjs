import { validateEnvironment } from "../server/environment.mjs";
try {
  const result = validateEnvironment(process.env);
  console.info(
    JSON.stringify({
      event: "environment_validated",
      environment: result.environment,
      configured: result.configured,
      scanning: result.scanning,
    }),
  );
} catch {
  console.error(
    "Deployment configuration is invalid. See docs/deployment.md. No environment values were logged.",
  );
  process.exitCode = 1;
}
