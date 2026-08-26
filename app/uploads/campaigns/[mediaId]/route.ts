import { proxySocialStream } from "../../../api/social/_proxy";
import { campaignMediaPublicPath } from "../../../../lib/campaign-media.mjs";

export const runtime = "nodejs";

function validMediaId(value: string) {
  return /^[0-9a-f-]{36}\.(?:jpg|png|webp|gif|mp4|mov)$/i.test(value);
}

async function serve(
  request: Request,
  context: RouteContext<"/uploads/campaigns/[mediaId]">,
) {
  const { mediaId } = await context.params;
  if (!validMediaId(mediaId)) {
    return Response.json({ ok: false, error: "Media was not found." }, { status: 404 });
  }
  const range = request.headers.get("range");
  return proxySocialStream(`${campaignMediaPublicPath(process.env)}/${encodeURIComponent(mediaId)}`, {
    method: request.method,
    cache: "no-store",
    headers: range ? { range } : undefined,
  }, { requiresServiceToken: false });
}

export async function GET(
  request: Request,
  context: RouteContext<"/uploads/campaigns/[mediaId]">,
) {
  return serve(request, context);
}

export async function HEAD(
  request: Request,
  context: RouteContext<"/uploads/campaigns/[mediaId]">,
) {
  return serve(request, context);
}
