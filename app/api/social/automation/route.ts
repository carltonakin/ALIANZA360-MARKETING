import { proxySocialRequest } from "../_proxy";

export async function GET() {
  return proxySocialRequest("/campaign-automation");
}

async function payload(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function PUT(request: Request) {
  const body = await payload(request);
  if (!body) return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  return proxySocialRequest("/campaign-automation", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function POST(request: Request) {
  const body = await payload(request);
  if (!body) return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  const path = body.action === "run-due" ? "/campaign-automation/run-due" : "/campaign-automation/action";
  return proxySocialRequest(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
