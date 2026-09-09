import { proxySocialRequest } from "../../social/_proxy";

export async function POST(request: Request) {
  return proxySocialRequest("/landing-pages/duplicate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
