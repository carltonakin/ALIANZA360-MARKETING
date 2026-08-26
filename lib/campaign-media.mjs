import path from "node:path";
import { uploadCampaignMediaToCloudinary } from "./cloudinary-campaign-media.mjs";
import { inspectCampaignVideo } from "./instagram-video.mjs";
import {
  instagramVideoValidationErrors,
  INSTAGRAM_VIDEO_MAX_BYTES,
} from "./instagram-video-validation.mjs";

export const DEFAULT_CAMPAIGN_MEDIA_MAX_BYTES = INSTAGRAM_VIDEO_MAX_BYTES;

const MEDIA_TYPES = Object.freeze({
  "image/jpeg": { mediaType: "image", extensions: ["jpg", "jpeg"] },
  "image/png": { mediaType: "image", extensions: ["png"] },
  "image/webp": { mediaType: "image", extensions: ["webp"] },
  "image/gif": { mediaType: "image", extensions: ["gif"] },
  "video/mp4": { mediaType: "video", extensions: ["mp4"] },
  "video/quicktime": { mediaType: "video", extensions: ["mov"] },
});

function mediaError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function campaignMediaMaximumBytes(env = process.env) {
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
    bytes: buffer,
  };
}

async function inspectAndUploadCampaignMedia(validated, {
  env = process.env,
  postType = "POST",
  targetServices = [],
  inspectVideo = inspectCampaignVideo,
  uploadMedia = uploadCampaignMediaToCloudinary,
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

  const uploaded = await uploadMedia(validated, { env });
  return {
    mediaId: uploaded.assetId,
    assetId: uploaded.assetId,
    publicId: uploaded.publicId,
    resourceType: uploaded.resourceType,
    format: uploaded.format,
    mediaType: validated.mediaType,
    mediaUrl: uploaded.mediaUrl,
    mediaOriginalName: validated.originalName,
    originalFileName: validated.originalName,
    mediaMimeType: validated.mimeType,
    mimeType: validated.mimeType,
    mediaSizeBytes: uploaded.size,
    size: uploaded.size,
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

export async function storeCampaignMedia(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== "function") throw mediaError("Choose an image or video file to upload.");
  const bytes = Buffer.from(await file.arrayBuffer());
  return storeCampaignMediaBuffer({
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    bytes,
  }, options);
}

export async function storeCampaignMediaBuffer({ filename, mimeType, size, bytes }, options = {}) {
  const env = options.env || process.env;
  const validated = validateCampaignMedia({ filename, mimeType, size, bytes }, env);
  return inspectAndUploadCampaignMedia(validated, { ...options, env });
}
