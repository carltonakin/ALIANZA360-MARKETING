import { isSocialConfigAdmin } from "../_config";
import { proxySocialRequest } from "../_proxy";

export async function POST(request: Request) {
  if (!isSocialConfigAdmin(request)) {
    return Response.json({ ok: false, message: "Only the site owner can create AI drafts." }, { status: 403 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  }
  return proxySocialRequest("/ai/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
