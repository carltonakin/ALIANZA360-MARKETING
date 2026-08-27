import { proxySocialRequest } from "../_proxy";

export async function GET(request: Request) {
  const source = new URL(request.url);
  const query = new URLSearchParams();
  if (source.searchParams.get("campaignId")) query.set("campaignId", source.searchParams.get("campaignId")!);
  if (source.searchParams.get("limit")) query.set("limit", source.searchParams.get("limit")!);
  return proxySocialRequest(`/integration-actions${query.size ? `?${query}` : ""}`);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  }
  const path = body.operation === "run-due" ? "/integration-actions/run-due" : "/integration-actions";
  return proxySocialRequest(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
