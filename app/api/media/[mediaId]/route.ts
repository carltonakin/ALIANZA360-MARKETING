import { isSocialConfigAdmin } from "../../social/_config";
import { proxySocialRequest } from "../../social/_proxy";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: RouteContext<"/api/media/[mediaId]">) {
  if (!isSocialConfigAdmin(request)) {
    return Response.json({ ok: false, error: "Only the site owner can remove campaign media." }, { status: 403 });
  }
  const { mediaId } = await context.params;
  const body = await request.json().catch(() => ({}));
  return proxySocialRequest(`/api/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
