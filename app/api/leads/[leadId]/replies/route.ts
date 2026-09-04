import { authenticatedAuthRequest } from "../../../../auth/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await context.params;
  if (!/^\d+$/.test(leadId)) {
    return Response.json({ ok: false, message: "A valid lead ID is required." }, { status: 400 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  }
  return authenticatedAuthRequest(`/leads/${leadId}/replies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
