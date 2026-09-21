import { storeCampaignMediaBuffer } from "../lib/campaign-media.mjs";

function mediaError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function campaignMediaLibrary(campaigns = []) {
  const assets = new Map();
  for (const campaign of campaigns) {
    const assetId = String(campaign.cloudinaryAssetId || "").trim();
    if (!assetId || !campaign.cloudinaryPublicId || !campaign.cloudinaryFormat ||
      campaign.cloudinaryResourceType !== campaign.mediaType ||
      !String(campaign.mediaUrl || "").startsWith("https://") ||
      !["image", "video"].includes(campaign.mediaType)) continue;
    assets.set(assetId, {
      mediaId: assetId,
      cloudinaryAssetId: assetId,
      cloudinaryPublicId: campaign.cloudinaryPublicId,
      cloudinaryResourceType: campaign.cloudinaryResourceType,
      cloudinaryFormat: campaign.cloudinaryFormat,
      mediaType: campaign.mediaType,
      mediaUrl: campaign.mediaUrl,
      mediaOriginalName: campaign.mediaOriginalName,
      mediaMimeType: campaign.mediaMimeType,
      mediaSizeBytes: campaign.mediaSizeBytes,
      mediaWidth: campaign.mediaWidth,
      mediaHeight: campaign.mediaHeight,
      mediaDurationSeconds: campaign.mediaDurationSeconds,
      mediaFrameRate: campaign.mediaFrameRate,
      mediaVideoCodec: campaign.mediaVideoCodec,
      mediaAudioCodec: campaign.mediaAudioCodec,
      mediaAudioSampleRate: campaign.mediaAudioSampleRate,
      mediaVideoBitrate: campaign.mediaVideoBitrate,
      mediaAudioBitrate: campaign.mediaAudioBitrate,
      label: campaign.mediaOriginalName || campaign.name || assetId,
    });
  }
  return [...assets.values()];
}

function words(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);
}

export function selectCampaignMedia(assets, { strategy, output, platform, previousAssetIds = [], preferredType = null } = {}) {
  const desired = strategy === "STORED_VIDEO_ONLY" ? "video"
    : ["STORED_IMAGE_ONLY", "MIXED_IMAGE"].includes(strategy) ? "image" : preferredType;
  const candidates = assets.filter((asset) => !desired || asset.mediaType === desired);
  if (!candidates.length) return null;
  const topic = words([output?.headline, output?.caption, output?.excerpt_source_segment, output?.media_direction].join(" "));
  const used = new Set(previousAssetIds);
  const ranked = candidates.map((asset) => {
    const label = words([asset.label, asset.cloudinaryPublicId].join(" "));
    let score = [...topic].filter((word) => label.has(word)).length;
    if (used.has(asset.cloudinaryAssetId)) score -= 2;
    if (platform === "instagram" && asset.mediaType === "video" && !asset.mediaDurationSeconds) score -= 10;
    return { asset, score };
  }).sort((a, b) => b.score - a.score);
  if (ranked[0].score < 1 && candidates.length > 1) return null;
  return ranked[0].asset;
}

export class AIImageService {
  constructor({ providerService, fetchImpl = globalThis.fetch, uploadMedia = storeCampaignMediaBuffer, env = process.env } = {}) {
    this.providerService = providerService;
    this.fetchImpl = fetchImpl;
    this.uploadMedia = uploadMedia;
    this.env = env;
  }

  async generate({ providerId, prompt, platform }) {
    const provider = await this.providerService.provider(providerId);
    if (provider.providerCode !== "OPENAI") throw mediaError("Direct image generation is not configured for this provider.", 409);
    const model = String(this.env.AI_CAMPAIGN_IMAGE_MODEL || "gpt-image-1").trim();
    if (!/^gpt-image-[a-z0-9.-]+$/.test(model)) throw mediaError("AI_CAMPAIGN_IMAGE_MODEL must be a GPT Image model.", 503);
    const response = await this.fetchImpl("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${provider.secrets.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: String(prompt || "").slice(0, 4000), n: 1, output_format: "png", size: platform === "instagram" ? "1024x1024" : "1536x1024" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw mediaError(`Image provider returned HTTP ${response.status}.`, response.status === 429 ? 429 : 502);
    const body = await response.json();
    const encoded = body?.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || !encoded) throw mediaError("Image provider did not return image bytes.", 502);
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw mediaError("Generated image has an invalid size.", 502);
    const media = await this.uploadMedia({ filename: `ai-campaign-${Date.now()}.png`, mimeType: "image/png", size: bytes.length, bytes }, { env: this.env });
    return { media, model };
  }
}
