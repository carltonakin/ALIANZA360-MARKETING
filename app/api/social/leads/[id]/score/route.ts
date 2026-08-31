import { proxySocialRequest } from "../../../_proxy";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return Response.json({ ok: false, message: "A valid lead ID is required." }, { status: 400 });
  }
  return proxySocialRequest(`/leads/${id}/score`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
