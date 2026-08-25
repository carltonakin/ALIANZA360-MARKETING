import { isSocialConfigAdmin } from "../social/_config";
import { storeCampaignMedia } from "../../../lib/campaign-media.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSocialConfigAdmin(request)) {
    return Response.json({ ok: false, error: "Only the site owner can upload campaign media." }, { status: 403 });
  }

  const configuredLimit = Number(process.env.CAMPAIGN_MEDIA_MAX_BYTES || 100 * 1024 * 1024);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength && contentLength > configuredLimit + 1024 * 1024) {
    return Response.json({ ok: false, error: "The campaign media upload is too large." }, { status: 413 });
  }

  try {
    const form = await request.formData();
    const file = form.get("media");
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: "Choose an image or video file to upload." }, { status: 400 });
    }
    const media = await storeCampaignMedia(file, { requestUrl: request.url, env: process.env });
    return Response.json({ ok: true, media }, { status: 201 });
  } catch (error) {
    const status = Number.isInteger((error as { statusCode?: number })?.statusCode)
      ? (error as { statusCode: number }).statusCode
      : 500;
    return Response.json({
      ok: false,
      error: status < 500 && error instanceof Error ? error.message : "The campaign media could not be stored.",
    }, { status });
  }
}

