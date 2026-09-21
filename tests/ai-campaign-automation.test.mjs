import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  AIProviderService,
  NORMALIZED_AI_OUTPUT_SCHEMA,
  OpenAIAdapter,
  normalizeAiCampaignOutput,
  safeAiMessage,
} from "../social/ai-providers.mjs";
import {
  AICampaignAutomationEngine,
  campaignDate,
  normalizeAiCampaignInput,
} from "../social/ai-campaign-automation.mjs";
import { createSocialListenerApp } from "../social/server.mjs";
import { AIImageService, campaignMediaLibrary, selectCampaignMedia } from "../social/ai-campaign-media.mjs";

const providerRows = [
  { id: 1, providerCode: "OPENAI", providerName: "OpenAI", model: "primary-model", enabled: true, secrets: { apiKey: "primary-secret" } },
  { id: 2, providerCode: "ANTHROPIC", providerName: "Claude", model: "fallback-model", enabled: true, secrets: { apiKey: "fallback-secret" } },
];

function providerRepository() {
  return {
    getAiProviderConfigurations: async ({ providerId }) => providerRows.filter((item) => item.id === Number(providerId)),
  };
}

function generatedValue(platform = "instagram") {
  return {
    headline: "A fresh lesson",
    caption: "Make the next step simpler.",
    body: "Use one repeatable system to create steady progress.",
    hashtags: ["Growth", "#CRM", "Growth"],
    cta_text: "See the guide",
    cta_url: "https://example.com/guide",
    content_type: "EDUCATIONAL",
    image_prompt: "A calm founder reviewing a clear growth dashboard",
    video_prompt: "A concise product walkthrough with clean transitions",
    platform,
    recommended_publish_time: "17:30",
  };
}

test("normalized AI output enforces one provider-independent contract", () => {
  const output = normalizeAiCampaignOutput(generatedValue(), {
    providerCode: "OPENAI",
    model: "gpt-test",
    platform: "instagram",
  });
  assert.deepEqual(Object.keys(output), [
    "headline", "caption", "body", "hashtags", "cta_text", "cta_url", "content_type",
    "image_prompt", "video_prompt", "excerpt_source_segment", "media_direction",
    "platform", "recommended_publish_time", "metadata",
  ]);
  assert.deepEqual(output.hashtags, ["#Growth", "#CRM"]);
  assert.deepEqual(output.metadata, { provider: "OPENAI", model: "gpt-test" });
  assert.equal(NORMALIZED_AI_OUTPUT_SCHEMA.additionalProperties, false);
});

test("provider service retries primary and uses only an explicitly configured fallback", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const adapters = new Map([
    ["OPENAI", {
      generateCampaignContent: async () => {
        primaryCalls += 1;
        const error = new Error("temporary outage");
        error.retryable = true;
        throw error;
      },
    }],
    ["ANTHROPIC", {
      generateCampaignContent: async () => {
        fallbackCalls += 1;
        return generatedValue("facebook");
      },
    }],
  ]);
  const service = new AIProviderService({ repository: providerRepository(), encryptionKey: "unused", adapters });
  const result = await service.generateCampaignContent({
    providerId: 1,
    fallbackProviderId: 2,
    context: { platform: "facebook" },
  });
  assert.equal(primaryCalls, 3);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.providerCode, "ANTHROPIC");
  assert.equal(result.output.metadata.model, "fallback-model");

  primaryCalls = 0;
  fallbackCalls = 0;
  await assert.rejects(() => service.generateCampaignContent({ providerId: 1, context: { platform: "instagram" } }), /temporary outage/);
  assert.equal(primaryCalls, 3);
  assert.equal(fallbackCalls, 0);
});

test("AI provider errors redact credentials even when the upstream message labels a provided key", () => {
  const message = safeAiMessage(new Error("Incorrect API key provided: example********************************suffix."));
  assert.equal(message, "Incorrect API key provided=[redacted]");
  assert.doesNotMatch(message, /example|suffix/);
});

test("provider authentication failures never return an upstream credential fragment", async () => {
  const adapter = new OpenAIAdapter({
    fetchImpl: async () => Response.json({
      error: { message: "Incorrect API key provided: example********************************suffix." },
    }, { status: 401 }),
  });

  await assert.rejects(
    () => adapter.testConnection({ providerName: "OpenAI", secrets: { apiKey: "example-secret-suffix" } }),
    (error) => error.statusCode === 401 && error.message === "OpenAI rejected the stored API credential.",
  );
});

test("AI campaign validation stores only supported content types and selected Buffer IDs", () => {
  const input = normalizeAiCampaignInput({
    campaignName: "Thirty day launch",
    campaignObjective: "Educate qualified founders",
    startDate: "2026-09-10",
    endDate: "2026-10-10",
    postsPerDay: 2,
    contentTypes: ["educational", "TIPS", "UNKNOWN"],
    aiProviderId: 1,
    fallbackProviderId: 2,
    selectedBufferChannelIds: ["ig-1", "ig-1", "fb-1"],
    publishingMode: "draft",
  });
  assert.deepEqual(input.contentTypes, ["EDUCATIONAL", "TIPS"]);
  assert.deepEqual(input.selectedBufferChannelIds, ["ig-1", "fb-1"]);
  assert.equal(input.publishingMode, "DRAFT");
  assert.throws(() => normalizeAiCampaignInput({ ...input, fallbackProviderId: 1 }), /differ/);
});

test("transcript and media-rich campaigns require reviewable drafts", () => {
  const base = {
    campaignName: "Source series", campaignObjective: "Explain our process",
    startDate: "2026-09-20", endDate: "2026-09-21", postsPerDay: 2,
    contentTypes: ["EDUCATIONAL"], aiProviderId: 1, selectedBufferChannelIds: ["ig-1"],
    sourceContentType: "TRANSCRIPT_PLUS_OBJECTIVE", sourceContent: "First lesson. Second lesson.",
    mediaStrategy: "STORED_IMAGE_ONLY", storedMediaAssetIds: ["asset-1"], publishingMode: "DRAFT",
  };
  const input = normalizeAiCampaignInput(base);
  assert.equal(input.sourceContentType, "TRANSCRIPT_PLUS_OBJECTIVE");
  assert.deepEqual(input.storedMediaAssetIds, ["asset-1"]);
  assert.throws(() => normalizeAiCampaignInput({ ...base, publishingMode: "PRODUCTION" }), /drafts for review/);
  assert.throws(() => normalizeAiCampaignInput({ ...base, sourceContent: "" }), /Add transcript/);
});

test("stored media catalog deduplicates Cloudinary assets and matches relevant labels", () => {
  const assets = campaignMediaLibrary([
    { cloudinaryAssetId: "asset-1", cloudinaryPublicId: "campaigns/growth", cloudinaryResourceType: "image", cloudinaryFormat: "png", mediaType: "image", mediaUrl: "https://res.cloudinary.com/example/growth.png", mediaOriginalName: "growth dashboard.png" },
    { cloudinaryAssetId: "asset-1", cloudinaryPublicId: "campaigns/growth", cloudinaryResourceType: "image", cloudinaryFormat: "png", mediaType: "image", mediaUrl: "https://res.cloudinary.com/example/growth.png", mediaOriginalName: "growth dashboard.png" },
    { cloudinaryAssetId: "asset-2", cloudinaryPublicId: "campaigns/team", cloudinaryResourceType: "image", cloudinaryFormat: "png", mediaType: "image", mediaUrl: "https://res.cloudinary.com/example/team.png", mediaOriginalName: "team portrait.png" },
  ]);
  assert.equal(assets.length, 2);
  assert.equal(selectCampaignMedia(assets, { strategy: "STORED_IMAGE_ONLY", output: { headline: "A growth dashboard" } }).cloudinaryAssetId, "asset-1");
  assert.equal(selectCampaignMedia(assets, { strategy: "STORED_VIDEO_ONLY", output: { headline: "A growth dashboard" } }), null);
});

test("AI image generation uses an existing provider secret and stores bytes through campaign Cloudinary path", async () => {
  let uploaded;
  const service = new AIImageService({
    providerService: { provider: async () => ({ providerCode: "OPENAI", secrets: { apiKey: "stored-secret" } }) },
    fetchImpl: async (_url, request) => {
      assert.equal(request.headers.authorization, "Bearer stored-secret");
      assert.equal(JSON.parse(request.body).model, "gpt-image-1");
      return Response.json({ data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }] });
    },
    uploadMedia: async (input) => { uploaded = input; return { assetId: "generated-1", mediaUrl: "https://res.cloudinary.com/example/generated.png" }; },
    env: {},
  });
  const result = await service.generate({ providerId: 1, prompt: "A useful illustration", platform: "instagram" });
  assert.equal(result.media.assetId, "generated-1");
  assert.equal(uploaded.bytes.toString(), "image-bytes");
});

test("transcript series creates normal image CampaignPosts from distinct source segments", async () => {
  const configuration = {
    id: 9, campaignName: "Transcript series", campaignObjective: "Teach dashboard basics",
    startDate: "2026-09-20", endDate: "2026-09-21", postsPerDay: 2,
    contentTypes: ["EDUCATIONAL"], aiProviderId: 1, fallbackProviderId: null,
    selectedBufferChannelIds: ["ig-1"], cta: "Learn more", destinationUrl: "https://example.com",
    sourceContentType: "TRANSCRIPT_PLUS_OBJECTIVE", sourceContent: "First lesson is about growth dashboards. Second lesson is about marketing dashboards.",
    mediaStrategy: "STORED_IMAGE_ONLY", storedMediaAssetIds: ["asset-growth", "asset-marketing"],
    publishingMode: "DRAFT", status: "DRAFT",
  };
  const campaigns = [
    { cloudinaryAssetId: "asset-growth", cloudinaryPublicId: "campaigns/growth", cloudinaryResourceType: "image", cloudinaryFormat: "png", mediaType: "image", mediaUrl: "https://res.cloudinary.com/example/growth.png", mediaOriginalName: "growth dashboard.png" },
    { cloudinaryAssetId: "asset-marketing", cloudinaryPublicId: "campaigns/marketing", cloudinaryResourceType: "image", cloudinaryFormat: "png", mediaType: "image", mediaUrl: "https://res.cloudinary.com/example/marketing.png", mediaOriginalName: "marketing dashboard.png" },
  ];
  const history = [];
  const saved = [];
  const contexts = [];
  const engine = new AICampaignAutomationEngine({
    repository: {
      getAiCampaignConfigurations: async () => [configuration],
      setAiCampaignStatus: async () => ({ ...configuration, status: "ACTIVE" }),
      getCompanyProfile: async () => ({ companyName: "Example" }),
      getAiGenerationHistory: async () => history,
      getContent: async () => ({ campaigns }),
      claimAiGenerationRun: async () => ({ id: saved.length + 1 }),
      succeedAiGenerationRun: async (_id, input) => saved.push(input),
      failAiGenerationRun: async (_id, input) => assert.fail(input.error),
    },
    providerService: {
      provider: async () => providerRows[0],
      generateCampaignContent: async ({ context }) => {
        contexts.push(context);
        const output = normalizeAiCampaignOutput({
          ...generatedValue(),
          headline: context.sourceSegment.id === "segment-1" ? "Growth dashboard" : "Marketing dashboard",
          excerpt_source_segment: context.sourceSegment.text,
        }, { providerCode: "OPENAI", model: "test", platform: "instagram" });
        return { output, providerId: 1, providerCode: "OPENAI", model: "test", fallbackUsed: false, attempts: 1 };
      },
    },
    bufferCampaignService: {
      getChannels: async () => ({ channels: [{ id: "ig-1", service: "instagram", displayName: "Instagram" }] }),
      scheduleCampaign: async (input) => ({ campaign: { id: `campaign:${saved.length + 1}` }, posts: [{ id: saved.length + 1, postStatus: "DRAFT", ...input }] }),
    },
    clock: () => new Date("2026-09-20T12:00:00Z"),
    logger: { error() {} },
  });
  const result = await engine.start(9);
  assert.equal(result.generated.every((item) => item.status === "SUCCEEDED"), true);
  assert.deepEqual(contexts.map((context) => context.sourceSegment.id), ["segment-1", "segment-2"]);
  assert.deepEqual(saved.map((item) => item.normalizedOutput.media_plan.assetId), ["asset-growth", "asset-marketing"]);
  assert.equal(result.generated[0].campaignPost.cloudinaryAssetId, "asset-growth");
  assert.equal(result.generated[0].campaignPost.campaignStatus, "DRAFT");
});

test("script with stored video creates an Instagram Reel draft through normal CampaignPost flow", async () => {
  const video = {
    cloudinaryAssetId: "video-1", cloudinaryPublicId: "campaigns/demo", cloudinaryResourceType: "video",
    cloudinaryFormat: "mp4", mediaType: "video", mediaUrl: "https://res.cloudinary.com/example/demo.mp4",
    mediaOriginalName: "product demo.mp4", mediaDurationSeconds: 20, mediaWidth: 1080, mediaHeight: 1920,
  };
  const configuration = {
    id: 10, campaignName: "Demo", campaignObjective: "Explain the product demo",
    startDate: "2026-09-20", endDate: "2026-09-21", postsPerDay: 1,
    contentTypes: ["EDUCATIONAL"], aiProviderId: 1, fallbackProviderId: null,
    selectedBufferChannelIds: ["ig-1"], sourceContentType: "SCRIPT_PLUS_OBJECTIVE",
    sourceContent: "The product demo shows the workflow.", mediaStrategy: "STORED_VIDEO_ONLY",
    storedMediaAssetIds: ["video-1"], publishingMode: "DRAFT", status: "DRAFT",
  };
  let delivery;
  const engine = new AICampaignAutomationEngine({
    repository: {
      getAiCampaignConfigurations: async () => [configuration],
      setAiCampaignStatus: async () => ({ ...configuration, status: "ACTIVE" }),
      getCompanyProfile: async () => ({ companyName: "Example" }),
      getAiGenerationHistory: async () => [],
      getContent: async () => ({ campaigns: [video] }),
      claimAiGenerationRun: async () => ({ id: 1 }),
      succeedAiGenerationRun: async () => {},
      failAiGenerationRun: async (_id, input) => assert.fail(input.error),
    },
    providerService: {
      provider: async () => providerRows[0],
      generateCampaignContent: async ({ context }) => ({
        output: normalizeAiCampaignOutput({ ...generatedValue(), headline: "Product demo", excerpt_source_segment: context.sourceSegment.text }, { platform: "instagram" }),
        providerId: 1, providerCode: "OPENAI", model: "test", fallbackUsed: false, attempts: 1,
      }),
    },
    bufferCampaignService: {
      getChannels: async () => ({ channels: [{ id: "ig-1", service: "instagram", displayName: "Instagram" }] }),
      scheduleCampaign: async (input) => { delivery = input; return { campaign: { id: "campaign:10" }, posts: [{ id: 10, postStatus: "DRAFT" }] }; },
    },
    clock: () => new Date("2026-09-20T12:00:00Z"), logger: { error() {} },
  });
  const result = await engine.start(10);
  assert.equal(result.generated[0].status, "SUCCEEDED");
  assert.equal(delivery.postType, "REEL");
  assert.equal(delivery.cloudinaryAssetId, "video-1");
  assert.equal(delivery.campaignStatus, "DRAFT");
});

test("AI-image strategy attaches the generated Cloudinary reference to a transcript draft", async () => {
  const configuration = {
    id: 11, campaignName: "Visual lesson", campaignObjective: "Teach the lesson",
    startDate: "2026-09-20", endDate: "2026-09-21", postsPerDay: 1,
    contentTypes: ["EDUCATIONAL"], aiProviderId: 1, fallbackProviderId: null,
    selectedBufferChannelIds: ["fb-1"], sourceContentType: "TRANSCRIPT_PLUS_OBJECTIVE",
    sourceContent: "The lesson explains how a dashboard helps.", mediaStrategy: "AI_IMAGE_ONLY",
    imageProviderId: 1, storedMediaAssetIds: [], publishingMode: "DRAFT", status: "DRAFT",
  };
  let delivery;
  let imagePrompt;
  const engine = new AICampaignAutomationEngine({
    repository: {
      getAiCampaignConfigurations: async () => [configuration], setAiCampaignStatus: async () => ({ ...configuration, status: "ACTIVE" }),
      getCompanyProfile: async () => ({ companyName: "Example" }), getAiGenerationHistory: async () => [],
      getContent: async () => ({ campaigns: [] }), claimAiGenerationRun: async () => ({ id: 1 }),
      succeedAiGenerationRun: async () => {}, failAiGenerationRun: async (_id, input) => assert.fail(input.error),
    },
    providerService: {
      provider: async () => providerRows[0],
      generateCampaignContent: async () => ({
        output: normalizeAiCampaignOutput(generatedValue("facebook"), { platform: "facebook" }),
        providerId: 1, providerCode: "OPENAI", model: "test", fallbackUsed: false, attempts: 1,
      }),
    },
    imageService: { generate: async ({ prompt }) => {
      imagePrompt = prompt;
      return { model: "gpt-image-1", media: {
        assetId: "ai-1", publicId: "campaigns/ai-1", resourceType: "image", format: "png",
        mediaId: "ai-1", mediaType: "image", mediaUrl: "https://res.cloudinary.com/example/ai-1.png",
      } };
    } },
    bufferCampaignService: {
      getChannels: async () => ({ channels: [{ id: "fb-1", service: "facebook", displayName: "Facebook" }] }),
      scheduleCampaign: async (input) => { delivery = input; return { campaign: { id: "campaign:11" }, posts: [{ id: 11, postStatus: "DRAFT" }] }; },
    },
    clock: () => new Date("2026-09-20T12:00:00Z"), logger: { error() {} },
  });
  const result = await engine.start(11);
  assert.equal(result.generated[0].status, "SUCCEEDED");
  assert.match(imagePrompt, /dashboard/);
  assert.equal(delivery.cloudinaryAssetId, "ai-1");
  assert.equal(delivery.campaignStatus, "DRAFT");
  assert.deepEqual(result.generated[0].output.ai_generated_media_references, ["ai-1"]);
});

test("start-now creates normal Campaign and CampaignPost deliveries once per date, slot, and channel", async () => {
  const now = new Date("2026-09-10T14:00:00.000Z");
  const configuration = {
    id: 7,
    campaignName: "Daily momentum",
    campaignObjective: "Drive qualified visits",
    startDate: "2026-09-10",
    endDate: "2026-09-12",
    postsPerDay: 2,
    contentTypes: ["EDUCATIONAL", "TIPS"],
    aiProviderId: 1,
    aiModel: null,
    fallbackProviderId: null,
    selectedBufferChannelIds: ["ig-1", "fb-1"],
    cta: "Book a call",
    destinationUrl: "https://example.com/book",
    publishingMode: "DRAFT",
    status: "DRAFT",
  };
  const claimed = new Set();
  const runs = [];
  const completed = [];
  let campaignSequence = 0;
  const repository = {
    getAiCampaignConfigurations: async () => [configuration],
    setAiCampaignStatus: async (_id, status) => ({ ...configuration, status }),
    getCompanyProfile: async () => ({ companyName: "Next2TheTop", companyDescription: "Growth systems", preferredCTA: "Learn more" }),
    getAiGenerationHistory: async () => runs,
    claimAiGenerationRun: async (input) => {
      const key = `${input.configurationId}:${input.generationDate}:${input.runSlot}:${input.bufferChannelId}:0`;
      if (claimed.has(key)) return null;
      claimed.add(key);
      const run = { id: claimed.size, ...input };
      runs.unshift({ ...run, generationStatus: "CLAIMED", normalizedOutput: null });
      return run;
    },
    succeedAiGenerationRun: async (id, input) => completed.push({ id, ...input }),
    failAiGenerationRun: async () => assert.fail("generation should succeed"),
  };
  const providerService = {
    provider: async () => providerRows[0],
    generateCampaignContent: async ({ context }) => ({
      output: normalizeAiCampaignOutput(generatedValue(context.platform), {
        providerCode: "OPENAI", model: "primary-model", platform: context.platform,
      }),
      providerId: 1,
      providerCode: "OPENAI",
      model: "primary-model",
      fallbackUsed: false,
      attempts: 1,
    }),
  };
  const bufferCampaignService = {
    getChannels: async () => ({ channels: [
      { id: "ig-1", service: "instagram", displayName: "Instagram", isQueuePaused: false },
      { id: "fb-1", service: "facebook", displayName: "Facebook", isQueuePaused: false },
    ] }),
    scheduleCampaign: async (input) => {
      campaignSequence += 1;
      assert.equal(input.createdByAi, true);
      assert.equal(input.targetSocialChannels.length, 1);
      assert.equal(input.campaignStatus, "DRAFT");
      return {
        campaign: { id: `campaign:${campaignSequence}`, ...input },
        posts: [{ id: campaignSequence, campaignId: `campaign:${campaignSequence}`, postStatus: "DRAFT" }],
      };
    },
  };
  const engine = new AICampaignAutomationEngine({ repository, providerService, bufferCampaignService, clock: () => now, logger: { error() {} } });
  const first = await engine.start(7);
  const second = await engine.start(7);
  assert.equal(campaignDate(now), "2026-09-10");
  assert.equal(first.generated.length, 4);
  assert.equal(first.generated.every((item) => item.status === "SUCCEEDED"), true);
  assert.equal(second.generated.every((item) => item.status === "SKIPPED"), true);
  assert.equal(campaignSequence, 4);
  assert.equal(completed.length, 4);
  assert.equal(new Set(completed.map((item) => item.campaignPostId)).size, 4);
});

test("daily tick includes the end date and completes active campaigns only afterward", async () => {
  let completedDate;
  const configuration = {
    id: 3, status: "ACTIVE", startDate: "2026-09-01", endDate: "2026-09-10", postsPerDay: 1,
    selectedBufferChannelIds: [], contentTypes: ["TIPS"], aiProviderId: 1,
  };
  const engine = new AICampaignAutomationEngine({
    repository: {
      completeExpiredAiCampaigns: async (date) => { completedDate = date; return 0; },
      getDueAiCampaignConfigurations: async () => [configuration],
    },
    clock: () => new Date("2026-09-10T18:00:00.000Z"),
    logger: { error() {} },
  });
  engine.processConfiguration = async (_configuration, date) => [{ date }];
  const result = await engine.tick();
  assert.equal(completedDate, "2026-09-10");
  assert.equal(result.campaigns[0].results[0].date, "2026-09-10");
});

test("migration adds configuration and history without replacing Campaign or CampaignPost", async () => {
  const sql = await readFile(new URL("../sql/024_multi_provider_ai_campaign_automation.sql", import.meta.url), "utf8");
  for (const table of ["CompanyProfiles", "AIProviderConfigurations", "AICampaignConfigurations", "AICampaignGenerationRuns"]) {
    assert.match(sql, new RegExp(`CREATE TABLE dbo\\.${table}`));
  }
  for (const procedure of [
    "CompanyProfile_Upsert", "AIProviderConfiguration_Upsert", "AICampaignConfiguration_Save",
    "AICampaignGenerationRun_Claim", "AICampaignGenerationRun_Succeed", "AICampaignGenerationHistory_Get",
  ]) {
    assert.match(sql, new RegExp(`PROCEDURE dbo\\.${procedure}`));
  }
  assert.match(sql, /UQ_AICampaignGenerationRuns_Identity UNIQUE/);
  assert.match(sql, /FOREIGN KEY \(CampaignId\) REFERENCES dbo\.Campaigns/);
  assert.match(sql, /FOREIGN KEY \(CampaignPostId\) REFERENCES dbo\.CampaignPosts/);
  assert.doesNotMatch(sql, /CREATE TABLE dbo\.Campaigns\b/);
  assert.doesNotMatch(sql, /CREATE TABLE dbo\.CampaignPosts\b/);
});

test("source/media migration extends AI configurations and leaves normal CampaignPosts intact", async () => {
  const sql = await readFile(new URL("../sql/027_ai_campaign_source_media.sql", import.meta.url), "utf8");
  for (const column of ["SourceContentType", "SourceContent", "MediaStrategy", "StoredMediaAssetIdsJson", "ImageProviderConfigurationId"]) {
    assert.match(sql, new RegExp(`ADD ${column} `));
  }
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.AICampaignConfiguration_Save/);
  assert.doesNotMatch(sql, /ALTER TABLE dbo\.CampaignPosts/);
  assert.doesNotMatch(sql, /CREATE TABLE dbo\.Campaigns/);
});

test("authenticated media-library endpoint returns only reusable campaign Cloudinary references", async () => {
  const app = await createSocialListenerApp({
    env: { SERVICE_AUTH_TOKEN: "service-token" },
    repository: { getContent: async () => ({ campaigns: [
      { cloudinaryAssetId: "asset-1", cloudinaryPublicId: "campaigns/one", cloudinaryResourceType: "image", cloudinaryFormat: "png", mediaType: "image", mediaUrl: "https://res.cloudinary.com/example/one.png" },
      { mediaType: "image", mediaUrl: "https://example.com/not-cloudinary.png" },
    ] }) },
    adapters: {}, bufferCampaignService: {}, aiProviderService: {}, aiCampaignAutomationEngine: {},
    logger: { error() {}, info() {} },
  });
  const unauthorized = await app.handle(new Request("http://localhost/ai/campaigns/media-library"));
  const response = await app.handle(new Request("http://localhost/ai/campaigns/media-library", {
    headers: { authorization: "Bearer service-token" },
  }));
  assert.equal(unauthorized.status, 401);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).assets.map((item) => item.cloudinaryAssetId), ["asset-1"]);
});

test("provider configuration API encrypts submitted keys and returns only a mask", async () => {
  const provider = {
    id: 1,
    providerCode: "OPENAI",
    providerName: "OpenAI",
    model: "gpt-test",
    enabled: false,
    isDefault: true,
    capabilities: ["TEXT_GENERATION", "STRUCTURED_OUTPUT"],
    hasSecret: false,
    connectionStatus: "NOT_TESTED",
  };
  let storedEnvelope;
  const repository = {
    getAiProviderConfigurations: async () => [provider],
    saveAiProviderConfiguration: async (input, envelope) => {
      storedEnvelope = envelope;
      return { ...provider, ...input, hasSecret: true };
    },
  };
  const app = await createSocialListenerApp({
    env: {
      SERVICE_AUTH_TOKEN: "service-token",
      AI_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
    repository,
    adapters: {},
    bufferCampaignService: {},
    aiProviderService: {},
    aiCampaignAutomationEngine: {},
    logger: { error() {}, info() {} },
  });
  const response = await app.handle(new Request("http://localhost/ai/providers", {
    method: "PUT",
    headers: { authorization: "Bearer service-token", "content-type": "application/json" },
    body: JSON.stringify({ id: 1, model: "gpt-test", apiKey: "provider-key-do-not-return-this-value", enabled: true, isDefault: true }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.provider.hasSecret, true);
  assert.equal(body.provider.maskedSecret, "********");
  assert.equal(body.provider.apiKey, undefined);
  assert.doesNotMatch(JSON.stringify(body), /do-not-return/);
  assert.doesNotMatch(storedEnvelope.ciphertext, /do-not-return/);
});

test("Company Profile API saves and reloads the complete normalized profile", async () => {
  let storedProfile = null;
  const repository = {
    getCompanyProfile: async () => storedProfile,
    saveCompanyProfile: async (input) => {
      storedProfile = {
        id: 1,
        ...input,
        createdAt: "2026-09-11T12:00:00.000Z",
        updatedAt: "2026-09-11T12:00:00.000Z",
      };
      return storedProfile;
    },
  };
  const app = await createSocialListenerApp({
    env: { SERVICE_AUTH_TOKEN: "service-token" },
    repository,
    adapters: {},
    bufferCampaignService: {},
    aiProviderService: {},
    aiCampaignAutomationEngine: {},
    logger: { error() {}, info() {} },
  });

  const saveResponse = await app.handle(new Request("http://localhost/company-profile", {
    method: "PUT",
    headers: { authorization: "Bearer service-token", "content-type": "application/json" },
    body: JSON.stringify({
      companyName: "Next2TheTop",
      companyDescription: "",
      productsServices: "CRM and marketing automation",
      targetAudience: "Growth-focused businesses",
      website: "https://next2thetop.com",
      otherProfileContext: "Preserve the existing campaign architecture.",
    }),
  }));
  const saved = await saveResponse.json();
  const reloadResponse = await app.handle(new Request("http://localhost/company-profile", {
    headers: { authorization: "Bearer service-token" },
  }));
  const reloaded = await reloadResponse.json();

  assert.equal(saveResponse.status, 200);
  assert.equal(reloadResponse.status, 200);
  assert.equal(saved.profile.companyName, "Next2TheTop");
  assert.equal(saved.profile.companyDescription, "");
  assert.equal(reloaded.profile.productsServices, "CRM and marketing automation");
  assert.equal(reloaded.profile.website, "https://next2thetop.com/");
  assert.equal(reloaded.profile.otherProfileContext, "Preserve the existing campaign architecture.");
});

test("Settings deep link renders AI configuration immediately and keeps optional profile fields optional", async () => {
  const [dashboard, home, configuration] = await Promise.all([
    readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AIConfiguration.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /<Home initialView=\{requested\} \/>/);
  assert.match(home, /useState\(initialView\)/);
  assert.match(home, /<AISettingsPanels \/>/);
  assert.match(configuration, /<h3>AI Provider Configuration<\/h3>/);
  assert.match(configuration, /<textarea name="companyDescription" defaultValue=/);
  assert.doesNotMatch(configuration, /<textarea name="companyDescription" required/);
});
