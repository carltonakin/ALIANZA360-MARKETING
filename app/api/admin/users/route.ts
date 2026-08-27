import { authenticatedAuthRequest } from "../../../auth/server";

export async function GET() {
  return authenticatedAuthRequest("/auth/users");
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed JSON payload." }, { status: 400 });
  }
  return authenticatedAuthRequest("/auth/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
