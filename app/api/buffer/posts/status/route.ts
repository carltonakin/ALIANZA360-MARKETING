import { isSocialConfigAdmin } from "../../../social/_config";
import { proxySocialRequest } from "../../../social/_proxy";

function forbidden() {
  return Response.json({ ok: false, error: "Only the site owner can manage Buffer campaign posts." }, { status: 403 });
}

export async function GET(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  const source = new URL(request.url);
  const query = new URLSearchParams();
  if (source.searchParams.get("campaignId")) query.set("campaignId", source.searchParams.get("campaignId")!);
  return proxySocialRequest(`/buffer/posts/status${query.size ? `?${query}` : ""}`);
}

export async function POST(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed JSON payload." }, { status: 400 });
  }
  return proxySocialRequest("/buffer/posts/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
