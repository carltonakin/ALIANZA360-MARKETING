import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BufferAdapter,
  bufferPostMetadata,
  externalPostIdFromLink,
  mapBufferPostStatus,
} from "../social/buffer-adapter.mjs";
import {
  BufferCampaignService,
  normalizeBufferCampaignInput,
  validateBufferPostCompatibility,
} from "../social/buffer-campaigns.mjs";
import {
  readCampaignMedia,
  storeCampaignMedia,
  validateCampaignMedia,
} from "../lib/campaign-media.mjs";
import { InMemorySocialRepository } from "../social/core.mjs";
import { createSocialListenerApp } from "../social/server.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const channels = [
  { id: "channel-instagram", name: "alianza", displayName: "Alianza Instagram", service: "instagram", avatar: null, isQueuePaused: false },
  { id: "channel-twitter", name: "alianza_x", displayName: "Alianza X", service: "twitter", avatar: null, isQueuePaused: false },
];

const campaignInput = {
  campaignName: "Founder webinar",
  campaignObjective: "Register qualified founders for the webinar",
  postText: "Build a scalable company. Register for the webinar.",
  targetSocialChannels: channels.map((channel) => channel.id),
  publishDateTime: "2030-08-26T15:00:00.000Z",
  highIntentKeywords: "pricing, webinar, demo",
  aiReplyEnabled: true,
};

test("Buffer adapter retrieves live channels without exposing its server credential", async () => {
  let request;
  const adapter = new BufferAdapter({
    apiKey: "buffer-secret-key",
    organizationId: "organization-1",
  }, {
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return jsonResponse({ data: { channels } });
    },
  });

  const result = await adapter.getChannels();
  assert.equal(request.url, "https://api.buffer.com");
  assert.equal(request.init.headers.authorization, "Bearer buffer-secret-key");
  assert.deepEqual(request.body.variables, { input: { organizationId: "organization-1" } });
  assert.deepEqual(result.map((channel) => channel.id), ["channel-instagram", "channel-twitter"]);
  assert.doesNotMatch(JSON.stringify(result), /buffer-secret-key/);
});

test("Buffer adapter schedules exact custom UTC posts with automatic publishing and public media", async () => {
  let variables;
  const adapter = new BufferAdapter({ apiKey: "key", organizationId: "organization-1" }, {
    fetchImpl: async (_url, init) => {
      variables = JSON.parse(init.body).variables;
      return jsonResponse({
        data: {
          createPost: {
            __typename: "PostActionSuccess",
            post: {
              id: "buffer-post-1",
              channelId: "channel-instagram",
              channelService: "instagram",
              dueAt: "2030-08-26T15:00:00.000Z",
              sentAt: null,
              status: "scheduled",
              externalLink: null,
              error: null,
            },
          },
        },
      });
    },
  });

  const post = await adapter.schedulePost({
    channelId: "channel-instagram",
    service: "instagram",
    postType: "POST",
    text: "Register now",
    dueAt: "2030-08-26T11:00:00-04:00",
    mediaType: "image",
    mediaUrl: "https://cdn.example.com/webinar.jpg",
  });
  assert.equal(post.id, "buffer-post-1");
  assert.equal(variables.input.mode, "customScheduled");
  assert.equal(variables.input.schedulingType, "automatic");
  assert.equal(variables.input.dueAt, "2030-08-26T15:00:00.000Z");
  assert.deepEqual(variables.input.assets, [{ image: { url: "https://cdn.example.com/webinar.jpg" } }]);
  assert.deepEqual(variables.input.metadata, { instagram: { type: "post", shouldShareToFeed: true } });
});

test("Buffer maps Instagram and Facebook post types through documented metadata", () => {
  assert.deepEqual(bufferPostMetadata("instagram", "REEL"), {
    instagram: { type: "reel", shouldShareToFeed: true },
  });
  assert.deepEqual(bufferPostMetadata("instagram", "STORY"), {
    instagram: { type: "story", shouldShareToFeed: false },
  });
  assert.deepEqual(bufferPostMetadata("facebook", "STORY"), { facebook: { type: "story" } });
  assert.equal(bufferPostMetadata("twitter", "POST"), undefined);
});

test("Buffer editPost updates the existing ID with exact scheduling, metadata, and assets", async () => {
  let operation;
  let variables;
  const adapter = new BufferAdapter({ apiKey: "key", organizationId: "organization-1" }, {
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      operation = body.query;
      variables = body.variables;
      return jsonResponse({ data: { editPost: { __typename: "PostActionSuccess", post: {
        id: "buffer-post-1", channelId: "channel-instagram", channelService: "instagram",
        dueAt: "2030-08-27T15:00:00.000Z", sentAt: null, status: "scheduled", externalLink: null, error: null,
      } } } });
    },
  });
  await adapter.editPost({
    postId: "buffer-post-1",
    service: "instagram",
    postType: "REEL",
    text: "Updated Reel",
    dueAt: "2030-08-27T15:00:00.000Z",
    mediaType: "video",
    mediaUrl: "https://cdn.example.com/reel.mp4",
  });
  assert.match(operation, /editPost\(input: \$input\)/);
  assert.equal(variables.input.id, "buffer-post-1");
  assert.equal(variables.input.mode, "customScheduled");
  assert.deepEqual(variables.input.assets, [{ video: { url: "https://cdn.example.com/reel.mp4" } }]);
  assert.deepEqual(variables.input.metadata, { instagram: { type: "reel", shouldShareToFeed: true } });
});

test("Buffer status mapping only treats sent posts as published", () => {
  assert.equal(mapBufferPostStatus("scheduled"), "SCHEDULED");
  assert.equal(mapBufferPostStatus("sending"), "QUEUED");
  assert.equal(mapBufferPostStatus("sent"), "PUBLISHED");
  assert.equal(mapBufferPostStatus("error"), "FAILED");
  assert.equal(mapBufferPostStatus("needs_approval"), "DRAFT");
  assert.equal(externalPostIdFromLink("twitter", "https://x.com/alianza/status/123456"), "123456");
  assert.equal(externalPostIdFromLink("instagram", "https://www.instagram.com/p/ABC123/"), "ABC123");
});

test("campaign validation requires future scheduling, live targets, and public media URLs", () => {
  assert.throws(() => normalizeBufferCampaignInput({
    ...campaignInput,
    mediaType: "image",
    mediaUrl: "http://localhost/file.jpg",
  }, { now: new Date("2026-08-25T12:00:00Z") }), /publicly accessible/i);
  assert.throws(() => normalizeBufferCampaignInput({
    ...campaignInput,
    targetSocialChannels: [],
  }, { now: new Date("2026-08-25T12:00:00Z") }), /at least one live Buffer channel/i);
});

test("Reel and Story validation rejects missing media and unsupported channels before Buffer", () => {
  assert.throws(() => normalizeBufferCampaignInput({ ...campaignInput, postType: "REEL" }), /requires a valid video/i);
  const reel = normalizeBufferCampaignInput({
    ...campaignInput,
    postType: "REEL",
    mediaType: "video",
    mediaUrl: "https://cdn.example.com/reel.mp4",
  });
  assert.throws(() => validateBufferPostCompatibility(reel, [channels[1]]), /supports POST only/i);
  assert.throws(() => normalizeBufferCampaignInput({ ...campaignInput, postType: "STORY" }), /requires a valid image or video/i);
});

test("campaign media upload validates MIME, extension, signature, size, and reloads the stored bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crm360-media-"));
  const env = {
    NODE_ENV: "production",
    CAMPAIGN_MEDIA_DIRECTORY: directory,
    CAMPAIGN_MEDIA_PUBLIC_BASE_URL: "https://crm.example.com",
    CAMPAIGN_MEDIA_MAX_BYTES: "1048576",
  };
  try {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("campaign-image"),
    ]);
    const file = new File([png], "campaign.png", { type: "image/png" });
    const stored = await storeCampaignMedia(file, { requestUrl: "https://internal.example/upload", env });
    assert.equal(stored.mediaType, "image");
    assert.match(stored.mediaUrl, /^https:\/\/crm\.example\.com\/api\/media\/[0-9a-f-]+\.png$/);
    assert.equal(stored.mediaOriginalName, "campaign.png");
    const loaded = await readCampaignMedia(stored.mediaId, env);
    assert.deepEqual(loaded.bytes, png);
    assert.equal(loaded.mimeType, "image/png");

    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from("ftypisom"),
      Buffer.from("campaign-video"),
    ]);
    const video = await storeCampaignMedia(
      new File([mp4], "campaign.mp4", { type: "video/mp4" }),
      { requestUrl: "https://internal.example/upload", env },
    );
    assert.equal(video.mediaType, "video");
    assert.match(video.mediaUrl, /^https:\/\/crm\.example\.com\/api\/media\/[0-9a-f-]+\.mp4$/);
    const loadedVideo = await readCampaignMedia(video.mediaId, env);
    assert.deepEqual(loadedVideo.bytes, mp4);
    assert.equal(loadedVideo.mimeType, "video/mp4");

    assert.throws(() => validateCampaignMedia({
      filename: "fake.png", mimeType: "image/png", size: 4, bytes: Buffer.from("fake"),
    }, env), /contents do not match/i);
    assert.throws(() => validateCampaignMedia({
      filename: "wrong.jpg", mimeType: "image/png", size: png.length, bytes: png,
    }, env), /extension does not match/i);
    assert.throws(() => validateCampaignMedia({
      filename: "campaign.png", mimeType: "image/png", size: png.length, bytes: png,
    }, { ...env, CAMPAIGN_MEDIA_MAX_BYTES: "8" }), /exceeds/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("campaign service persists campaign and draft rows before any Buffer post call", async () => {
  const repository = new InMemorySocialRepository();
  let scheduleCalls = 0;
  const adapter = {
    configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
    getChannels: async () => channels,
    schedulePost: async ({ channelId, dueAt }) => {
      const content = await repository.getContent();
      assert.equal(content.campaigns.length, 1);
      assert.equal(content.campaigns[0].campaignPosts.length, 2);
      assert.ok(content.campaigns[0].campaignPosts.every((post) => post.postStatus === "DRAFT"));
      scheduleCalls += 1;
      return {
        id: `buffer-post-${scheduleCalls}`,
        channelId,
        channelService: channels.find((channel) => channel.id === channelId).service,
        dueAt,
        sentAt: null,
        status: "scheduled",
        externalLink: null,
        error: null,
      };
    },
  };
  const service = new BufferCampaignService({ repository, bufferAdapter: adapter, logger: { error() {} } });
  const result = await service.scheduleCampaign(campaignInput);
  assert.equal(result.statusCode, 201);
  assert.equal(result.campaign.status, "production");
  assert.equal(result.posts.length, 2);
  assert.ok(result.posts.every((post) => post.postStatus === "SCHEDULED"));
  assert.deepEqual(result.campaign.targetSocialChannels.map((channel) => channel.id), channels.map((channel) => channel.id));
});

test("partial Buffer failure is stored safely and does not falsely promote the campaign", async () => {
  const repository = new InMemorySocialRepository();
  const adapter = {
    configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
    getChannels: async () => channels,
    schedulePost: async ({ channelId, dueAt }) => {
      if (channelId === "channel-twitter") throw new Error("api_key=never-leak rejected this post");
      return {
        id: "buffer-post-1", channelId, channelService: "instagram", dueAt,
        sentAt: null, status: "scheduled", externalLink: null, error: null,
      };
    },
  };
  const service = new BufferCampaignService({ repository, bufferAdapter: adapter, logger: { error() {} } });
  const result = await service.scheduleCampaign(campaignInput);
  assert.equal(result.statusCode, 207);
  assert.equal(result.campaign.status, "draft");
  const failed = result.posts.find((post) => post.postStatus === "FAILED");
  assert.equal(failed.errorSource, "BUFFER");
  assert.match(failed.errorMessage, /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(result), /never-leak/);
});

test("status sync persists Buffer sent time, external URL, and platform post ID", async () => {
  const repository = new InMemorySocialRepository();
  const adapter = {
    configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
    getChannels: async () => channels.slice(0, 1),
    schedulePost: async ({ channelId, dueAt }) => ({
      id: "buffer-post-1", channelId, channelService: "instagram", dueAt,
      sentAt: null, status: "scheduled", externalLink: null, error: null,
    }),
    getPost: async () => ({
      id: "buffer-post-1",
      channelId: "channel-instagram",
      channelService: "instagram",
      dueAt: campaignInput.publishDateTime,
      sentAt: "2030-08-26T15:00:05.000Z",
      status: "sent",
      externalLink: "https://www.instagram.com/p/PUBLISHED123/",
      error: null,
    }),
  };
  const service = new BufferCampaignService({ repository, bufferAdapter: adapter, logger: { error() {} } });
  const created = await service.scheduleCampaign({ ...campaignInput, targetSocialChannels: ["channel-instagram"] });
  const synced = await service.syncPosts({ campaignId: created.campaign.id });
  assert.equal(synced.posts[0].postStatus, "PUBLISHED");
  assert.equal(synced.posts[0].publishedAt, "2030-08-26T15:00:05.000Z");
  assert.equal(synced.posts[0].externalPostId, "PUBLISHED123");
  assert.equal(synced.posts[0].postUrl, "https://www.instagram.com/p/PUBLISHED123/");
});

test("saved SQL campaign edits reuse CampaignId, CampaignPostId, and Buffer editPost", async () => {
  const repository = new InMemorySocialRepository();
  let editCalls = 0;
  const adapter = {
    configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
    getChannels: async () => channels.slice(0, 1),
    schedulePost: async ({ channelId, dueAt }) => ({
      id: "buffer-post-edit", channelId, channelService: "instagram", dueAt,
      sentAt: null, status: "scheduled", externalLink: null, error: null,
    }),
    getPost: async () => ({
      id: "buffer-post-edit", channelId: "channel-instagram", channelService: "instagram",
      dueAt: campaignInput.publishDateTime, sentAt: null, status: "scheduled", externalLink: null, error: null,
    }),
    editPost: async ({ postId, postType, mediaType, dueAt }) => {
      editCalls += 1;
      assert.equal(postId, "buffer-post-edit");
      assert.equal(postType, "REEL");
      assert.equal(mediaType, "video");
      return {
        id: postId, channelId: "channel-instagram", channelService: "instagram", dueAt,
        sentAt: null, status: "scheduled", externalLink: null, error: null,
      };
    },
  };
  const service = new BufferCampaignService({ repository, bufferAdapter: adapter, logger: { error() {} } });
  const created = await service.scheduleCampaign({ ...campaignInput, targetSocialChannels: ["channel-instagram"] });
  const originalCampaignId = created.campaign.id;
  const originalCampaignPostId = created.posts[0].id;
  const updated = await service.updateCampaign(originalCampaignId, {
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    campaignName: "Founder webinar revised",
    postText: "Updated Reel copy",
    postType: "REEL",
    mediaType: "video",
    mediaUrl: "https://cdn.example.com/reel.mp4",
    mediaOriginalName: "reel.mp4",
    mediaMimeType: "video/mp4",
    mediaSizeBytes: 5000,
    publishDateTime: "2030-08-27T15:00:00.000Z",
    campaignStatus: "PRODUCTION",
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.campaign.id, originalCampaignId);
  assert.equal(updated.posts[0].id, originalCampaignPostId);
  assert.equal(updated.posts[0].bufferPostId, "buffer-post-edit");
  assert.equal(editCalls, 1);
  assert.equal((await repository.getContent()).campaigns.length, 1);
});

test("SQL draft mode stores campaign media and posts without calling Buffer", async () => {
  const repository = new InMemorySocialRepository();
  const adapter = {
    configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
    getChannels: async () => channels.slice(0, 1),
    schedulePost: async () => assert.fail("Buffer must not be called for a SQL draft"),
  };
  const service = new BufferCampaignService({ repository, bufferAdapter: adapter, logger: { error() {} } });
  const result = await service.scheduleCampaign({
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    campaignStatus: "DRAFT",
    postType: "STORY",
    mediaType: "image",
    mediaUrl: "http://127.0.0.1:3000/api/media/local.png",
    mediaOriginalName: "local.png",
    mediaMimeType: "image/png",
    mediaSizeBytes: 100,
  });
  assert.equal(result.campaign.status, "draft");
  assert.equal(result.posts[0].postStatus, "DRAFT");
  assert.equal(result.posts[0].bufferPostId, null);
});

test("authenticated Buffer endpoints return live channels and SQL-backed campaigns", async () => {
  const repository = new InMemorySocialRepository();
  const bufferAdapter = {
    configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
    getChannels: async () => channels.slice(0, 1),
    schedulePost: async ({ channelId, dueAt }) => ({
      id: "buffer-post-api", channelId, channelService: "instagram", dueAt,
      sentAt: null, status: "scheduled", externalLink: null, error: null,
    }),
    getPost: async () => ({
      id: "buffer-post-api", channelId: "channel-instagram", channelService: "instagram",
      dueAt: campaignInput.publishDateTime, sentAt: null, status: "scheduled", externalLink: null, error: null,
    }),
    editPost: async ({ postId, dueAt }) => ({
      id: postId, channelId: "channel-instagram", channelService: "instagram",
      dueAt, sentAt: null, status: "scheduled", externalLink: null, error: null,
    }),
  };
  const app = await createSocialListenerApp({
    env: { SERVICE_AUTH_TOKEN: "service-token" },
    repository,
    adapters: {},
    bufferAdapter,
    logger: { info() {}, error() {}, log() {} },
  });
  const request = (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", "Bearer service-token");
    return app.handle(new Request(`http://listener.test${path}`, { ...init, headers }));
  };
  const channelResponse = await request("/buffer/channels");
  assert.equal(channelResponse.status, 200);
  assert.equal((await channelResponse.json()).channels[0].id, "channel-instagram");

  const createResponse = await request("/buffer/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...campaignInput, targetSocialChannels: ["channel-instagram"] }),
  });
  assert.equal(createResponse.status, 201);
  const persisted = await request("/buffer/campaigns");
  const body = await persisted.json();
  assert.equal(body.campaigns.length, 1);
  assert.equal(body.campaigns[0].campaignPosts[0].bufferPostId, "buffer-post-api");

  const updateResponse = await request("/buffer/campaigns", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...campaignInput,
      campaignId: body.campaigns[0].id,
      campaignName: "Founder webinar edited",
      targetSocialChannels: ["channel-instagram"],
      publishDateTime: "2030-08-27T15:00:00.000Z",
      campaignStatus: "PRODUCTION",
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updatedBody = await updateResponse.json();
  assert.equal(updatedBody.campaign.id, body.campaigns[0].id);
  assert.equal(updatedBody.posts[0].bufferPostId, "buffer-post-api");
});
