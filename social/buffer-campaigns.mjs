import {
  externalPostIdFromLink,
  mapBufferPostStatus,
  safeBufferMessage,
} from "./buffer-adapter.mjs";
import {
  campaignMediaPublicUrl,
  deleteCampaignMedia,
  readCampaignMedia,
} from "../lib/campaign-media.mjs";
import { inspectCampaignVideo } from "../lib/instagram-video.mjs";
import {
  instagramVideoValidationErrors,
  INSTAGRAM_VIDEO_MAX_BYTES,
} from "../lib/instagram-video-validation.mjs";

const SCHEDULED_STATES = new Set(["SCHEDULED", "QUEUED", "PUBLISHED"]);
const SUPPORTED_POST_TYPES = new Set(["POST", "REEL", "STORY"]);
const RICH_POST_SERVICES = new Set(["instagram", "facebook"]);

function validationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requiredString(value, label, maximum) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw validationError(`${label} is required.`);
  if (normalized.length > maximum) throw validationError(`${label} must be ${maximum} characters or fewer.`);
  return normalized;
}

function booleanValue(value) {
  return value === true || value === 1 || ["true", "1", "yes", "on"].includes(String(value || "").toLowerCase());
}

function optionalString(value, maximum) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized.length > maximum) throw validationError(`A media field must be ${maximum} characters or fewer.`);
  return normalized;
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function publicMediaUrl(value, { allowPrivate = false } = {}) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw validationError("Media must be a valid public HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw validationError("Media must use an HTTP or HTTPS URL.");
  if (!allowPrivate && parsed.protocol !== "https:") throw validationError("Media must use a publicly accessible HTTPS URL for Buffer.");
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost = hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1" ||
    hostname === "0.0.0.0" || hostname.startsWith("127.") || hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") || hostname.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname);
  if (privateHost && !allowPrivate) throw validationError("Media must be publicly accessible to Buffer.");
  if (parsed.href.length > 2048) throw validationError("Media URL must be 2048 characters or fewer.");
  return parsed.href;
}

function expectedMediaContentType(mediaType, contentType) {
  const normalized = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  return normalized.startsWith(`${mediaType}/`) && normalized !== "text/html";
}

export async function verifyPublicMediaUrl(input, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  if (!input.mediaUrl || !input.mediaType) return input;
  const request = async (method) => {
    const response = await fetchImpl(input.mediaUrl, {
      method,
      redirect: "manual",
      headers: method === "GET" ? { range: "bytes=0-1023" } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentType = response.headers.get("content-type") || "";
    const acceptableStatus = response.ok || (method === "GET" && response.status === 206);
    const acceptableType = expectedMediaContentType(input.mediaType, contentType);
    if (response.body && method === "GET") await response.body.cancel().catch(() => {});
    return { acceptableStatus, acceptableType, status: response.status, contentType };
  };

  let head;
  try {
    head = await request("HEAD");
  } catch {
    head = null;
  }
  if (head?.acceptableStatus && head.acceptableType) return input;

  let get;
  try {
    get = await request("GET");
  } catch (error) {
    throw validationError(
      `The saved media URL is not publicly reachable for Buffer: ${error instanceof Error ? error.message : "request failed"}.`,
      424,
    );
  }
  if (!get.acceptableStatus) {
    throw validationError(`The saved media URL returned HTTP ${get.status}; Buffer was not called.`, 424);
  }
  if (!get.acceptableType) {
    throw validationError(
      `The saved media URL returned ${get.contentType || "no Content-Type"} instead of ${input.mediaType} media; Buffer was not called.`,
      424,
    );
  }
  return input;
}

export function validateCanonicalMediaReference(input, env = process.env) {
  if (!input.mediaUrl || !input.mediaId) return input;
  const expected = campaignMediaPublicUrl(input.mediaId, input.mediaUrl, env);
  if (input.mediaUrl !== expected) {
    throw validationError("The persisted media URL does not match the canonical stored filename and public media path.");
  }
  return input;
}

function keywordValue(value) {
  const keywords = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(keywords.map((item) => String(item).trim()).filter(Boolean))].join(", ").slice(0, 2000);
}

function normalizedChannelIds(value) {
  const ids = [...new Set((Array.isArray(value) ? value : [value])
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
  if (!ids.length) throw validationError("Select at least one live Buffer channel.");
  if (ids.length > 25) throw validationError("A campaign can target at most 25 Buffer channels.");
  if (ids.some((id) => id.length > 255)) throw validationError("A Buffer channel ID is invalid.");
  return ids;
}

export function normalizeBufferCampaignInput(body, { now = new Date() } = {}) {
  const campaignStatus = String(body.campaignStatus || "PRODUCTION").trim().toUpperCase();
  if (!new Set(["DRAFT", "PRODUCTION"]).has(campaignStatus)) throw validationError("Campaign status must be DRAFT or PRODUCTION.");
  const mediaUrl = publicMediaUrl(body.mediaUrl, { allowPrivate: campaignStatus === "DRAFT" });
  const mediaType = String(body.mediaType || "").trim().toLowerCase() || null;
  if (mediaType && !new Set(["image", "video"]).has(mediaType)) throw validationError("Media type must be image or video.");
  if (Boolean(mediaUrl) !== Boolean(mediaType)) throw validationError("Media type and media URL must be provided together.");

  const mediaMimeType = optionalString(body.mediaMimeType, 127)?.toLowerCase() || null;
  if (mediaMimeType && !mediaMimeType.startsWith(`${mediaType}/`)) {
    throw validationError("Media MIME type does not match the selected media type.");
  }
  const mediaSizeBytes = body.mediaSizeBytes == null || body.mediaSizeBytes === "" ? null : Number(body.mediaSizeBytes);
  if (mediaSizeBytes != null && (!Number.isInteger(mediaSizeBytes) || mediaSizeBytes < 1 || mediaSizeBytes > INSTAGRAM_VIDEO_MAX_BYTES)) {
    throw validationError("Media size must be between 1 byte and 300 MB.");
  }

  const postType = String(body.postType || "POST").trim().toUpperCase();
  if (!SUPPORTED_POST_TYPES.has(postType)) throw validationError("Post type must be POST, REEL, or STORY.");
  if (postType === "REEL" && mediaType !== "video") throw validationError("A Reel requires a valid video upload.");
  if (postType === "STORY" && !mediaType) throw validationError("A Story requires a valid image or video upload.");

  const publishDate = new Date(requiredString(body.publishDateTime, "Publish date and time", 100));
  if (Number.isNaN(publishDate.getTime())) throw validationError("Publish date and time is invalid.");
  if (publishDate.getTime() <= now.getTime()) throw validationError("Publish date and time must be in the future.");

  return {
    campaignName: requiredString(body.campaignName || body.name, "Campaign name", 255),
    campaignObjective: requiredString(body.campaignObjective, "Campaign objective", 2000),
    postText: requiredString(body.postText || body.message, "Post text", 16_000),
    postType,
    mediaId: mediaUrl ? optionalString(body.mediaId, 100) : null,
    mediaType,
    mediaUrl,
    mediaOriginalName: mediaUrl ? optionalString(body.mediaOriginalName, 255) : null,
    mediaMimeType: mediaUrl ? mediaMimeType : null,
    mediaSizeBytes: mediaUrl ? mediaSizeBytes : null,
    mediaWidth: mediaUrl ? optionalNumber(body.mediaWidth) : null,
    mediaHeight: mediaUrl ? optionalNumber(body.mediaHeight) : null,
    mediaDurationSeconds: mediaUrl ? optionalNumber(body.mediaDurationSeconds) : null,
    mediaFrameRate: mediaUrl ? optionalNumber(body.mediaFrameRate) : null,
    mediaVideoCodec: mediaUrl ? optionalString(body.mediaVideoCodec, 64) : null,
    mediaAudioCodec: mediaUrl ? optionalString(body.mediaAudioCodec, 64) : null,
    mediaAudioSampleRate: mediaUrl ? optionalNumber(body.mediaAudioSampleRate) : null,
    mediaVideoBitrate: mediaUrl ? optionalNumber(body.mediaVideoBitrate) : null,
    mediaAudioBitrate: mediaUrl ? optionalNumber(body.mediaAudioBitrate) : null,
    targetSocialChannels: normalizedChannelIds(body.targetSocialChannels),
    publishDateTime: publishDate.toISOString(),
    campaignStatus,
    highIntentKeywords: keywordValue(body.highIntentKeywords),
    aiReplyEnabled: booleanValue(body.aiReplyEnabled),
    createdByAi: booleanValue(body.createdByAi),
  };
}

export function validateBufferPostCompatibility(input, channels) {
  for (const channel of channels) {
    const service = String(channel.service || "").toLowerCase();
    if (input.postType !== "POST" && !RICH_POST_SERVICES.has(service)) {
      throw validationError(`${channel.displayName || service} supports POST only; ${input.postType} is not compatible.`);
    }
    if (input.postType === "REEL" && input.mediaType !== "video") {
      throw validationError(`${channel.displayName || service} requires video for a Reel.`);
    }
    if (input.postType === "STORY" && !input.mediaType) {
      throw validationError(`${channel.displayName || service} requires image or video media for a Story.`);
    }
    if (service === "instagram" && input.postType === "POST" && input.mediaType === "video") {
      throw validationError("Instagram no longer accepts a standard video Post through Buffer. Choose Reel or Story.");
    }
  }
}

export async function validateStoredInstagramVideo(input, channels, {
  env = process.env,
  readMedia = readCampaignMedia,
  inspectVideo = inspectCampaignVideo,
} = {}) {
  const services = channels.map((channel) => String(channel.service || "").toLowerCase());
  if (input.mediaType !== "video" || !services.includes("instagram")) return input;
  if (!input.mediaId) {
    throw validationError("Upload the Instagram video through the campaign editor so the server can verify its publishing requirements.");
  }
  try {
    validateCanonicalMediaReference(input, env);
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : "The stored campaign video URL is invalid.");
  }

  let stored;
  let metadata;
  try {
    stored = await readMedia(input.mediaId, env);
    if (!String(stored.mimeType || "").startsWith("video/")) {
      throw new Error("The stored media is not a video.");
    }
    metadata = await inspectVideo(stored.bytes);
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : "The stored campaign video could not be validated.");
  }
  const errors = instagramVideoValidationErrors(metadata, {
    postType: input.postType,
    services,
    sizeBytes: stored.bytes.byteLength,
  });
  if (errors.length) throw validationError(errors.join(" "));

  return {
    ...input,
    mediaSizeBytes: stored.bytes.byteLength,
    mediaWidth: metadata.width,
    mediaHeight: metadata.height,
    mediaDurationSeconds: metadata.durationSeconds,
    mediaFrameRate: metadata.frameRate,
    mediaVideoCodec: metadata.videoCodec,
    mediaAudioCodec: metadata.audioCodec,
    mediaAudioSampleRate: metadata.audioSampleRate,
    mediaVideoBitrate: metadata.videoBitrate,
    mediaAudioBitrate: metadata.audioBitrate,
  };
}

function postPersistence(post) {
  const postStatus = mapBufferPostStatus(post.status);
  return {
    bufferPostId: post.id,
    scheduledAt: post.dueAt || null,
    publishedAt: post.sentAt || null,
    postStatus,
    externalPostId: externalPostIdFromLink(post.channelService, post.externalLink),
    postUrl: post.externalLink || null,
    errorMessage: postStatus === "FAILED" ? safeBufferMessage(post.error?.message || "Buffer reported a publishing failure.") : null,
  };
}

function selectedChannelRecords(input, channels) {
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
  const selected = input.targetSocialChannels.map((id) => channelMap.get(id));
  if (selected.some((channel) => !channel)) throw validationError("One or more selected channels are not available in the connected Buffer organization.");
  if (selected.some((channel) => channel.isQueuePaused)) throw validationError("One or more selected Buffer channels have a paused queue.");
  validateBufferPostCompatibility(input, selected);
  return selected;
}

function campaignRecord(input, selectedChannels, existing = null) {
  return {
    ...(existing ? { id: existing.id } : {}),
    name: input.campaignName,
    platform: [...new Set(selectedChannels.map((channel) => channel.service))].join(", "),
    audience: input.campaignObjective,
    message: input.postText,
    budget: existing?.budget || 0,
    status: existing?.status === "production" ? "production" : "draft",
    createdByAi: existing?.createdByAi || input.createdByAi,
    campaignObjective: input.campaignObjective,
    postText: input.postText,
    postType: input.postType,
    mediaId: input.mediaId,
    mediaType: input.mediaType,
    mediaUrl: input.mediaUrl,
    mediaOriginalName: input.mediaOriginalName,
    mediaMimeType: input.mediaMimeType,
    mediaSizeBytes: input.mediaSizeBytes,
    mediaWidth: input.mediaWidth,
    mediaHeight: input.mediaHeight,
    mediaDurationSeconds: input.mediaDurationSeconds,
    mediaFrameRate: input.mediaFrameRate,
    mediaVideoCodec: input.mediaVideoCodec,
    mediaAudioCodec: input.mediaAudioCodec,
    mediaAudioSampleRate: input.mediaAudioSampleRate,
    mediaVideoBitrate: input.mediaVideoBitrate,
    mediaAudioBitrate: input.mediaAudioBitrate,
    publishDateTime: input.publishDateTime,
    highIntentKeywords: input.highIntentKeywords,
    aiReplyEnabled: input.aiReplyEnabled,
    targetSocialChannels: selectedChannels.map((channel) => ({
      id: channel.id,
      service: channel.service,
      displayName: channel.displayName,
    })),
  };
}

function channelIdsFromCampaign(campaign) {
  return (Array.isArray(campaign.targetSocialChannels) ? campaign.targetSocialChannels : [])
    .map((channel) => String(channel?.id || ""))
    .filter(Boolean)
    .sort();
}

function deliveryFieldsChanged(existing, input) {
  const existingDate = existing.publishDateTime ? new Date(existing.publishDateTime).toISOString() : null;
  return String(existing.postText || existing.message || "") !== input.postText ||
    String(existing.postType || "POST").toUpperCase() !== input.postType ||
    (existing.mediaType || null) !== input.mediaType ||
    (existing.mediaUrl || null) !== input.mediaUrl ||
    existingDate !== input.publishDateTime ||
    JSON.stringify(channelIdsFromCampaign(existing)) !== JSON.stringify([...input.targetSocialChannels].sort());
}

const MEDIA_FIELDS = [
  "mediaId",
  "mediaType",
  "mediaUrl",
  "mediaOriginalName",
  "mediaMimeType",
  "mediaSizeBytes",
  "mediaWidth",
  "mediaHeight",
  "mediaDurationSeconds",
  "mediaFrameRate",
  "mediaVideoCodec",
  "mediaAudioCodec",
  "mediaAudioSampleRate",
  "mediaVideoBitrate",
  "mediaAudioBitrate",
];

function persistedDeliveryInput(input, campaign) {
  const persisted = { ...input };
  for (const field of MEDIA_FIELDS) persisted[field] = campaign[field] ?? null;
  return persisted;
}

export class BufferCampaignService {
  constructor({
    repository,
    bufferAdapter,
    logger = console,
    env = process.env,
    validateMedia = validateStoredInstagramVideo,
    verifyMediaUrl = verifyPublicMediaUrl,
    fetchImpl = globalThis.fetch,
  }) {
    this.repository = repository;
    this.bufferAdapter = bufferAdapter;
    this.logger = logger;
    this.env = env;
    this.validateMedia = validateMedia;
    this.verifyMediaUrl = verifyMediaUrl;
    this.fetchImpl = fetchImpl;
  }

  configurationStatus() {
    return this.bufferAdapter.configurationStatus();
  }

  async getChannels() {
    const channels = await this.bufferAdapter.getChannels();
    return {
      connection: {
        ...this.bufferAdapter.configurationStatus(),
        status: "connected",
        reason: `Buffer returned ${channels.length} live channel${channels.length === 1 ? "" : "s"}.`,
        checkedAt: new Date().toISOString(),
      },
      channels,
    };
  }

  async getCampaigns() {
    const content = await this.repository.getContent();
    return content.campaigns || [];
  }

  async campaignById(campaignId) {
    const campaigns = await this.getCampaigns();
    return campaigns.find((campaign) => String(campaign.id) === String(campaignId)) || null;
  }

  async deleteMediaIfUnreferenced(mediaId) {
    const normalizedId = String(mediaId || "").trim();
    const campaigns = await this.getCampaigns();
    const referenced = campaigns.some((campaign) => String(campaign.mediaId || "") === normalizedId);
    if (referenced) return { deleted: false, referenced: true };
    return {
      deleted: await deleteCampaignMedia(normalizedId, this.env),
      referenced: false,
    };
  }

  async cleanupUnreferencedMedia(mediaId) {
    if (!mediaId) return;
    try {
      await this.deleteMediaIfUnreferenced(mediaId);
    } catch (error) {
      this.logger.error?.(JSON.stringify({
        component: "campaign_media",
        operation: "cleanup_unreferenced",
        mediaId,
        status: "failed",
        error: safeBufferMessage(error),
      }));
    }
  }

  async recordMediaDeliveryFailure(campaign, posts, error) {
    const message = safeBufferMessage(error);
    const results = [];
    for (const post of posts) {
      results.push(post.bufferPostId
        ? await this.repository.recordCampaignPostAttemptError(post.id, message)
        : await this.repository.failCampaignPost(post.id, message));
    }
    this.logger.error?.(JSON.stringify({
      component: "buffer_campaign",
      operation: "verify_public_media",
      campaignId: campaign.id,
      status: "failed",
      error: message,
    }));
    return results;
  }

  async saveDraftPosts(campaign, selectedChannels, input) {
    const posts = [];
    for (const channel of selectedChannels) {
      posts.push(await this.repository.upsertCampaignPost({
        campaignId: campaign.id,
        platform: channel.service,
        bufferChannelId: channel.id,
        scheduledAt: input.publishDateTime,
      }));
    }
    return posts;
  }

  async createOrEditBufferPost(post, channel, input, operation) {
    const common = {
      service: channel.service,
      postType: input.postType,
      text: input.postText,
      dueAt: input.publishDateTime,
      mediaType: input.mediaType,
      mediaUrl: input.mediaUrl,
      aiAssisted: input.createdByAi,
    };
    return operation === "edit"
      ? this.bufferAdapter.editPost({ ...common, postId: post.bufferPostId })
      : this.bufferAdapter.schedulePost({ ...common, channelId: channel.id });
  }

  async scheduleCampaign(body) {
    let input;
    let campaign = null;
    let selectedChannels;
    try {
      input = normalizeBufferCampaignInput(body);
      const { channels } = await this.getChannels();
      selectedChannels = selectedChannelRecords(input, channels);
      input = await this.validateMedia(input, selectedChannels, { env: this.env });
      campaign = await this.repository.saveCampaign(campaignRecord(input, selectedChannels));
      if (!campaign) throw new Error("The campaign could not be persisted before Buffer scheduling.");
    } catch (error) {
      if (!campaign) await this.cleanupUnreferencedMedia(input?.mediaId || body?.mediaId);
      throw error;
    }

    input = persistedDeliveryInput(input, campaign);
    const draftPosts = await this.saveDraftPosts(campaign, selectedChannels, input);
    if (input.campaignStatus === "DRAFT") {
      return { ok: true, campaign: { ...campaign, campaignPosts: draftPosts }, posts: draftPosts, scheduledCount: 0, failedCount: 0, statusCode: 201 };
    }

    try {
      input = validateCanonicalMediaReference(input, this.env);
      input = await this.verifyMediaUrl(input, { fetchImpl: this.fetchImpl });
    } catch (error) {
      const failedPosts = await this.recordMediaDeliveryFailure(campaign, draftPosts, error);
      return {
        ok: false,
        campaign: { ...campaign, campaignPosts: failedPosts },
        posts: failedPosts,
        scheduledCount: 0,
        failedCount: failedPosts.length,
        error: safeBufferMessage(error),
        statusCode: 424,
      };
    }

    const results = await Promise.all(draftPosts.map(async (draft, index) => {
      const channel = selectedChannels[index];
      try {
        const bufferPost = await this.createOrEditBufferPost(draft, channel, input, "create");
        return await this.repository.applyCampaignPostStatus(draft.id, postPersistence(bufferPost));
      } catch (error) {
        const message = safeBufferMessage(error);
        this.logger.error?.(JSON.stringify({ component: "buffer_campaign", operation: "schedule_post", campaignId: campaign.id, channelId: channel.id, status: "failed", error: message }));
        return this.repository.failCampaignPost(draft.id, message);
      }
    }));

    const allScheduled = results.length > 0 && results.every((post) => SCHEDULED_STATES.has(post.postStatus));
    const promoted = allScheduled ? await this.repository.setBufferCampaignMode(campaign.id, "production") : campaign;
    const failures = results.filter((post) => post.postStatus === "FAILED");
    return {
      ok: allScheduled,
      campaign: { ...promoted, campaignPosts: results },
      posts: results,
      scheduledCount: results.length - failures.length,
      failedCount: failures.length,
      statusCode: allScheduled ? 201 : failures.length === results.length ? 424 : 207,
    };
  }

  async updateCampaign(campaignId, body) {
    const existing = await this.campaignById(requiredString(String(campaignId || ""), "Campaign ID", 100));
    if (!existing) {
      await this.cleanupUnreferencedMedia(body?.mediaId);
      throw validationError("Campaign was not found.", 404);
    }

    let input;
    let selectedChannels;
    let activePosts;
    let changed;
    let saved = null;
    try {
      input = normalizeBufferCampaignInput({ ...body, createdByAi: existing.createdByAi });
      const { channels } = await this.getChannels();
      selectedChannels = selectedChannelRecords(input, channels);
      const existingTargetIds = new Set((existing.targetSocialChannels || []).map((channel) =>
        String(typeof channel === "string" ? channel : channel?.id || "")));
      const sameTargets = input.targetSocialChannels.length === existingTargetIds.size &&
        input.targetSocialChannels.every((id) => existingTargetIds.has(String(id)));
      const unchangedLegacyVideo = input.mediaType === "video" && !input.mediaId &&
        input.mediaUrl === existing.mediaUrl && !existing.mediaId &&
        input.postType === existing.postType && sameTargets;
      if (!unchangedLegacyVideo) {
        input = await this.validateMedia(input, selectedChannels, { env: this.env });
      }
      const selectedIds = new Set(input.targetSocialChannels);
      const existingPosts = await this.repository.getCampaignPosts({ campaignId: existing.id });
      activePosts = existingPosts.filter((post) => post.isActive !== false);
      changed = deliveryFieldsChanged(existing, input);

      if (changed && activePosts.some((post) => post.postStatus === "PUBLISHED")) {
        throw validationError("Published Buffer posts cannot be edited. Campaign delivery fields were not changed.", 409);
      }
      const removedScheduled = activePosts.find((post) => !selectedIds.has(post.bufferChannelId) && post.bufferPostId);
      if (removedScheduled) throw validationError("A channel with an existing Buffer post cannot be removed without cancelling that post in Buffer first.", 409);
      if (input.campaignStatus === "DRAFT" && activePosts.some((post) => post.bufferPostId)) {
        throw validationError("A scheduled Buffer campaign cannot be returned to draft without cancelling its Buffer posts.", 409);
      }

      if (changed) {
        for (const post of activePosts.filter((item) => item.bufferPostId)) {
          const current = await this.bufferAdapter.getPost(post.bufferPostId);
          const persisted = postPersistence(current);
          await this.repository.applyCampaignPostStatus(post.id, persisted);
          if (persisted.postStatus === "PUBLISHED") throw validationError("Buffer reports that this post is already published and cannot be edited.", 409);
        }
      }

      saved = await this.repository.saveCampaign(campaignRecord(input, selectedChannels, existing));
      if (!saved) throw validationError("Campaign was not found.", 404);
    } catch (error) {
      const candidateMediaId = input?.mediaId || body?.mediaId;
      if (!saved && candidateMediaId && candidateMediaId !== existing.mediaId) {
        await this.cleanupUnreferencedMedia(candidateMediaId);
      }
      throw error;
    }

    input = persistedDeliveryInput(input, saved);
    await this.repository.deactivateMissingCampaignPosts(saved.id, input.targetSocialChannels);
    const posts = await this.saveDraftPosts(saved, selectedChannels, input);

    if (input.campaignStatus === "DRAFT") {
      const draftCampaign = await this.repository.setBufferCampaignMode(saved.id, "draft");
      if (existing.mediaId && existing.mediaId !== input.mediaId) {
        await this.cleanupUnreferencedMedia(existing.mediaId);
      }
      return { ok: true, campaign: { ...draftCampaign, campaignPosts: posts }, posts, syncedCount: 0, failedCount: 0, statusCode: 200 };
    }

    try {
      input = validateCanonicalMediaReference(input, this.env);
      input = await this.verifyMediaUrl(input, { fetchImpl: this.fetchImpl });
    } catch (error) {
      const failedPosts = await this.recordMediaDeliveryFailure(saved, posts, error);
      const campaign = await this.repository.setBufferCampaignMode(saved.id, "draft");
      return {
        ok: false,
        campaign: { ...campaign, campaignPosts: failedPosts },
        posts: failedPosts,
        syncedCount: 0,
        failedCount: failedPosts.length,
        error: safeBufferMessage(error),
        statusCode: 424,
      };
    }

    const results = [];
    const failures = [];
    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index];
      const channel = selectedChannels[index];
      if (post.bufferPostId && !changed) {
        results.push(post);
        continue;
      }
      try {
        const bufferPost = await this.createOrEditBufferPost(post, channel, input, post.bufferPostId ? "edit" : "create");
        results.push(await this.repository.applyCampaignPostStatus(post.id, postPersistence(bufferPost)));
      } catch (error) {
        const message = safeBufferMessage(error);
        const failedPost = post.bufferPostId
          ? await this.repository.recordCampaignPostAttemptError(post.id, message)
          : await this.repository.failCampaignPost(post.id, message);
        failures.push(failedPost);
        results.push(failedPost);
      }
    }

    const allSynchronized = failures.length === 0 && results.length > 0 && results.every((post) => SCHEDULED_STATES.has(post.postStatus));
    const campaign = await this.repository.setBufferCampaignMode(saved.id, allSynchronized ? "production" : "draft");
    if (allSynchronized && existing.mediaId && existing.mediaId !== input.mediaId) {
      await this.cleanupUnreferencedMedia(existing.mediaId);
    }
    return {
      ok: allSynchronized,
      campaign: { ...campaign, campaignPosts: results },
      posts: results,
      syncedCount: results.length - failures.length,
      failedCount: failures.length,
      statusCode: allSynchronized ? 200 : 207,
    };
  }

  async syncPosts({ campaignId = null } = {}) {
    const posts = await this.repository.getCampaignPosts({ campaignId, syncableOnly: true });
    const results = [];
    for (const post of posts) {
      try {
        const current = await this.bufferAdapter.getPost(post.bufferPostId);
        results.push(await this.repository.applyCampaignPostStatus(post.id, postPersistence(current)));
      } catch (error) {
        const message = safeBufferMessage(error);
        await this.repository.recordCampaignPostAttemptError(post.id, message);
        results.push({ ...post, errorSource: "BUFFER", errorMessage: message, lastAttemptAt: new Date().toISOString() });
      }
    }
    return { ok: results.every((post) => post.postStatus !== "FAILED"), checked: results.length, posts: results };
  }
}
