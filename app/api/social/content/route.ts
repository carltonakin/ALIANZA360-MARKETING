import { proxySocialRequest } from "../_proxy";

export async function GET() {
  return proxySocialRequest("/content");
}

async function forward(request: Request, method: "POST" | "PUT") {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  }
  const path = payload.action === "campaign.mode" ? "/content/campaign-mode" : "/content";
  return proxySocialRequest(path, {
    method: path.endsWith("campaign-mode") ? "POST" : method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function POST(request: Request) {
  return forward(request, "POST");
}

export async function PUT(request: Request) {
  return forward(request, "PUT");
}
