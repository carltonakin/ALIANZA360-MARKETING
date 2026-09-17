import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import typescript from "typescript";
import {
  LANDING_PAGE_BLOCK_TYPES,
  defaultLandingPageBlock,
  legacyLandingPageBlocks,
  normalizeLandingPageBlocks,
  projectLegacyLandingPageFields,
  resolveLandingPageBlocks,
} from "../lib/landing-page-studio.mjs";
import { InMemorySocialRepository } from "../social/core.mjs";
import { createSocialListenerApp } from "../social/server.mjs";

const env = { SERVICE_AUTH_TOKEN: "service-token", META_VERIFY_TOKEN: "verify", META_APP_SECRET: "secret" };
const logger = { info() {}, error() {}, log() {} };
const nodeRequire = createRequire(import.meta.url);

async function loadBlockRenderer() {
  const source = await readFile(new URL("../app/components/LandingPageBlocks.tsx", import.meta.url), "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, jsx: typescript.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  runInNewContext(output, {
    exports, URL,
    require(specifier) {
      if (specifier === "./LandingVideoPlayer") return { LandingVideoPlayer: () => null };
      if (specifier === "../landing/[slug]/RegisterForm") return { RegisterForm: () => null };
      if (specifier === "next/image") return () => null;
      return nodeRequire(specifier);
    },
  });
  return exports.LandingPageBlocks;
}

function request(path, body, method = "POST") {
  return new Request(`http://listener.test${path}`, {
    method,
    headers: { authorization: "Bearer service-token", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function fixture() {
  const repository = new InMemorySocialRepository();
  const adapter = { validateCredentials: async () => ({ status: "connected" }) };
  const app = await createSocialListenerApp({
    env,
    repository,
    adapters: { instagram: adapter, facebook: adapter, x: adapter },
    logger,
  });
  return { app, repository };
}

test("studio supports every V1 block and normalizes deterministic order", () => {
  assert.deepEqual(LANDING_PAGE_BLOCK_TYPES, [
    "HERO", "TEXT", "IMAGE", "VIDEO", "CTA_BUTTON", "REGISTRATION_FORM",
    "SOCIAL_HANDLES", "TESTIMONIALS", "FAQ", "COUNTDOWN", "DIVIDER", "PAYMENT_CTA",
  ]);
  const input = [defaultLandingPageBlock("CTA_BUTTON", "cta"), defaultLandingPageBlock("HERO", "hero")];
  input[0].sortOrder = 99;
  const blocks = normalizeLandingPageBlocks(input);
  assert.deepEqual(blocks.map((block) => block.sortOrder), [0, 1]);
  assert.throws(() => normalizeLandingPageBlocks([{ id: "bad", type: "SCRIPT", config: {} }]), /unsupported/i);
  assert.throws(() => normalizeLandingPageBlocks([{ ...defaultLandingPageBlock("CTA_BUTTON"), config: { text: "Unsafe", url: "javascript:alert(1)" } }]), /HTTP or HTTPS/i);
});

test("legacy fields convert to blocks and blocks project back for old clients", () => {
  const blocks = legacyLandingPageBlocks({
    headline: "Legacy headline",
    teaser: "Legacy teaser",
    webinarUrl: "https://example.com/watch",
    preVideoCtaEnabled: true,
    preVideoCtaText: "Book now",
    preVideoCtaUrl: "https://example.com/book",
  });
  assert.deepEqual(blocks.map((block) => block.type), ["HERO", "TEXT", "CTA_BUTTON", "REGISTRATION_FORM"]);
  const legacy = projectLegacyLandingPageFields(blocks);
  assert.equal(legacy.headline, "Legacy headline");
  assert.equal(legacy.teaser, "Legacy teaser");
  assert.equal(legacy.webinarUrl, "https://example.com/watch");
  assert.equal(legacy.preVideoCtaText, "Book now");
});

test("one invalid stored block does not hide a valid published CTA", () => {
  const blocks = resolveLandingPageBlocks({ blocks: [
    { ...defaultLandingPageBlock("IMAGE", "broken-image"), config: { url: "javascript:bad" }, sortOrder: 0 },
    { ...defaultLandingPageBlock("CTA_BUTTON", "cta"), config: { text: "Join", url: "https://example.com/join", alignment: "center" }, sortOrder: 1 },
  ] });
  assert.deepEqual(blocks.map((block) => block.id), ["cta"]);
  assert.equal(blocks[0].config.url, "https://example.com/join");
});

test("an unedited block can be selected and updated after save and reload", async () => {
  const { app } = await fixture();
  const blocks = [defaultLandingPageBlock("HERO", "hero"), defaultLandingPageBlock("CTA_BUTTON", "new-cta")];
  const created = (await (await app.handle(request("/content", {
    entity: "landing_page", title: "Edit later", slug: "edit-later", headline: "Edit later", status: "draft", blocks,
  }))).json()).record;
  const loaded = (await (await app.handle(request("/content", undefined, "GET"))).json()).pages.find((page) => page.id === created.id);
  assert.equal(loaded.blocks.find((block) => block.id === "new-cta").config.text, "Get started");
  const edited = loaded.blocks.map((block) => block.id === "new-cta"
    ? { ...block, config: { ...block.config, text: "Apply now", url: "https://example.com/apply" } }
    : block);
  const response = await app.handle(request("/content", {
    entity: "landing_page", id: created.id, title: "Edit later", slug: "edit-later", headline: "Edit later", status: "published", blocks: edited,
  }, "PUT"));
  assert.equal(response.status, 200);
  const reloaded = (await (await app.handle(request("/content", undefined, "GET"))).json()).pages.find((page) => page.id === created.id);
  assert.deepEqual(reloaded.blocks.map((block) => block.id), ["hero", "new-cta"]);
  assert.equal(reloaded.blocks[1].config.url, "https://example.com/apply");
});

test("saved preview controls remain selectable through three reopen and edit cycles", async () => {
  const { app } = await fixture();
  const LandingPageBlocks = await loadBlockRenderer();
  const blocks = [
    defaultLandingPageBlock("HERO", "hero"),
    defaultLandingPageBlock("TEXT", "text"),
    defaultLandingPageBlock("CTA_BUTTON", "cta"),
  ];
  const created = (await (await app.handle(request("/content", {
    entity: "landing_page", title: "Repeated edits", slug: "repeated-edits", headline: "Repeated edits", status: "draft", blocks,
  }))).json()).record;

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const reopened = (await (await app.handle(request("/content", undefined, "GET"))).json()).pages.find((page) => page.id === created.id);
    let selectedId = "";
    const preview = LandingPageBlocks({
      blocks: reopened.blocks, pageId: reopened.id, preview: true,
      selectedBlockId: "hero", onSelectBlock: (id) => { selectedId = id; },
    });
    const controls = preview.props.children;
    assert.equal(controls.length, 3);
    for (const control of controls) {
      control.props.children[1].props.onClick();
      assert.equal(selectedId, control.props["data-studio-block-id"]);
      assert.ok(reopened.blocks.find((block) => block.id === selectedId)?.config);
    }
    const edited = reopened.blocks.map((block) => block.id === "cta"
      ? { ...block, config: { ...block.config, text: `Apply ${cycle}`, url: `https://example.com/apply-${cycle}` } }
      : block);
    const response = await app.handle(request("/content", {
      entity: "landing_page", id: created.id, title: reopened.title, slug: reopened.slug,
      headline: reopened.headline, status: "draft", blocks: edited,
    }, "PUT"));
    assert.equal(response.status, 200);
    const saved = (await response.json()).record;
    assert.equal(saved.blocks.length, 3);
    assert.equal(saved.blocks.find((block) => block.id === "cta")?.config.text, `Apply ${cycle}`);
  }
});

test("lead change cursor announces only newly created canonical leads", async () => {
  const { app } = await fixture();
  const baseline = await (await app.handle(request("/leads/changes", undefined, "GET"))).json();
  assert.equal(baseline.cursor, 0);
  const created = await (await app.handle(request("/leads", { name: "A New Lead", email: "new@example.com" }))).json();
  const afterCreate = await (await app.handle(request(`/leads/changes?after=${baseline.cursor}`, undefined, "GET"))).json();
  assert.equal(afterCreate.leads[0].event, "LEAD_CREATED");
  assert.deepEqual(afterCreate.leads.map((lead) => lead.leadId), [Number(created.lead.id.replace("social:", ""))]);
  await app.handle(request("/leads", { name: "Updated Lead", email: "new@example.com" }));
  const afterUpdate = await (await app.handle(request(`/leads/changes?after=${afterCreate.cursor}`, undefined, "GET"))).json();
  assert.deepEqual(afterUpdate.leads, []);
  assert.equal(afterUpdate.totalLeads, 1);
});

test("content API saves ordered blocks and duplicates design without lead history", async () => {
  const { app } = await fixture();
  const blocks = normalizeLandingPageBlocks([
    { ...defaultLandingPageBlock("HERO", "hero"), config: { headline: "Studio headline", eyebrow: "WELCOME", body: "Studio body", alignment: "center" } },
    { ...defaultLandingPageBlock("CTA_BUTTON", "cta-one"), config: { text: "Apply", url: "https://example.com/apply", alignment: "center" } },
    { ...defaultLandingPageBlock("CTA_BUTTON", "cta-two"), config: { text: "Learn", url: "https://example.com/learn", alignment: "left" } },
    defaultLandingPageBlock("REGISTRATION_FORM", "form"),
  ]);
  const createdResponse = await app.handle(request("/content", {
    entity: "landing_page", title: "Studio page", slug: "studio-page", headline: "fallback",
    status: "published", blocks,
  }));
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).record;
  assert.equal(created.headline, "Studio headline");
  assert.deepEqual(created.blocks.map((block) => block.id), ["hero", "cta-one", "cta-two", "form"]);

  const duplicateResponse = await app.handle(request("/landing-pages/duplicate", { pageId: created.id }));
  assert.equal(duplicateResponse.status, 201);
  const duplicate = (await duplicateResponse.json()).record;
  assert.equal(duplicate.status, "draft");
  assert.equal(duplicate.registrations, 0);
  assert.match(duplicate.slug, /studio-page-copy/);
  assert.deepEqual(duplicate.blocks, created.blocks);
});

test("visitor analytics deduplicates daily refreshes and groups campaign attribution", async () => {
  const { app } = await fixture();
  const pageResponse = await app.handle(request("/content", {
    entity: "landing_page", title: "Measured page", slug: "measured-page", headline: "Measure",
    status: "published", blocks: [defaultLandingPageBlock("HERO", "hero")],
  }));
  const page = (await pageResponse.json()).record;
  const view = { pageId: page.id, visitorKey: "opaque-browser-cookie", source: "instagram", campaign: "fall-launch" };
  assert.equal((await app.handle(request("/landing-page-views", view))).status, 201);
  assert.equal((await app.handle(request("/landing-page-views", view))).status, 200);
  const analyticsResponse = await app.handle(request("/landing-pages/analytics", undefined, "GET"));
  const analytics = (await analyticsResponse.json()).analytics.find((item) => item.pageId === page.id);
  assert.equal(analytics.visitors, 1);
  assert.deepEqual(analytics.sources, [{ name: "instagram", count: 1 }]);
  assert.deepEqual(analytics.campaigns, [{ name: "fall-launch", count: 1 }]);
});

test("studio UI, public renderer, protected drafts, routes, and SQL migration are wired", async () => {
  const [dashboard, studio, renderer, landing, proxy, migration, dataRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LandingPageStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LandingPageBlocks.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/landing/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../sql/021_landing_page_studio.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/data/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /Landing Page Studio/);
  assert.match(dashboard, /Edit design/);
  assert.match(studio, /studio-workspace/);
  assert.match(studio, /Desktop/);
  assert.match(studio, /Tablet/);
  assert.match(studio, /Mobile/);
  assert.match(studio, /draggable/);
  for (const type of LANDING_PAGE_BLOCK_TYPES) assert.match(studio, new RegExp(type));
  assert.match(renderer, /LandingVideoPlayer/);
  assert.match(renderer, /RegisterForm/);
  assert.match(landing, /page\.status === "published"/);
  assert.match(landing, /LandingPageViewTracker/);
  assert.match(proxy, /"\/api\/landing-views"/);
  assert.match(dataRoute, /landingPageAnalytics/);
  assert.match(migration, /CREATE TABLE dbo\.LandingPageBlocks/);
  assert.match(migration, /CREATE TABLE dbo\.LandingPageViews/);
  assert.match(migration, /CREATE OR ALTER PROCEDURE dbo\.LandingPage_Duplicate/);
  assert.match(migration, /CREATE OR ALTER PROCEDURE dbo\.LandingPageAnalytics_GetAll/);
  assert.match(migration, /NOT EXISTS \(SELECT 1 FROM dbo\.LandingPageBlocks/);
  assert.doesNotMatch(migration, /LeadScore_Recalculate|LeadScoringRules|LeadTemperatureThresholds/);
});
