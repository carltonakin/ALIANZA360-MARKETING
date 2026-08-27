import { proxySocialRequest } from "../../social/_proxy";

export async function GET() {
  return proxySocialRequest("/buffer/campaigns");
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed JSON payload." }, { status: 400 });
  }
  return proxySocialRequest("/buffer/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed JSON payload." }, { status: 400 });
  }
  return proxySocialRequest("/buffer/campaigns", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
