import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { proxySocialRequest } from "../api/social/_proxy";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_HEADER,
  type AuthUser,
} from "./shared";

export async function authSessionToken() {
  return (await cookies()).get(AUTH_COOKIE_NAME)?.value || "";
}

export async function authenticatedAuthRequest(path: string, init: RequestInit = {}) {
  const token = await authSessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set(AUTH_SESSION_HEADER, token);
  return proxySocialRequest(path, { ...init, headers });
}

export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  const response = await authenticatedAuthRequest("/auth/me");
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { user?: AuthUser } | null;
  return body?.user?.isActive ? body.user : null;
}

export async function requireAuthenticatedUser(role?: "ADMIN"): Promise<AuthUser> {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  if (role === "ADMIN" && user.role !== "ADMIN") redirect("/dashboard?forbidden=1");
  return user;
}

export function authCookieOptions(expiresAt: string | Date) {
  const expires = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
    priority: "high" as const,
  };
}
