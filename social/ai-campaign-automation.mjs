import { randomUUID } from "node:crypto";
import { AI_CAMPAIGN_CONTENT_TYPES, safeAiMessage } from "./ai-providers.mjs";
import { AIImageService, campaignMediaLibrary, selectCampaignMedia } from "./ai-campaign-media.mjs";

const CAMPAIGN_STATUSES = new Set(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "STOPPED", "FAILED"]);
const PUBLISHING_MODES = new Set(["DRAFT", "PRODUCTION"]);
const SOURCE_TYPES = new Set(["OBJECTIVE_ONLY", "TRANSCRIPT", "SCRIPT", "TRANSCRIPT_PLUS_OBJECTIVE", "SCRIPT_PLUS_OBJECTIVE", "OBJECTIVE_PLUS_NOTES"]);
const MEDIA_STRATEGIES = new Set(["TEXT_ONLY", "AI_IMAGE_ONLY", "STORED_IMAGE_ONLY", "MIXED_IMAGE", "STORED_VIDEO_ONLY", "AI_VISUAL_CONCEPTS_WITH_STORED_MEDIA", "IMAGE_AND_VIDEO_MIXED"]);

function validationError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function clean(value, maximum = 16_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function positiveId(value, label, { optional = false } = {}) {
  if ((value === null || value === undefined || value === "") && optional) return null;
  const id = Number(String(value ?? "").replace(/^[^:]+:/, ""));
  if (!Number.isInteger(id) || id < 1) throw validationError(`${label} is invalid.`);
  return id;
}

function dateKey(value, label) {
  const result = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00.000Z`))) {
    throw validationError(`${label} must be a valid date.`);
  }
  return result;
}

function httpsUrl(value) {
  const candidate = clean(value, 2048);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("invalid protocol");
    return url.toString();
  } catch {
    throw validationError("Destination URL must be a valid HTTP or HTTPS URL.");
  }
}

export function normalizeAiCampaignInput(body = {}) {
  const startDate = dateKey(body.startDate, "Start date");
  const endDate = dateKey(body.endDate, "End date");
  if (startDate > endDate) throw validationError("Start date must be on or before end date.");
  const postsPerDay = Number(body.postsPerDay);
  if (!Number.isInteger(postsPerDay) || postsPerDay < 1 || postsPerDay > 10) {
    throw validationError("Posts per day must be between 1 and 10.");
  }
  const selectedBufferChannelIds = [...new Set((Array.isArray(body.selectedBufferChannelIds)
    ? body.selectedBufferChannelIds
    : [body.selectedBufferChannelIds])
    .map((value) => clean(value, 255))
    .filter(Boolean))];
  if (!selectedBufferChannelIds.length) throw validationError("Select at least one live Buffer channel.");
  const contentTypes = [...new Set((Array.isArray(body.contentTypes) ? body.contentTypes : [body.contentTypes])
    .map((value) => clean(value, 64).toUpperCase())
    .filter((value) => AI_CAMPAIGN_CONTENT_TYPES.includes(value)))];
  if (!contentTypes.length) throw validationError("Select at least one supported content type.");
  const publishingMode = clean(body.publishingMode || "DRAFT", 16).toUpperCase();
  if (!PUBLISHING_MODES.has(publishingMode)) throw validationError("Publishing mode must be DRAFT or PRODUCTION.");
  const status = clean(body.status || "DRAFT", 16).toUpperCase();
  if (!CAMPAIGN_STATUSES.has(status)) throw validationError("AI campaign status is invalid.");
  const providerId = positiveId(body.aiProviderId || body.providerId, "AI provider");
  const fallbackProviderId = positiveId(body.fallbackProviderId, "Fallback provider", { optional: true });
  if (fallbackProviderId === providerId) throw validationError("Fallback provider must differ from the primary provider.");
  const sourceContentType = clean(body.sourceContentType || "OBJECTIVE_ONLY", 40).toUpperCase();
  if (!SOURCE_TYPES.has(sourceContentType)) throw validationError("Source content type is invalid.");
  const sourceContent = clean(body.sourceContent, 100_000);
  if (sourceContentType !== "OBJECTIVE_ONLY" && !sourceContent) throw validationError("Add transcript, script, or notes content for the selected source type.");
  const mediaStrategy = clean(body.mediaStrategy || "TEXT_ONLY", 64).toUpperCase();
  if (!MEDIA_STRATEGIES.has(mediaStrategy)) throw validationError("Media strategy is invalid.");
  const storedMediaAssetIds = [...new Set((Array.isArray(body.storedMediaAssetIds) ? body.storedMediaAssetIds : [body.storedMediaAssetIds])
    .map((value) => clean(value, 255)).filter(Boolean))].slice(0, 50);
  if (["STORED_IMAGE_ONLY", "STORED_VIDEO_ONLY", "AI_VISUAL_CONCEPTS_WITH_STORED_MEDIA"].includes(mediaStrategy) && !storedMediaAssetIds.length) {
    throw validationError("Select at least one stored Cloudinary asset for this media strategy.");
  }
  const imageProviderId = positiveId(body.imageProviderId, "Image provider", { optional: true });
  if (mediaStrategy === "AI_IMAGE_ONLY" && !imageProviderId) throw validationError("Select an image-generation provider.");
  if (["MIXED_IMAGE", "IMAGE_AND_VIDEO_MIXED"].includes(mediaStrategy) && !storedMediaAssetIds.length && !imageProviderId) {
    throw validationError("Select stored media or an image-generation provider.");
  }
  if (publishingMode === "PRODUCTION" && (sourceContentType !== "OBJECTIVE_ONLY" || mediaStrategy !== "TEXT_ONLY")) {
    throw validationError("Transcript and media-rich AI campaigns must generate drafts for review before scheduling.");
  }
  return {
    id: positiveId(body.id || body.aiCampaignConfigurationId, "AI campaign", { optional: true }),
    campaignName: clean(body.campaignName, 255),
    campaignObjective: clean(body.campaignObjective, 2000),
    startDate,
    endDate,
    postsPerDay,
    contentTypes,
    aiProviderId: providerId,
    aiModel: clean(body.aiModel, 255) || null,
    fallbackProviderId,
    selectedBufferChannelIds,
    cta: clean(body.cta, 500),
    destinationUrl: httpsUrl(body.destinationUrl || body.destinationUrlOrLandingPage),
    publishingMode,
    status,
    sourceContentType,
    sourceContent,
    mediaStrategy,
    storedMediaAssetIds,
    imageProviderId,
  };
}

function companyContext(profile) {
  return {
    companyName: profile.companyName,
    companyDescription: profile.companyDescription,
    productsServices: profile.productsServices,
    targetAudience: profile.targetAudience,
    brandVoice: profile.brandVoice,
    offers: profile.offers,
    website: profile.website,
    preferredCTA: profile.preferredCTA,
    industry: profile.industry,
    businessGoals: profile.businessGoals,
    otherProfileContext: profile.otherProfileContext,
  };
}

export function campaignDate(now = new Date(), timeZone = "America/Bogota") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function publishDateTime(generationDate, time, slot, now) {
  const [hour, minute] = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time || "")?.slice(1).map(Number) || [16, 0];
  const candidate = new Date(`${generationDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + Math.max(0, slot - 1) * 30);
  const minimum = new Date(now.getTime() + (10 + Math.max(0, slot - 1) * 5) * 60_000);
  return (candidate > minimum ? candidate : minimum).toISOString();
}

function postText(output) {
  const sections = [output.headline, output.caption, output.body]
    .map((value) => clean(value))
    .filter((value, index, all) => value && all.indexOf(value) === index);
  if (output.hashtags?.length) sections.push(output.hashtags.join(" "));
  const cta = [clean(output.cta_text, 500), clean(output.cta_url, 2048)].filter(Boolean).join(" ");
  if (cta) sections.push(cta);
  return sections.join("\n\n").slice(0, 16_000);
}

function priorOutputSummary(history) {
  return (history || [])
    .filter((item) => item.generationStatus === "SUCCEEDED" && item.normalizedOutput)
    .slice(0, 20)
    .map((item) => ({
      date: item.generationDate,
      platform: item.normalizedOutput.platform,
      headline: item.normalizedOutput.headline,
      caption: item.normalizedOutput.caption,
      cta: item.normalizedOutput.cta_text,
      imagePrompt: item.normalizedOutput.image_prompt,
      videoPrompt: item.normalizedOutput.video_prompt,
      sourceSegmentId: item.normalizedOutput.source_segment_id,
      mediaAssetId: item.normalizedOutput.media_plan?.assetId,
    }));
}

function sourceSegments(content) {
  const blocks = String(content || "").split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/).map((part) => part.trim()).filter(Boolean);
  const segments = [];
  for (const block of blocks) {
    for (let index = 0; index < block.length; index += 4500) {
      segments.push(block.slice(index, index + 4500));
    }
  }
  return segments;
}

function chooseSourceSegment(configuration, history, slot) {
  const segments = sourceSegments(configuration.sourceContent);
  if (!segments.length) return { id: null, text: "" };
  const used = new Set(history.map((item) => item.normalizedOutput?.source_segment_id).filter(Boolean));
  let index = (slot - 1) % segments.length;
  for (let count = 0; count < segments.length; count += 1) {
    const candidate = (index + count) % segments.length;
    if (!used.has(`segment-${candidate + 1}`)) { index = candidate; break; }
  }
  return { id: `segment-${index + 1}`, text: segments[index] };
}

export class AICampaignAutomationEngine {
  constructor({ repository, providerService, bufferCampaignService, imageService, clock = () => new Date(), logger = console } = {}) {
    this.repository = repository;
    this.providerService = providerService;
    this.bufferCampaignService = bufferCampaignService;
    this.imageService = imageService || new AIImageService({ providerService });
    this.clock = clock;
    this.logger = logger;
  }

  async configuration(id) {
    const configurations = await this.repository.getAiCampaignConfigurations(positiveId(id, "AI campaign"));
    const configuration = configurations[0];
    if (!configuration) throw validationError("AI campaign configuration was not found.", 404);
    return configuration;
  }

  async validateResources(configuration) {
    const [profile, provider, channelResult] = await Promise.all([
      this.repository.getCompanyProfile(),
      this.providerService.provider(configuration.aiProviderId),
      this.bufferCampaignService.getChannels(),
    ]);
    if (!profile?.companyName) throw validationError("Save the Company Profile before starting an AI campaign.", 409);
    const channels = channelResult.channels || [];
    const selected = configuration.selectedBufferChannelIds.map((id) => channels.find((channel) => channel.id === id));
    if (selected.some((channel) => !channel)) throw validationError("One or more selected Buffer channels are no longer connected.", 409);
    if (selected.some((channel) => channel.isQueuePaused)) throw validationError("One or more selected Buffer queues are paused.", 409);
    if (selected.some((channel) => !["facebook", "instagram"].includes(String(channel.service || "").toLowerCase()))) {
      throw validationError("AI campaigns currently support connected Facebook and Instagram Buffer accounts only.", 409);
    }
    if (configuration.fallbackProviderId) await this.providerService.provider(configuration.fallbackProviderId);
    return { profile, provider, channels: selected };
  }

  async saveConfiguration(body) {
    const input = normalizeAiCampaignInput(body);
    if (input.imageProviderId) {
      const provider = await this.providerService.provider(input.imageProviderId);
      if (provider.providerCode !== "OPENAI") throw validationError("Direct image generation is not configured for this provider.", 409);
    }
    if (input.storedMediaAssetIds.length) {
      const library = campaignMediaLibrary((await this.repository.getContent()).campaigns);
      const available = new Map(library.map((asset) => [asset.cloudinaryAssetId, asset]));
      if (input.storedMediaAssetIds.some((id) => !available.has(id))) throw validationError("One or more selected Cloudinary assets are unavailable.");
      const selected = input.storedMediaAssetIds.map((id) => available.get(id));
      if (input.mediaStrategy === "STORED_VIDEO_ONLY" && !selected.some((asset) => asset.mediaType === "video")) {
        throw validationError("Select a stored video for this strategy.");
      }
      if (input.mediaStrategy === "STORED_IMAGE_ONLY" && !selected.some((asset) => asset.mediaType === "image")) {
        throw validationError("Select a stored image for this strategy.");
      }
      if (input.mediaStrategy === "IMAGE_AND_VIDEO_MIXED" && !selected.some((asset) => asset.mediaType === "video")) {
        throw validationError("Select a stored video for the mixed image/video strategy.");
      }
      if (input.mediaStrategy === "IMAGE_AND_VIDEO_MIXED" && !input.imageProviderId && !selected.some((asset) => asset.mediaType === "image")) {
        throw validationError("Select a stored image or image provider for the mixed image/video strategy.");
      }
    }
    if (input.mediaStrategy === "IMAGE_AND_VIDEO_MIXED" && !input.storedMediaAssetIds.length) {
      throw validationError("Select a stored video for the mixed image/video strategy.");
    }
    return this.repository.saveAiCampaignConfiguration(input);
  }

  async start(id) {
    const configuration = await this.configuration(id);
    await this.validateResources(configuration);
    const now = this.clock();
    const today = campaignDate(now);
    if (today > configuration.endDate) throw validationError("This AI campaign has already passed its end date.", 409);
    await this.repository.setAiCampaignStatus(configuration.id, "ACTIVE");
    const active = { ...configuration, status: "ACTIVE" };
    const generated = today >= active.startDate ? await this.processConfiguration(active, today, { retryFailed: true }) : [];
    if (generated.length && generated.every((item) => item.status === "FAILED")) {
      const error = generated[0].error || "Every initial generation failed.";
      await this.repository.setAiCampaignStatus(configuration.id, "FAILED", error);
    }
    return { configuration: await this.configuration(id), generated };
  }

  async setStatus(id, action) {
    const configuration = await this.configuration(id);
    const normalized = clean(action, 16).toUpperCase();
    const status = { PAUSE: "PAUSED", RESUME: "ACTIVE", STOP: "STOPPED" }[normalized];
    if (!status) throw validationError("AI campaign action must be pause, resume, or stop.");
    if (normalized === "RESUME") await this.validateResources(configuration);
    return this.repository.setAiCampaignStatus(configuration.id, status);
  }

  async generateNow(id) {
    const configuration = await this.configuration(id);
    if (configuration.status !== "ACTIVE") throw validationError("Only an ACTIVE AI campaign can generate today's posts.", 409);
    const today = campaignDate(this.clock());
    if (today < configuration.startDate || today > configuration.endDate) {
      throw validationError("Today's date is outside this AI campaign's configured range.", 409);
    }
    await this.validateResources(configuration);
    return this.processConfiguration(configuration, today, { retryFailed: true });
  }

  async generationContext(configuration, generationDate, slot, channel, profile, history) {
    const remainingDays = Math.max(0, Math.round((Date.parse(`${configuration.endDate}T00:00:00Z`) - Date.parse(`${generationDate}T00:00:00Z`)) / 86_400_000));
    return {
      companyProfile: companyContext(profile),
      campaignName: configuration.campaignName,
      campaignObjective: configuration.campaignObjective,
      generationDate,
      remainingCampaignDays: remainingDays,
      postNumberToday: slot,
      postsPerDay: configuration.postsPerDay,
      requestedContentTypes: configuration.contentTypes,
      platform: channel.service,
      bufferChannelDisplayName: channel.displayName,
      cta: configuration.cta || profile.preferredCTA || "",
      destinationUrl: configuration.destinationUrl || profile.website || "",
      previousPosts: priorOutputSummary(history),
      sourceContentType: configuration.sourceContentType || "OBJECTIVE_ONLY",
      sourceSegment: chooseSourceSegment(configuration, history, slot),
      mediaStrategy: configuration.mediaStrategy || "TEXT_ONLY",
    };
  }

  async resolveMedia(configuration, output, channel, history) {
    const strategy = configuration.mediaStrategy || "TEXT_ONLY";
    if (strategy === "TEXT_ONLY") return { media: null, origin: "NONE", imageModel: null };
    const content = await this.repository.getContent();
    const allowed = new Set(configuration.storedMediaAssetIds || []);
    const assets = campaignMediaLibrary(content.campaigns).filter((asset) => allowed.has(asset.cloudinaryAssetId));
    const priorIds = history.map((item) => item.normalizedOutput?.media_plan?.assetId).filter(Boolean);
    const preferredType = strategy === "IMAGE_AND_VIDEO_MIXED" ? (history.length % 2 ? "video" : "image") : null;
    const selected = strategy === "AI_IMAGE_ONLY" ? null
      : selectCampaignMedia(assets, { strategy, output, platform: channel.service, previousAssetIds: priorIds, preferredType });
    if (selected) return { media: selected, origin: "STORED", imageModel: null };
    if (["AI_IMAGE_ONLY", "MIXED_IMAGE", "IMAGE_AND_VIDEO_MIXED"].includes(strategy) && configuration.imageProviderId) {
      const generated = await this.imageService.generate({
        providerId: configuration.imageProviderId,
        prompt: [output.image_prompt || output.media_direction || output.headline, configuration.campaignObjective, "No text or logos in image."].filter(Boolean).join(". "),
        platform: channel.service,
      });
      return { media: {
        ...generated.media,
        cloudinaryAssetId: generated.media.assetId,
        cloudinaryPublicId: generated.media.publicId,
        cloudinaryResourceType: generated.media.resourceType,
        cloudinaryFormat: generated.media.format,
      }, origin: "AI_GENERATED", imageModel: generated.model };
    }
    if (["STORED_IMAGE_ONLY", "STORED_VIDEO_ONLY", "AI_VISUAL_CONCEPTS_WITH_STORED_MEDIA", "AI_IMAGE_ONLY"].includes(strategy)) {
      throw validationError("No relevant approved media is available for this post; select another asset or strategy.", 409);
    }
    return { media: null, origin: "PROMPT_ONLY", imageModel: null };
  }

  async generateClaim(configuration, generationDate, slot, channel, profile, history, { retryFailed = false } = {}) {
    const context = await this.generationContext(configuration, generationDate, slot, channel, profile, history);
    const run = await this.repository.claimAiGenerationRun({
      configurationId: configuration.id,
      generationDate,
      runSlot: slot,
      bufferChannelId: channel.id,
      regenerated: false,
      retryFailed,
      inputContext: { requestId: randomUUID(), platform: channel.service, priorPostCount: context.previousPosts.length },
    });
    if (!run) return { status: "SKIPPED", slot, channelId: channel.id };

    try {
      const generated = await this.providerService.generateCampaignContent({
        providerId: configuration.aiProviderId,
        fallbackProviderId: configuration.fallbackProviderId,
        model: configuration.aiModel,
        context,
      });
      const mediaResult = await this.resolveMedia(configuration, generated.output, channel, history);
      const media = mediaResult.media;
      const output = {
        ...generated.output,
        source_content_type: configuration.sourceContentType || "OBJECTIVE_ONLY",
        source_segment_id: context.sourceSegment.id,
        excerpt_source_segment: generated.output.excerpt_source_segment && context.sourceSegment.text.includes(generated.output.excerpt_source_segment)
          ? generated.output.excerpt_source_segment : context.sourceSegment.text.slice(0, 1000),
        media_strategy: configuration.mediaStrategy || "TEXT_ONLY",
        media_plan: { origin: mediaResult.origin, assetId: media?.cloudinaryAssetId || null, url: media?.mediaUrl || null, imageModel: mediaResult.imageModel },
        stored_media_references: mediaResult.origin === "STORED" ? [media.cloudinaryAssetId] : [],
        ai_generated_media_references: mediaResult.origin === "AI_GENERATED" ? [media.cloudinaryAssetId] : [],
        generation_timestamp: this.clock().toISOString(),
      };
      const delivery = await this.bufferCampaignService.scheduleCampaign({
        campaignName: `${configuration.campaignName} · ${generationDate} · ${slot} · ${channel.displayName}`.slice(0, 255),
        campaignObjective: configuration.campaignObjective,
        postText: postText(output),
        postType: media?.mediaType === "video" && channel.service === "instagram" ? "REEL" : "POST",
        ...(media || {}),
        targetSocialChannels: [channel.id],
        publishDateTime: publishDateTime(generationDate, output.recommended_publish_time, slot, this.clock()),
        campaignStatus: configuration.publishingMode,
        highIntentKeywords: output.hashtags,
        aiReplyEnabled: false,
        createdByAi: true,
      });
      const campaign = delivery.campaign;
      const campaignPost = delivery.posts?.[0];
      if (!campaign || !campaignPost) throw new Error("The existing Campaign/Buffer flow did not return a persisted CampaignPost.");
      await this.repository.succeedAiGenerationRun(run.id, {
        providerId: generated.providerId,
        providerCode: generated.providerCode,
        model: generated.model,
        campaignId: campaign.id,
        campaignPostId: campaignPost.id,
        fallbackUsed: generated.fallbackUsed,
        attemptCount: generated.attempts,
        normalizedOutput: output,
      });
      history.unshift({ generationStatus: "SUCCEEDED", generationDate, normalizedOutput: output });
      return { status: "SUCCEEDED", runId: run.id, campaign, campaignPost, output };
    } catch (error) {
      const message = safeAiMessage(error);
      await this.repository.failAiGenerationRun(run.id, {
        providerId: error?.providerId || null,
        providerCode: error?.providerCode || null,
        model: error?.model || null,
        fallbackUsed: Boolean(error?.fallbackUsed),
        attemptCount: Number(error?.attempts) || 1,
        error: message,
      });
      this.logger.error?.(JSON.stringify({
        component: "ai_campaign_automation",
        operation: "generate_daily_post",
        configurationId: configuration.id,
        generationDate,
        slot,
        channelId: channel.id,
        status: "failed",
        error: message,
      }));
      return { status: "FAILED", runId: run.id, slot, channelId: channel.id, error: message };
    }
  }

  async processConfiguration(configuration, generationDate, { retryFailed = false } = {}) {
    const { profile, channels } = await this.validateResources(configuration);
    const history = await this.repository.getAiGenerationHistory({ configurationId: configuration.id, limit: 50 });
    const results = [];
    for (let slot = 1; slot <= configuration.postsPerDay; slot += 1) {
      for (const channel of channels) {
        results.push(await this.generateClaim(configuration, generationDate, slot, channel, profile, history, { retryFailed }));
      }
    }
    return results;
  }

  async regenerate(runId, providerId = null) {
    const prior = (await this.repository.getAiGenerationHistory({ runId: positiveId(runId, "Generation run"), limit: 1 }))[0];
    if (!prior?.campaignId || !prior?.campaignPostId) throw validationError("Only a successfully persisted generated post can be regenerated.", 409);
    if (!(prior.postStatus === "DRAFT" || (prior.postStatus === "FAILED" && !prior.bufferPostId))) {
      throw validationError("Only an unscheduled draft or unsent failed post can be regenerated.", 409);
    }
    const configuration = await this.configuration(prior.configurationId);
    const { profile, channels } = await this.validateResources(configuration);
    const channel = channels.find((item) => item.id === prior.bufferChannelId);
    if (!channel) throw validationError("The generated post's Buffer channel is no longer selected.", 409);
    const history = await this.repository.getAiGenerationHistory({ configurationId: configuration.id, limit: 50 });
    const context = await this.generationContext(configuration, prior.generationDate, prior.runSlot, channel, profile, history);
    const originalSegment = /^segment-(\d+)$/.exec(prior.normalizedOutput?.source_segment_id || "");
    const originalText = originalSegment ? sourceSegments(configuration.sourceContent)[Number(originalSegment[1]) - 1] : null;
    if (originalText) context.sourceSegment = { id: prior.normalizedOutput.source_segment_id, text: originalText };
    const run = await this.repository.claimAiGenerationRun({
      configurationId: configuration.id,
      generationDate: prior.generationDate,
      runSlot: prior.runSlot,
      bufferChannelId: channel.id,
      regenerated: true,
      inputContext: { requestId: randomUUID(), replacesRunId: prior.id, platform: channel.service },
    });
    try {
      const generated = await this.providerService.generateCampaignContent({
        providerId: providerId ? positiveId(providerId, "AI provider override") : configuration.aiProviderId,
        fallbackProviderId: providerId ? null : configuration.fallbackProviderId,
        model: providerId ? null : configuration.aiModel,
        context,
      });
      const existing = await this.bufferCampaignService.campaignById(prior.campaignId);
      if (!existing) throw validationError("The normal Campaign record for this generated post was not found.", 404);
      const output = {
        ...generated.output,
        source_content_type: configuration.sourceContentType || "OBJECTIVE_ONLY",
        source_segment_id: context.sourceSegment.id,
        excerpt_source_segment: generated.output.excerpt_source_segment && context.sourceSegment.text.includes(generated.output.excerpt_source_segment)
          ? generated.output.excerpt_source_segment : context.sourceSegment.text.slice(0, 1000),
        media_strategy: configuration.mediaStrategy || "TEXT_ONLY",
        media_plan: {
          origin: existing.mediaUrl ? prior.normalizedOutput?.media_plan?.origin || "PRESERVED" : "NONE",
          assetId: existing.cloudinaryAssetId || null,
          url: existing.mediaUrl || null,
          imageModel: prior.normalizedOutput?.media_plan?.imageModel || null,
        },
        stored_media_references: existing.mediaUrl && prior.normalizedOutput?.media_plan?.origin === "STORED" ? [existing.cloudinaryAssetId] : [],
        ai_generated_media_references: existing.mediaUrl && prior.normalizedOutput?.media_plan?.origin === "AI_GENERATED" ? [existing.cloudinaryAssetId] : [],
        generation_timestamp: this.clock().toISOString(),
      };
      const delivery = await this.bufferCampaignService.updateCampaign(existing.id, {
        campaignName: existing.name,
        campaignObjective: configuration.campaignObjective,
        postText: postText(output),
        postType: existing.postType || "POST",
        targetSocialChannels: [channel.id],
        publishDateTime: publishDateTime(campaignDate(this.clock()), generated.output.recommended_publish_time, prior.runSlot, this.clock()),
        campaignStatus: "DRAFT",
        highIntentKeywords: generated.output.hashtags,
        aiReplyEnabled: existing.aiReplyEnabled,
        mediaId: existing.mediaId,
        cloudinaryAssetId: existing.cloudinaryAssetId,
        cloudinaryPublicId: existing.cloudinaryPublicId,
        cloudinaryResourceType: existing.cloudinaryResourceType,
        cloudinaryFormat: existing.cloudinaryFormat,
        mediaType: existing.mediaType,
        mediaUrl: existing.mediaUrl,
        mediaOriginalName: existing.mediaOriginalName,
        mediaMimeType: existing.mediaMimeType,
        mediaSizeBytes: existing.mediaSizeBytes,
        mediaWidth: existing.mediaWidth,
        mediaHeight: existing.mediaHeight,
        mediaDurationSeconds: existing.mediaDurationSeconds,
        mediaFrameRate: existing.mediaFrameRate,
        mediaVideoCodec: existing.mediaVideoCodec,
        mediaAudioCodec: existing.mediaAudioCodec,
        mediaAudioSampleRate: existing.mediaAudioSampleRate,
        mediaVideoBitrate: existing.mediaVideoBitrate,
        mediaAudioBitrate: existing.mediaAudioBitrate,
      });
      const campaignPost = delivery.posts?.find((item) => String(item.id) === String(prior.campaignPostId)) || delivery.posts?.[0];
      await this.repository.succeedAiGenerationRun(run.id, {
        providerId: generated.providerId,
        providerCode: generated.providerCode,
        model: generated.model,
        campaignId: existing.id,
        campaignPostId: campaignPost.id,
        fallbackUsed: generated.fallbackUsed,
        attemptCount: generated.attempts,
        normalizedOutput: output,
      });
      return { runId: run.id, campaign: delivery.campaign, campaignPost, output };
    } catch (error) {
      await this.repository.failAiGenerationRun(run.id, {
        providerId: error?.providerId || null,
        providerCode: error?.providerCode || null,
        model: error?.model || null,
        fallbackUsed: Boolean(error?.fallbackUsed),
        attemptCount: Number(error?.attempts) || 1,
        error: safeAiMessage(error),
      });
      throw error;
    }
  }

  async tick() {
    const today = campaignDate(this.clock());
    const completed = await this.repository.completeExpiredAiCampaigns(today);
    const configurations = await this.repository.getDueAiCampaignConfigurations(today);
    const campaigns = [];
    for (const configuration of configurations) {
      try {
        campaigns.push({ configurationId: configuration.id, results: await this.processConfiguration(configuration, today) });
      } catch (error) {
        const message = safeAiMessage(error);
        campaigns.push({ configurationId: configuration.id, error: message, results: [] });
        this.logger.error?.(JSON.stringify({
          component: "ai_campaign_automation",
          operation: "daily_tick",
          configurationId: configuration.id,
          status: "failed",
          error: message,
        }));
      }
    }
    return { date: today, completed, campaigns };
  }
}
