import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySocialRepository } from "../social/core.mjs";
import {
  calculateHistoricalLeadScore,
  DEFAULT_SCORING_RULES,
  evaluateSocialEvent,
  extractQualification,
  temperatureForScore,
} from "../social/intelligence.mjs";

function event(overrides = {}) {
  return {
    channel: "facebook",
    externalEventId: "evt-1",
    eventType: "comment",
    externalUserId: "fb-user-1",
    username: "buyer",
    displayName: "Buyer One",
    email: null,
    phone: null,
    message: "What is the price? Please send details.",
    postId: "post-1",
    campaignId: "campaign-provider-1",
    campaignName: "Launch",
    adId: "ad-1",
    leadFormId: null,
    conversationId: "conversation-1",
    direction: "INBOUND",
    sourceUrl: "https://example.test/post/1",
    occurredAt: "2026-08-17T12:00:00.000Z",
    rawPayload: {},
    ...overrides,
  };
}

test("intelligence classifies paid intent, scores it, and qualifies buying details", () => {
  const result = evaluateSocialEvent(event({
    email: "buyer@example.test",
    phone: "+1 305 555 0100",
    message: "I need 25 licenses this month. My budget is $5,000. What is the price?",
  }));
  assert.equal(result.interactionType, "COMMENT");
  assert.equal(result.intent, "PRICE_REQUEST");
  assert.equal(result.sourceType, "PAID");
  assert.equal(result.intentConfidence, null);
  assert.equal(result.shouldCreateLead, true);
  assert.equal(result.scoreDelta,
    DEFAULT_SCORING_RULES.COMMENT_ON_ADVERTISEMENT +
    DEFAULT_SCORING_RULES.PRICE_REQUEST +
    DEFAULT_SCORING_RULES.EMAIL_PROVIDED +
    DEFAULT_SCORING_RULES.PHONE_NUMBER_PROVIDED);
  assert.equal(result.qualification.quantity, 25);
  assert.equal(result.qualification.budget, 5000);
  assert.equal(result.qualification.purchaseTimeline, "this month");
});

test("passive engagement is retained as an interaction without creating a lead", () => {
  const result = evaluateSocialEvent(event({ eventType: "like", message: null, adId: null }));
  assert.equal(result.interactionType, "LIKE");
  assert.equal(result.shouldCreateLead, false);
  assert.equal(result.sourceType, "ORGANIC");
});

test("temperature thresholds and qualification extraction are deterministic", () => {
  assert.equal(temperatureForScore(19), "COLD");
  assert.equal(temperatureForScore(20), "WARM");
  assert.equal(temperatureForScore(50), "HOT");
  assert.equal(temperatureForScore(80), "VERY_HOT");
  const qualification = extractQualification("I am the owner and need custom onboarding within 2 weeks for $12,000", "PURCHASE_INTENT");
  assert.equal(qualification.decisionMaker, true);
  assert.equal(qualification.budget, 12000);
  assert.equal(qualification.purchaseTimeline, "within 2 weeks");
});

test("historical scoring rewards repeat intent and falls as interactions age", () => {
  const lead = { email: "buyer@example.test", phone: "+1 305 555 0100", qualification: {} };
  const firstInteraction = {
    interactionType: "COMMENT", direction: "INBOUND", intent: "PURCHASE_INTENT",
    intentConfidence: 1, sourceType: "ORGANIC", occurredAt: "2030-01-01T12:00:00.000Z",
  };
  const first = calculateHistoricalLeadScore({
    lead, interactions: [firstInteraction], asOf: "2030-01-01T13:00:00.000Z",
  });
  const repeated = calculateHistoricalLeadScore({
    lead,
    interactions: [firstInteraction, {
      ...firstInteraction, interactionType: "DM", intent: "QUOTE_REQUEST", occurredAt: "2030-01-02T12:00:00.000Z",
    }],
    asOf: "2030-01-02T13:00:00.000Z",
  });
  const aged = calculateHistoricalLeadScore({
    lead,
    interactions: [firstInteraction, {
      ...firstInteraction, interactionType: "DM", intent: "QUOTE_REQUEST", occurredAt: "2030-01-02T12:00:00.000Z",
    }],
    asOf: "2031-01-02T13:00:00.000Z",
  });

  assert.ok(repeated.score > first.score);
  assert.equal(repeated.qualified, true);
  assert.equal(repeated.band, "QUALIFIED");
  assert.ok(aged.score < repeated.score);
  assert.match(repeated.reason, /across 2 inbound interactions/i);
});

test("repository deduplicates a person across platforms while preserving both identities", async () => {
  const repository = new InMemorySocialRepository();
  const facebookEvent = event({ email: "same@example.test" });
  const instagramEvent = event({
    channel: "instagram",
    externalEventId: "evt-2",
    externalUserId: "ig-user-9",
    email: "same@example.test",
  });
  const lead = {
    name: "Same Person",
    email: "same@example.test",
    phone: null,
    firstTouchAt: facebookEvent.occurredAt,
  };
  const first = await repository.processEvent(facebookEvent, lead, evaluateSocialEvent(facebookEvent));
  const second = await repository.processEvent(instagramEvent, lead, evaluateSocialEvent(instagramEvent));
  assert.equal(first.leadCreated, true);
  assert.equal(second.leadUpdated, true);
  assert.equal((await repository.getLeads()).length, 1);
  const unified = await repository.getUnifiedLead(1);
  assert.equal(unified.socialAccounts.length, 2);
  assert.equal(unified.interactions.length, 2);
});
