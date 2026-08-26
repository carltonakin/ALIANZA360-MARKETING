import { campaignMediaPublicUrl } from "../../../../lib/campaign-media.mjs";
import { isSocialConfigAdmin } from "../../social/_config";
import { proxySocialRequest } from "../../social/_proxy";

export const runtime = "nodejs";

async function legacyRedirect(request: Request, context: RouteContext<"/api/media/[mediaId]">) {
  try {
    const { mediaId } = await context.params;
    return Response.redirect(campaignMediaPublicUrl(mediaId, request.url, process.env), 308);
  } catch (error) {
    const status = Number.isInteger((error as { statusCode?: number })?.statusCode)
      ? (error as { statusCode: number }).statusCode
      : 500;
    return Response.json({ ok: false, error: status === 404 ? "Media was not found." : "Media could not be loaded." }, { status });
  }
}

export async function GET(request: Request, context: RouteContext<"/api/media/[mediaId]">) {
  return legacyRedirect(request, context);
}

export async function HEAD(request: Request, context: RouteContext<"/api/media/[mediaId]">) {
  return legacyRedirect(request, context);
}

export async function DELETE(request: Request, context: RouteContext<"/api/media/[mediaId]">) {
  if (!isSocialConfigAdmin(request)) {
    return Response.json({ ok: false, error: "Only the site owner can remove campaign media." }, { status: 403 });
  }
  const { mediaId } = await context.params;
  return proxySocialRequest(`/api/media/${encodeURIComponent(mediaId)}`, { method: "DELETE" });
}
