import { cookies } from "next/headers";
import { authenticatedAuthRequest } from "../../../auth/server";
import { AUTH_COOKIE_NAME } from "../../../auth/shared";

export async function POST() {
  await authenticatedAuthRequest("/auth/logout", { method: "POST" }).catch(() => null);
  (await cookies()).set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
