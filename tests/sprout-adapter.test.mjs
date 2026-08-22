import assert from "node:assert/strict";
import test from "node:test";
import { SproutSocialAdapter, sproutConfigurationFromEnv } from "../social/sprout.mjs";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const baseConfig = {
  apiToken: "sprout-api-token",
  authMode: "api_token",
  customerId: "customer-42",
  groupId: "88",
  profileIds: ["101", "102"],
  listeningTopicIds: ["77"],
};

test("Sprout environment configuration keeps credentials server-side", () => {
  const config = sproutConfigurationFromEnv({
    SPROUT_API_TOKEN: "private-token",
    SPROUT_CUSTOMER_ID: "customer-1",
    SPROUT_GROUP_ID: "group-1",
    SPROUT_PROFILE_IDS: "profile-1, profile-2",
    SPROUT_LISTENING_TOPIC_IDS: "topic-1",
  });
  assert.equal(config.apiToken, "private-token");
  assert.deepEqual(config.profileIds, ["profile-1", "profile-2"]);
  const adapter = new SproutSocialAdapter(config);
  assert.doesNotMatch(JSON.stringify(adapter.status()), /private-token/);
});

test("Sprout validates customer access and never exposes the bearer token", async () => {
  const adapter = new SproutSocialAdapter(baseConfig, {
    sleep: async () => {},
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.authorization, "Bearer sprout-api-token");
      return response({ data: [{ customer_id: "customer-42", name: "Alianza" }] });
    },
  });
  const health = await adapter.healthCheck();
  assert.equal(health.status, "connected");
  assert.equal(health.publishingReady, true);
  assert.doesNotMatch(JSON.stringify(health), /sprout-api-token/);
});

test("Sprout machine credentials obtain and cache an OAuth access token", async () => {
  let tokenRequests = 0;
  let apiRequests = 0;
  const adapter = new SproutSocialAdapter({
    ...baseConfig,
    apiToken: "",
    authMode: "client_credentials",
    clientId: "client-1",
    clientSecret: "client-secret",
  }, {
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      if (String(url).includes("identity.sproutsocial.com")) {
        tokenRequests += 1;
        assert.match(String(init.body), /grant_type=client_credentials/);
        assert.match(String(init.body), /scope=organization_id/);
        return response({ access_token: "short-lived-token", expires_in: 3600 });
      }
      apiRequests += 1;
      assert.equal(init.headers.authorization, "Bearer short-lived-token");
      return response({ data: [{ customer_id: "customer-42" }] });
    },
  });
  await adapter.healthCheck();
  await adapter.healthCheck();
  assert.equal(tokenRequests, 1);
  assert.equal(apiRequests, 2);
});

test("Sprout inbox and listening messages normalize into CRM-owned channel events", async () => {
  const requests = [];
  const adapter = new SproutSocialAdapter(baseConfig, {
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
      if (String(url).includes("/listening/topics/")) {
        return response({ data: [{ guid: "listen-1", network: "INSTAGRAM", text: "Need pricing", created_time: "2026-08-18T10:00:00Z", from: { guid: "ig-user-1", name: "Sam" } }] });
      }
      return response({ data: [{ guid: "message-1", network: "FACEBOOK", post_type: "FACEBOOK_COMMENT", text: "Send the webinar", created_time: "2026-08-18T09:00:00Z", from: { guid: "fb-user-1", name: "Alicia" } }] });
    },
  });
  const events = await adapter.fetchInboundEvents({ since: "2026-08-18T00:00:00Z" });
  assert.equal(events.length, 2);
  assert.equal(adapter.normalizeEvent(events[0]).channel, "facebook");
  assert.equal(adapter.normalizeEvent(events[1]).channel, "instagram");
  assert.equal(adapter.normalizeEvent({ guid: "linkedin-1", network: "LINKEDIN" }), null);
  assert.match(requests[0].body.filters.join(" "), /group_id\.eq\(88\)/);
  assert.match(requests[1].url, /listening\/topics\/77\/messages/);
});

test("Sprout publishing creates a scheduled draft and captures every external ID", async () => {
  let submitted;
  const adapter = new SproutSocialAdapter(baseConfig, {
    sleep: async () => {},
    fetchImpl: async (_url, init) => {
      submitted = JSON.parse(init.body);
      return response({ data: [
        { internal: { publishing: { publishing_post_id: 501, deliveries: [{ delivery_status: "PENDING" }] } } },
        { internal: { publishing: { publishing_post_id: 502, deliveries: [{ delivery_status: "PENDING" }] } } },
      ] }, 200, { "x-sprout-request-id": "request-1" });
    },
  });
  const result = await adapter.createPublishingDraft({ text: "Watch the webinar", scheduledAt: "2026-09-01T15:00:00Z" });
  assert.equal(submitted.is_draft, true);
  assert.deepEqual(submitted.customer_profile_ids, [101, 102]);
  assert.equal(submitted.delivery.type, "SCHEDULED");
  assert.equal(result.externalId, "501");
  assert.deepEqual(result.externalIds, ["501", "502"]);
  assert.equal(result.externalStatus, "PENDING");
  assert.equal(result.requestId, "request-1");
});

test("Sprout retries transient provider responses", async () => {
  let attempts = 0;
  const adapter = new SproutSocialAdapter(baseConfig, {
    sleep: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3 ? response({ error: "busy" }, 503) : response({ data: [] });
    },
  });
  const result = await adapter.getMetrics({ start: "2026-08-01", end: "2026-08-18" });
  assert.deepEqual(result, []);
  assert.equal(attempts, 3);
});

test("Sprout retrieves both owned-profile and post-level metrics", async () => {
  const adapter = new SproutSocialAdapter(baseConfig, {
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      if (String(url).endsWith("/analytics/posts")) {
        assert.ok(body.metrics.includes("lifetime.impressions"));
        return response({ data: [{ text: "Webinar", metrics: { "lifetime.impressions": 42 } }] });
      }
      assert.ok(body.metrics.includes("impressions"));
      return response({ data: [{ dimensions: { customer_profile_id: 101 }, metrics: { impressions: 90 } }] });
    },
  });
  const metrics = await adapter.collectMetrics({ start: "2026-08-01", end: "2026-08-18" });
  assert.equal(metrics.profiles.length, 1);
  assert.equal(metrics.posts.length, 1);
});
