import assert from "node:assert/strict";
import { File } from "node:buffer";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Writable } from "node:stream";
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
  storeCampaignMediaBuffer,
  storeCampaignMedia,
  validateCampaignMedia,
} from "../lib/campaign-media.mjs";
import {
  deleteCampaignMediaFromCloudinary,
  uploadCampaignMediaToCloudinary,
} from "../lib/cloudinary-campaign-media.mjs";
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

const cloudinaryEnvironment = {
  CLOUDINARY_CLOUD_NAME: "crm-cloud",
  CLOUDINARY_API_KEY: "cloudinary-key",
  CLOUDINARY_API_SECRET: "cloudinary-secret",
  CLOUDINARY_CAMPAIGN_FOLDER: "crm-marketing/campaigns",
  CAMPAIGN_MEDIA_MAX_BYTES: "314572800",
};

function cloudinaryMedia(overrides = {}) {
  const resourceType = overrides.resourceType || overrides.mediaType || "image";
  const format = overrides.format || (resourceType === "video" ? "mp4" : "png");
  const assetId = overrides.assetId || `asset-${resourceType}-1`;
  return {
    mediaId: assetId,
    cloudinaryAssetId: assetId,
    cloudinaryPublicId: overrides.publicId || `crm-marketing/campaigns/${resourceType}-1`,
    cloudinaryResourceType: resourceType,
    cloudinaryFormat: format,
    mediaType: resourceType,
    mediaUrl: overrides.mediaUrl || `https://res.cloudinary.com/crm-cloud/${resourceType}/upload/v1/crm-marketing/campaigns/${resourceType}-1.${format}`,
    mediaOriginalName: overrides.mediaOriginalName || `campaign.${format}`,
    mediaMimeType: overrides.mediaMimeType || `${resourceType}/${format === "jpg" ? "jpeg" : format}`,
    mediaSizeBytes: overrides.mediaSizeBytes || 100,
    ...overrides,
  };
}

test("the project has one upload route and no local campaign-media hosting path", async () => {
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
  assert.match(mediaSource, /uploadCampaignMediaToCloudinary/);
  assert.doesNotMatch(serverSource, /express\.static\(mediaDirectory/);
  assert.doesNotMatch(`${pageSource}\n${nextUploadSource}\n${serverSource}\n${mediaSource}`, /CAMPAIGN_MEDIA_DIRECTORY|CAMPAIGN_MEDIA_PUBLIC_PATH|App_Data\/campaign-media/);
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
    ...cloudinaryMedia({ mediaType: "video" }),
  });
  assert.throws(() => validateBufferPostCompatibility(reel, [channels[1]]), /supports POST only/i);
  assert.throws(() => normalizeBufferCampaignInput({ ...campaignInput, postType: "STORY" }), /requires a valid image or video/i);
  const instagramVideoPost = normalizeBufferCampaignInput({
    ...campaignInput,
    postType: "POST",
    ...cloudinaryMedia({ mediaType: "video" }),
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

test("Instagram validation uses metadata persisted with the canonical Cloudinary asset", async () => {
  const validated = await validateStoredInstagramVideo({
    postType: "REEL",
    ...cloudinaryMedia({
      mediaType: "video",
      mediaWidth: validInstagramVideo.width,
      mediaHeight: validInstagramVideo.height,
      mediaDurationSeconds: validInstagramVideo.durationSeconds,
      mediaFrameRate: validInstagramVideo.frameRate,
      mediaVideoCodec: validInstagramVideo.videoCodec,
      mediaAudioCodec: validInstagramVideo.audioCodec,
      mediaAudioSampleRate: validInstagramVideo.audioSampleRate,
      mediaVideoBitrate: validInstagramVideo.videoBitrate,
      mediaAudioBitrate: validInstagramVideo.audioBitrate,
    }),
  }, [channels[0]]);
  assert.equal(validated.mediaSizeBytes, 100);
  assert.equal(validated.mediaWidth, 1080);
  assert.equal(validated.mediaHeight, 1920);
  await assert.rejects(() => validateStoredInstagramVideo({
    postType: "REEL",
    ...cloudinaryMedia({ mediaType: "video", mediaWidth: null, mediaHeight: null }),
  }, [channels[0]]), /validation metadata/i);
  await assert.rejects(() => validateStoredInstagramVideo({
    postType: "REEL",
    ...cloudinaryMedia({
      mediaType: "video",
      mediaId: "different-asset",
      mediaWidth: validInstagramVideo.width,
      mediaHeight: validInstagramVideo.height,
      mediaDurationSeconds: validInstagramVideo.durationSeconds,
      mediaFrameRate: validInstagramVideo.frameRate,
      mediaVideoCodec: validInstagramVideo.videoCodec,
      mediaAudioCodec: validInstagramVideo.audioCodec,
      mediaAudioSampleRate: validInstagramVideo.audioSampleRate,
      mediaVideoBitrate: validInstagramVideo.videoBitrate,
      mediaAudioBitrate: validInstagramVideo.audioBitrate,
    }),
  }, [channels[0]]), /does not match/i);
});

test("campaign media validates exact image/video bytes before Cloudinary upload", async () => {
  const env = { CAMPAIGN_MEDIA_MAX_BYTES: "1048576" };
  const uploadedBytes = [];
  const uploadMedia = async (validated) => {
    uploadedBytes.push(Buffer.from(validated.bytes));
    return {
      assetId: `asset-${validated.mediaType}`,
      publicId: `crm-marketing/campaigns/campaign-${validated.mediaType}`,
      resourceType: validated.mediaType,
      format: validated.mediaType === "video" ? "mp4" : "png",
      size: validated.sizeBytes,
      mediaUrl: `https://res.cloudinary.com/crm-cloud/${validated.mediaType}/upload/campaign`,
    };
  };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const image = await storeCampaignMedia(new File([png], "campaign.png", { type: "image/png" }), {
    env,
    uploadMedia,
  });
  assert.equal(image.mediaId, "asset-image");
  assert.equal(image.publicId, "crm-marketing/campaigns/campaign-image");
  assert.equal(image.resourceType, "image");
  assert.equal(image.mediaUrl, "https://res.cloudinary.com/crm-cloud/image/upload/campaign");
  assert.deepEqual(uploadedBytes[0], png);

  const mp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom"),
    Buffer.from("campaign-video"),
  ]);
  const video = await storeCampaignMedia(new File([mp4], "campaign.mp4", { type: "video/mp4" }), {
    env,
    postType: "REEL",
    targetServices: ["instagram"],
    inspectVideo: async () => validInstagramVideo,
    uploadMedia,
  });
  assert.equal(video.resourceType, "video");
  assert.equal(video.mediaWidth, 1080);
  assert.deepEqual(uploadedBytes[1], mp4);

  assert.throws(() => validateCampaignMedia({
    filename: "fake.png", mimeType: "image/png", size: 4, bytes: Buffer.from("fake"),
  }, env), /contents do not match/i);
  assert.throws(() => validateCampaignMedia({
    filename: "wrong.jpg", mimeType: "image/png", size: png.length, bytes: png,
  }, env), /extension does not match/i);
  assert.throws(() => validateCampaignMedia({
    filename: "campaign.png", mimeType: "image/png", size: png.length, bytes: png,
  }, { ...env, CAMPAIGN_MEDIA_MAX_BYTES: "8" }), /exceeds/i);
});

test("official Cloudinary client receives exact bytes and normalizes secure_url metadata", async () => {
  const bytes = Buffer.from("verified-image-bytes");
  let configured;
  let uploadOptions;
  let received = Buffer.alloc(0);
  const client = {
    config(value) { configured = value; },
    uploader: {
      upload_stream(options, callback) {
        uploadOptions = options;
        return new Writable({
          write(chunk, _encoding, done) {
            received = Buffer.concat([received, chunk]);
            done();
          },
          final(done) {
            callback(null, {
              asset_id: "cloudinary-asset-id",
              public_id: "crm-marketing/campaigns/campaign",
              resource_type: "image",
              format: "png",
              bytes: bytes.length,
              secure_url: "https://res.cloudinary.com/crm-cloud/image/upload/v1/crm-marketing/campaigns/campaign.png",
            });
            done();
          },
        });
      },
    },
  };
  const normalized = await uploadCampaignMediaToCloudinary({
    bytes,
    sizeBytes: bytes.length,
    originalName: "campaign.png",
    mediaType: "image",
  }, { env: cloudinaryEnvironment, client });
  assert.deepEqual(received, bytes);
  assert.equal(configured.api_secret, "cloudinary-secret");
  assert.equal(uploadOptions.resource_type, "auto");
  assert.equal(uploadOptions.folder, "crm-marketing/campaigns");
  assert.equal(normalized.assetId, "cloudinary-asset-id");
  assert.equal(normalized.mediaUrl, "https://res.cloudinary.com/crm-cloud/image/upload/v1/crm-marketing/campaigns/campaign.png");
  assert.doesNotMatch(JSON.stringify(normalized), /cloudinary-secret/);
});

test("Cloudinary cleanup deletes by public_id and resource_type with CDN invalidation", async () => {
  let destroyed;
  const client = {
    config() {},
    uploader: {
      async destroy(publicId, options) {
        destroyed = { publicId, options };
        return { result: "ok" };
      },
    },
  };
  assert.equal(await deleteCampaignMediaFromCloudinary({
    publicId: "crm-marketing/campaigns/video-1",
    resourceType: "video",
  }, { env: cloudinaryEnvironment, client }), true);
  assert.deepEqual(destroyed, {
    publicId: "crm-marketing/campaigns/video-1",
    options: { resource_type: "video", type: "upload", invalidate: true },
  });
});

test("Express accepts authenticated multipart image/video uploads and returns Cloudinary metadata", async () => {
  const env = {
    SERVICE_AUTH_TOKEN: "upload-service-token",
    CAMPAIGN_MEDIA_MAX_BYTES: "1048576",
  };
  let counter = 0;
  const expressApp = express();
  registerCampaignMediaExpressRoutes(expressApp, {
    env,
    logger: { error() {} },
    storeMedia: (payload, options) => storeCampaignMediaBuffer(payload, {
      ...options,
      inspectVideo: async () => validInstagramVideo,
      uploadMedia: async (validated) => {
        counter += 1;
        const format = validated.mediaType === "video" ? "mp4" : "png";
        return {
          assetId: `cloudinary-asset-${counter}`,
          publicId: `crm-marketing/campaigns/campaign-${counter}`,
          resourceType: validated.mediaType,
          format,
          size: validated.sizeBytes,
          mediaUrl: `https://res.cloudinary.com/crm-cloud/${validated.mediaType}/upload/v1/campaign-${counter}.${format}`,
        };
      },
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
    assert.equal(body.assetId, body.media.assetId);
    assert.equal(body.publicId, body.media.publicId);
    assert.equal(body.resourceType, body.media.resourceType);
    assert.equal(body.format, body.media.format);
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
    assert.equal(image.assetId, image.mediaId);
    assert.equal(image.originalFileName, "campaign.png");
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.size, png.length);
    assert.match(image.mediaUrl, /^https:\/\/res\.cloudinary\.com\/crm-cloud\/image\/upload\/.+\.png$/);
    assert.equal((await fetch(`${origin}/uploads/campaigns/${image.mediaId}`)).status, 404);

    const video = await upload(new File([mp4], "campaign.mp4", { type: "video/mp4" }), "REEL");
    assert.equal(video.resourceType, "video");
    assert.match(video.mediaUrl, /^https:\/\/res\.cloudinary\.com\/crm-cloud\/video\/upload\/.+\.mp4$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Cloudinary upload failure returns non-2xx and no false media success", async () => {
  const expressApp = express();
  const error = new Error("Cloudinary rejected the upload");
  error.statusCode = 502;
  registerCampaignMediaExpressRoutes(expressApp, {
    env: { SERVICE_AUTH_TOKEN: "upload-service-token", CAMPAIGN_MEDIA_MAX_BYTES: "1048576" },
    logger: { error() {} },
    storeMedia: async () => { throw error; },
  });
  const server = expressApp.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    const form = new FormData();
    form.append("media", new File([Buffer.from([0x89, 0x50, 0x4e, 0x47])], "campaign.png", { type: "image/png" }));
    const response = await fetch(`http://127.0.0.1:${address.port}/api/media`, {
      method: "POST",
      headers: { authorization: "Bearer upload-service-token" },
      body: form,
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.mediaUrl, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("public media verification falls back from HEAD to GET and rejects HTML", async () => {
  const input = {
    mediaType: "image",
    mediaUrl: "https://res.cloudinary.com/crm-cloud/image/upload/example.png",
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
    logger: { error() {} },
  });
  const result = await service.scheduleCampaign({
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    postType: "STORY",
    ...cloudinaryMedia(),
  });
  assert.equal(result.statusCode, 424);
  assert.equal(bufferCalls, 0);
  assert.equal((await repository.getContent()).campaigns.length, 1);
  assert.equal(result.posts[0].postStatus, "FAILED");
});

test("a failed SQL save removes only the newly uploaded unreferenced Cloudinary asset", async () => {
  const media = cloudinaryMedia();
  const deleted = [];
  const repository = new InMemorySocialRepository();
  repository.saveCampaign = async () => { throw new Error("MSSQL campaign write failed"); };
  const service = new BufferCampaignService({
    repository,
    bufferAdapter: {
      configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
      getChannels: async () => channels.slice(0, 1),
      schedulePost: async () => assert.fail("Buffer must not run after failed SQL persistence"),
    },
    deleteMedia: async (reference) => { deleted.push(reference); return true; },
    logger: { error() {} },
  });
  await assert.rejects(() => service.scheduleCampaign({
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    postType: "STORY",
    ...media,
  }), /MSSQL campaign write failed/);
  assert.deepEqual(deleted, [{
    assetId: media.cloudinaryAssetId,
    publicId: media.cloudinaryPublicId,
    resourceType: media.cloudinaryResourceType,
  }]);
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

test("Buffer receives the exact Cloudinary secure_url returned from MSSQL", async () => {
  const repository = new InMemorySocialRepository();
  const canonicalUrl = "https://res.cloudinary.com/crm-cloud/image/upload/v1730000000/crm-marketing/campaigns/campaign.png";
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
    fetchImpl: async () => new Response(null, { status: 200, headers: { "content-type": "image/png" } }),
    logger: { error() {} },
  });
  const result = await service.scheduleCampaign({
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    postType: "STORY",
    ...cloudinaryMedia({ mediaUrl: canonicalUrl }),
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
    ...cloudinaryMedia({
      mediaType: "video",
      mediaUrl: "https://res.cloudinary.com/crm-cloud/video/upload/v1/crm-marketing/campaigns/reel.mp4",
      mediaOriginalName: "reel.mp4",
      mediaSizeBytes: 5000,
    }),
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
  const service = new BufferCampaignService({
    repository,
    bufferAdapter: adapter,
    deleteMedia: async () => assert.fail("Unchanged Cloudinary media must not be deleted"),
    logger: { error() {} },
  });
  const result = await service.scheduleCampaign({
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    campaignStatus: "DRAFT",
    postType: "STORY",
    ...cloudinaryMedia(),
  });
  assert.equal(result.campaign.status, "draft");
  assert.match(result.campaign.mediaUrl, /^https:\/\/res\.cloudinary\.com\//);
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
    cloudinaryAssetId: result.campaign.cloudinaryAssetId,
    cloudinaryPublicId: result.campaign.cloudinaryPublicId,
    cloudinaryResourceType: result.campaign.cloudinaryResourceType,
    cloudinaryFormat: result.campaign.cloudinaryFormat,
    mediaType: result.campaign.mediaType,
    mediaUrl: result.campaign.mediaUrl,
    mediaOriginalName: result.campaign.mediaOriginalName,
    mediaMimeType: result.campaign.mediaMimeType,
    mediaSizeBytes: result.campaign.mediaSizeBytes,
  });
  assert.equal(edited.campaign.mediaUrl, result.campaign.mediaUrl);
  assert.equal(edited.campaign.mediaId, result.campaign.mediaId);
});

test("draft media replacement persists the new Cloudinary asset before deleting the unreferenced old asset", async () => {
  const repository = new InMemorySocialRepository();
  const deleted = [];
  const adapter = {
    configurationStatus: () => ({ provider: "buffer", configured: true, status: "configured", missing: [] }),
    getChannels: async () => channels.slice(0, 1),
    schedulePost: async () => assert.fail("Buffer must not be called for a SQL draft"),
  };
  const service = new BufferCampaignService({
    repository,
    bufferAdapter: adapter,
    deleteMedia: async (reference) => {
      const saved = (await repository.getContent()).campaigns[0];
      assert.equal(saved.cloudinaryAssetId, "asset-image-replacement");
      deleted.push(reference);
      return true;
    },
    logger: { error() {} },
  });
  const original = cloudinaryMedia();
  const created = await service.scheduleCampaign({
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    campaignStatus: "DRAFT",
    postType: "STORY",
    ...original,
  });
  const replacement = cloudinaryMedia({
    assetId: "asset-image-replacement",
    publicId: "crm-marketing/campaigns/replacement",
    mediaUrl: "https://res.cloudinary.com/crm-cloud/image/upload/v2/crm-marketing/campaigns/replacement.png",
  });
  const updated = await service.updateCampaign(created.campaign.id, {
    ...campaignInput,
    targetSocialChannels: ["channel-instagram"],
    campaignStatus: "DRAFT",
    postType: "STORY",
    ...replacement,
  });
  assert.equal(updated.campaign.mediaUrl, replacement.mediaUrl);
  assert.equal(updated.campaign.cloudinaryPublicId, replacement.cloudinaryPublicId);
  assert.deepEqual(deleted, [{
    assetId: original.cloudinaryAssetId,
    publicId: original.cloudinaryPublicId,
    resourceType: original.cloudinaryResourceType,
  }]);
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
