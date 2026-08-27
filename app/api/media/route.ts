import { proxySocialRequest } from "../social/_proxy";
import { INSTAGRAM_VIDEO_MAX_BYTES } from "../../../lib/instagram-video-validation.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const configuredLimit = Number(process.env.CAMPAIGN_MEDIA_MAX_BYTES || INSTAGRAM_VIDEO_MAX_BYTES);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength && contentLength > configuredLimit + 1024 * 1024) {
    return Response.json({ ok: false, error: "The campaign media upload is too large." }, { status: 413 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return Response.json({ ok: false, error: "Campaign media uploads must use multipart/form-data." }, { status: 415 });
  }
  if (!request.body) {
    return Response.json({ ok: false, error: "Choose an image or video file to upload." }, { status: 400 });
  }

  const headers = new Headers({ "content-type": contentType });
  if (contentLength) headers.set("content-length", String(contentLength));
  const uploadRequest: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body: request.body,
    duplex: "half",
  };
  return proxySocialRequest("/api/media", uploadRequest);
}
