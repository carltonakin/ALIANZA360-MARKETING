import { cookies } from "next/headers";
import { proxySocialRequest } from "../../social/_proxy";
import { AUTH_COOKIE_NAME, type AuthUser } from "../../../auth/shared";
import { authCookieOptions } from "../../../auth/server";

export async function POST(request: Request) {
  let credentials: { username?: unknown; password?: unknown };
  try {
    credentials = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed JSON payload." }, { status: 400 });
  }

  const response = await proxySocialRequest("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: typeof credentials.username === "string" ? credentials.username : "",
      password: typeof credentials.password === "string" ? credentials.password : "",
    }),
  });
  const body = await response.json().catch(() => null) as {
    user?: AuthUser;
    sessionToken?: string;
    expiresAt?: string;
    error?: string;
  } | null;

  if (!response.ok || !body?.user || !body.sessionToken || !body.expiresAt) {
    return Response.json(
      { ok: false, error: body?.error || "Login could not be completed." },
      { status: response.status },
    );
  }

  (await cookies()).set(AUTH_COOKIE_NAME, body.sessionToken, authCookieOptions(body.expiresAt));
  return Response.json({ ok: true, user: body.user }, { headers: { "cache-control": "no-store" } });
}
