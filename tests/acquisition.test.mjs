import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AcquisitionService,
  CommunicationPolicyEngine,
  ProspectDiscoveryProvider,
  normalizeAcquisitionDecision,
  normalizeAcquisitionInput,
  normalizeProspect,
} from "../social/acquisition.mjs";
import { AIProviderService } from "../social/ai-providers.mjs";
import { createSocialListenerApp } from "../social/server.mjs";
import { InMemorySocialRepository } from "../social/core.mjs";

function configuration(overrides = {}) {
  return normalizeAcquisitionInput({
    id: 8,
    acquisitionName: "South Florida advisory firms",
    objective: "Start qualified conversations",
    productOrService: "CRM implementation",
    targetIndustry: "advisory",
    targetLocation: "Miami",
    keywords: "growth, automation",
    aiProviderId: 1,
    minimumProspectFitScore: 50,
    searchSources: [{ sourceCode: "CSV_IMPORT", enabled: true, priority: 1, settings: {} }],
    communicationMethods: [
      { channel: "EMAIL", enabled: true, priority: 1, maximumAttempts: 2 },
      { channel: "WHATSAPP_BUSINESS", enabled: true, priority: 2, maximumAttempts: 2 },
      { channel: "MANUAL_HUMAN_FOLLOW_UP", enabled: true, priority: 3, maximumAttempts: 1 },
    ],
    qualificationQuestions: ["BusinessGoal", "Timeline"],
    ...overrides,
  });
}

test("acquisition configuration validates providers, dates, source order, and channel policy", () => {
  const value = configuration();
  assert.equal(value.companyProfileId, 1);
  assert.equal(value.searchSources[0].sourceCode, "CSV_IMPORT");
  assert.equal(value.communicationMethods[0].channel, "EMAIL");
  assert.equal(value.communicationMethods[0].stopOnResponse, true);
  assert.throws(() => configuration({ fallbackAIProviderId: 1 }), /must differ/);
  assert.throws(() => configuration({ startDate: "2026-10-10", endDate: "2026-10-01" }), /End date/);
  assert.throws(() => configuration({ searchSources: [{ sourceCode: "UNAPPROVED", enabled: true }] }), /Unsupported search source/);
});

test("provider normalization creates stable prospect identity and preserves contact provenance without inventing data", () => {
  const config = { ...configuration(), id: 8 };
  const raw = {
    companyName: "Example Advisory",
    industry: "Financial advisory",
    location: "Miami, FL",
    website: "https://www.example.test/about",
    phone: "+1 305 555 0100",
    externalSourceId: "place-42",
    contactProvenance: { PHONE: { source: "GOOGLE_PLACES", sourceUrl: "https://maps.example/place-42" } },
  };
  const first = normalizeProspect(raw, { sourceCode: "GOOGLE_PLACES", configuration: config });
  const second = normalizeProspect({ ...raw, companyName: "Changed display name" }, { sourceCode: "GOOGLE_PLACES", configuration: config });
  assert.equal(first.identityKey, second.identityKey);
  assert.equal(first.email, "");
  assert.equal(first.status, "CONTACTABLE");
  assert.deepEqual(first.contacts.find((contact) => contact.type === "PHONE"), {
    type: "PHONE", value: "+1 305 555 0100", source: "GOOGLE_PLACES", sourceUrl: "https://maps.example/place-42", verified: false,
  });
});

test("communication policy selects the highest-priority available allowed channel and stops escalation", () => {
  const engine = new CommunicationPolicyEngine();
  const methods = configuration().communicationMethods;
  const selection = engine.select({
    prospect: { email: "", whatsAppNumber: "+13055550100", phone: "", website: "", status: "CONTACTABLE", responded: false,
      consentStatus: "GRANTED", contacts: [{ type: "WHATSAPP_BUSINESS", value: "+13055550100", source: "CRM" }] },
    methods,
    attemptsByChannel: {},
  });
  assert.equal(selection.selected.method.channel, "WHATSAPP_BUSINESS");
  assert.deepEqual(selection.evaluations[0].policy.reasons, ["CONTACT_INFORMATION_MISSING"]);

  const responded = engine.select({
    prospect: { email: "buyer@example.test", whatsAppNumber: "+13055550100", status: "ENGAGED", responded: true },
    methods,
    attemptsByChannel: {},
  });
  assert.equal(responded.selected.method.channel, "MANUAL_HUMAN_FOLLOW_UP");
  assert.ok(responded.evaluations.filter((item) => item.method.channel !== "MANUAL_HUMAN_FOLLOW_UP").every((item) => item.policy.reasons.includes("RESPONSE_STOPS_ESCALATION")));

  const blocked = engine.select({
    prospect: { email: "buyer@example.test", whatsAppNumber: "+13055550100", status: "DO_NOT_CONTACT", responded: false },
    methods,
    attemptsByChannel: {},
  });
  assert.equal(blocked.selected, null);
  assert.ok(blocked.evaluations.every((item) => item.policy.reasons.includes("DO_NOT_CONTACT")));
});

test("discovery provider abstraction applies fit threshold, daily limit, and repository deduplication", async () => {
  const config = { ...configuration(), id: 8, dailyProspectLimit: 2 };
  const persisted = new Map();
  const repository = {
    getAcquisitionConfigurations: async () => [config],
    getAcquisitionDiscoveryCountToday: async () => 0,
    upsertAcquisitionProspect: async (prospect) => {
      const inserted = !persisted.has(prospect.identityKey);
      persisted.set(prospect.identityKey, prospect);
      return { ...prospect, inserted };
    },
  };
  class FakeProvider extends ProspectDiscoveryProvider {
    constructor() { super("CSV_IMPORT"); }
    async searchProspects() {
      return [
        { companyName: "One Advisory", industry: "advisory", location: "Miami", email: "one@example.test", externalSourceId: "one" },
        { companyName: "One Advisory duplicate", industry: "advisory", location: "Miami", email: "one@example.test", externalSourceId: "one" },
        { companyName: "Two Advisory", industry: "advisory", location: "Miami", phone: "+13055550102", externalSourceId: "two" },
      ];
    }
  }
  const service = new AcquisitionService({ repository, aiProviderService: {}, discoveryProviders: new Map([["CSV_IMPORT", new FakeProvider()]]) });
  const result = await service.discover(8);
  assert.equal(result.results[0].discovered, 2);
  assert.equal(result.remainingDailyLimit, 0);
  assert.equal(persisted.size, 2, "duplicate rows do not consume the cap before a second unique prospect");
});

test("conversion requires engagement and rejects do-not-contact even when fit is high", async () => {
  const config = { ...configuration(), id: 8 };
  const prospect = { id: 12, acquisitionConfigurationId: 8, status: "CONTACTABLE", source: "CSV_IMPORT",
    responded: false, fitScore: 90, optedOut: false, convertedLeadId: null };
  let converted = 0;
  const service = new AcquisitionService({ repository: {
    getAcquisitionConfigurations: async () => [config],
    getAcquisitionProspects: async () => [prospect],
    convertAcquisitionProspect: async () => { converted += 1; return { leadId: "social:42" }; },
  }, aiProviderService: {} });
  await assert.rejects(() => service.convert(12), /has not engaged/);
  prospect.responded = true;
  assert.deepEqual(await service.convert(12), { leadId: "social:42" });
  prospect.status = "DO_NOT_CONTACT";
  await assert.rejects(() => service.convert(12), /Do-not-contact/);
  assert.equal(converted, 1);
});

test("inbound opt-out is recorded without invoking AI or queuing a reply", async () => {
  const config = { ...configuration(), id: 8 };
  const prospect = { id: 12, acquisitionConfigurationId: 8, status: "CONTACTED", optedOut: false };
  const updates = [];
  let aiCalls = 0;
  const service = new AcquisitionService({ repository: {
    getAcquisitionConfigurations: async () => [config],
    getAcquisitionProspects: async () => [prospect],
    saveAcquisitionConversation: async () => ({ id: 42, duplicate: false }),
    updateAcquisitionProspectEngagement: async (_id, update) => { updates.push(update); },
  }, aiProviderService: { generateStructuredOutput: async () => { aiCalls += 1; } } });
  const result = await service.receiveMessage(12, { channel: "EMAIL", message: "Please do not contact me", externalMessageId: "mail-1" });
  assert.equal(result.optedOut, true);
  assert.deepEqual(updates, [{ status: "DO_NOT_CONTACT", responded: true, optedOut: true }]);
  assert.equal(aiCalls, 0);
});

test("AI-classified opt-out also suppresses an outbound reply", async () => {
  const config = { ...configuration(), id: 8 };
  const prospect = { id: 12, acquisitionConfigurationId: 8, status: "CONTACTED", optedOut: false };
  const updates = [];
  let saved = 0;
  const service = new AcquisitionService({ repository: {
    getAcquisitionConfigurations: async () => [config],
    getAcquisitionProspects: async () => [prospect],
    getAcquisitionConversations: async () => [],
    getCompanyProfile: async () => ({}),
    saveAcquisitionConversation: async () => ({ id: ++saved, duplicate: false }),
    updateAcquisitionProspectEngagement: async (_id, update) => { updates.push(update); },
  }, aiProviderService: { generateStructuredOutput: async () => ({
    output: { intent: "OPT_OUT", confidence: 0.95, next_action: "WAIT", response: "Goodbye", extracted_information: {} },
  }) } });
  const result = await service.receiveMessage(12, { channel: "EMAIL", message: "I would rather not hear from you again", externalMessageId: "mail-2" });
  assert.equal(result.optedOut, true);
  assert.equal(saved, 1, "only the inbound conversation is saved");
  assert.ok(updates.some((update) => update.optedOut === true && update.status === "DO_NOT_CONTACT"));
});

test("automatic outreach is opt-in, consent-gated, delayed, and bounded", async () => {
  const config = { ...configuration({ automaticOutreachEnabled: true }), id: 8, status: "ACTIVE" };
  const prospect = (id, consentStatus) => ({ id, acquisitionConfigurationId: 8, companyName: `Company ${id}`,
    email: `${id}@example.test`, status: "CONTACTABLE", consentStatus, optedOut: false,
    responded: false, convertedLeadId: null, contacts: [{ type: "EMAIL", value: `${id}@example.test`, source: "CSV_IMPORT" }] });
  const prospects = [prospect(1, "GRANTED"), prospect(2, ""), prospect(3, "OPT_IN")];
  const attempts = { 1: [], 2: [], 3: [{ channel: "EMAIL", status: "SENT", attemptedAt: "2026-09-17T12:00:00.000Z" }] };
  const queued = [];
  const service = new AcquisitionService({ repository: {
    getAcquisitionConfigurations: async () => [config],
    getAcquisitionProspects: async ({ prospectId }) => prospectId ? prospects.filter((item) => item.id === prospectId) : prospects,
    getAcquisitionContactAttempts: async (id) => attempts[id],
  }, aiProviderService: {}, env: { AI_ACQUISITION_OUTREACH_BATCH_SIZE: "2" } });
  service.queueContact = async (id, body) => { queued.push({ id, ...body }); return { attempt: { id } }; };
  const result = await service.scheduleOutreach(config, { now: new Date("2026-09-19T12:00:00.000Z") });
  assert.equal(result.queued, 2);
  assert.deepEqual(queued.map((item) => item.id), [1, 3]);
  assert.equal(queued[1].idempotencyKey, "acquisition:auto:3:1");
  assert.equal((await service.scheduleOutreach({ ...config, automaticOutreachEnabled: false })).queued, 0);
  attempts[3][0].attemptedAt = "2026-09-19T11:30:00.000Z";
  queued.length = 0;
  await service.scheduleOutreach(config, { now: new Date("2026-09-19T12:00:00.000Z") });
  assert.deepEqual(queued.map((item) => item.id), [1], "the follow-up waits for its configured delay");
});

test("structured acquisition decisions preserve the required contract", () => {
  assert.deepEqual(normalizeAcquisitionDecision({
    intent: "pricing", confidence: 1.4, next_action: "HANDOFF", response: "A specialist can help.",
    qualification_field: "Timeline", extracted_information: { Timeline: "this month" }, request_human: true,
  }), {
    intent: "pricing", confidence: 1, next_action: "HANDOFF", response: "A specialist can help.",
    qualification_field: "Timeline", extracted_information: { Timeline: "this month" }, request_human: true,
  });
});

test("generic AI structured output retries a primary and uses only the configured fallback", async () => {
  const providers = [
    { id: 1, providerCode: "OPENAI", providerName: "OpenAI", model: "primary", enabled: true, secrets: { apiKey: "secret" } },
    { id: 2, providerCode: "ANTHROPIC", providerName: "Claude", model: "fallback", enabled: true, secrets: { apiKey: "secret" } },
  ];
  let primaryCalls = 0;
  const service = new AIProviderService({
    repository: { getAiProviderConfigurations: async ({ providerId }) => providers.filter((provider) => provider.id === Number(providerId)) },
    adapters: new Map([
      ["OPENAI", { generateStructuredOutput: async () => { primaryCalls += 1; throw Object.assign(new Error("temporary"), { retryable: true }); } }],
      ["ANTHROPIC", { generateStructuredOutput: async () => ({ intent: "INTEREST", confidence: 0.9, next_action: "ASK", response: "What timeline works?", qualification_field: "Timeline", extracted_information: {}, request_human: false }) }],
    ]),
  });
  const result = await service.generateStructuredOutput({ providerId: 1, fallbackProviderId: 2, prompt: "Decide", schemaName: "decision", schema: { type: "object" } });
  assert.equal(primaryCalls, 3);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.output.intent, "INTEREST");
});

test("listener exposes acquisition routes independently of campaign routes", async () => {
  const calls = [];
  let saveError = null;
  const acquisitionService = {
    overview: async () => ({ prospectsDiscovered: 7 }),
    configurations: async () => [{ id: 3, acquisitionName: "Test" }],
    prospects: async () => [], conversations: async () => [], analytics: async () => ({ overview: {}, sources: [], channels: [], configurations: [] }),
    manualTasks: async () => [{ id: 5, prospectId: 9, channel: "MANUAL_HUMAN_FOLLOW_UP" }],
    completeManualTask: async (id) => ({ id, status: "COMPLETED" }),
    saveConfiguration: async (body) => { if (saveError) throw saveError; return { ...body, id: 3 }; },
    setStatus: async () => ({ id: 3, status: "ACTIVE" }),
    discover: async (id) => { calls.push(id); return { configurationId: Number(id), results: [] }; },
    queueContact: async () => ({}), convert: async () => ({}), receiveMessage: async () => ({}),
  };
  const app = await createSocialListenerApp({
    env: { SERVICE_AUTH_TOKEN: "service-token" },
    repository: new InMemorySocialRepository(),
    adapters: {}, acquisitionService,
    aiProviderService: { testConnection: async () => true },
    aiCampaignAutomationEngine: {},
    bufferCampaignService: {},
    logger: { info() {}, error() {}, log() {} },
  });
  const request = (path, init = {}) => app.handle(new Request(`http://listener.test${path}`, {
    ...init, headers: { authorization: "Bearer service-token", "content-type": "application/json", ...init.headers },
  }));
  const overview = await request("/acquisition/overview");
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).overview.prospectsDiscovered, 7);
  const discovery = await request("/acquisition/discover", { method: "POST", body: JSON.stringify({ configurationId: 3 }) });
  assert.equal(discovery.status, 200);
  assert.deepEqual(calls, [3]);
  const tasks = await request("/acquisition/manual-tasks");
  assert.equal((await tasks.json()).tasks[0].id, 5);
  const completed = await request("/acquisition/manual-tasks/5/complete", { method: "POST", body: "{}" });
  assert.equal((await completed.json()).task.status, "COMPLETED");
  saveError = Object.assign(new Error("password=must-not-leak"), { code: "EREQUEST", number: 2812 });
  const failedSave = await request("/acquisition/configurations", { method: "POST", body: "{}" });
  assert.equal(failedSave.status, 500);
  assert.deepEqual(await failedSave.json(), {
    error: "Acquisition configuration could not be saved.",
    diagnosticCode: "SQL_2812",
  });
});

test("acquisition migration keeps Prospect storage independent and conversion inside the existing Lead lifecycle", () => {
  const sql = readFileSync(new URL("../sql/026_ai_acquisition.sql", import.meta.url), "utf8");
  for (const table of ["AIAcquisitionConfigurations", "AIAcquisitionProspects", "AIAcquisitionProspectContacts",
    "AIAcquisitionConversations", "AIAcquisitionContactAttempts"]) {
    assert.match(sql, new RegExp(`CREATE TABLE dbo\\.${table}`));
  }
  assert.match(sql, /CRMLead_UpsertFromRoutine/);
  assert.match(sql, /@KnownLeadId=TRY_CONVERT\(BIGINT/);
  assert.match(sql, /INSERT dbo\.LeadRoutineEvents\(Routine,ExternalEventId,LeadId,SourceDetail,OccurredAt\)/);
  assert.match(sql, /LeadScore_Recalculate/);
  assert.match(sql, /AI_ACQUISITION_CONVERSATION/);
  assert.match(sql, /IX_AIAcquisitionContactAttempts_Due/);
  assert.match(sql, /AutomaticOutreachEnabled/);
  assert.match(sql, /attempt\.Channel<>N'MANUAL_HUMAN_FOLLOW_UP'/);
  assert.match(sql, /ReplyRatePercent/);
  assert.match(sql, /AverageLeadScore/);
  assert.doesNotMatch(sql, /CREATE\s+TABLE\s+dbo\.Leads\b/i);
});
