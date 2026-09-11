import { proxySocialRequest } from "../../../social/_proxy";

export async function POST(request: Request) {
  return proxySocialRequest("/ai/campaigns/regenerate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
