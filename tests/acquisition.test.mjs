import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AcquisitionService,
  ApolloProvider,
  ApolloOrganizationsProvider,
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

test("Apollo.io organization discovery applies configured filters and preserves returned contact provenance", async () => {
  const config = { ...configuration({
    targetIndustry: "financial services",
    targetLocation: "Miami, Florida",
    keywords: "automation, advisory",
  }), id: 8, dailyProspectLimit: 50 };
  let captured;
  const provider = new ApolloOrganizationsProvider({
    apiKey: "apollo-test-key",
    fetchImpl: async (url, init) => {
      captured = { url: new URL(url), init };
      return new Response(JSON.stringify({ organizations: [{
        id: "apollo-org-42",
        name: "Example Advisory",
        website_url: "https://example.test",
        primary_domain: "example.test",
        primary_phone: { sanitized_number: "+13055550100", source: "Scraped" },
        linkedin_url: "https://linkedin.example/company/example-advisory",
        facebook_url: "https://facebook.example/example-advisory",
        twitter_url: "https://x.example/example-advisory",
        city: "Miami",
        state: "Florida",
        country: "United States",
        industry: "Financial Services",
        estimated_num_employees: 25,
        founded_year: 2018,
        languages: ["English", "Spanish"],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const results = await provider.searchProspects({
    configuration: config,
    settings: { resultLimit: 10, employeeRanges: ["11,50"], technologyUids: ["salesforce"] },
  });
  assert.equal(captured.url.origin + captured.url.pathname, "https://api.apollo.io/api/v1/mixed_companies/search");
  assert.deepEqual(captured.url.searchParams.getAll("organization_locations[]"), ["Miami, Florida"]);
  assert.deepEqual(captured.url.searchParams.getAll("q_organization_keyword_tags[]"), ["financial services", "automation", "advisory"]);
  assert.deepEqual(captured.url.searchParams.getAll("organization_num_employees_ranges[]"), ["11,50"]);
  assert.deepEqual(captured.url.searchParams.getAll("currently_using_any_of_technology_uids[]"), ["salesforce"]);
  assert.equal(captured.url.searchParams.get("per_page"), "10");
  assert.equal(captured.init.headers["x-api-key"], "apollo-test-key");

  const normalized = provider.normalizeProspect(results[0], { configuration: config });
  assert.equal(normalized.source, "APOLLO_IO");
  assert.equal(normalized.externalSourceId, "apollo-org-42");
  assert.equal(normalized.companyName, "Example Advisory");
  assert.equal(normalized.email, "", "the adapter must not derive an email address from the Apollo domain");
  assert.equal(normalized.phone, "+13055550100");
  assert.equal(normalized.status, "CONTACTABLE");
  assert.deepEqual(normalized.contacts.find((contact) => contact.type === "PHONE"), {
    type: "PHONE",
    value: "+13055550100",
    source: "APOLLO_IO",
    sourceUrl: "https://linkedin.example/company/example-advisory",
    verified: false,
  });
  assert.equal(normalized.metadata.primaryDomain, "example.test");
});

test("Apollo.io discovery stays disabled without a server-side API key and refuses an unfiltered search", async () => {
  const config = { ...configuration({ targetIndustry: "", targetLocation: "", keywords: "", businessSize: "" }), id: 8 };
  await assert.rejects(
    () => new ApolloOrganizationsProvider().searchProspects({ configuration: config }),
    /APOLLO_API_KEY is not configured/,
  );
  await assert.rejects(
    () => new ApolloOrganizationsProvider({ apiKey: "test", fetchImpl: async () => { throw new Error("must not call"); } })
      .searchProspects({ configuration: config }),
    /requires a company name, keyword, location, domain, employee range, or technology filter/,
  );
});

test("Apollo People Search discovers decision-makers without triggering paid enrichment", async () => {
  const config = { ...configuration(), id: 8, dailyProspectLimit: 50 };
  const calls = [];
  const provider = new ApolloProvider({
    apiKey: "apollo-test-key",
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return new Response(JSON.stringify({ people: [{
        id: "person-42", first_name: "Ana", last_name_obfuscated: "G.", title: "Marketing Director",
        seniority: "director", linkedin_url: "https://linkedin.example/in/ana-g",
        has_email: true, has_direct_phone: false, organization_id: "org-8",
        organization: { id: "org-8", name: "Example Advisory", primary_domain: "example.test", industry: "Advisory" },
        city: "Miami", state: "Florida", country: "United States",
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const people = await provider.searchProspects({ configuration: config, settings: {
    decisionMakerTitles: ["Marketing Director"], seniorities: ["director"], domains: ["https://www.example.test"], resultLimit: 10,
  } });
  assert.equal(calls.length, 1, "People Search does not call an enrichment endpoint");
  assert.equal(calls[0].url.pathname, "/api/v1/mixed_people/api_search");
  assert.deepEqual(calls[0].url.searchParams.getAll("person_titles[]"), ["Marketing Director"]);
  assert.deepEqual(calls[0].url.searchParams.getAll("person_seniorities[]"), ["director"]);
  assert.deepEqual(calls[0].url.searchParams.getAll("q_organization_domains_list[]"), ["example.test"]);
  assert.equal(people[0].externalSourceId, "person-42");
  assert.equal(people[0].metadata.apolloPersonId, "person-42");
  assert.equal(people[0].metadata.apolloOrganizationId, "org-8");
  assert.equal(people[0].email, undefined);
  assert.equal(people[0].phone, undefined);
});

test("Apollo bulk enrichment keeps standard, waterfall email, and phone requests explicitly separate", async () => {
  const calls = [];
  const provider = new ApolloProvider({ apiKey: "test", fetchImpl: async (url, init) => {
    calls.push({ url: new URL(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ status: "success", matches: [] }), { status: 200 });
  } });
  const profiles = Array.from({ length: 12 }, (_, index) => ({ apolloPersonId: `person-${index}` }));
  await provider.enrichPeople(profiles, "STANDARD");
  await provider.enrichPeople(profiles.slice(0, 2), "WATERFALL_EMAIL");
  await provider.enrichPeople(profiles.slice(0, 2), "PHONE");
  assert.equal(calls[0].body.details.length, 10, "Apollo bulk requests never exceed ten people");
  assert.equal(calls[0].url.searchParams.get("run_waterfall_email"), null);
  assert.equal(calls[0].url.searchParams.get("reveal_phone_number"), "false");
  assert.equal(calls[1].url.searchParams.get("run_waterfall_email"), "true");
  assert.equal(calls[1].url.searchParams.get("poll_only"), "true");
  assert.equal(calls[2].url.searchParams.get("reveal_phone_number"), "true");
  assert.equal(calls[2].url.searchParams.get("poll_only"), "true");
});

function apolloConfiguration(settings = {}, methods = null) {
  const config = { ...configuration(), id: 8, status: "ACTIVE" };
  config.searchSources.push({ sourceCode: "APOLLO_IO", enabled: true, priority: 2, settings: {
    peopleSearchEnabled: true, standardPeopleEnrichmentEnabled: true,
    minimumFitScoreForStandardEnrichment: 60, dailyCreditLimit: 100, monthlyCreditLimit: 1000, ...settings,
  } });
  if (methods) config.communicationMethods = methods;
  return config;
}

function apolloRepository(config, profiles) {
  const usage = [];
  return {
    usage,
    getAcquisitionConfigurations: async () => [config],
    getApolloProfiles: async ({ pendingOnly } = {}) => profiles.filter((profile) => !pendingOnly || profile.apolloRequestId),
    getApolloUsage: async () => ({ summary: { dailyCreditsConsumed: 0, monthlyCreditsConsumed: 0, dailyEstimatedCredits: 0, monthlyEstimatedCredits: 0 }, requests: usage }),
    saveApolloUsage: async (entry) => { usage.push(entry); return entry; },
    updateApolloProfile: async (update) => {
      const profile = profiles.find((item) => item.prospectId === update.prospectId);
      Object.assign(profile, update);
      if (update.persistEmail) profile.prospectEmail = update.email;
      if (update.persistPhone) profile.prospectPhone = update.phone;
      return profile;
    },
  };
}

test("selective Apollo enrichment applies the fit gate and a usable standard email prevents waterfall", async () => {
  const config = apolloConfiguration({ waterfallEmailEnabled: true, minimumFitScoreForWaterfallEmail: 80 });
  const profiles = [
    { prospectId: 1, apolloPersonId: "high", fitScore: 90, prospectStatus: "DISCOVERED", optedOut: false, standardEnrichmentUsed: false },
    { prospectId: 2, apolloPersonId: "low", fitScore: 59, prospectStatus: "DISCOVERED", optedOut: false, standardEnrichmentUsed: false },
  ];
  const repository = apolloRepository(config, profiles);
  const kinds = [];
  const provider = { apiKey: "test", enrichPeople: async (batch, kind) => {
    kinds.push({ ids: batch.map((item) => item.apolloPersonId), kind });
    return { unique_enriched_records: 1, credits_consumed: 1, matches: [{ id: "high", email: "ana@example.test", email_status: "verified", match_confidence: "high" }] };
  }, pollEnrichment: async () => ({ pending: true }) };
  const service = new AcquisitionService({ repository, aiProviderService: {}, discoveryProviders: new Map([["APOLLO_IO", provider]]) });
  await service.enrichApollo(8);
  assert.deepEqual(kinds, [{ ids: ["high"], kind: "STANDARD" }]);
  assert.equal(profiles[0].prospectEmail, "ana@example.test");
  assert.equal(profiles[1].standardEnrichmentUsed, false, "a prospect below the fit gate is not enriched");
  assert.equal(profiles[0].waterfallEmailUsed, undefined, "standard email stops waterfall email");
});

test("missing standard email starts selective waterfall while disabled phone channels prevent phone enrichment", async () => {
  const config = apolloConfiguration({ waterfallEmailEnabled: true, phoneEnrichmentEnabled: true,
    minimumFitScoreForWaterfallEmail: 80, minimumFitScoreForPhone: 80 });
  config.communicationMethods = config.communicationMethods.map((method) => ({ ...method,
    enabled: method.channel === "EMAIL" || method.channel === "MANUAL_HUMAN_FOLLOW_UP" }));
  const profiles = [{ prospectId: 3, apolloPersonId: "missing", fitScore: 90, prospectStatus: "DISCOVERED", optedOut: false, standardEnrichmentUsed: false }];
  const repository = apolloRepository(config, profiles);
  const kinds = [];
  const provider = { apiKey: "test", enrichPeople: async (_batch, kind) => {
    kinds.push(kind);
    return kind === "STANDARD"
      ? { unique_enriched_records: 1, credits_consumed: 1, matches: [{ id: "missing", match_confidence: "high", email_status: "unavailable" }] }
      : { request_id: "-922337203685477000", waterfall: { status: "processing" } };
  }, pollEnrichment: async () => ({ pending: true }) };
  const service = new AcquisitionService({ repository, aiProviderService: {}, discoveryProviders: new Map([["APOLLO_IO", provider]]) });
  await service.enrichApollo(8);
  assert.deepEqual(kinds, ["STANDARD", "WATERFALL_EMAIL"]);
  assert.equal(profiles[0].apolloRequestId, "-922337203685477000", "signed 64-bit request IDs stay strings");
  assert.equal(profiles[0].phoneEnrichmentUsed, undefined, "phone is not requested when phone channels are disabled");
});

test("Apollo polling correlates people by stable ID and never marks a returned phone as WhatsApp", async () => {
  const config = apolloConfiguration({ phoneEnrichmentEnabled: true }, [
    { channel: "SMS", enabled: true, priority: 1, maximumAttempts: 1 },
    { channel: "WHATSAPP_BUSINESS", enabled: true, priority: 2, maximumAttempts: 1 },
  ]);
  const profiles = [
    { prospectId: 10, apolloPersonId: "person-a", fitScore: 90, prospectStatus: "DISCOVERED", optedOut: false, apolloRequestId: "55", pendingRequestKind: "PHONE", pendingUsageKey: "usage-55", enrichmentStatus: "PENDING" },
    { prospectId: 11, apolloPersonId: "person-b", fitScore: 90, prospectStatus: "DISCOVERED", optedOut: false, apolloRequestId: "55", pendingRequestKind: "PHONE", pendingUsageKey: "usage-55", enrichmentStatus: "PENDING" },
  ];
  const repository = apolloRepository(config, profiles);
  const provider = { apiKey: "test", pollEnrichment: async () => ({ pending: false, body: { webhook_result: { credits_consumed: 8, matches: [
    { id: "person-b", phone_numbers: [{ sanitized_number: "+13055550111", type: "mobile" }], match_confidence: "high" },
    { id: "person-a", phone_numbers: [{ sanitized_number: "+13055550110", type: "mobile" }], match_confidence: "high" },
  ] } } }), enrichPeople: async () => ({ matches: [] }) };
  const service = new AcquisitionService({ repository, aiProviderService: {}, discoveryProviders: new Map([["APOLLO_IO", provider]]) });
  const result = await service.pollApolloEnrichments(config);
  assert.equal(result.completed, 2);
  assert.equal(profiles[0].prospectPhone, "+13055550110");
  assert.equal(profiles[1].prospectPhone, "+13055550111");
  assert.equal(profiles[0].whatsAppNumber, undefined, "Apollo phone never becomes a WhatsApp number");
});

test("Apollo discovery prefers known provider domains and links a matching Prospect instead of duplicating it", async () => {
  const config = { ...configuration({ minimumProspectFitScore: 0, searchSources: [{ sourceCode: "APOLLO_IO", enabled: true, priority: 1,
    settings: { peopleSearchEnabled: true, preferKnownDomains: true } }] }), id: 8 };
  let receivedSettings;
  let coreUpserts = 0;
  let linkedProfile;
  const repository = {
    getAcquisitionConfigurations: async () => [config],
    getAcquisitionDiscoveryCountToday: async () => 0,
    getAcquisitionProspectDomains: async () => ["https://www.known.test/services"],
    saveApolloUsage: async (entry) => entry,
    findApolloProspectMatch: async () => ({ id: 77, inserted: false, companyName: "Known Company" }),
    upsertAcquisitionProspect: async () => { coreUpserts += 1; },
    upsertApolloProfileDiscovery: async (profile) => { linkedProfile = profile; return profile; },
  };
  const provider = new class extends ProspectDiscoveryProvider {
    constructor() { super("APOLLO_IO"); }
    async searchProspects({ settings }) {
      receivedSettings = settings;
      return [{ companyName: "Known Company", contactName: "Ana G", jobTitle: "Owner", website: "https://known.test",
        externalSourceId: "person-known", sourceUrl: "https://linkedin.example/in/ana-g",
        metadata: { apolloPersonId: "person-known", apolloOrganizationId: "org-known", fullName: "Ana G",
          jobTitle: "Owner", companyDomain: "known.test", linkedInUrl: "https://linkedin.example/in/ana-g" } }];
    }
  }();
  const service = new AcquisitionService({ repository, aiProviderService: {}, discoveryProviders: new Map([["APOLLO_IO", provider]]) });
  await service.discover(8);
  assert.deepEqual(receivedSettings.domains, ["known.test"]);
  assert.equal(coreUpserts, 0, "the cross-provider Prospect match is reused");
  assert.equal(linkedProfile.prospectId, 77);
  assert.equal(linkedProfile.apolloPersonId, "person-known");
});

test("Apollo credit limits block paid calls before the provider is invoked", async () => {
  const config = apolloConfiguration({ dailyCreditLimit: 0, monthlyCreditLimit: 0 });
  const profiles = [{ prospectId: 90, apolloPersonId: "blocked", fitScore: 95, prospectStatus: "DISCOVERED", optedOut: false, standardEnrichmentUsed: false }];
  const repository = apolloRepository(config, profiles);
  let calls = 0;
  const provider = { apiKey: "test", enrichPeople: async () => { calls += 1; }, pollEnrichment: async () => ({ pending: true }) };
  const service = new AcquisitionService({ repository, aiProviderService: {}, discoveryProviders: new Map([["APOLLO_IO", provider]]) });
  const result = await service.enrichApollo(8);
  assert.equal(calls, 0);
  assert.equal(result.stages.standard.budgetBlocked, 1);
  assert.equal(profiles[0].enrichmentStatus, "BUDGET_LIMIT_REACHED");
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
    apolloStatus: async (_id, options = {}) => ({ configured: true, connected: Boolean(options.test) }),
    apolloUsage: async () => ({ summary: { dailyCreditsConsumed: 1 }, requests: [] }),
    enrichApollo: async () => ({ stages: { standard: { completed: 1 } } }),
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
  const apolloStatus = await request("/acquisition/providers/apollo/status?configurationId=3");
  assert.equal((await apolloStatus.json()).status.configured, true);
  const apolloTest = await request("/acquisition/providers/apollo/test", { method: "POST", body: JSON.stringify({ configurationId: 3 }) });
  assert.equal((await apolloTest.json()).status.connected, true);
  const apolloUsage = await request("/acquisition/providers/apollo/usage?configurationId=3");
  assert.equal((await apolloUsage.json()).usage.summary.dailyCreditsConsumed, 1);
  const apolloEnrichment = await request("/acquisition/providers/apollo/enrich", { method: "POST", body: JSON.stringify({ configurationId: 3 }) });
  assert.equal((await apolloEnrichment.json()).enrichment.stages.standard.completed, 1);
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

test("Apollo migration adds provider-specific enrichment and usage state without replacing CRM scoring", () => {
  const sql = readFileSync(new URL("../sql/028_apollo_selective_enrichment.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE dbo\.AIAcquisitionApolloProfiles/);
  assert.match(sql, /CREATE TABLE dbo\.AIAcquisitionApolloUsage/);
  assert.match(sql, /UNIQUE \(AIAcquisitionConfigurationId, ApolloPersonId\)/);
  assert.match(sql, /ApolloRequestId NVARCHAR\(64\)/);
  assert.match(sql, /PendingUsageKey/);
  assert.match(sql, /AIAcquisitionProspectContacts/);
  assert.doesNotMatch(sql, /CREATE\s+TABLE\s+dbo\.(?:AIAcquisitionProspects|Leads)\b/i);
  assert.doesNotMatch(sql, /LeadScore_Recalculate|CRMLead_UpsertFromRoutine/);
  assert.doesNotMatch(sql, /WhatsAppNumber\s*=/i, "Apollo phone is never promoted to WhatsApp");
});
