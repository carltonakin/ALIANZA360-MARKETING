import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_HEADER,
  VERIFIED_ROLE_HEADER,
  VERIFIED_USER_ID_HEADER,
  VERIFIED_USERNAME_HEADER,
  type AuthUser,
} from "./app/auth/shared";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/register",
  "/api/social/webhook/meta",
]);

function clean(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function isPublicPath(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/landing/") || PUBLIC_API_PATHS.has(pathname);
}

function requiresAdmin(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname.startsWith("/admin") || pathname === "/settings") return true;
  if (pathname === "/dashboard") {
    return ["settings", "user management"].includes((searchParams.get("view") || "").toLowerCase());
  }
  return pathname.startsWith("/api/admin/") || [
    "/api/social/config",
    "/api/social/channels",
    "/api/social/scoring",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function validateSession(sessionToken: string): Promise<{
  user: AuthUser | null;
  unavailable: boolean;
}> {
  const serviceUrl = clean(process.env.SOCIAL_LISTENER_SERVICE_URL).replace(/\/$/, "");
  const serviceToken = clean(process.env.SOCIAL_LISTENER_SERVICE_TOKEN);
  if (!serviceUrl || !serviceToken) return { user: null, unavailable: true };

  try {
    const response = await fetch(`${serviceUrl}/auth/me`, {
      headers: {
        authorization: `Bearer ${serviceToken}`,
        [AUTH_SESSION_HEADER]: sessionToken,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { user: null, unavailable: response.status >= 500 };
    const body = await response.json() as { user?: AuthUser };
    return { user: body.user?.isActive ? body.user : null, unavailable: false };
  } catch {
    return { user: null, unavailable: true };
  }
}

function clearSession(response: NextResponse) {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function unauthenticated(request: NextRequest, unavailable = false) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: unavailable ? "Authentication service is unavailable." : "Authentication is required." },
      { status: unavailable ? 503 : 401 },
    );
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (unavailable) login.searchParams.set("error", "service_unavailable");
  return clearSession(NextResponse.redirect(login));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const sessionToken = request.cookies.get(AUTH_COOKIE_NAME)?.value || "";

  if (isPublicPath(pathname)) {
    if (pathname === "/login" && sessionToken) {
      const { user } = await validateSession(sessionToken);
      if (user) return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!sessionToken) return unauthenticated(request);
  const { user, unavailable } = await validateSession(sessionToken);
  if (!user) return unauthenticated(request, unavailable);

  if (requiresAdmin(request) && user.role !== "ADMIN") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Administrator access is required." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/dashboard?forbidden=1", request.url));
  }

  if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", request.url));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(VERIFIED_USER_ID_HEADER);
  requestHeaders.delete(VERIFIED_USERNAME_HEADER);
  requestHeaders.delete(VERIFIED_ROLE_HEADER);
  requestHeaders.set(VERIFIED_USER_ID_HEADER, String(user.id));
  requestHeaders.set(VERIFIED_USERNAME_HEADER, user.username);
  requestHeaders.set(VERIFIED_ROLE_HEADER, user.role);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.svg|.*\\.(?:png|jpg|jpeg|gif|webp|svg|css|js|map|woff|woff2)$).*)"],
};
