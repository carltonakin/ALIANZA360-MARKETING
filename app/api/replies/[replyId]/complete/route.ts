import { forwardJson } from "../../../social/_proxy";

export async function POST(
  request: Request,
  context: { params: Promise<{ replyId: string }> },
) {
  const { replyId } = await context.params;
  if (!/^\d+$/.test(replyId)) {
    return Response.json({ ok: false, message: "A valid reply ID is required." }, { status: 400 });
  }
  return forwardJson(request, `/reply-requests/${replyId}/complete`);
}
