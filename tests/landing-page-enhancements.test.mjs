import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LANDING_PAGE_SUBMIT_TEXT,
  normalizeExternalVideoUrl,
  normalizeLandingPageVideo,
  normalizeOptionalCta,
} from "../lib/landing-page-video.mjs";
import { BufferCampaignService } from "../social/buffer-campaigns.mjs";
import { InMemorySocialRepository } from "../social/core.mjs";
import { createSocialListenerApp } from "../social/server.mjs";

const silentLogger = { info() {}, error() {}, log() {} };
const serviceEnv = { SERVICE_AUTH_TOKEN: "service-token", META_VERIFY_TOKEN: "verify", META_APP_SECRET: "secret" };

function request(path, body, method = "POST") {
  return new Request(`http://listener.test${path}`, {
    method,
    headers: { authorization: "Bearer service-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function appWithMemory() {
  const repository = new InMemorySocialRepository();
  const adapter = { validateCredentials: async () => ({ status: "connected" }) };
  const app = await createSocialListenerApp({
    env: serviceEnv,
    repository,
    adapters: { instagram: adapter, facebook: adapter, x: adapter },
    logger: silentLogger,
  });
  return { app, repository };
}

test("YouTube, Vimeo, and public Canva links normalize to safe HTTPS players", () => {
  assert.deepEqual(normalizeExternalVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=3"), {
    provider: "YOUTUBE",
    url: "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&playsinline=1&controls=1",
  });
  assert.deepEqual(normalizeExternalVideoUrl("https://vimeo.com/123456789"), {
    provider: "VIMEO",
    url: "https://player.vimeo.com/video/123456789?autoplay=1&muted=1&playsinline=1",
  });
  assert.deepEqual(normalizeExternalVideoUrl("https://www.canva.com/design/DAGabc_123/view?utm_content=test"), {
    provider: "CANVA",
    url: "https://www.canva.com/design/DAGabc_123/view?embed",
  });
  assert.throws(() => normalizeExternalVideoUrl("https://www.canva.com/design/DAGabc_123/edit"), /editor links cannot be embedded/i);
  assert.throws(() => normalizeExternalVideoUrl("<iframe src='https://example.com'>"), /valid HTTP or HTTPS URL/i);
});

test("landing video and CTA validation clears unused metadata and requires complete safe values", () => {
  assert.deepEqual(normalizeLandingPageVideo({ videoSourceType: "NONE" }), {
    videoSourceType: "NONE", videoUrl: null, videoProvider: null, cloudinaryAssetId: null,
    cloudinaryPublicId: null, cloudinaryResourceType: null, videoAutoplay: true, videoMuted: true,
    videoShowControls: true,
  });
  assert.equal(normalizeOptionalCta("Book now", "https://example.com/book").preVideoCtaText, "Book now");
  assert.throws(() => normalizeOptionalCta("Book now", ""), /both be provided/i);
  assert.throws(() => normalizeOptionalCta("Book now", "javascript:alert(1)"), /HTTP or HTTPS/i);
  assert.equal(LANDING_PAGE_SUBMIT_TEXT, "Register Now for an Interview");
});

test("content API persists normalized landing-page fields and rejects unsupported Canva links", async () => {
  const { app } = await appWithMemory();
  const response = await app.handle(request("/content", {
    entity: "landing_page", title: "Interview", slug: "interview", headline: "Grow with us",
    videoSourceType: "EXTERNAL_URL", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    preVideoCtaText: "Talk to us", preVideoCtaUrl: "https://example.com/talk",
  }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.record.videoProvider, "YOUTUBE");
  assert.match(body.record.videoUrl, /^https:\/\/www\.youtube\.com\/embed\//);
  assert.equal(body.record.submitButtonText, LANDING_PAGE_SUBMIT_TEXT);

  const invalid = await app.handle(request("/content", {
    entity: "landing_page", title: "Bad Canva", slug: "bad-canva", headline: "Bad link",
    videoSourceType: "EXTERNAL_URL", videoUrl: "https://www.canva.com/design/DAGabc_123/edit",
  }));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /editor links cannot be embedded/i);
});

test("partial landing-page updates preserve saved video and CTA configuration until explicitly removed", async () => {
  const { app } = await appWithMemory();
  const createdResponse = await app.handle(request("/content", {
    entity: "landing_page", title: "Persistent page", slug: "persistent-page", headline: "Original headline",
    videoSourceType: "EXTERNAL_URL", videoUrl: "https://vimeo.com/123456789",
    preVideoCtaText: "Book a call", preVideoCtaUrl: "https://example.com/book",
    submitButtonText: "Save my seat", status: "published",
  }));
  const created = (await createdResponse.json()).record;

  const updatedResponse = await app.handle(request("/content", {
    entity: "landing_page", id: created.id, title: "Persistent page", slug: "persistent-page",
    headline: "Updated headline", status: "published",
  }, "PUT"));
  assert.equal(updatedResponse.status, 200);
  const updated = (await updatedResponse.json()).record;
  assert.equal(updated.videoSourceType, "EXTERNAL_URL");
  assert.equal(updated.videoProvider, "VIMEO");
  assert.equal(updated.videoUrl, created.videoUrl);
  assert.equal(updated.preVideoCtaText, "Book a call");
  assert.equal(updated.preVideoCtaUrl, "https://example.com/book");
  assert.equal(updated.submitButtonText, "Save my seat");

  const removedResponse = await app.handle(request("/content", {
    entity: "landing_page", id: created.id, title: "Persistent page", slug: "persistent-page",
    headline: "Updated headline", status: "published", videoSourceType: "NONE",
    preVideoCtaText: "", preVideoCtaUrl: "",
  }, "PUT"));
  assert.equal(removedResponse.status, 200);
  const removed = (await removedResponse.json()).record;
  assert.equal(removed.videoSourceType, "NONE");
  assert.equal(removed.videoUrl, null);
  assert.equal(removed.preVideoCtaText, null);
  assert.equal(removed.preVideoCtaUrl, null);
});

test("registration handles enrich one Lead and normalized social identities without duplicates", async () => {
  const { app, repository } = await appWithMemory();
  const first = await app.handle(request("/routine-leads", {
    routine: "landing_page_registration", externalEventId: "registration-1", name: "Avery",
    email: "avery@example.com", instagram: "@avery.grows", facebook: " avery.fb ", x: "@avery_x",
  }));
  assert.equal(first.status, 201);
  const firstLeadId = (await first.json()).leadId;
  const second = await app.handle(request("/routine-leads", {
    routine: "landing_page_registration", externalEventId: "registration-2", name: "Avery",
    email: "avery+second@example.com", instagram: "avery.grows",
  }));
  assert.equal(second.status, 201);
  assert.equal((await second.json()).leadId, firstLeadId);
  assert.equal(repository.leads.size, 1);
  assert.equal(repository.socialAccounts.size, 3);
  assert.ok([...repository.socialAccounts.values()].every((account) => account.leadId === `social:${firstLeadId}`));
});

test("Cloudinary cleanup protects both campaign and landing-page references", async () => {
  const repository = new InMemorySocialRepository();
  await repository.saveLandingPage({
    title: "Video page", slug: "video-page", headline: "Video", status: "published",
    videoSourceType: "UPLOAD", videoUrl: "https://res.cloudinary.com/demo/video/upload/video.mp4",
    cloudinaryAssetId: "asset-landing", cloudinaryPublicId: "landing/video", cloudinaryResourceType: "video",
  });
  let deletions = 0;
  const service = new BufferCampaignService({
    repository,
    bufferAdapter: {},
    logger: silentLogger,
    deleteMedia: async () => { deletions += 1; return true; },
  });
  assert.deepEqual(await service.deleteMediaIfUnreferenced({ assetId: "asset-landing" }), { deleted: false, referenced: true });
  assert.equal(deletions, 0);
  assert.deepEqual(await service.deleteMediaIfUnreferenced({ assetId: "orphan" }), { deleted: true, referenced: false });
  assert.equal(deletions, 1);
});

test("builder, public renderer, registration route, and MSSQL migration expose the complete feature", async () => {
  const [builder, landing, player, registration, registerRoute, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/landing/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LandingVideoPlayer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/landing/[slug]/RegisterForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../sql/017_landing_page_video_cta_social_handles.sql", import.meta.url), "utf8"),
  ]);
  assert.match(builder, /onDrop=\{onVideoDrop\}/);
  assert.match(builder, /Cloudinary video upload in progress/);
  assert.match(builder, /purpose", "landing_page_video/);
  assert.match(builder, /Remove video/);
  assert.match(builder, /fetch\("\/api\/social\/content", \{ cache: "no-store" \}\)/);
  assert.match(builder, /externalVideoPreview/);
  assert.match(builder, /onPlaybackError/);
  const publicLayout = landing.slice(landing.indexOf("<section className=\"landing-hero\">"));
  assert.ok(publicLayout.indexOf("landing-video-cta") < publicLayout.indexOf("<LandingVideoPlayer"));
  assert.ok(publicLayout.indexOf("<LandingVideoPlayer") < publicLayout.indexOf("page.teaser"));
  assert.ok(publicLayout.indexOf("page.teaser") < publicLayout.indexOf("<RegisterForm"));
  assert.match(landing, /autoplay=\{page\.videoAutoplay !== false\}/);
  assert.match(landing, /muted=\{page\.videoMuted !== false\}/);
  assert.match(player, /autoPlay=\{autoplay\}/);
  assert.match(player, /playsInline/);
  for (const handle of ["instagram", "facebook", "x"]) {
    assert.match(registration, new RegExp(`name="${handle}"`));
    assert.match(registerRoute, new RegExp(`${handle}:body\\.${handle}`));
  }
  for (const column of ["VideoSourceType", "VideoUrl", "VideoProvider", "CloudinaryPublicId", "VideoAutoplay", "VideoMuted", "VideoShowControls", "PreVideoCtaText", "PreVideoCtaUrl", "SubmitButtonText"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(migration, /INSERT dbo\.SocialAccounts/);
  assert.match(migration, /Register Now for an Interview/);
});
