import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LANDING_PAGE_SUBMIT_TEXT,
  normalizeExternalVideoUrl,
  normalizeLandingPageCta,
  normalizeLandingPageMedia,
  normalizeLandingPagePicture,
  normalizeLandingPageVideo,
  normalizeOptionalCta,
  resolvePersistedLandingPageMedia,
  resolvePersistedLandingPageVideo,
} from "../lib/landing-page-video.mjs";
import { normalizePostUrl } from "../lib/post-url.mjs";
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
  assert.deepEqual(normalizeLandingPageCta(false, "Book later", "https://example.com/later"), {
    preVideoCtaEnabled: false,
    preVideoCtaText: "Book later",
    preVideoCtaUrl: "https://example.com/later",
  });
  assert.throws(() => normalizeLandingPageCta(true, "Book now", ""), /only after providing both/i);
  assert.throws(() => normalizeOptionalCta("Book now", ""), /both be provided/i);
  assert.throws(() => normalizeOptionalCta("Book now", "javascript:alert(1)"), /HTTP or HTTPS/i);
  assert.equal(LANDING_PAGE_SUBMIT_TEXT, "Register Now for an Interview");
});

test("picture-only and ordered mixed media normalize with Cloudinary identity", () => {
  const picture = {
    pictureUrl: "https://res.cloudinary.com/crm-cloud/image/upload/v1/landing/teaser.webp",
    pictureCloudinaryAssetId: "picture-asset",
    pictureCloudinaryPublicId: "landing/teaser",
    pictureCloudinaryResourceType: "image",
  };
  assert.deepEqual(normalizeLandingPagePicture(picture), picture);
  assert.throws(() => normalizeLandingPagePicture({
    ...picture,
    pictureUrl: "https://example.com/teaser.webp",
  }), /Cloudinary URL/i);

  const pictureOnly = normalizeLandingPageMedia({ mediaMode: "PICTURE_ONLY", mediaOrder: "PICTURE_FIRST", ...picture });
  assert.equal(pictureOnly.mediaMode, "PICTURE_ONLY");
  assert.equal(pictureOnly.mediaOrder, "PICTURE_FIRST");
  assert.equal(pictureOnly.videoSourceType, "NONE");
  assert.equal(pictureOnly.pictureCloudinaryAssetId, "picture-asset");

  const both = normalizeLandingPageMedia({
    mediaMode: "VIDEO_AND_PICTURE",
    mediaOrder: "PICTURE_FIRST",
    videoSourceType: "EXTERNAL_URL",
    videoUrl: "https://vimeo.com/123456789",
    ...picture,
  });
  assert.equal(both.mediaMode, "VIDEO_AND_PICTURE");
  assert.equal(both.mediaOrder, "PICTURE_FIRST");
  assert.equal(both.videoProvider, "VIMEO");
  assert.equal(normalizeLandingPageMedia({
    ...both,
    mediaOrder: "VIDEO_FIRST",
  }).mediaOrder, "VIDEO_FIRST");
  assert.throws(() => normalizeLandingPageMedia({ mediaMode: "PICTURE_ONLY" }), /Teaser picture must include/i);
});

test("persisted legacy and incomplete video records resolve safely for public playback", () => {
  const legacyYouTube = resolvePersistedLandingPageVideo({
    videoSourceType: "EXTERNAL_URL",
    videoProvider: "YOUTUBE",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  assert.equal(legacyYouTube.videoSourceType, "EXTERNAL_URL");
  assert.equal(legacyYouTube.videoProvider, "YOUTUBE");
  assert.match(legacyYouTube.videoUrl, /^https:\/\/www\.youtube\.com\/embed\//);

  const incompleteCloudinary = resolvePersistedLandingPageVideo({
    videoSourceType: "NONE",
    videoUrl: "https://res.cloudinary.com/demo/video/upload/v1/landing/video.mp4",
  });
  assert.equal(incompleteCloudinary.videoSourceType, "UPLOAD");
  assert.equal(incompleteCloudinary.videoProvider, "CLOUDINARY");
  assert.equal(incompleteCloudinary.cloudinaryResourceType, "video");

  const unsafe = resolvePersistedLandingPageVideo({
    videoSourceType: "EXTERNAL_URL",
    videoUrl: "javascript:alert(1)",
  });
  assert.equal(unsafe.videoSourceType, "NONE");
  assert.equal(unsafe.videoUrl, null);

  const legacyMedia = resolvePersistedLandingPageMedia({
    videoSourceType: "EXTERNAL_URL",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  assert.equal(legacyMedia.mediaMode, "VIDEO_ONLY");
  assert.equal(legacyMedia.mediaOrder, "VIDEO_FIRST");
});

test("Post URL Link accepts only HTTP(S) destinations", () => {
  assert.equal(normalizePostUrl("  https://example.com/thank-you?source=crm  "), "https://example.com/thank-you?source=crm");
  assert.equal(normalizePostUrl(""), null);
  for (const unsafe of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/secret"]) {
    assert.throws(() => normalizePostUrl(unsafe), /Post URL Link must be a valid HTTP or HTTPS URL/i);
  }
});

test("content API persists normalized landing-page fields and rejects unsupported Canva links", async () => {
  const { app } = await appWithMemory();
  const response = await app.handle(request("/content", {
    entity: "landing_page", title: "Interview", slug: "interview", headline: "Grow with us",
    videoSourceType: "EXTERNAL_URL", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    preVideoCtaText: "Talk to us", preVideoCtaUrl: "https://example.com/talk",
    webinarUrl: "https://example.com/thank-you",
  }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.record.videoProvider, "YOUTUBE");
  assert.equal(body.record.mediaMode, "VIDEO_ONLY");
  assert.match(body.record.videoUrl, /^https:\/\/www\.youtube\.com\/embed\//);
  assert.equal(body.record.submitButtonText, LANDING_PAGE_SUBMIT_TEXT);
  assert.equal(body.record.webinarUrl, "https://example.com/thank-you");
  assert.equal(body.record.preVideoCtaEnabled, true);

  const reloadedResponse = await app.handle(new Request("http://listener.test/content", {
    headers: { authorization: "Bearer service-token" },
  }));
  const reloaded = await reloadedResponse.json();
  assert.equal(reloaded.pages.find((page) => page.id === body.record.id).webinarUrl, "https://example.com/thank-you");

  const unsafePostUrl = await app.handle(request("/content", {
    entity: "landing_page", title: "Unsafe redirect", slug: "unsafe-redirect", headline: "Unsafe",
    webinarUrl: "javascript:alert(1)",
  }));
  assert.equal(unsafePostUrl.status, 400);
  assert.match((await unsafePostUrl.json()).error, /Post URL Link must be a valid HTTP or HTTPS URL/i);

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
  assert.equal(updated.mediaMode, "VIDEO_ONLY");
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
  assert.equal(removed.mediaMode, "NONE");
  assert.equal(removed.videoUrl, null);
  assert.equal(removed.preVideoCtaEnabled, false);
  assert.equal(removed.preVideoCtaText, null);
  assert.equal(removed.preVideoCtaUrl, null);
});

test("content API persists picture media, mixed ordering, and explicit CTA visibility", async () => {
  const { app } = await appWithMemory();
  const picture = {
    pictureUrl: "https://res.cloudinary.com/crm-cloud/image/upload/v1/landing/picture.png",
    pictureCloudinaryAssetId: "picture-asset",
    pictureCloudinaryPublicId: "landing/picture",
    pictureCloudinaryResourceType: "image",
  };
  const createdResponse = await app.handle(request("/content", {
    entity: "landing_page",
    title: "Picture page",
    slug: "picture-page",
    headline: "Picture first",
    mediaMode: "PICTURE_ONLY",
    mediaOrder: "PICTURE_FIRST",
    ...picture,
    preVideoCtaEnabled: false,
    preVideoCtaText: "Saved but hidden",
    preVideoCtaUrl: "https://example.com/hidden",
  }));
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).record;
  assert.equal(created.mediaMode, "PICTURE_ONLY");
  assert.equal(created.pictureCloudinaryAssetId, "picture-asset");
  assert.equal(created.preVideoCtaEnabled, false);
  assert.equal(created.preVideoCtaText, "Saved but hidden");

  const mixedResponse = await app.handle(request("/content", {
    entity: "landing_page",
    id: created.id,
    title: created.title,
    slug: created.slug,
    headline: created.headline,
    mediaMode: "VIDEO_AND_PICTURE",
    mediaOrder: "PICTURE_FIRST",
    videoSourceType: "EXTERNAL_URL",
    videoUrl: "https://youtu.be/dQw4w9WgXcQ",
    preVideoCtaEnabled: true,
  }, "PUT"));
  assert.equal(mixedResponse.status, 200);
  const mixed = (await mixedResponse.json()).record;
  assert.equal(mixed.mediaMode, "VIDEO_AND_PICTURE");
  assert.equal(mixed.mediaOrder, "PICTURE_FIRST");
  assert.equal(mixed.pictureUrl, picture.pictureUrl);
  assert.equal(mixed.videoProvider, "YOUTUBE");
  assert.equal(mixed.preVideoCtaEnabled, true);

  const partialResponse = await app.handle(request("/content", {
    entity: "landing_page",
    id: created.id,
    title: created.title,
    slug: created.slug,
    headline: "Updated but preserved",
  }, "PUT"));
  assert.equal(partialResponse.status, 200);
  const partial = (await partialResponse.json()).record;
  assert.equal(partial.mediaMode, "VIDEO_AND_PICTURE");
  assert.equal(partial.mediaOrder, "PICTURE_FIRST");
  assert.equal(partial.pictureCloudinaryAssetId, "picture-asset");
  assert.equal(partial.preVideoCtaEnabled, true);
});

test("registration handles enrich one Lead and normalized social identities without duplicates", async () => {
  const { app, repository } = await appWithMemory();
  const scoredPage = await repository.saveLandingPage({
    campaignId: "campaign:1", title: "Scored page", slug: "scored-page",
    headline: "Register", status: "published",
  });
  assert.equal(scoredPage.id, "page:1");
  const first = await app.handle(request("/routine-leads", {
    routine: "landing_page_registration", externalEventId: "registration-1", name: "Avery",
    email: "avery@example.com", instagram: "@avery.grows", facebook: " avery.fb ", x: "@avery_x",
    campaignId: "campaign:1", landingPageId: "page:1", sourceDetail: "landing_page:page:1",
  }));
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  const firstLeadId = firstBody.leadId;
  assert.equal(firstBody.score, 44);
  assert.equal(firstBody.scoreBand, "WARM");
  assert.equal(firstBody.interactionInserted, true);
  assert.equal(repository.interactions.size, 1);

  const retry = await app.handle(request("/routine-leads", {
    routine: "landing_page_registration", externalEventId: "registration-1", name: "Avery",
    email: "avery@example.com", instagram: "@avery.grows", facebook: " avery.fb ", x: "@avery_x",
    campaignId: "campaign:1", landingPageId: "page:1", sourceDetail: "landing_page:page:1",
  }));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).interactionInserted, false);
  assert.equal(repository.interactions.size, 1);

  const second = await app.handle(request("/routine-leads", {
    routine: "landing_page_registration", externalEventId: "registration-2", name: "Avery",
    email: "avery+second@example.com", instagram: "avery.grows",
    campaignId: "campaign:1", landingPageId: "page:1", sourceDetail: "landing_page:page:1",
  }));
  assert.equal(second.status, 201);
  assert.equal((await second.json()).leadId, firstLeadId);
  assert.equal(repository.leads.size, 1);
  assert.equal(repository.socialAccounts.size, 3);
  assert.equal(repository.interactions.size, 2);
  assert.equal(repository.routineEvents.size, 2);
  assert.equal(repository.pages.get("page:1").registrations, 2);
  assert.ok([...repository.routineEvents.keys()].every((key) => key.startsWith("landing_page_registration:")));
  assert.ok([...repository.events.values()].every((event) =>
    event.campaignId === "campaign:1" && event.rawPayload.landingPageId === "page:1"));
  const savedLead = [...repository.leads.values()][0];
  assert.equal(savedLead.intentScore, 16);
  assert.equal(savedLead.engagementScore, 6);
  assert.equal(savedLead.fitScore, 3);
  assert.equal(savedLead.recencyScore, 15);
  assert.equal(savedLead.sourceScore, 15);
  assert.equal(savedLead.lastInteractionType, "LEAD_FORM_SUBMISSION");
  assert.ok(savedLead.lastScoredAt);
  assert.ok([...repository.socialAccounts.values()].every((account) => account.leadId === `social:${firstLeadId}`));
});

test("Cloudinary cleanup protects both campaign and landing-page references", async () => {
  const repository = new InMemorySocialRepository();
  await repository.saveLandingPage({
    title: "Video page", slug: "video-page", headline: "Video", status: "published",
    videoSourceType: "UPLOAD", videoUrl: "https://res.cloudinary.com/demo/video/upload/video.mp4",
    cloudinaryAssetId: "asset-landing", cloudinaryPublicId: "landing/video", cloudinaryResourceType: "video",
    pictureUrl: "https://res.cloudinary.com/demo/image/upload/picture.png",
    pictureCloudinaryAssetId: "asset-picture", pictureCloudinaryPublicId: "landing/picture",
    pictureCloudinaryResourceType: "image",
  });
  let deletions = 0;
  const service = new BufferCampaignService({
    repository,
    bufferAdapter: {},
    logger: silentLogger,
    deleteMedia: async () => { deletions += 1; return true; },
  });
  assert.deepEqual(await service.deleteMediaIfUnreferenced({ assetId: "asset-landing" }), { deleted: false, referenced: true });
  assert.deepEqual(await service.deleteMediaIfUnreferenced({ assetId: "asset-picture" }), { deleted: false, referenced: true });
  assert.equal(deletions, 0);
  assert.deepEqual(await service.deleteMediaIfUnreferenced({ assetId: "orphan" }), { deleted: true, referenced: false });
  assert.equal(deletions, 1);
});

test("builder, public renderer, registration route, and MSSQL migrations expose the complete feature", async () => {
  const [builder, landing, renderer, player, registration, registerRoute, migration, scoringMigration, repairMigration, mediaMigration, studioMigration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/landing/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LandingPageBlocks.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LandingVideoPlayer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/landing/[slug]/RegisterForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../sql/017_landing_page_video_cta_social_handles.sql", import.meta.url), "utf8"),
    readFile(new URL("../sql/018_landing_registration_scoring.sql", import.meta.url), "utf8"),
    readFile(new URL("../sql/019_repair_landing_registration_video.sql", import.meta.url), "utf8"),
    readFile(new URL("../sql/020_landing_page_picture_media_order_cta.sql", import.meta.url), "utf8"),
    readFile(new URL("../sql/021_landing_page_studio.sql", import.meta.url), "utf8"),
  ]);
  assert.match(builder, /onDrop=\{onVideoDrop\}/);
  assert.match(builder, /Cloudinary landing-page media upload in progress/);
  assert.match(builder, /purpose", "landing_page_video/);
  assert.match(builder, /purpose", "landing_page_picture/);
  assert.match(builder, /VIDEO_AND_PICTURE/);
  assert.match(builder, /PICTURE_FIRST/);
  assert.match(builder, /Remove video/);
  assert.match(builder, /Remove picture/);
  assert.match(builder, /fetch\("\/api\/social\/content", \{ cache: "no-store" \}\)/);
  assert.match(builder, /externalVideoPreview/);
  assert.match(builder, /onPlaybackError/);
  assert.match(landing, /LandingPageBlocks/);
  assert.match(landing, /resolveLandingPageBlocks/);
  assert.match(landing, /page\.status === "published"/);
  assert.match(renderer, /block\.type === "CTA_BUTTON"/);
  assert.match(renderer, /block\.type === "IMAGE"/);
  assert.match(renderer, /block\.type === "VIDEO"/);
  assert.match(renderer, /block\.type === "REGISTRATION_FORM"/);
  assert.match(renderer, /LandingVideoPlayer/);
  assert.match(renderer, /<Image/);
  assert.match(player, /autoPlay=\{autoplay\}/);
  assert.match(player, /playsInline/);
  assert.match(player, /landing-video-fallback/);
  for (const handle of ["instagram", "facebook", "x"]) {
    assert.match(registration, new RegExp(`name="${handle}"`));
    assert.match(registerRoute, new RegExp(`clean\\(body\\.${handle}\\)`));
  }
  assert.match(builder, /label="Post URL Link"/);
  assert.match(builder, /After a successful registration, send the visitor/);
  assert.match(registerRoute, /proxySocialRequest\("\/content"/);
  assert.ok(registerRoute.indexOf('proxySocialRequest("/content"') < registerRoute.indexOf('proxySocialRequest("/routine-leads"'));
  assert.match(registerRoute, /registrationBlock\?\.config\?\.postSubmitUrl \|\| page\.webinarUrl/);
  assert.match(registerRoute, /redirectUrl/);
  assert.match(registration, /window\.location\.assign\(result\.redirectUrl\)/);
  assert.match(registration, /registrationId/);
  assert.doesNotMatch(registration, /<video/);
  for (const column of ["VideoSourceType", "VideoUrl", "VideoProvider", "CloudinaryPublicId", "VideoAutoplay", "VideoMuted", "VideoShowControls", "PreVideoCtaText", "PreVideoCtaUrl", "SubmitButtonText"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(migration, /INSERT dbo\.SocialAccounts/);
  assert.match(migration, /Register Now for an Interview/);
  assert.match(scoringMigration, /CREATE OR ALTER PROCEDURE dbo\.LeadScore_Recalculate/);
  assert.equal((scoringMigration.match(/LEAD_FORM_SUBMISSION/g) || []).length, 4);
  assert.match(scoringMigration, /@LeadScore = @IntentScore \+ @EngagementScore \+ @FitScore \+ @RecencyScore \+ @SourceScore/);
  assert.match(repairMigration, /LegacyVideoMigratedAt/);
  assert.match(repairMigration, /VideoSourceType = N'EXTERNAL_URL'/);
  assert.match(repairMigration, /INSERT dbo\.SocialInteractions/);
  assert.match(repairMigration, /N'LEAD_FORM_SUBMISSION'/);
  assert.match(repairMigration, /EXEC dbo\.LeadScore_Recalculate/);
  for (const column of ["MediaMode", "MediaOrder", "PictureUrl", "PictureCloudinaryAssetId", "PictureCloudinaryPublicId", "PictureCloudinaryResourceType", "PreVideoCtaEnabled"]) {
    assert.match(mediaMigration, new RegExp(column));
  }
  assert.match(mediaMigration, /VIDEO_AND_PICTURE/);
  assert.match(mediaMigration, /PICTURE_FIRST/);
  assert.doesNotMatch(mediaMigration, /LeadScoringRules|LeadTemperatureThresholds|LeadScore_Recalculate/);
  assert.match(studioMigration, /LandingPageBlocks/);
  assert.match(studioMigration, /LandingPageViews/);
  assert.match(studioMigration, /LandingPageAnalytics_GetAll/);
  assert.doesNotMatch(studioMigration, /LeadScoringRules|LeadTemperatureThresholds|LeadScore_Recalculate/);
});

test("Next2TheTop CRM branding is used on login, dashboard, public pages, and metadata", async () => {
  const [dashboard, login, landing, layout, logo, mark] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/landing/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/next2thetop-crm-logo.svg", import.meta.url), "utf8"),
    readFile(new URL("../public/next2thetop-crm-mark.svg", import.meta.url), "utf8"),
  ]);
  for (const source of [dashboard, login, landing]) assert.match(source, /BrandLogo/);
  assert.match(layout, /title:"Next2TheTop CRM"/);
  assert.match(layout, /applicationName:"Next2TheTop CRM"/);
  assert.match(logo, /Next2TheTop/);
  assert.match(mark, /<title id="title">Next2TheTop CRM<\/title>/);
  assert.doesNotMatch(`${dashboard}\n${login}\n${landing}\n${layout}`, /Alianza(?:CRM| Growth| CRM)/i);
});
