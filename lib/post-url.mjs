export function normalizePostUrl(value) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) return null;

  if (result.length > 2048) {
    const error = new Error("Post URL Link must be 2,048 characters or fewer.");
    error.statusCode = 400;
    throw error;
  }

  try {
    const parsed = new URL(result);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported protocol");
    return parsed.toString();
  } catch {
    const error = new Error("Post URL Link must be a valid HTTP or HTTPS URL.");
    error.statusCode = 400;
    throw error;
  }
}
