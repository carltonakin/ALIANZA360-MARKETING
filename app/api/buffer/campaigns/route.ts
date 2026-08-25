import { isSocialConfigAdmin } from "../../social/_config";
import { proxySocialRequest } from "../../social/_proxy";

function forbidden() {
  return Response.json({ ok: false, error: "Only the site owner can manage Buffer campaigns." }, { status: 403 });
}

export async function GET(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  return proxySocialRequest("/buffer/campaigns");
}

export async function POST(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
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
  if (!isSocialConfigAdmin(request)) return forbidden();
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
