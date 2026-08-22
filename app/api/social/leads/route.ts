import { proxySocialRequest } from "../_proxy";

export async function GET() {
  return proxySocialRequest("/leads?limit=100");
}

export async function POST(request: Request) {
  return forwardLeadWrite(request, "POST");
}

export async function PUT(request: Request) {
  return forwardLeadWrite(request, "PUT");
}

async function forwardLeadWrite(request: Request, method: "POST" | "PUT") {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  }
  const isStatusUpdate = method === "POST" && "leadId" in body && "status" in body && !("name" in body);
  return proxySocialRequest(isStatusUpdate ? "/leads/status" : "/leads", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
