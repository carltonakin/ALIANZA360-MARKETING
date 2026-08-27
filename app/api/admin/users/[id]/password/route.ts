import { authenticatedAuthRequest } from "../../../../../auth/server";

export async function POST(request: Request, context: RouteContext<"/api/admin/users/[id]/password">) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed JSON payload." }, { status: 400 });
  }
  const { id } = await context.params;
  return authenticatedAuthRequest(`/auth/users/${encodeURIComponent(id)}/password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
