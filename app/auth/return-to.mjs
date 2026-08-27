const INTERNAL_ORIGIN = "https://crm.local";

export function safeAuthReturnTo(value) {
  if (typeof value !== "string") return "/";
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";

  let url;
  try {
    url = new URL(candidate, INTERNAL_ORIGIN);
  } catch {
    return "/";
  }

  if (url.origin !== INTERNAL_ORIGIN) return "/";
  if (url.pathname === "/login" || url.pathname.startsWith("/api/auth/")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
