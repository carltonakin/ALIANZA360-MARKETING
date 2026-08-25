import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_CAMPAIGN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

const MEDIA_TYPES = Object.freeze({
  "image/jpeg": { mediaType: "image", extensions: ["jpg", "jpeg"], canonicalExtension: "jpg" },
  "image/png": { mediaType: "image", extensions: ["png"], canonicalExtension: "png" },
  "image/webp": { mediaType: "image", extensions: ["webp"], canonicalExtension: "webp" },
  "image/gif": { mediaType: "image", extensions: ["gif"], canonicalExtension: "gif" },
  "video/mp4": { mediaType: "video", extensions: ["mp4"], canonicalExtension: "mp4" },
  "video/quicktime": { mediaType: "video", extensions: ["mov"], canonicalExtension: "mov" },
});

const FILE_ID = /^[0-9a-f-]{36}\.(?:jpg|png|webp|gif|mp4|mov)$/i;

function mediaError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function configuredMaximum(env = process.env) {
  const value = Number(env.CAMPAIGN_MEDIA_MAX_BYTES || DEFAULT_CAMPAIGN_MEDIA_MAX_BYTES);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_CAMPAIGN_MEDIA_MAX_BYTES;
}

function extensionOf(filename) {
  return path.extname(String(filename || "")).slice(1).toLowerCase();
}

function matchesSignature(bytes, mimeType) {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") return bytes.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}

export function campaignMediaDirectory(env = process.env) {
  const configured = String(env.CAMPAIGN_MEDIA_DIRECTORY || "").trim();
  return path.resolve(/* turbopackIgnore: true */ configured || path.join(process.cwd(), "var", "campaign-media"));
}

export function validateCampaignMedia({ filename, mimeType, size, bytes }, env = process.env) {
  const normalizedMime = String(mimeType || "").trim().toLowerCase();
  const rule = MEDIA_TYPES[normalizedMime];
  if (!rule) throw mediaError("Upload a JPEG, PNG, WebP, GIF, MP4, or MOV file.");

  const extension = extensionOf(filename);
  if (!rule.extensions.includes(extension)) {
    throw mediaError(`The .${extension || "unknown"} extension does not match ${normalizedMime}.`);
  }

  const byteLength = Number(size);
  const maximum = configuredMaximum(env);
  if (!Number.isInteger(byteLength) || byteLength < 1) throw mediaError("The selected media file is empty.");
  if (byteLength > maximum) {
    throw mediaError(`The selected media exceeds the ${Math.floor(maximum / 1024 / 1024)} MB upload limit.`, 413);
  }

  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buffer.length !== byteLength || !matchesSignature(buffer, normalizedMime)) {
    throw mediaError("The media contents do not match the declared file type.");
  }

  return {
    mediaType: rule.mediaType,
    mimeType: normalizedMime,
    originalName: path.basename(String(filename)).slice(0, 255),
    sizeBytes: byteLength,
    extension: rule.canonicalExtension,
    bytes: buffer,
  };
}

export function mediaPublicBaseUrl(requestUrl, env = process.env) {
  const configured = String(env.CAMPAIGN_MEDIA_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:") throw mediaError("CAMPAIGN_MEDIA_PUBLIC_BASE_URL must use HTTPS.", 503);
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  }

  const requestOrigin = new URL(requestUrl).origin;
  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    throw mediaError("CAMPAIGN_MEDIA_PUBLIC_BASE_URL must be configured before production media uploads.", 503);
  }
  return requestOrigin;
}

/**
 * @param {File} file
 * @param {{ requestUrl: string, env?: Record<string, string | undefined> }} options
 */
export async function storeCampaignMedia(file, { requestUrl, env = process.env }) {
  if (!file || typeof file.arrayBuffer !== "function") throw mediaError("Choose an image or video file to upload.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const validated = validateCampaignMedia({
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    bytes,
  }, env);
  const publicBaseUrl = mediaPublicBaseUrl(requestUrl, env);
  const mediaId = `${randomUUID()}.${validated.extension}`;
  const directory = campaignMediaDirectory(env);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(/* turbopackIgnore: true */ directory, mediaId), validated.bytes, { flag: "wx" });
  return {
    mediaId,
    mediaType: validated.mediaType,
    mediaUrl: `${publicBaseUrl}/api/media/${mediaId}`,
    mediaOriginalName: validated.originalName,
    mediaMimeType: validated.mimeType,
    mediaSizeBytes: validated.sizeBytes,
  };
}

export async function readCampaignMedia(mediaId, env = process.env) {
  const normalizedId = String(mediaId || "").trim();
  if (!FILE_ID.test(normalizedId)) throw mediaError("Media was not found.", 404);
  const extension = extensionOf(normalizedId);
  const entry = Object.entries(MEDIA_TYPES).find(([, rule]) => rule.canonicalExtension === extension);
  if (!entry) throw mediaError("Media was not found.", 404);
  try {
    return {
      bytes: await readFile(path.join(/* turbopackIgnore: true */ campaignMediaDirectory(env), normalizedId)),
      mimeType: entry[0],
    };
  } catch (error) {
    if (error?.code === "ENOENT") throw mediaError("Media was not found.", 404);
    throw error;
  }
}
