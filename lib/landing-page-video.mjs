export const LANDING_PAGE_SUBMIT_TEXT = "Register Now for an Interview";
export const LANDING_PAGE_VIDEO_SOURCES = Object.freeze(["NONE", "UPLOAD", "EXTERNAL_URL"]);
export const LANDING_PAGE_VIDEO_PROVIDERS = Object.freeze(["CLOUDINARY", "YOUTUBE", "VIMEO", "CANVA"]);
export const LANDING_PAGE_MEDIA_MODES = Object.freeze(["NONE", "VIDEO_ONLY", "PICTURE_ONLY", "VIDEO_AND_PICTURE"]);
export const LANDING_PAGE_MEDIA_ORDERS = Object.freeze(["VIDEO_FIRST", "PICTURE_FIRST"]);

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseHttpUrl(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (normalized.length > 2048) throw validationError(`${label} must be 2048 characters or fewer.`);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw validationError(`${label} must be a valid HTTP or HTTPS URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw validationError(`${label} must use HTTP or HTTPS.`);
  }
  return parsed;
}

function youtubeId(parsed) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0] || "";
  if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) return "";
  if (parsed.pathname === "/watch") return parsed.searchParams.get("v") || "";
  const parts = parsed.pathname.split("/").filter(Boolean);
  return ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] || "" : "";
}

function normalizeYouTube(parsed) {
  const id = youtubeId(parsed);
  if (!/^[A-Za-z0-9_-]{6,15}$/.test(id)) return null;
  return {
    provider: "YOUTUBE",
    url: `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&controls=1`,
  };
}

function normalizeVimeo(parsed) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!["vimeo.com", "player.vimeo.com"].includes(host)) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const id = host === "player.vimeo.com" && parts[0] === "video" ? parts[1] : parts[0];
  if (!/^\d{5,12}$/.test(id || "")) return null;
  return {
    provider: "VIMEO",
    url: `https://player.vimeo.com/video/${id}?autoplay=1&muted=1&playsinline=1`,
  };
}

function normalizeCanva(parsed) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "canva.com") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "design" || !/^[A-Za-z0-9_-]{6,80}$/.test(parts[1] || "")) return null;
  if (!["view", "watch"].includes(parts[2])) return null;
  return {
    provider: "CANVA",
    url: `https://www.canva.com/design/${parts[1]}/${parts[2]}?embed`,
  };
}

export function normalizeExternalVideoUrl(value) {
  const parsed = parseHttpUrl(value, "External video URL");
  if (!parsed) throw validationError("External video URL is required.");
  if (parsed.protocol !== "https:") throw validationError("External video URL must use HTTPS.");
  const normalized = normalizeYouTube(parsed) || normalizeVimeo(parsed) || normalizeCanva(parsed);
  if (!normalized) {
    throw validationError("Use a valid YouTube watch/share URL, Vimeo video URL, or public Canva view/watch URL. Canva editor links cannot be embedded.");
  }
  return normalized;
}

export function normalizeLandingPageVideo(input = {}) {
  const sourceType = String(input.videoSourceType || "NONE").trim().toUpperCase();
  if (!LANDING_PAGE_VIDEO_SOURCES.includes(sourceType)) {
    throw validationError("Video source must be None, Upload, or External URL.");
  }

  const playback = {
    videoAutoplay: input.videoAutoplay === undefined ? true : Boolean(input.videoAutoplay),
    videoMuted: input.videoMuted === undefined ? true : Boolean(input.videoMuted),
    videoShowControls: input.videoShowControls === undefined ? true : Boolean(input.videoShowControls),
  };

  if (sourceType === "NONE") {
    return {
      videoSourceType: "NONE",
      videoUrl: null,
      videoProvider: null,
      cloudinaryAssetId: null,
      cloudinaryPublicId: null,
      cloudinaryResourceType: null,
      ...playback,
    };
  }

  if (sourceType === "EXTERNAL_URL") {
    const external = normalizeExternalVideoUrl(input.videoUrl);
    return {
      videoSourceType: sourceType,
      videoUrl: external.url,
      videoProvider: external.provider,
      cloudinaryAssetId: null,
      cloudinaryPublicId: null,
      cloudinaryResourceType: null,
      ...playback,
    };
  }

  const videoUrl = parseHttpUrl(input.videoUrl, "Uploaded video URL");
  const assetId = String(input.cloudinaryAssetId || "").trim();
  const publicId = String(input.cloudinaryPublicId || "").trim();
  const resourceType = String(input.cloudinaryResourceType || "").trim().toLowerCase();
  if (!videoUrl || videoUrl.protocol !== "https:" || !assetId || !publicId || resourceType !== "video") {
    throw validationError("Uploaded video must include its secure Cloudinary URL, asset ID, public ID, and video resource type.");
  }
  if (assetId.length > 255 || publicId.length > 500) {
    throw validationError("Cloudinary video identifiers exceed their storage limit.");
  }
  return {
    videoSourceType: sourceType,
    videoUrl: videoUrl.toString(),
    videoProvider: "CLOUDINARY",
    cloudinaryAssetId: assetId,
    cloudinaryPublicId: publicId,
    cloudinaryResourceType: "video",
    ...playback,
  };
}

export function resolvePersistedLandingPageVideo(input = {}) {
  const playback = {
    videoAutoplay: input.videoAutoplay === undefined || input.videoAutoplay === null
      ? true
      : Boolean(input.videoAutoplay),
    videoMuted: input.videoMuted === undefined || input.videoMuted === null
      ? true
      : Boolean(input.videoMuted),
    videoShowControls: input.videoShowControls === undefined || input.videoShowControls === null
      ? true
      : Boolean(input.videoShowControls),
  };
  const videoUrl = String(input.videoUrl || "").trim();
  if (!videoUrl) return normalizeLandingPageVideo({ videoSourceType: "NONE", ...playback });

  const sourceType = String(input.videoSourceType || "").trim().toUpperCase();
  const provider = String(input.videoProvider || "").trim().toUpperCase();
  const assetId = String(input.cloudinaryAssetId || "").trim();
  const publicId = String(input.cloudinaryPublicId || "").trim();
  const resourceType = String(input.cloudinaryResourceType || "").trim().toLowerCase();

  try {
    const parsed = parseHttpUrl(videoUrl, "Saved video URL");
    const isCloudinaryDeliveryUrl = parsed?.hostname.toLowerCase() === "res.cloudinary.com" &&
      parsed.pathname.toLowerCase().includes("/video/");
    const hasCloudinaryIdentity = Boolean(assetId || publicId || resourceType === "video");
    if ((sourceType === "UPLOAD" || provider === "CLOUDINARY" || isCloudinaryDeliveryUrl || hasCloudinaryIdentity) &&
        parsed?.protocol === "https:") {
      return {
        videoSourceType: "UPLOAD",
        videoUrl: parsed.toString(),
        videoProvider: "CLOUDINARY",
        cloudinaryAssetId: assetId || null,
        cloudinaryPublicId: publicId || null,
        cloudinaryResourceType: "video",
        ...playback,
      };
    }

    const external = normalizeExternalVideoUrl(videoUrl);
    return {
      videoSourceType: "EXTERNAL_URL",
      videoUrl: external.url,
      videoProvider: external.provider,
      cloudinaryAssetId: null,
      cloudinaryPublicId: null,
      cloudinaryResourceType: null,
      ...playback,
    };
  } catch {
    // Persisted legacy values are untrusted input. Invalid or unsupported URLs
    // are intentionally omitted rather than being passed to an iframe.
    return normalizeLandingPageVideo({ videoSourceType: "NONE", ...playback });
  }
}

function emptyLandingPagePicture() {
  return {
    pictureUrl: null,
    pictureCloudinaryAssetId: null,
    pictureCloudinaryPublicId: null,
    pictureCloudinaryResourceType: null,
  };
}

export function normalizeLandingPagePicture(input = {}) {
  const pictureUrl = parseHttpUrl(input.pictureUrl, "Teaser picture URL");
  const assetId = String(input.pictureCloudinaryAssetId || "").trim();
  const publicId = String(input.pictureCloudinaryPublicId || "").trim();
  const resourceType = String(input.pictureCloudinaryResourceType || "").trim().toLowerCase();
  const isCloudinaryImage = pictureUrl?.hostname.toLowerCase() === "res.cloudinary.com" &&
    pictureUrl.pathname.toLowerCase().includes("/image/");
  if (!pictureUrl || pictureUrl.protocol !== "https:" || !isCloudinaryImage || !assetId || !publicId || resourceType !== "image") {
    throw validationError("Teaser picture must include its secure Cloudinary URL, asset ID, public ID, and image resource type.");
  }
  if (assetId.length > 255 || publicId.length > 500) {
    throw validationError("Cloudinary picture identifiers exceed their storage limit.");
  }
  return {
    pictureUrl: pictureUrl.toString(),
    pictureCloudinaryAssetId: assetId,
    pictureCloudinaryPublicId: publicId,
    pictureCloudinaryResourceType: "image",
  };
}

export function resolvePersistedLandingPagePicture(input = {}) {
  const pictureUrl = String(input.pictureUrl || "").trim();
  if (!pictureUrl) return emptyLandingPagePicture();
  try {
    const parsed = parseHttpUrl(pictureUrl, "Saved teaser picture URL");
    const assetId = String(input.pictureCloudinaryAssetId || "").trim();
    const publicId = String(input.pictureCloudinaryPublicId || "").trim();
    const cloudinaryUrl = parsed?.hostname.toLowerCase() === "res.cloudinary.com" &&
      parsed.pathname.toLowerCase().includes("/image/");
    if (parsed?.protocol !== "https:" || !cloudinaryUrl) {
      return emptyLandingPagePicture();
    }
    return {
      pictureUrl: parsed.toString(),
      pictureCloudinaryAssetId: assetId || null,
      pictureCloudinaryPublicId: publicId || null,
      pictureCloudinaryResourceType: "image",
    };
  } catch {
    return emptyLandingPagePicture();
  }
}

export function normalizeLandingPageMedia(input = {}) {
  const sourceType = String(input.videoSourceType || "NONE").trim().toUpperCase();
  const inferredVideo = sourceType !== "NONE" && Boolean(String(input.videoUrl || "").trim());
  const inferredPicture = Boolean(String(input.pictureUrl || "").trim());
  const inferredMode = inferredVideo && inferredPicture
    ? "VIDEO_AND_PICTURE"
    : inferredVideo
      ? "VIDEO_ONLY"
      : inferredPicture
        ? "PICTURE_ONLY"
        : "NONE";
  const mediaMode = String(input.mediaMode || inferredMode).trim().toUpperCase();
  const mediaOrder = String(input.mediaOrder || "VIDEO_FIRST").trim().toUpperCase();
  if (!LANDING_PAGE_MEDIA_MODES.includes(mediaMode)) {
    throw validationError("Teaser media must be none, video only, picture only, or video and picture.");
  }
  if (!LANDING_PAGE_MEDIA_ORDERS.includes(mediaOrder)) {
    throw validationError("Teaser media order must be video first or picture first.");
  }

  const includesVideo = mediaMode === "VIDEO_ONLY" || mediaMode === "VIDEO_AND_PICTURE";
  const includesPicture = mediaMode === "PICTURE_ONLY" || mediaMode === "VIDEO_AND_PICTURE";
  const video = includesVideo
    ? normalizeLandingPageVideo(input)
    : normalizeLandingPageVideo({
        videoSourceType: "NONE",
        videoAutoplay: input.videoAutoplay,
        videoMuted: input.videoMuted,
        videoShowControls: input.videoShowControls,
      });
  if (includesVideo && video.videoSourceType === "NONE") {
    throw validationError("Choose a teaser video or change the teaser media selection.");
  }
  const picture = includesPicture ? normalizeLandingPagePicture(input) : emptyLandingPagePicture();
  return { mediaMode, mediaOrder, ...video, ...picture };
}

export function resolvePersistedLandingPageMedia(input = {}) {
  const video = resolvePersistedLandingPageVideo(input);
  const picture = resolvePersistedLandingPagePicture(input);
  const inferredMode = video.videoUrl && picture.pictureUrl
    ? "VIDEO_AND_PICTURE"
    : video.videoUrl
      ? "VIDEO_ONLY"
      : picture.pictureUrl
        ? "PICTURE_ONLY"
        : "NONE";
  const storedMode = String(input.mediaMode || "").trim().toUpperCase();
  const storedOrder = String(input.mediaOrder || "").trim().toUpperCase();
  return {
    mediaMode: LANDING_PAGE_MEDIA_MODES.includes(storedMode) ? storedMode : inferredMode,
    mediaOrder: LANDING_PAGE_MEDIA_ORDERS.includes(storedOrder) ? storedOrder : "VIDEO_FIRST",
    ...video,
    ...picture,
  };
}

export function normalizeLandingPageCta(enabledValue, textValue, urlValue) {
  const enabled = Boolean(enabledValue);
  const text = String(textValue || "").trim();
  const rawUrl = String(urlValue || "").trim();
  if (text.length > 255) throw validationError("CTA button title must be 255 characters or fewer.");
  const url = rawUrl ? parseHttpUrl(rawUrl, "CTA URL")?.toString() || null : null;
  if (enabled && (!text || !url)) {
    throw validationError("Enable the CTA only after providing both its button title and destination URL.");
  }
  return {
    preVideoCtaEnabled: enabled,
    preVideoCtaText: text || null,
    preVideoCtaUrl: url,
  };
}

export function normalizeOptionalCta(textValue, urlValue) {
  const text = String(textValue || "").trim();
  const rawUrl = String(urlValue || "").trim();
  if (!text && !rawUrl) return { preVideoCtaText: null, preVideoCtaUrl: null };
  if (!text || !rawUrl) throw validationError("CTA button title and URL must either both be provided or both be left blank.");
  if (text.length > 255) throw validationError("CTA button title must be 255 characters or fewer.");
  const url = parseHttpUrl(rawUrl, "CTA URL");
  return { preVideoCtaText: text, preVideoCtaUrl: url.toString() };
}
