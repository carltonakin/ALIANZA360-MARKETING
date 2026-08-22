import assert from "node:assert/strict";
import test from "node:test";
import { CrmSocialOrchestrator, sanitizeIntegrationData } from "../social/crm-orchestrator.mjs";
import { InMemorySocialRepository, ProviderError } from "../social/core.mjs";

function orchestratorWith(sprout, options = {}) {
  const repository = new InMemorySocialRepository();
  const events = [];
  const listener = { processNormalizedEvent: async (event) => { events.push(event); return { duplicate: false }; } };
  const orchestrator = new CrmSocialOrchestrator({ repository, listener, sprout, ...options });
  return { repository, orchestrator, events };
}

test("CRM queues an idempotent outbound decision and records Sprout delivery IDs", async () => {
  let deliveries = 0;
  const sprout = {
    status: () => ({ provider: "sprout", status: "configured" }),
    createPublishingDraft: async () => {
      deliveries += 1;
      return { externalId: "sprout-501", externalIds: ["sprout-501"], externalStatus: "PENDING", isDraft: true };
    },
  };
  const { repository, orchestrator } = orchestratorWith(sprout, { clock: () => new Date("2026-08-18T12:00:00Z") });
  const first = await orchestrator.queueAction({
    provider: "sprout", actionType: "PUBLISH_POST", idempotencyKey: "crm-action-1",
    campaignId: "campaign:7", payload: { text: "Watch the webinar" },
  });
  await orchestrator.runDue({ actionId: first.id });
  const duplicate = await orchestrator.queueAction({
    provider: "sprout", actionType: "PUBLISH_POST", idempotencyKey: "crm-action-1",
    campaignId: "campaign:7", payload: { text: "Watch the webinar" },
  });
  const [saved] = await repository.getIntegrationActions({ campaignId: "campaign:7" });
  assert.equal(deliveries, 1);
  assert.equal(duplicate.duplicate, true);
  assert.equal(saved.status, "SUCCEEDED");
  assert.equal(saved.externalId, "sprout-501");
  assert.equal(saved.externalStatus, "PENDING");
  assert.equal(repository.workflowRuns.size, 1);
  assert.ok(repository.auditLogs.some((entry) => entry.action === "ACTION_SUCCEEDED"));
});

test("CRM schedules retryable delivery failures without duplicating the action", async () => {
  const sprout = {
    status: () => ({ provider: "sprout", status: "configured" }),
    createPublishingDraft: async () => { throw new ProviderError("Provider unavailable", { retryable: true }); },
  };
  const { repository, orchestrator } = orchestratorWith(sprout, { clock: () => new Date("2026-08-18T12:00:00Z") });
  const action = await orchestrator.queueAction({ provider: "sprout", payload: { text: "Post" }, idempotencyKey: "retry-1" });
  await orchestrator.runDue({ actionId: action.id });
  const [saved] = await repository.getIntegrationActions();
  assert.equal(saved.status, "RETRY_SCHEDULED");
  assert.equal(saved.attemptCount, 1);
  assert.equal(saved.nextAttemptAt, "2026-08-18T12:01:00.000Z");
});

test("integration payloads and errors redact credential-shaped values", () => {
  const safe = sanitizeIntegrationData({
    text: "Publish this",
    accessToken: "never-store-this",
    nested: { client_secret: "also-private", profileId: "101" },
  });
  assert.equal(safe.text, "Publish this");
  assert.equal(safe.accessToken, "[redacted]");
  assert.equal(safe.nested.client_secret, "[redacted]");
  assert.doesNotMatch(JSON.stringify(safe), /never-store-this|also-private/);
});

test("Sprout inbound sync is normalized, deduplicated in the integration ledger, and passed to CRM", async () => {
  const payload = { guid: "message-1", network: "FACEBOOK", text: "Need pricing", created_time: "2026-08-18T10:00:00Z" };
  const sprout = {
    status: () => ({ provider: "sprout", status: "connected" }),
    fetchInboundEvents: async () => [payload],
    normalizeEvent: () => ({
      channel: "facebook", externalEventId: "message-1", eventType: "comment", externalUserId: "person-1",
      username: null, displayName: "Buyer", email: null, phone: null, message: "Need pricing", postId: "message-1",
      campaignId: null, adId: null, leadFormId: null, campaignName: null, conversationId: "message-1",
      direction: "INBOUND", sourceUrl: null, occurredAt: "2026-08-18T10:00:00.000Z", rawPayload: payload,
    }),
  };
  const { repository, orchestrator, events } = orchestratorWith(sprout);
  const first = await orchestrator.syncSprout();
  const second = await orchestrator.syncSprout();
  assert.equal(first.processed, 1);
  assert.equal(second.duplicates, 1);
  assert.equal(events.length, 2);
  assert.equal((await repository.getIntegrationActions()).filter((item) => item.direction === "INBOUND").length, 1);
});

test("CRM stores Sprout profile and post metrics and audits the refresh", async () => {
  const sprout = {
    status: () => ({ provider: "sprout", status: "connected" }),
    collectMetrics: async () => ({ profiles: [{ impressions: 100 }], posts: [{ impressions: 40 }] }),
  };
  const { repository, orchestrator } = orchestratorWith(sprout);
  const metrics = await orchestrator.collectSproutMetrics();
  assert.equal(metrics.posts.length, 1);
  assert.deepEqual(repository.metrics.get("sprout"), metrics);
  assert.ok(repository.auditLogs.some((entry) => entry.action === "METRICS_REFRESHED"));
});
