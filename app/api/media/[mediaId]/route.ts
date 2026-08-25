import { readCampaignMedia } from "../../../../lib/campaign-media.mjs";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/media/[mediaId]">) {
  try {
    const { mediaId } = await context.params;
    const media = await readCampaignMedia(mediaId, process.env);
    return new Response(media.bytes, {
      headers: {
        "content-type": media.mimeType,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const status = Number.isInteger((error as { statusCode?: number })?.statusCode)
      ? (error as { statusCode: number }).statusCode
      : 500;
    return Response.json({ ok: false, error: status === 404 ? "Media was not found." : "Media could not be loaded." }, { status });
  }
}

