import assert from "node:assert/strict";
import test from "node:test";
import {
  FacebookAdapter,
  InMemorySocialRepository,
  InstagramAdapter,
  MalformedPayloadError,
  SocialListener,
  XAdapter,
  createAdaptersFromEnv,
  extractMetaWebhookEvents,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
} from "../social/core.mjs";

const silentLogger = { info() {}, error() {}, log() {} };
const noSleep = async () => {};

function providerResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function instagram(options = {}) {
  return new InstagramAdapter({ accessToken: "test-token", accountId: "ig-1" }, {
    logger: silentLogger,
    sleep: noSleep,
    ...options,
  });
}

function facebook(options = {}) {
  return new FacebookAdapter({ accessToken: "test-token", pageId: "page-1" }, {
    logger: silentLogger,
    sleep: noSleep,
    ...options,
  });
}

function xAdapter(options = {}) {
  return new XAdapter({ bearerToken: "test-token" }, {
    logger: silentLogger,
    sleep: noSleep,
    ...options,
  });
}

test("Instagram events normalize into the unified shape", () => {
  const event = instagram().normalizeEvent({
    id: "ig-comment-1",
    text: "Please send pricing details",
    username: "alicia",
    from: { id: "ig-user-1", name: "Alicia Morgan" },
    post_id: "ig-post-1",
    campaign_id: "campaign-1",
    ad_id: "ad-1",
    permalink: "https://instagram.com/p/example",
    timestamp: "2026-08-16T12:00:00Z",
  });

  assert.deepEqual(
    {
      channel: event.channel,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      externalUserId: event.externalUserId,
      username: event.username,
      postId: event.postId,
      campaignId: event.campaignId,
      adId: event.adId,
    },
    {
      channel: "instagram",
      externalEventId: "ig-comment-1",
      eventType: "comment",
      externalUserId: "ig-user-1",
      username: "alicia",
      postId: "ig-post-1",
      campaignId: "campaign-1",
      adId: "ad-1",
    },
  );
  assert.equal(event.rawPayload.text, "Please send pricing details");
});

test("Facebook lead events normalize optional contact data", () => {
  const event = facebook().normalizeEvent({
    leadgen_id: "fb-lead-1",
    event_type: "leadgen",
    email: "buyer@example.com",
    phone: "+1-305-555-0100",
    name: "Buyer One",
    campaign_id: "fb-campaign",
    ad_id: "fb-ad",
    created_time: 1_787_000_000,
  });
  assert.equal(event.channel, "facebook");
  assert.equal(event.externalEventId, "fb-lead-1");
  assert.equal(event.email, "buyer@example.com");
  assert.equal(event.phone, "+1-305-555-0100");
  assert.equal(event.username, null);
});

test("X mentions normalize with source attribution", () => {
  const event = xAdapter().normalizeEvent({
    id: "x-post-1",
    author_id: "x-user-1",
    text: "I am interested in the webinar",
    created_at: "2026-08-16T13:00:00Z",
    conversation_id: "x-thread-1",
    author: { id: "x-user-1", username: "samirak", name: "Samira Khan" },
  });
  assert.equal(event.channel, "x");
  assert.equal(event.externalEventId, "x-post-1");
  assert.equal(event.postId, "x-thread-1");
  assert.equal(event.sourceUrl, "https://x.com/samirak/status/x-post-1");
});

test("normalizers accept missing optional fields and reject missing event IDs", () => {
  const event = instagram().normalizeEvent({ id: "ig-minimal", text: "hello" });
  assert.equal(event.email, null);
  assert.equal(event.phone, null);
  assert.equal(event.postId, null);
  assert.throws(() => facebook().normalizeEvent({ message: "no id" }), MalformedPayloadError);
  assert.throws(() => xAdapter().normalizeEvent({ text: "no id" }), MalformedPayloadError);
});

test("lead extraction qualifies intent and preserves every attribution field", () => {
  const adapter = instagram();
  const event = adapter.normalizeEvent({
    id: "ig-intent-1",
    text: "Can you send me pricing details?",
    username: "prospect",
    from: { id: "person-1", name: "Prospect One" },
    post_id: "post-1",
    campaign_id: "campaign-1",
    ad_id: "ad-1",
    timestamp: "2026-08-16T12:00:00Z",
  });
  const lead = adapter.extractLead(event);
  assert.deepEqual(
    {
      sourceChannel: lead.sourceChannel,
      externalEventId: lead.externalEventId,
      externalUserId: lead.externalUserId,
      socialUsername: lead.socialUsername,
      postId: lead.postId,
      campaignId: lead.campaignId,
      adId: lead.adId,
      firstTouchAt: lead.firstTouchAt,
      lastInteractionAt: lead.lastInteractionAt,
    },
    {
      sourceChannel: "instagram",
      externalEventId: "ig-intent-1",
      externalUserId: "person-1",
      socialUsername: "prospect",
      postId: "post-1",
      campaignId: "campaign-1",
      adId: "ad-1",
      firstTouchAt: "2026-08-16T12:00:00.000Z",
      lastInteractionAt: "2026-08-16T12:00:00.000Z",
    },
  );
  assert.equal(adapter.extractLead(adapter.normalizeEvent({ id: "not-intent", username: "person", text: "nice post" })), null);
});

test("lead pipeline creates once, updates an existing lead, and deduplicates an event", async () => {
  const repository = new InMemorySocialRepository();
  const adapter = instagram();
  const listener = new SocialListener({
    adapters: { instagram: adapter },
    repository,
    logger: silentLogger,
  });
  const firstPayload = {
    id: "same-event",
    text: "Please send webinar details",
    username: "buyer",
    from: { id: "person-1", name: "Buyer One" },
    timestamp: "2026-08-16T12:00:00Z",
  };
  const first = await listener.processEvent("instagram", firstPayload);
  const duplicate = await listener.processEvent("instagram", firstPayload);
  const update = await listener.processEvent("instagram", {
    ...firstPayload,
    id: "second-event",
    text: "I also need pricing",
    timestamp: "2026-08-16T13:00:00Z",
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.leadCreated, true);
  assert.equal(first.interactionInserted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.interactionInserted, false);
  assert.equal(update.duplicate, false);
  assert.equal(update.leadCreated, false);
  assert.equal(update.leadUpdated, true);
  assert.equal(update.interactionInserted, true);
  assert.ok(update.score >= first.score);
  assert.equal(repository.events.size, 2);
  assert.equal(repository.leads.size, 1);
});

test("missing channel configuration never reports connected", async () => {
  const adapters = createAdaptersFromEnv({}, { logger: silentLogger, sleep: noSleep });
  for (const adapter of Object.values(adapters)) {
    const result = await adapter.validateCredentials();
    assert.equal(result.status, "missing_configuration");
    assert.equal(result.credentialValidation, "skipped");
  }
});

test("a successful identity response is required before connected", async () => {
  const fetchImpl = async () => providerResponse({ id: "account-1", name: "Account" });
  const result = await instagram({ fetchImpl }).validateCredentials();
  assert.equal(result.status, "connected");
  assert.equal(result.credentialValidation, "pass");
  assert.equal(result.identity.id, "account-1");
});

test("authentication failure and expired credentials never report connected", async () => {
  for (const status of [401, 403]) {
    const fetchImpl = async () => providerResponse({ error: { message: "expired token" } }, status);
    const result = await facebook({ fetchImpl }).validateCredentials();
    assert.equal(result.status, "invalid_credentials");
    assert.equal(result.credentialValidation, "fail");
    assert.notEqual(result.status, "connected");
    assert.doesNotMatch(result.reason, /test-token/);
  }
});

test("rate limits, timeouts, provider errors, and malformed responses map safely", async () => {
  const cases = [
    {
      fetchImpl: async () => providerResponse({ error: { message: "slow down" } }, 429),
      expected: "rate_limited",
    },
    {
      fetchImpl: async () => providerResponse({ error: { message: "upstream" } }, 503),
      expected: "degraded",
    },
    {
      fetchImpl: async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; },
      expected: "degraded",
    },
    {
      fetchImpl: async () => new Response("not json", { status: 200 }),
      expected: "degraded",
    },
  ];
  for (const item of cases) {
    const result = await xAdapter({ fetchImpl: item.fetchImpl }).validateCredentials();
    assert.equal(result.status, item.expected);
    assert.notEqual(result.status, "connected");
  }
});

test("temporary provider failures use bounded retries", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls < 3
      ? providerResponse({ error: { message: "temporary" } }, 503)
      : providerResponse({ data: { id: "x-account", username: "account" } });
  };
  const result = await xAdapter({ fetchImpl }).validateCredentials();
  assert.equal(result.status, "connected");
  assert.equal(calls, 3);
});

test("X authentication failure never reports connected", async () => {
  const fetchImpl = async () => providerResponse({
    title: "Unauthorized",
    detail: "Invalid bearer token",
  }, 401);
  const result = await xAdapter({ fetchImpl }).validateCredentials();
  assert.equal(result.status, "invalid_credentials");
  assert.equal(result.credentialValidation, "fail");
});

test("provider metrics are normalized without inventing unavailable values", async () => {
  const igMetrics = await instagram({
    fetchImpl: async () => providerResponse({ data: [{ name: "reach", values: [{ value: 12 }] }] }),
  }).getMetrics();
  const fbMetrics = await facebook({
    fetchImpl: async () => providerResponse({ data: [{ name: "page_impressions", values: [{ value: 20 }] }] }),
  }).getMetrics();
  const xMetrics = await xAdapter({
    fetchImpl: async () => providerResponse({
      data: { id: "x-1", username: "account", public_metrics: { followers_count: 7 } },
    }),
  }).getMetrics();
  assert.equal(igMetrics[0].name, "reach");
  assert.equal(fbMetrics[0].name, "page_impressions");
  assert.deepEqual(xMetrics[0].values, { followers_count: 7 });
});

test("polling isolates channel failures and persists successful events", async () => {
  const repository = new InMemorySocialRepository();
  const ig = instagram();
  ig.fetchEvents = async () => [{
    id: "poll-event-1",
    text: "Please send webinar info",
    username: "poll-buyer",
    from: { id: "poll-person-1" },
    timestamp: "2026-08-16T12:00:00Z",
  }];
  const configured = () => ({ configured: true, missing: [] });
  const failing = {
    validateConfiguration: configured,
    fetchEvents: async () => { throw new Error("provider unavailable"); },
  };
  const idle = {
    validateConfiguration: configured,
    fetchEvents: async () => [],
  };
  const listener = new SocialListener({
    adapters: { instagram: ig, facebook: failing, x: idle },
    repository,
    logger: silentLogger,
  });
  const results = await listener.poll(["instagram", "facebook", "x"]);
  assert.equal(results.find((result) => result.channel === "instagram").processed, 1);
  assert.equal(results.find((result) => result.channel === "facebook").status, "error");
  assert.equal(results.find((result) => result.channel === "x").processed, 0);
  assert.equal(repository.events.size, 1);
  assert.equal(repository.leads.size, 1);
});

test("metric collection isolates a failed provider", async () => {
  const repository = new InMemorySocialRepository();
  const configured = () => ({ configured: true, missing: [] });
  const listener = new SocialListener({
    adapters: {
      instagram: { validateConfiguration: configured, getMetrics: async () => [{ name: "reach", value: 10 }] },
      facebook: { validateConfiguration: configured, getMetrics: async () => { throw new Error("permission denied"); } },
      x: { validateConfiguration: configured, getMetrics: async () => [] },
    },
    repository,
    logger: silentLogger,
  });
  const results = await listener.collectMetrics(["instagram", "facebook", "x"]);
  assert.equal(results.find((result) => result.channel === "instagram").metricsTest, "pass");
  assert.equal(results.find((result) => result.channel === "facebook").metricsTest, "fail");
  assert.equal(results.find((result) => result.channel === "x").metricsTest, "pass");
  assert.equal(repository.metrics.has("instagram"), true);
});

test("channel validation isolates a failing adapter", async () => {
  const repository = new InMemorySocialRepository();
  const base = {
    validateConfiguration: () => ({ configured: true, missing: [] }),
  };
  const adapters = {
    instagram: {
      ...base,
      validateCredentials: async () => ({
        channel: "instagram", name: "Instagram", configured: true,
        credentialValidation: "pass", status: "connected", checkedAt: new Date().toISOString(), reason: "ok",
      }),
    },
    facebook: {
      ...base,
      validateCredentials: async () => { throw new Error("facebook failed"); },
    },
    x: {
      ...base,
      validateCredentials: async () => ({
        channel: "x", name: "X", configured: true,
        credentialValidation: "pass", status: "connected", checkedAt: new Date().toISOString(), reason: "ok",
      }),
    },
  };
  const results = await new SocialListener({ adapters, repository, logger: silentLogger })
    .validateChannels(["instagram", "facebook", "x"]);
  assert.equal(results.find((result) => result.channel === "instagram").status, "connected");
  assert.equal(results.find((result) => result.channel === "facebook").status, "error");
  assert.equal(results.find((result) => result.channel === "x").status, "connected");
});

test("Meta webhook extraction supports changes and messages", () => {
  const events = extractMetaWebhookEvents({
    object: "instagram",
    entry: [{
      time: 1_787_000_000,
      changes: [{ field: "comments", value: { id: "comment-1", text: "pricing please" } }],
      messaging: [{ sender: { id: "sender-1" }, message: { mid: "message-1", text: "send info" }, timestamp: 1_787_000_001 }],
    }],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].channel, "instagram");
  assert.equal(events[1].payload.event_type, "message");
  assert.throws(() => extractMetaWebhookEvents({}), MalformedPayloadError);
});

test("Meta webhook challenge and signature validation reject invalid values", async () => {
  const url = new URL("https://example.test/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1234");
  assert.equal(verifyMetaWebhookChallenge(url, "verify-me"), "1234");
  assert.equal(verifyMetaWebhookChallenge(url, "wrong"), null);

  const body = JSON.stringify({ object: "page", entry: [] });
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode("app-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyMetaSignature(body, `sha256=${hex}`, "app-secret"), true);
  assert.equal(await verifyMetaSignature(body, "sha256=invalid", "app-secret"), false);
});
