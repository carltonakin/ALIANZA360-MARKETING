import { proxySocialRequest } from "../../../social/_proxy";

export async function GET(
  _request: Request,
  context: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await context.params;
  if (!/^\d+$/.test(leadId)) {
    return Response.json({ ok: false, message: "A valid lead ID is required." }, { status: 400 });
  }
  return proxySocialRequest(`/leads/${leadId}/interactions`);
}
