import { proxySocialRequest } from "../social/_proxy";

export async function GET() {
  return proxySocialRequest("/company-profile", { cache: "no-store" });
}

export async function PUT(request: Request) {
  return proxySocialRequest("/company-profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
