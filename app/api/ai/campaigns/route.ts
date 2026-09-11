import { proxySocialRequest } from "../../social/_proxy";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return proxySocialRequest(`/ai/campaigns${query.size ? `?${query}` : ""}`, { cache: "no-store" });
}

export async function POST(request: Request) {
  return proxySocialRequest("/ai/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
