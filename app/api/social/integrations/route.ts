import { isSocialConfigAdmin } from "../_config";
import { proxySocialRequest } from "../_proxy";

function forbidden() {
  return Response.json({ ok: false, message: "Only the site owner can manage social integrations." }, { status: 403 });
}

export async function GET(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  const source = new URL(request.url);
  const query = new URLSearchParams();
  if (source.searchParams.get("campaignId")) query.set("campaignId", source.searchParams.get("campaignId")!);
  if (source.searchParams.get("limit")) query.set("limit", source.searchParams.get("limit")!);
  return proxySocialRequest(`/integrations${query.size ? `?${query}` : ""}`);
}

export async function POST(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  }
  const operation = body.operation === "sync" ? "sync" : body.operation === "metrics" ? "metrics" : "test";
  return proxySocialRequest(`/integrations/sprout/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
