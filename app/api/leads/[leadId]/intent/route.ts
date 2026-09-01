import { forwardJson } from "../../../social/_proxy";

export async function POST(
  request: Request,
  context: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await context.params;
  if (!/^\d+$/.test(leadId)) {
    return Response.json({ ok: false, message: "A valid lead ID is required." }, { status: 400 });
  }
  return forwardJson(request, `/leads/${leadId}/intent`);
}
