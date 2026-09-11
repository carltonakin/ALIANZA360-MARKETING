import { proxySocialRequest } from "../../social/_proxy";

export async function GET() {
  return proxySocialRequest("/ai/providers", { cache: "no-store" });
}

export async function PUT(request: Request) {
  return proxySocialRequest("/ai/providers", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
