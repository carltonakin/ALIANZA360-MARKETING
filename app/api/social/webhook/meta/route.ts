import { proxySocialRequest } from "../../_proxy";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxySocialRequest(`/webhooks/meta?${url.searchParams.toString()}`, {}, {
    requiresServiceToken: false,
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  return proxySocialRequest("/webhooks/meta", {
    method: "POST",
    headers: signature ? { "x-hub-signature-256": signature } : {},
    body: rawBody,
  }, { requiresServiceToken: false });
}
