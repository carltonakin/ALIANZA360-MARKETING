export const INSTAGRAM_VIDEO_MAX_BYTES = 300 * 1024 * 1024;

function isSupportedReelAspectRatio(width, height) {
  if (!width || !height) return false;
  const ratio = width / height;
  return ratio >= (9 / 16) - 0.01 && ratio <= (4 / 5) + 0.01;
}

export function instagramVideoValidationErrors(metadata, {
  postType,
  sizeBytes,
  services = [],
} = {}) {
  const selectedServices = new Set(services.map((service) => String(service || "").toLowerCase()));
  if (!selectedServices.has("instagram")) return [];

  const type = String(postType || "POST").toUpperCase();
  const errors = [];
  if (type === "POST") {
    errors.push("Instagram no longer accepts a standard video Post through Buffer. Choose Reel or Story.");
    return errors;
  }
  if (!new Set(["REEL", "STORY"]).has(type)) {
    errors.push("Instagram video must use the Reel or Story post type.");
    return errors;
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > INSTAGRAM_VIDEO_MAX_BYTES) {
    errors.push("Instagram videos sent through Buffer must be 300 MB or smaller.");
  }
  if (!/^avc[13](?:\.|$)/i.test(String(metadata.videoCodec || ""))) {
    errors.push("Use H.264 video (codec avc1/avc3); Buffer does not reliably publish HEVC, AV1, or ProRes to Instagram.");
  }
  if (metadata.audioCodec && !/^mp4a(?:\.|$)/i.test(String(metadata.audioCodec))) {
    errors.push("Instagram video audio must use AAC.");
  }
  if (Number(metadata.frameRate) < 23 || Number(metadata.frameRate) > 60) {
    errors.push("Instagram video frame rate must be between 23 and 60 FPS.");
  }
  if (Number(metadata.videoBitrate) > 25_000_000) {
    errors.push("Instagram video bitrate must not exceed 25 Mbps.");
  }
  if (metadata.audioBitrate != null && Number(metadata.audioBitrate) > 128_000) {
    errors.push("Instagram audio bitrate must not exceed 128 kbps.");
  }

  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    errors.push("The video width and height could not be verified.");
  } else {
    if (type === "REEL" && !isSupportedReelAspectRatio(width, height)) {
      errors.push(`Instagram Reels sent through Buffer require an aspect ratio from 9:16 through 4:5; this file is ${width}x${height}.`);
    }
    if (type === "REEL" && width > 1920) {
      errors.push("Instagram Reels may not exceed 1920 horizontal pixels.");
    }
  }

  const duration = Number(metadata.durationSeconds);
  const minimum = type === "REEL" ? 5 : 3;
  const maximum = type === "REEL" ? 15 * 60 : 60;
  if (!Number.isFinite(duration) || duration < minimum || duration > maximum) {
    errors.push(`Instagram ${type === "REEL" ? "Reels" : "Stories"} must be between ${minimum} seconds and ${maximum === 60 ? "60 seconds" : "15 minutes"}.`);
  }
  return errors;
}

export function browserVideoValidationErrors(metadata, options) {
  const assumed = {
    ...metadata,
    videoCodec: "avc1",
    audioCodec: null,
    audioSampleRate: null,
    videoBitrate: 0,
    audioBitrate: null,
    frameRate: 30,
  };
  return instagramVideoValidationErrors(assumed, options).filter((message) =>
    !/H\.264|audio|frame rate|bitrate/i.test(message));
}
