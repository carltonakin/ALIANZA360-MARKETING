import assert from "node:assert/strict";
import { File } from "node:buffer";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import {
  BufferAdapter,
  bufferPostMetadata,
  externalPostIdFromLink,
  mapBufferPostStatus,
} from "../social/buffer-adapter.mjs";
import {
  BufferCampaignService,
  normalizeBufferCampaignInput,
  verifyPublicMediaUrl,
  validateStoredInstagramVideo,
  validateBufferPostCompatibility,
} from "../social/buffer-campaigns.mjs";
import {
  readCampaignMedia,
  storeCampaignMediaBuffer,
  storeCampaignMedia,
  validateCampaignMedia,
} from "../lib/campaign-media.mjs";
import { instagramVideoValidationErrors } from "../lib/instagram-video-validation.mjs";
import { InMemorySocialRepository } from "../social/core.mjs";
import { createSocialListenerApp, registerCampaignMediaExpressRoutes } from "../social/server.mjs";

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

test("the project has one upload route and one canonical public media path", async () => {
  const [pageSource, nextUploadSource, serverSource, mediaSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/media/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../social/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/campaign-media.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(pageSource, /fetch\("\/api\/media", \{ method: "POST", body: uploadForm \}\)/);
  assert.equal((pageSource.match(/fetch\("\/api\/media", \{ method: "POST", body: uploadForm \}\)/g) || []).length, 1);
  assert.match(nextUploadSource, /proxySocialRequest\("\/api\/media", uploadRequest\)/);
  assert.match(serverSource, /expressApp\.post\(\s*"\/api\/media"/);
  assert.doesNotMatch(serverSource, /expressApp\.post\(\s*"\/uploads\/campaigns"/);
  assert.match(mediaSource, /DEFAULT_CAMPAIGN_MEDIA_PUBLIC_PATH = "\/uploads\/campaigns"/);
  assert.doesNotMatch(`${pageSource}\n${nextUploadSource}\n${serverSource}`, /\/api\/campaigns\/media|\/api\/upload|\/media\/upload/);
});

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
    mediaType: "image",
    mediaUrl: "https://127.0.0.1/private.jpg",
  }, { now: new Date("2026-08-25T12:00:00Z") }), /publicly accessible/i);
  assert.throws(() => normalizeBufferCampaignInput({
    ...campaignInput,
    mediaType: "image",
    mediaUrl: "not-a-url",
  }, { now: new Date("2026-08-25T12:00:00Z") }), /valid public/i);
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
  const instagramVideoPost = normalizeBufferCampaignInput({
    ...campaignInput,
    postType: "POST",
    mediaType: "video",
    mediaUrl: "https://cdn.example.com/video.mp4",
  });
  assert.throws(() => validateBufferPostCompatibility(instagramVideoPost, [channels[0]]), /choose Reel or Story/i);
});

const validInstagramVideo = {
  width: 1080,
  height: 1920,
  durationSeconds: 30,
  frameRate: 30,
  videoCodec: "avc1.640028",
  audioCodec: "mp4a.40.2",
  audioSampleRate: 44_100,
  videoBitrate: 8_000_000,
  audioBitrate: 128_000,
};

test("Instagram video validation enforces Buffer-compatible codec, dimensions, rate, duration, and size", () => {
  const options = { postType: "REEL", services: ["instagram"], sizeBytes: 20 * 1024 * 1024 };
  assert.deepEqual(instagramVideoValidationErrors(validInstagramVideo, options), []);
  assert.deepEqual(instagramVideoValidationErrors({ ...validInstagramVideo, audioSampleRate: 48_000 }, options), []);
  assert.match(instagramVideoValidationErrors({ ...validInstagramVideo, videoCodec: "hvc1" }, options).join(" "), /H\.264/i);
  assert.match(instagramVideoValidationErrors({ ...validInstagramVideo, audioCodec: "ac-3", audioSampleRate: 44_100 }, options).join(" "), /AAC/i);
  assert.match(instagramVideoValidationErrors({ ...validInstagramVideo, frameRate: 61 }, options).join(" "), /23 and 60 FPS/i);
  assert.deepEqual(instagramVideoValidationErrors({ ...validInstagramVideo, width: 1080, height: 1350 }, options), []);
  assert.match(instagramVideoValidationErrors({ ...validInstagramVideo, width: 1920, height: 1080 }, options).join(" "), /9:16 through 4:5/i);
  assert.match(instagramVideoValidationErrors({ ...validInstagramVideo, durationSeconds: 4 }, options).join(" "), /5 seconds/i);
  assert.match(instagramVideoValidationErrors(validInstagramVideo, { ...options, postType: "STORY", sizeBytes: 301 * 1024 * 1024 }).join(" "), /300 MB/i);
  assert.match(instagramVideoValidationErrors({ ...validInstagramVideo, durationSeconds: 61 }, { ...options, postType: "STORY" }).join(" "), /60 seconds/i);
});

test("authoritative campaign validation reloads the stored video instead of trusting client metadata", async () => {
  const bytes = Buffer.alloc(1000);
  const validated = await validateStoredInstagramVideo({
    postType: "REEL",
    mediaType: "video",
    mediaId: "12345678-1234-1234-1234-123456789abc.mp4",
    mediaUrl: "https://crm.example.com/uploads/campaigns/12345678-1234-1234-1234-123456789abc.mp4",
    mediaSizeBytes: 1,
    mediaWidth: 1,
    mediaHeight: 1,
  }, [channels[0]], {
    env: {},
    readMedia: async () => ({ bytes, mimeType: "video/mp4" }),
    inspectVideo: async () => validInstagramVideo,
  });
  assert.equal(validated.mediaSizeBytes, 1000);
  assert.equal(validated.mediaWidth, 1080);
  assert.equal(validated.mediaHeight, 1920);
  await assert.rejects(() => validateStoredInstagramVideo({
    postType: "REEL",
    mediaType: "video",
    mediaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4",
    mediaUrl: "https://crm.example.com/uploads/campaigns/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4",
  }, [channels[0]], { readMedia: async () => assert.fail("mismatched media must not be read") }), /does not match/i);
});

test("campaign media upload validates MIME, extension, signature, size, and reloads the stored bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crm360-media-"));
  const env = {
    NODE_ENV: "production",
    CAMPAIGN_MEDIA_DIRECTORY: directory,
    PUBLIC_BASE_URL: "https://crm.example.com",
    CAMPAIGN_MEDIA_MAX_BYTES: "1048576",
  };
  try {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const file = new File([png], "campaign.png", { type: "image/png" });
    const stored = await storeCampaignMedia(file, { requestUrl: "https://internal.example/upload", env });
    assert.equal(stored.mediaType, "image");
    assert.match(stored.mediaUrl, /^https:\/\/crm\.example\.com\/uploads\/campaigns\/[0-9a-f-]+\.png$/);
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
      {
        requestUrl: "https://internal.example/upload",
        env,
        postType: "REEL",
        targetServices: ["instagram"],
        inspectVideo: async () => validInstagramVideo,
      },
    );
    assert.equal(video.mediaType, "video");
    assert.match(video.mediaUrl, /^https:\/\/crm\.example\.com\/uploads\/campaigns\/[0-9a-f-]+\.mp4$/);
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

test("Express accepts authenticated multipart image/video uploads and serves them publicly", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crm360-express-media-"));
  const env = {
    NODE_ENV: "production",
    SERVICE_AUTH_TOKEN: "upload-service-token",
    CAMPAIGN_MEDIA_DIRECTORY: directory,
    PUBLIC_BASE_URL: "https://crm.example.com",
    CAMPAIGN_MEDIA_MAX_BYTES: "1048576",
  };
  const expressApp = express();
  registerCampaignMediaExpressRoutes(expressApp, {
    env,
    logger: { error() {} },
    storeMedia: (payload, options) => storeCampaignMediaBuffer(payload, {
      ...options,
      inspectVideo: async () => validInstagramVideo,
    }),
  });
  const server = expressApp.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const mp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom"),
    Buffer.from("campaign-video"),
  ]);
  const upload = async (file, postType) => {
    const form = new FormData();
    form.append("media", file);
    form.append("postType", postType);
    form.append("targetServices", "instagram");
    const response = await fetch(`${origin}/api/media`, {
      method: "POST",
      headers: { authorization: "Bearer upload-service-token" },
      body: form,
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.storedFileName, body.media.mediaId);
    assert.equal(body.originalFileName, body.media.mediaOriginalName);
    assert.equal(body.mimeType, body.media.mediaMimeType);
    assert.equal(body.size, body.media.mediaSizeBytes);
    assert.equal(body.mediaUrl, body.media.mediaUrl);
    return body.media;
  };

  try {
    const unauthorized = new FormData();
    unauthorized.append("media", new File([png], "blocked.png", { type: "image/png" }));
    assert.equal((await fetch(`${origin}/api/media`, { method: "POST", body: unauthorized })).status, 401);

    const wrongRoute = new FormData();
    wrongRoute.append("media", new File([png], "wrong-route.png", { type: "image/png" }));
    const wrongRouteResponse = await fetch(`${origin}/uploads/campaigns`, {
      method: "POST",
      headers: { authorization: "Bearer upload-service-token" },
      body: wrongRoute,
    });
    assert.ok(wrongRouteResponse.status === 404 || wrongRouteResponse.status === 405);

    const image = await upload(new File([png], "campaign.png", { type: "image/png" }), "STORY");
    assert.equal(image.storedFileName, image.mediaId);
    assert.equal(image.originalFileName, "campaign.png");
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.size, png.length);
    assert.match(image.mediaUrl, /^https:\/\/crm\.example\.com\/uploads\/campaigns\/.+\.png$/);
    const imageResponse = await fetch(`${origin}/uploads/campaigns/${image.mediaId}`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);

    const video = await upload(new File([mp4], "campaign.mp4", { type: "video/mp4" }), "REEL");
    const videoHead = await fetch(`${origin}/uploads/campaigns/${video.mediaId}`, { method: "HEAD" });
    assert.equal(videoHead.status, 200);
    assert.equal(videoHead.headers.get("content-type"), "video/mp4");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("public media verification falls back from HEAD to GET and rejects HTML", async () => {
  const input = {
    mediaType: "image",
    mediaUrl: "https://crm.example.com/uploads/campaigns/example.png",
  };
  const methods = [];
  await verifyPublicMediaUrl(input, {
    fetchImpl: async (_url, init) => {
      methods.push(init.method);
      return init.method === "HEAD"
        ? new Response(null, { status: 405, headers: { "content-type": "text/plain" } })
        : new Response(Buffer.from([0x89]), { status: 206, headers: { "content-type": "image/png" } });
    },
  });
  assert.deepEqual(methods, ["HEAD", "GET"]);

  await assert.rejects(() => verifyPublicMediaUrl(input, {
    fetchImpl: async () => new Response("login", { status: 200, headers: { "content-type": "text/html" } }),
  }), /instead of image media/i);
});

test("unreachable media leaves the SQL campaign saved and prevents every Buffer call", async () => {
  const repository = new InMemorySocialRepository();
  let bufferCalls = 0;
  const service = new BufferCampaignService({
    repository,
    bufferAdapter: {
      configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
      getChannels: async () => channels.slice(0, 1),
      schedulePost: async () => { bufferCalls += 1; },
    },
    fetchImpl: async () => new Response("login", { status: 200, headers: { "content-type": "text/html" } }),
    env: {
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://crm.example.com",
      CAMPAIGN_MEDIA_PUBLIC_PATH: "/uploads/campaigns",
    },
    logger: { error() {} },
  });
  const result = await service.scheduleCampaign({
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    postType: "STORY",
    mediaId: "12345678-1234-1234-1234-123456789abc.png",
    mediaType: "image",
    mediaUrl: "https://crm.example.com/uploads/campaigns/12345678-1234-1234-1234-123456789abc.png",
    mediaOriginalName: "campaign.png",
    mediaMimeType: "image/png",
    mediaSizeBytes: 100,
  });
  assert.equal(result.statusCode, 424);
  assert.equal(bufferCalls, 0);
  assert.equal((await repository.getContent()).campaigns.length, 1);
  assert.equal(result.posts[0].postStatus, "FAILED");
});

test("a failed SQL save removes only the newly uploaded unreferenced media", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crm360-orphan-media-"));
  const env = {
    NODE_ENV: "production",
    CAMPAIGN_MEDIA_DIRECTORY: directory,
    PUBLIC_BASE_URL: "https://crm.example.com",
  };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  try {
    const media = await storeCampaignMedia(new File([png], "orphan.png", { type: "image/png" }), {
      requestUrl: "https://crm.example.com/api/media",
      env,
    });
    const repository = new InMemorySocialRepository();
    repository.saveCampaign = async () => { throw new Error("MSSQL campaign write failed"); };
    const service = new BufferCampaignService({
      repository,
      bufferAdapter: {
        configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
        getChannels: async () => channels.slice(0, 1),
        schedulePost: async () => assert.fail("Buffer must not run after failed SQL persistence"),
      },
      env,
      logger: { error() {} },
    });
    await assert.rejects(() => service.scheduleCampaign({
      ...campaignInput,
      targetSocialChannels: ["channel-instagram"],
      postType: "STORY",
      ...media,
    }), /MSSQL campaign write failed/);
    await assert.rejects(() => readCampaignMedia(media.mediaId, env), /not found/i);
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
  const service = new BufferCampaignService({
    repository,
    bufferAdapter: adapter,
    logger: { error() {} },
    validateMedia: async (input) => ({ ...input, ...validInstagramVideo }),
  });
  const result = await service.scheduleCampaign(campaignInput);
  assert.equal(result.statusCode, 201);
  assert.equal(result.campaign.status, "production");
  assert.equal(result.posts.length, 2);
  assert.ok(result.posts.every((post) => post.postStatus === "SCHEDULED"));
  assert.deepEqual(result.campaign.targetSocialChannels.map((channel) => channel.id), channels.map((channel) => channel.id));
});

test("Buffer receives the exact canonical MediaUrl returned from MSSQL", async () => {
  const repository = new InMemorySocialRepository();
  const canonicalUrl = "https://crm.example.com/uploads/campaigns/12345678-1234-1234-1234-123456789abc.png";
  let deliveredUrl = null;
  const service = new BufferCampaignService({
    repository,
    bufferAdapter: {
      configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
      getChannels: async () => channels.slice(0, 1),
      schedulePost: async ({ mediaUrl, channelId, dueAt }) => {
        const saved = (await repository.getContent()).campaigns[0];
        assert.equal(saved.mediaUrl, canonicalUrl);
        deliveredUrl = mediaUrl;
        return {
          id: "buffer-post-canonical", channelId, channelService: "instagram", dueAt,
          sentAt: null, status: "scheduled", externalLink: null, error: null,
        };
      },
    },
    env: {
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://crm.example.com",
      CAMPAIGN_MEDIA_PUBLIC_PATH: "/uploads/campaigns",
    },
    fetchImpl: async () => new Response(null, { status: 200, headers: { "content-type": "image/png" } }),
    logger: { error() {} },
  });
  const result = await service.scheduleCampaign({
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    postType: "STORY",
    mediaId: "12345678-1234-1234-1234-123456789abc.png",
    mediaType: "image",
    mediaUrl: canonicalUrl,
    mediaOriginalName: "campaign.png",
    mediaMimeType: "image/png",
    mediaSizeBytes: 100,
  });
  assert.equal(result.statusCode, 201);
  assert.equal(deliveredUrl, result.campaign.mediaUrl);
  assert.equal(deliveredUrl, canonicalUrl);
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

test("complete Buffer failure returns 424 with the saved SQL campaign for safe retry", async () => {
  const repository = new InMemorySocialRepository();
  const adapter = {
    configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
    getChannels: async () => channels.slice(0, 1),
    schedulePost: async () => { throw new Error("Buffer rejected the scheduled post"); },
  };
  const service = new BufferCampaignService({ repository, bufferAdapter: adapter, logger: { error() {} } });
  const result = await service.scheduleCampaign({ ...campaignInput, targetSocialChannels: ["channel-instagram"] });
  assert.equal(result.statusCode, 424);
  assert.equal(result.campaign.status, "draft");
  assert.equal(result.posts[0].postStatus, "FAILED");
  assert.equal((await repository.getContent()).campaigns.length, 1);
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
  const service = new BufferCampaignService({
    repository,
    bufferAdapter: adapter,
    logger: { error() {} },
    validateMedia: async (input) => input,
    verifyMediaUrl: async (input) => input,
  });
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
    mediaId: "12345678-1234-1234-1234-123456789abc.png",
    mediaType: "image",
    mediaUrl: "http://127.0.0.1:3000/uploads/campaigns/12345678-1234-1234-1234-123456789abc.png",
    mediaOriginalName: "local.png",
    mediaMimeType: "image/png",
    mediaSizeBytes: 100,
  });
  assert.equal(result.campaign.status, "draft");
  assert.equal(result.campaign.mediaUrl, "http://127.0.0.1:3000/uploads/campaigns/12345678-1234-1234-1234-123456789abc.png");
  assert.equal(result.posts[0].postStatus, "DRAFT");
  assert.equal(result.posts[0].bufferPostId, null);
  assert.equal((await service.getCampaigns())[0].mediaUrl, result.campaign.mediaUrl);

  const edited = await service.updateCampaign(result.campaign.id, {
    ...campaignInput,
    campaignName: "Founder webinar draft edit",
    targetSocialChannels: ["channel-instagram"],
    campaignStatus: "DRAFT",
    postType: "STORY",
    mediaId: result.campaign.mediaId,
    mediaType: result.campaign.mediaType,
    mediaUrl: result.campaign.mediaUrl,
    mediaOriginalName: result.campaign.mediaOriginalName,
    mediaMimeType: result.campaign.mediaMimeType,
    mediaSizeBytes: result.campaign.mediaSizeBytes,
  });
  assert.equal(edited.campaign.mediaUrl, result.campaign.mediaUrl);
  assert.equal(edited.campaign.mediaId, result.campaign.mediaId);
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

test("campaign API returns non-2xx and never calls Buffer when MSSQL persistence fails", async () => {
  const repository = new InMemorySocialRepository();
  repository.saveCampaign = async () => { throw new Error("MSSQL campaign write failed"); };
  const bufferAdapter = {
    configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
    getChannels: async () => channels.slice(0, 1),
    schedulePost: async () => assert.fail("Buffer must not run after a failed MSSQL write"),
  };
  const app = await createSocialListenerApp({
    env: { SERVICE_AUTH_TOKEN: "service-token" },
    repository,
    adapters: {},
    bufferAdapter,
    logger: { info() {}, error() {}, log() {} },
  });
  const response = await app.handle(new Request("http://listener.test/buffer/campaigns", {
    method: "POST",
    headers: { authorization: "Bearer service-token", "content-type": "application/json" },
    body: JSON.stringify({ ...campaignInput, targetSocialChannels: ["channel-instagram"] }),
  }));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /MSSQL campaign write failed/i);
});
