import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { proxySocialRequest } from "../social/_proxy";

const VISITOR_COOKIE = "n2tt_landing_visitor";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Malformed JSON payload." }, { status: 400 });
  }
  const cookieStore = await cookies();
  const visitorKey = cookieStore.get(VISITOR_COOKIE)?.value || randomUUID();
  const upstream = await proxySocialRequest("/landing-page-views", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, visitorKey }),
  });
  const payload = await upstream.json().catch(() => ({ error: "Unable to record this visit." }));
  const response = Response.json(payload, { status: upstream.status, headers: { "cache-control": "no-store" } });
  if (!cookieStore.get(VISITOR_COOKIE)) {
    response.headers.append("set-cookie", `${VISITOR_COOKIE}=${visitorKey}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  }
  return response;
}
