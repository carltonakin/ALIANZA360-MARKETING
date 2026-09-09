import {
  LANDING_PAGE_SUBMIT_TEXT,
  normalizeExternalVideoUrl,
  resolvePersistedLandingPageMedia,
} from "./landing-page-video.mjs";

export const LANDING_PAGE_BLOCK_TYPES = Object.freeze([
  "HERO",
  "TEXT",
  "IMAGE",
  "VIDEO",
  "CTA_BUTTON",
  "REGISTRATION_FORM",
  "SOCIAL_HANDLES",
  "TESTIMONIALS",
  "FAQ",
  "COUNTDOWN",
  "DIVIDER",
  "PAYMENT_CTA",
]);

const BLOCK_TYPE_SET = new Set(LANDING_PAGE_BLOCK_TYPES);
const ALIGNMENTS = new Set(["left", "center", "right"]);

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function text(value, maximum = 16_000) {
  const result = String(value ?? "").trim();
  return result.slice(0, maximum);
}

function bool(value, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function httpUrl(value, label, { required = false } = {}) {
  const candidate = text(value, 2048);
  if (!candidate) {
    if (required) throw invalid(`${label} is required.`);
    return "";
  }
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
    return parsed.toString();
  } catch {
    throw invalid(`${label} must be a valid HTTP or HTTPS URL.`);
  }
}

function cloudinaryImage(config) {
  const url = httpUrl(config.url, "Image URL");
  if (!url) return { url: "", cloudinaryAssetId: "", cloudinaryPublicId: "", cloudinaryResourceType: "" };
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "res.cloudinary.com" || !parsed.pathname.toLowerCase().includes("/image/")) {
    throw invalid("Uploaded images must use a secure Cloudinary delivery URL.");
  }
  return {
    url,
    cloudinaryAssetId: text(config.cloudinaryAssetId, 255),
    cloudinaryPublicId: text(config.cloudinaryPublicId, 500),
    cloudinaryResourceType: "image",
  };
}

function normalizeFormFields(config) {
  const requested = config?.fields && typeof config.fields === "object" ? config.fields : {};
  const result = {};
  for (const field of ["name", "email", "phone", "instagram", "facebook", "x", "message"]) {
    const item = requested[field] && typeof requested[field] === "object" ? requested[field] : {};
    result[field] = {
      enabled: field === "name" || field === "email" ? true : bool(item.enabled, ["phone", "instagram", "facebook", "x"].includes(field)),
      required: field === "name" || field === "email" ? true : bool(item.required, false),
      label: text(item.label, 80) || ({
        name: "Full name",
        email: "Email address",
        phone: "Phone number",
        instagram: "Instagram handle",
        facebook: "Facebook handle",
        x: "X handle",
        message: "How can we help?",
      })[field],
    };
    if (!result[field].enabled) result[field].required = false;
  }
  return result;
}

export function defaultLandingPageBlock(type, key = `block-${Date.now()}`) {
  const normalizedType = String(type || "").toUpperCase();
  if (!BLOCK_TYPE_SET.has(normalizedType)) throw invalid("Unsupported landing-page block type.");
  const configs = {
    HERO: { eyebrow: "BUILD A BETTER GROWTH ENGINE", headline: "A clear path to your next level", body: "Show visitors the outcome they can expect.", alignment: "left", backgroundUrl: "" },
    TEXT: { heading: "Tell your story", body: "Add the details your audience needs to take the next step.", alignment: "left" },
    IMAGE: { url: "", alt: "", caption: "", cloudinaryAssetId: "", cloudinaryPublicId: "", cloudinaryResourceType: "" },
    VIDEO: { videoSourceType: "NONE", videoUrl: "", videoProvider: null, cloudinaryAssetId: "", cloudinaryPublicId: "", cloudinaryResourceType: "", autoplay: true, muted: true, showControls: true },
    CTA_BUTTON: { text: "Get started", url: "", style: "primary", alignment: "left", openInNewTab: false },
    REGISTRATION_FORM: { eyebrow: "FREE ON-DEMAND WEBINAR", heading: "Get instant access", body: "Tell us where to send your resources.", submitButtonText: LANDING_PAGE_SUBMIT_TEXT, postSubmitUrl: "", fields: normalizeFormFields({}) },
    SOCIAL_HANDLES: { heading: "Follow us", instagram: "", facebook: "", x: "", linkedin: "" },
    TESTIMONIALS: { heading: "What people are saying", items: [{ quote: "Add a customer result or recommendation.", name: "Customer name", role: "" }] },
    FAQ: { heading: "Frequently asked questions", items: [{ question: "What will I learn?", answer: "Add a clear and helpful answer." }] },
    COUNTDOWN: { heading: "Registration closes soon", targetAt: "", expiredText: "Registration is now closed." },
    DIVIDER: { spacing: "medium" },
    PAYMENT_CTA: { heading: "Ready to continue?", body: "Choose the option that works for you.", text: "Choose your subscription", url: "", alignment: "center" },
  };
  return { id: text(key, 100), type: normalizedType, sortOrder: 0, enabled: true, config: configs[normalizedType] };
}

function normalizeConfig(type, input = {}) {
  const base = defaultLandingPageBlock(type, "template").config;
  const config = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const alignment = ALIGNMENTS.has(String(config.alignment)) ? String(config.alignment) : base.alignment;
  switch (type) {
    case "HERO": {
      const background = config.backgroundUrl ? cloudinaryImage({
        url: config.backgroundUrl,
        cloudinaryAssetId: config.backgroundCloudinaryAssetId,
        cloudinaryPublicId: config.backgroundCloudinaryPublicId,
      }) : null;
      return { eyebrow: text(config.eyebrow, 255), headline: text(config.headline, 500), body: text(config.body), alignment, backgroundUrl: background?.url || "", backgroundCloudinaryAssetId: background?.cloudinaryAssetId || "", backgroundCloudinaryPublicId: background?.cloudinaryPublicId || "", backgroundCloudinaryResourceType: background ? "image" : "" };
    }
    case "TEXT":
      return { heading: text(config.heading, 500), body: text(config.body), alignment };
    case "IMAGE":
      return { ...cloudinaryImage(config), alt: text(config.alt, 500), caption: text(config.caption, 1000) };
    case "VIDEO": {
      const sourceType = String(config.videoSourceType || "NONE").toUpperCase();
      if (!new Set(["NONE", "UPLOAD", "EXTERNAL_URL"]).has(sourceType)) throw invalid("Video source must be None, Upload, or External URL.");
      let normalized = { videoSourceType: "NONE", videoUrl: "", videoProvider: null, cloudinaryAssetId: "", cloudinaryPublicId: "", cloudinaryResourceType: "" };
      if (sourceType === "EXTERNAL_URL") {
        const external = normalizeExternalVideoUrl(config.videoUrl);
        normalized = { ...normalized, videoSourceType: sourceType, videoUrl: external.url, videoProvider: external.provider };
      } else if (sourceType === "UPLOAD") {
        const url = httpUrl(config.videoUrl, "Uploaded video URL", { required: true });
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "res.cloudinary.com" || !parsed.pathname.toLowerCase().includes("/video/") || !text(config.cloudinaryAssetId, 255) || !text(config.cloudinaryPublicId, 500)) {
          throw invalid("Uploaded video must include a secure Cloudinary URL and media identity.");
        }
        normalized = { videoSourceType: sourceType, videoUrl: url, videoProvider: "CLOUDINARY", cloudinaryAssetId: text(config.cloudinaryAssetId, 255), cloudinaryPublicId: text(config.cloudinaryPublicId, 500), cloudinaryResourceType: "video" };
      }
      return { ...normalized, autoplay: bool(config.autoplay, true), muted: bool(config.muted, true), showControls: bool(config.showControls, true) };
    }
    case "CTA_BUTTON":
      return { text: text(config.text, 255), url: httpUrl(config.url, "CTA URL"), style: config.style === "secondary" ? "secondary" : "primary", alignment, openInNewTab: bool(config.openInNewTab) };
    case "REGISTRATION_FORM":
      return { eyebrow: text(config.eyebrow, 255), heading: text(config.heading, 500), body: text(config.body), submitButtonText: text(config.submitButtonText, 255) || LANDING_PAGE_SUBMIT_TEXT, postSubmitUrl: httpUrl(config.postSubmitUrl, "Post-registration URL"), fields: normalizeFormFields(config) };
    case "SOCIAL_HANDLES":
      return { heading: text(config.heading, 500), instagram: httpUrl(config.instagram, "Instagram URL"), facebook: httpUrl(config.facebook, "Facebook URL"), x: httpUrl(config.x, "X URL"), linkedin: httpUrl(config.linkedin, "LinkedIn URL") };
    case "TESTIMONIALS":
      return { heading: text(config.heading, 500), items: (Array.isArray(config.items) ? config.items : []).slice(0, 12).map((item) => ({ quote: text(item?.quote, 2000), name: text(item?.name, 255), role: text(item?.role, 255) })).filter((item) => item.quote || item.name) };
    case "FAQ":
      return { heading: text(config.heading, 500), items: (Array.isArray(config.items) ? config.items : []).slice(0, 20).map((item) => ({ question: text(item?.question, 500), answer: text(item?.answer, 4000) })).filter((item) => item.question || item.answer) };
    case "COUNTDOWN": {
      const targetAt = text(config.targetAt, 64);
      if (targetAt && Number.isNaN(new Date(targetAt).getTime())) throw invalid("Countdown date is invalid.");
      return { heading: text(config.heading, 500), targetAt: targetAt ? new Date(targetAt).toISOString() : "", expiredText: text(config.expiredText, 500) };
    }
    case "DIVIDER":
      return { spacing: new Set(["small", "medium", "large"]).has(config.spacing) ? config.spacing : "medium" };
    case "PAYMENT_CTA":
      return { heading: text(config.heading, 500), body: text(config.body), text: text(config.text, 255), url: httpUrl(config.url, "Payment URL"), alignment };
    default:
      throw invalid("Unsupported landing-page block type.");
  }
}

export function normalizeLandingPageBlocks(blocks) {
  if (!Array.isArray(blocks)) throw invalid("Landing-page blocks must be an array.");
  if (blocks.length > 100) throw invalid("Landing pages may contain up to 100 blocks.");
  const keys = new Set();
  return blocks.map((block, index) => {
    const type = String(block?.type || block?.blockType || "").toUpperCase();
    if (!BLOCK_TYPE_SET.has(type)) throw invalid(`Unsupported landing-page block type at position ${index + 1}.`);
    let id = text(block?.id || `block-${index + 1}`, 100) || `block-${index + 1}`;
    if (keys.has(id)) id = `${id}-${index + 1}`;
    keys.add(id);
    return { id, type, sortOrder: index, enabled: bool(block?.enabled, true), config: normalizeConfig(type, block?.config) };
  });
}

export function legacyLandingPageBlocks(page = {}) {
  const media = resolvePersistedLandingPageMedia(page);
  const blocks = [];
  blocks.push({ ...defaultLandingPageBlock("HERO", "legacy-hero"), config: { eyebrow: "BUILD A BETTER GROWTH ENGINE", headline: text(page.headline, 500), body: "", alignment: "left", backgroundUrl: "", backgroundCloudinaryAssetId: "", backgroundCloudinaryPublicId: "", backgroundCloudinaryResourceType: "" } });
  if (page.teaser) blocks.push({ ...defaultLandingPageBlock("TEXT", "legacy-text"), config: { heading: "", body: text(page.teaser), alignment: "left" } });
  const picture = { ...defaultLandingPageBlock("IMAGE", "legacy-image"), config: { url: media.pictureUrl || "", alt: `${text(page.headline, 500)} teaser`, caption: "", cloudinaryAssetId: media.pictureCloudinaryAssetId || "", cloudinaryPublicId: media.pictureCloudinaryPublicId || "", cloudinaryResourceType: media.pictureCloudinaryResourceType || "" } };
  const video = { ...defaultLandingPageBlock("VIDEO", "legacy-video"), config: { videoSourceType: media.videoSourceType, videoUrl: media.videoUrl || "", videoProvider: media.videoProvider, cloudinaryAssetId: media.cloudinaryAssetId || "", cloudinaryPublicId: media.cloudinaryPublicId || "", cloudinaryResourceType: media.cloudinaryResourceType || "", autoplay: media.videoAutoplay, muted: media.videoMuted, showControls: media.videoShowControls } };
  const enabledMedia = [];
  if (["VIDEO_ONLY", "VIDEO_AND_PICTURE"].includes(media.mediaMode) && media.videoUrl) enabledMedia.push(video);
  if (["PICTURE_ONLY", "VIDEO_AND_PICTURE"].includes(media.mediaMode) && media.pictureUrl) enabledMedia.push(picture);
  if (media.mediaOrder === "PICTURE_FIRST") enabledMedia.reverse();
  blocks.push(...enabledMedia);
  if ((page.preVideoCtaEnabled ?? Boolean(page.preVideoCtaText && page.preVideoCtaUrl)) && page.preVideoCtaText && page.preVideoCtaUrl) {
    blocks.push({ ...defaultLandingPageBlock("CTA_BUTTON", "legacy-cta"), config: { text: text(page.preVideoCtaText, 255), url: httpUrl(page.preVideoCtaUrl, "CTA URL"), style: "primary", alignment: "left", openInNewTab: false } });
  }
  blocks.push({ ...defaultLandingPageBlock("REGISTRATION_FORM", "legacy-registration"), config: { ...defaultLandingPageBlock("REGISTRATION_FORM").config, submitButtonText: text(page.submitButtonText, 255) || LANDING_PAGE_SUBMIT_TEXT, postSubmitUrl: httpUrl(page.webinarUrl, "Post-registration URL") } });
  if (page.paymentUrl) blocks.push({ ...defaultLandingPageBlock("PAYMENT_CTA", "legacy-payment"), config: { ...defaultLandingPageBlock("PAYMENT_CTA").config, url: httpUrl(page.paymentUrl, "Payment URL") } });
  return blocks.map((block, sortOrder) => ({ ...block, sortOrder }));
}

export function resolveLandingPageBlocks(page = {}) {
  if (Array.isArray(page.blocks) && page.blocks.length) {
    try { return normalizeLandingPageBlocks(page.blocks); } catch { return legacyLandingPageBlocks(page); }
  }
  return legacyLandingPageBlocks(page);
}

export function projectLegacyLandingPageFields(blocks, fallback = {}) {
  const ordered = normalizeLandingPageBlocks(blocks);
  const first = (type) => ordered.find((block) => block.enabled && block.type === type)?.config;
  const hero = first("HERO");
  const copy = first("TEXT");
  const image = first("IMAGE");
  const video = first("VIDEO");
  const cta = first("CTA_BUTTON");
  const registration = first("REGISTRATION_FORM");
  const payment = first("PAYMENT_CTA");
  const hasVideo = Boolean(video?.videoUrl);
  const hasPicture = Boolean(image?.url);
  return {
    headline: hero?.headline || fallback.headline || "Landing page",
    teaser: copy?.body || hero?.body || fallback.teaser || "",
    webinarUrl: registration?.postSubmitUrl || fallback.webinarUrl || "",
    paymentUrl: payment?.url || fallback.paymentUrl || "",
    videoSourceType: hasVideo ? video.videoSourceType : "NONE",
    videoUrl: hasVideo ? video.videoUrl : null,
    videoProvider: hasVideo ? video.videoProvider : null,
    cloudinaryAssetId: hasVideo ? video.cloudinaryAssetId : null,
    cloudinaryPublicId: hasVideo ? video.cloudinaryPublicId : null,
    cloudinaryResourceType: hasVideo ? video.cloudinaryResourceType : null,
    videoAutoplay: video?.autoplay !== false,
    videoMuted: video?.muted !== false,
    videoShowControls: video?.showControls !== false,
    mediaMode: hasVideo && hasPicture ? "VIDEO_AND_PICTURE" : hasVideo ? "VIDEO_ONLY" : hasPicture ? "PICTURE_ONLY" : "NONE",
    mediaOrder: ordered.findIndex((block) => block === ordered.find((item) => item.enabled && item.type === "IMAGE")) < ordered.findIndex((block) => block === ordered.find((item) => item.enabled && item.type === "VIDEO")) ? "PICTURE_FIRST" : "VIDEO_FIRST",
    pictureUrl: hasPicture ? image.url : null,
    pictureCloudinaryAssetId: hasPicture ? image.cloudinaryAssetId : null,
    pictureCloudinaryPublicId: hasPicture ? image.cloudinaryPublicId : null,
    pictureCloudinaryResourceType: hasPicture ? image.cloudinaryResourceType : null,
    preVideoCtaEnabled: Boolean(cta?.text && cta?.url),
    preVideoCtaText: cta?.text || null,
    preVideoCtaUrl: cta?.url || null,
    submitButtonText: registration?.submitButtonText || LANDING_PAGE_SUBMIT_TEXT,
  };
}

export function landingPageMediaReferences(pageOrBlocks) {
  const blocks = Array.isArray(pageOrBlocks) ? pageOrBlocks : resolveLandingPageBlocks(pageOrBlocks || {});
  const references = [];
  for (const block of blocks) {
    const config = block?.config || {};
    const candidates = [
      { assetId: config.cloudinaryAssetId, publicId: config.cloudinaryPublicId, resourceType: config.cloudinaryResourceType },
      { assetId: config.backgroundCloudinaryAssetId, publicId: config.backgroundCloudinaryPublicId, resourceType: config.backgroundCloudinaryResourceType },
    ];
    for (const candidate of candidates) if (candidate.assetId) references.push(candidate);
  }
  return references;
}
