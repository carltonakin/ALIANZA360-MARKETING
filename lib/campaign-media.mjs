import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { inspectCampaignVideo } from "./instagram-video.mjs";
import {
  instagramVideoValidationErrors,
  INSTAGRAM_VIDEO_MAX_BYTES,
} from "./instagram-video-validation.mjs";

export const DEFAULT_CAMPAIGN_MEDIA_MAX_BYTES = INSTAGRAM_VIDEO_MAX_BYTES;
export const DEFAULT_CAMPAIGN_MEDIA_PUBLIC_PATH = "/uploads/campaigns";

const MEDIA_TYPES = Object.freeze({
  "image/jpeg": { mediaType: "image", extensions: ["jpg", "jpeg"], canonicalExtension: "jpg" },
  "image/png": { mediaType: "image", extensions: ["png"], canonicalExtension: "png" },
  "image/webp": { mediaType: "image", extensions: ["webp"], canonicalExtension: "webp" },
  "image/gif": { mediaType: "image", extensions: ["gif"], canonicalExtension: "gif" },
  "video/mp4": { mediaType: "video", extensions: ["mp4"], canonicalExtension: "mp4" },
  "video/quicktime": { mediaType: "video", extensions: ["mov"], canonicalExtension: "mov" },
});

const FILE_ID = /^[0-9a-f-]{36}\.(?:jpg|png|webp|gif|mp4|mov)$/i;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mediaError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function campaignMediaMaximumBytes(env = process.env) {
  const value = Number(env.CAMPAIGN_MEDIA_MAX_BYTES || DEFAULT_CAMPAIGN_MEDIA_MAX_BYTES);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_CAMPAIGN_MEDIA_MAX_BYTES;
}

export function campaignMediaPublicPath(env = process.env) {
  const configured = String(env.CAMPAIGN_MEDIA_PUBLIC_PATH || DEFAULT_CAMPAIGN_MEDIA_PUBLIC_PATH)
    .trim()
    .replace(/\/$/, "");
  if (configured !== DEFAULT_CAMPAIGN_MEDIA_PUBLIC_PATH) {
    throw mediaError(`CAMPAIGN_MEDIA_PUBLIC_PATH must be ${DEFAULT_CAMPAIGN_MEDIA_PUBLIC_PATH}.`, 503);
  }
  return configured;
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
  if (/^<[^>]+>$/.test(configured)) {
    throw mediaError("CAMPAIGN_MEDIA_DIRECTORY still contains a placeholder and must be configured.", 503);
  }
  const fallback = path.join(PROJECT_ROOT, "App_Data", "campaign-media");
  return path.resolve(/* turbopackIgnore: true */ PROJECT_ROOT, configured || fallback);
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
  const maximum = campaignMediaMaximumBytes(env);
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
  const production = String(env.NODE_ENV || "").toLowerCase() === "production";
  const configured = String(env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) {
    if (/^<[^>]+>$/.test(configured)) {
      throw mediaError("PUBLIC_BASE_URL still contains a placeholder and must be configured.", 503);
    }
    let parsed;
    try {
      parsed = new URL(configured);
    } catch {
      throw mediaError("PUBLIC_BASE_URL must be a valid URL origin.", 503);
    }
    if (production && parsed.protocol !== "https:") {
      throw mediaError("PUBLIC_BASE_URL must use HTTPS in production.", 503);
    }
    if (!production && !["http:", "https:"].includes(parsed.protocol)) {
      throw mediaError("PUBLIC_BASE_URL must use HTTP or HTTPS.", 503);
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
      throw mediaError("PUBLIC_BASE_URL must contain only the public app origin.", 503);
    }
    if (production) {
      const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      const privateHost = hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1" ||
        hostname === "0.0.0.0" || hostname.startsWith("127.") || hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") || hostname.startsWith("169.254.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
        /^fe[89ab][0-9a-f]:/i.test(hostname);
      if (privateHost) throw mediaError("PUBLIC_BASE_URL must be publicly reachable in production.", 503);
    }
    return parsed.origin;
  }

  if (production) {
    throw mediaError("PUBLIC_BASE_URL is required with the public HTTPS app origin.", 503);
  }
  const request = new URL(requestUrl);
  return request.origin;
}

export function campaignMediaPublicUrl(storedFileName, requestUrl, env = process.env) {
  const normalizedId = String(storedFileName || "").trim();
  if (!FILE_ID.test(normalizedId)) throw mediaError("The stored campaign media filename is invalid.");
  return `${mediaPublicBaseUrl(requestUrl, env)}${campaignMediaPublicPath(env)}/${normalizedId}`;
}

async function inspectAndStoreCampaignMedia(validated, {
  requestUrl,
  env = process.env,
  postType = "POST",
  targetServices = [],
  inspectVideo = inspectCampaignVideo,
}) {
  let videoMetadata = null;
  if (validated.mediaType === "video") {
    try {
      videoMetadata = await inspectVideo(validated.bytes);
    } catch (error) {
      throw mediaError(error instanceof Error ? error.message : "The video container could not be parsed.");
    }
    const videoErrors = instagramVideoValidationErrors(videoMetadata, {
      postType,
      services: targetServices,
      sizeBytes: validated.sizeBytes,
    });
    if (videoErrors.length) throw mediaError(videoErrors.join(" "));
  }
  const mediaId = `${randomUUID()}.${validated.extension}`;
  const directory = campaignMediaDirectory(env);
  const diskPath = path.join(/* turbopackIgnore: true */ directory, mediaId);
  const mediaUrl = campaignMediaPublicUrl(mediaId, requestUrl, env);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(diskPath, validated.bytes, { flag: "wx" });
    const written = await stat(diskPath);
    if (!written.isFile() || written.size !== validated.sizeBytes) {
      await unlink(diskPath).catch(() => {});
      throw mediaError("Campaign media storage verification failed.", 503);
    }
  } catch (error) {
    if (["EACCES", "EPERM", "EROFS", "EINVAL", "ENOENT"].includes(error?.code)) {
      const storageError = mediaError(
        "Campaign media storage is not writable. Configure CAMPAIGN_MEDIA_DIRECTORY as a persistent writable folder.",
        503,
      );
      storageError.cause = error;
      throw storageError;
    }
    throw error;
  }
  return {
    mediaId,
    storedFileName: mediaId,
    mediaType: validated.mediaType,
    mediaUrl,
    mediaOriginalName: validated.originalName,
    originalFileName: validated.originalName,
    mediaMimeType: validated.mimeType,
    mimeType: validated.mimeType,
    mediaSizeBytes: validated.sizeBytes,
    size: validated.sizeBytes,
    mediaWidth: videoMetadata?.width ?? null,
    mediaHeight: videoMetadata?.height ?? null,
    mediaDurationSeconds: videoMetadata?.durationSeconds ?? null,
    mediaFrameRate: videoMetadata?.frameRate ?? null,
    mediaVideoCodec: videoMetadata?.videoCodec ?? null,
    mediaAudioCodec: videoMetadata?.audioCodec ?? null,
    mediaAudioSampleRate: videoMetadata?.audioSampleRate ?? null,
    mediaVideoBitrate: videoMetadata?.videoBitrate ?? null,
    mediaAudioBitrate: videoMetadata?.audioBitrate ?? null,
  };
}

/**
 * @param {File} file
 * @param {{ requestUrl: string, env?: Record<string, string | undefined>, postType?: string, targetServices?: string[], inspectVideo?: typeof inspectCampaignVideo }} options
 */
export async function storeCampaignMedia(file, {
  requestUrl,
  env = process.env,
  postType = "POST",
  targetServices = [],
  inspectVideo = inspectCampaignVideo,
}) {
  if (!file || typeof file.arrayBuffer !== "function") throw mediaError("Choose an image or video file to upload.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const validated = validateCampaignMedia({
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    bytes,
  }, env);
  return inspectAndStoreCampaignMedia(validated, {
    requestUrl,
    env,
    postType,
    targetServices,
    inspectVideo,
  });
}

export async function storeCampaignMediaBuffer({ filename, mimeType, size, bytes }, options) {
  const env = options?.env || process.env;
  const validated = validateCampaignMedia({ filename, mimeType, size, bytes }, env);
  return inspectAndStoreCampaignMedia(validated, { ...options, env });
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

export async function deleteCampaignMedia(mediaId, env = process.env) {
  const normalizedId = String(mediaId || "").trim();
  if (!FILE_ID.test(normalizedId)) throw mediaError("Media was not found.", 404);
  try {
    await unlink(path.join(/* turbopackIgnore: true */ campaignMediaDirectory(env), normalizedId));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
