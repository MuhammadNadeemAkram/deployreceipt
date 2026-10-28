import { text } from "@/features/auth/validation";
export function validateProject(form: FormData) {
  const name = text(form, "name").trim();
  const rawUrl = text(form, "website_url").trim();
  const description = text(form, "description").trim();
  const errors: Record<string, string> = {};
  let websiteUrl = rawUrl;
  if (!name || name.length > 120)
    errors.name = "Enter a project name between 1 and 120 characters.";
  if (description.length > 2000)
    errors.description = "Use 2,000 characters or fewer.";
  try {
    const url = new URL(rawUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      rawUrl.length > 2048
    )
      throw new Error();
    websiteUrl = url.href;
    if (websiteUrl.length > 2048) throw new Error();
  } catch {
    errors.website_url =
      "Enter a complete HTTP or HTTPS URL without embedded credentials.";
  }
  return {
    values: { name, website_url: websiteUrl, description: description || null },
    errors,
  };
}
export function isProjectId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
