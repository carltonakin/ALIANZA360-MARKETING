import { proxySocialRequest } from "../../social/_proxy";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: RouteContext<"/api/media/[mediaId]">) {
  const { mediaId } = await context.params;
  const body = await request.json().catch(() => ({}));
  return proxySocialRequest(`/api/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
