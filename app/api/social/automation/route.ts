import { isSocialConfigAdmin } from "../_config";
import { proxySocialRequest } from "../_proxy";

function forbidden() {
  return Response.json({ ok: false, message: "Only the site owner can manage campaign automation." }, { status: 403 });
}

export async function GET(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
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
  if (!isSocialConfigAdmin(request)) return forbidden();
  const body = await payload(request);
  if (!body) return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  return proxySocialRequest("/campaign-automation", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function POST(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  const body = await payload(request);
  if (!body) return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  const path = body.action === "run-due" ? "/campaign-automation/run-due" : "/campaign-automation/action";
  return proxySocialRequest(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
