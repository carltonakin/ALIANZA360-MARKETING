import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AcquisitionService,
  ApolloProvider,
  ApolloOrganizationsProvider,
  CommunicationPolicyEngine,
  ProspectDiscoveryProvider,
  AISourceDiscoveryProvider,
  SEARCH_SOURCE_DEFINITIONS,
  createDiscoveryProviders,
  normalizeAcquisitionDecision,
  normalizeAcquisitionInput,
  normalizeProspect,
} from "../social/acquisition.mjs";
import { AIProviderService } from "../social/ai-providers.mjs";
import { AcquisitionSearchService, ACQUISITION_SEARCH_PROVIDERS } from "../social/acquisition-search.mjs";
import { createSocialListenerApp } from "../social/server.mjs";
import { InMemorySocialRepository } from "../social/core.mjs";
import { AI_ACQUISITION_SOURCES } from "../lib/acquisition-ai-sources.mjs";
import { aiDiscoveryCriteria } from "../social/acquisition-ai-discovery.mjs";
import { evidenceText, publicEvidenceAddress, publicEvidenceUrl, robotsAllows } from "../social/acquisition-evidence.mjs";
import { SqlServerRepository } from "../social/sql-server.mjs";

const verifiedBusiness = { companyName: "Example Advisory", website: "https://example.com", industry: "advisory", location: "Miami", email: "office@example.com", phone: "+1 305 555 0100", sourceUrl: "https://example.com/about", description: "growth automation", customerTypeEvidence: "business owners", businessSizeEvidence: "10 employees" };
const publicBusinessPage = "Example Advisory offers advisory in Miami. Contact office@example.com or +1 305 555 0100. Our growth automation team serves business owners with 10 employees.";

function groundedFixture(definition, candidates = [verifiedBusiness], { grounded = true, cited = true } = {}) {
  const answer = `\`\`\`json\n${JSON.stringify({ prospects: candidates })}\n\`\`\``;
  const citations = cited ? [{ type: "url_citation", url: verifiedBusiness.sourceUrl, title: "Example Advisory" }] : [];
  if (definition.id === "chatgpt") return { output: [...(grounded ? [{ type: "web_search_call", status: "completed" }] : []), { content: [{ type: "output_text", text: answer, annotations: citations }] }] };
  if (definition.id === "gemini") return { candidates: [{ content: { parts: [{ text: answer }] }, groundingMetadata: grounded ? { webSearchQueries: ["advisory Miami"], groundingChunks: cited ? [{ web: { uri: verifiedBusiness.sourceUrl } }] : [] } : {} }] };
  return { content: [{ type: "text", text: answer, citations }, ...(grounded ? [{ type: "web_search_tool_result", content: cited ? [{ url: verifiedBusiness.sourceUrl }] : [] }] : [])] };
}

function aiSourceFixture(definition, options = {}) {
  const provider = ACQUISITION_SEARCH_PROVIDERS.find((item) => item.id === (definition.apiProvider || definition.provider));
  return new AISourceDiscoveryProvider(definition, {
    env: { [provider.key]: "fixture-secret", [definition.modelEnv]: "account-search-model", [`ACQUISITION_${provider.id.toUpperCase()}_WEB_SEARCH`]: "true" },
    fetchImpl: async () => Response.json(groundedFixture(definition)),
    evidenceReader: async (url) => ({ url, text: publicBusinessPage }),
    sleep: async () => {}, ...options,
  });
}

test("AI discovery sources extend the existing defaults and persist independent choices with old configurations intact", async () => {
  const defaults = configuration({ searchSources: undefined });
  for (const definition of AI_ACQUISITION_SOURCES) {
    assert.equal(SEARCH_SOURCE_DEFINITIONS.find((item) => item.code === definition.code).id, definition.id);
    assert.equal(defaults.searchSources.find((item) => item.sourceCode === definition.code).enabled, false);
    assert.ok(createDiscoveryProviders({ env: {} }).has(definition.code));
  }
  const old = configuration();
  assert.deepEqual(old.searchSources.map((source) => source.sourceCode), ["CSV_IMPORT"]);
  let saved;
  const repository = { saveAcquisitionConfiguration: async (input) => { saved = structuredClone(input); return saved; }, getAcquisitionConfigurations: async () => saved ? [saved] : [] };
  const service = new AcquisitionService({ repository, env: {} });
  const input = configuration({ id: null, searchSources: AI_ACQUISITION_SOURCES.map((item, index) => ({ sourceCode: item.id, enabled: index !== 1, priority: index + 1, settings: {} })) });
  await service.saveConfiguration(input);
  assert.deepEqual((await service.configurations())[0].searchSources.map((source) => [source.sourceCode, source.enabled]), [["CHATGPT", true], ["GEMINI", false], ["CLAUDE", true]]);
});

for (const definition of AI_ACQUISITION_SOURCES) {
  test(`${definition.name} uses existing criteria, verifies evidence, excludes fabricated contacts, and normalizes provenance`, async () => {
    let payload;
    const config = { ...configuration({ targetCustomerType: "business owners", businessSize: "10 employees" }), id: 8,
      privateContacts: [{ email: "private@crm.test" }], objective: "PRIVATE_OBJECTIVE" };
    const provider = aiSourceFixture(definition, { fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return Response.json(groundedFixture(definition, [{ ...verifiedBusiness, email: "guessed@example.com", phone: "+1 999 999 9999", fitScore: 100, consentStatus: "GRANTED", whatsAppNumber: "+1 999 999 9999" }]));
    } });
    const found = await provider.searchProspects({ configuration: config, settings: {}, limit: 2 });
    assert.equal(found.length, 1);
    const prompt = JSON.stringify(payload);
    assert.match(prompt, /Miami/); assert.match(prompt, /advisory/); assert.match(prompt, /growth, automation/);
    assert.match(prompt, /business owners/); assert.match(prompt, /10 employees/);
    assert.equal(prompt.includes("private@crm.test"), false); assert.equal(prompt.includes("PRIVATE_OBJECTIVE"), false);
    assert.equal(payload.model || "account-search-model", "account-search-model");
    const normalized = provider.normalizeProspect(found[0], { configuration: config });
    assert.equal(normalized.source, definition.code);
    assert.equal(normalized.email, ""); assert.equal(normalized.phone, ""); assert.equal(normalized.whatsAppNumber, "");
    assert.equal(normalized.consentStatus, "");
    assert.equal(normalized.metadata.discoveries[0].source, definition.code);
    assert.ok(normalized.metadata.evidenceVerifiedAt);
    assert.equal(normalized.contacts.find((item) => item.type === "WEBSITE").verified, true);
  });
}

test("AI discovery fails closed on unsupported criteria, missing credentials, disabled search, absent grounding, and absent citations", async () => {
  const definition = AI_ACQUISITION_SOURCES[0];
  const config = { ...configuration(), id: 8 };
  assert.throws(() => aiDiscoveryCriteria(config, { radius: 50 }, 5), /cannot enforce.*radius/);
  assert.throws(() => aiDiscoveryCriteria(config, { resultLimit: "invalid" }, 5), /Invalid/);
  await assert.rejects(aiSourceFixture(definition, { env: {} }).searchProspects({ configuration: config }), /OPENAI_API_KEY/);
  await assert.rejects(aiSourceFixture(definition, { env: { OPENAI_API_KEY: "test", OPENAI_SEARCH_MODEL: "configured" } }).searchProspects({ configuration: config }), /WEB_SEARCH=true/);
  for (const fixtureOptions of [{ grounded: false }, { cited: false }]) {
    const provider = aiSourceFixture(definition, { fetchImpl: async () => Response.json(groundedFixture(definition, undefined, fixtureOptions)) });
    await assert.rejects(provider.searchProspects({ configuration: config }), /evidence|citations/);
  }
  const empty = aiSourceFixture(definition, { fetchImpl: async () => Response.json(groundedFixture(definition, [], { cited: false })) });
  assert.equal((await empty.searchProspects({ configuration: config })).length, 0);
});

test("AI discovery rejects unsupported/unverifiable targets and unsafe evidence and bounds retries", async () => {
  const definition = AI_ACQUISITION_SOURCES[0];
  const config = { ...configuration(), id: 8 };
  for (const overrides of [{ targetLocation: "Bogota" }, { targetIndustry: "retail" }, { businessSize: "500 employees" }, { targetCustomerType: "hospitals" }]) {
    const rows = await aiSourceFixture(definition).searchProspects({ configuration: { ...config, ...overrides } });
    assert.equal(rows.length, 0); assert.equal(rows.diagnostics.rejectedUnverified, 1);
  }
  const invalid = aiSourceFixture(definition, { fetchImpl: async () => Response.json(groundedFixture(definition, [{ ...verifiedBusiness, sourceUrl: "https://uncited.test/about" }])), evidenceReader: async () => { throw new Error("must not fetch"); } });
  assert.equal((await invalid.searchProspects({ configuration: config })).length, 0);
  let attempts = 0;
  const unavailable = aiSourceFixture(definition, { fetchImpl: async () => { attempts += 1; return Response.json({}, { status: 429 }); } });
  await assert.rejects(unavailable.searchProspects({ configuration: config }), /rate limited/);
  assert.equal(attempts, 3);
  attempts = 0;
  const unsupported = aiSourceFixture(definition, { fetchImpl: async () => { attempts += 1; return Response.json({}, { status: 400 }); } });
  await assert.rejects(unsupported.searchProspects({ configuration: config }), /model or search tool/);
  assert.equal(attempts, 1);
});

test("multiple AI sources use the same acquisition pipeline, daily cap, deduplication, and merged evidence", async () => {
  const config = { ...configuration({ minimumProspectFitScore: 0, dailyProspectLimit: 3,
    searchSources: [...AI_ACQUISITION_SOURCES.map((source, index) => ({ sourceCode: source.code, enabled: true, priority: index + 1 })), { sourceCode: "CSV_IMPORT", enabled: true, priority: 4 }] }), id: 8 };
  const records = new Map();
  const repository = { getAcquisitionConfigurations: async () => [config], getAcquisitionDiscoveryCountToday: async () => 0,
    findAcquisitionProspectByWebsite: async () => [...records.values()][0] || null,
    upsertAcquisitionProspect: async (prospect) => { const inserted = !records.has(prospect.identityKey); records.set(prospect.identityKey, prospect); return { ...prospect, inserted }; } };
  const providers = new Map(AI_ACQUISITION_SOURCES.map((definition) => [definition.code, aiSourceFixture(definition)]));
  providers.set("CSV_IMPORT", { ...new ProspectDiscoveryProvider("CSV_IMPORT"), searchProspects: async () => { throw new Error("An unrelated source failed."); } });
  const discovery = await new AcquisitionService({ repository, discoveryProviders: providers }).discover(8);
  assert.equal(records.size, 1);
  assert.equal(discovery.remainingDailyLimit, 2);
  assert.deepEqual(discovery.results.slice(0, 3).map((item) => item.discovered), [1, 0, 0]);
  assert.deepEqual([...records.values()][0].metadata.discoveries.map((item) => item.source), ["CHATGPT", "GEMINI", "CLAUDE"]);
  assert.match(discovery.results[3].error, /unrelated source/);
});

test("AI evidence lookup is scoped and parameterized and public fetch guards reject private hosts", async () => {
  let query, parameters = {};
  const repository = new SqlServerRepository({ BigInt: "bigint", NVarChar: () => "text" }, { request: () => ({ input(name, _type, value) { parameters[name] = value; return this; }, async query(sql) { query = sql; return { recordset: [{ IdentityKey: "existing-identity", MetadataJson: "{}" }] }; } }) });
  assert.equal((await repository.findAcquisitionProspectByWebsite(8, "example.com")).identityKey, "existing-identity");
  assert.deepEqual(parameters, { AIAcquisitionConfigurationId: 8, Domain: "example.com" });
  assert.match(query, /AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId/);
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.0.2", "::1"]) assert.equal(publicEvidenceAddress(ip), false);
  assert.equal(publicEvidenceAddress("8.8.8.8"), true);
  for (const url of ["http://example.com", "https://127.0.0.1", "https://localhost", "https://user:secret@example.com", "https://example.com:8080"]) assert.equal(publicEvidenceUrl(url), null);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /private\nAllow: /private/public", "/private/secret"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /private\nAllow: /private/public", "/private/public"), true);
  assert.equal(evidenceText("<script>fake@example.com</script><p>Real &amp; Public</p>"), "Real & Public");
});

test("AI Search registry, validation, and missing configuration", async () => {
  assert.deepEqual(ACQUISITION_SEARCH_PROVIDERS.map(({ id, label }) => [id, label]), [["openai", "ChatGPT"], ["google", "Gemini"], ["anthropic", "Claude"]]);
  const service = new AcquisitionSearchService({ env: {} });
  await assert.rejects(service.search({ provider: "other", query: "test" }), /Select ChatGPT/);
  await assert.rejects(service.search({ provider: "openai", query: " " }), /search query/);
  await assert.rejects(service.search({ provider: "openai", query: "a".repeat(4001) }), /4,000/);
  await assert.rejects(service.search({ provider: "openai", query: "test" }), /OPENAI_API_KEY/);
});

for (const provider of ACQUISITION_SEARCH_PROVIDERS) {
  test(`AI Search routes ${provider.id}, normalizes citations, and keeps credentials private`, async () => {
    const fixtures = {
      openai: { output: [{ type: "web_search_call", status: "completed" }, { content: [{ type: "output_text", text: "Answer", annotations: [{ type: "url_citation", url: "https://example.com", title: "Source" }] }] }] },
      google: { candidates: [{ content: { parts: [{ text: "Answer" }] }, groundingMetadata: { webSearchQueries: ["test"], groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }] } }] },
      anthropic: { content: [{ type: "text", text: "Answer", citations: [{ url: "https://example.com", title: "Source" }] }, { type: "web_search_tool_result", content: [{ url: "https://example.com", title: "Source" }] }] },
    };
    let request;
    const service = new AcquisitionSearchService({ env: { [provider.key]: "secret-fixture", [provider.model]: "configured-model", [`ACQUISITION_${provider.id.toUpperCase()}_WEB_SEARCH`]: "true" }, fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return Response.json(fixtures[provider.id]);
    } });
    const result = await service.search({ provider: provider.id, query: "Find prospects" });
    assert.equal(result.provider, provider.id);
    assert.equal(result.answer, "Answer");
    assert.equal(result.sources.length, 1);
    assert.equal(result.webSearchUsed, true);
    assert.equal(JSON.stringify(result).includes("secret-fixture"), false);
    assert.match(request.url, provider.id === "openai" ? /api.openai.com\/v1\/responses/ : provider.id === "google" ? /generativelanguage.googleapis.com/ : /api.anthropic.com\/v1\/messages/);
    assert.equal(request.body.model || "configured-model", "configured-model");
    assert.ok(request.body.tools);
  });
}

test("AI Search reuses encrypted settings, labels generation, and handles failures safely", async () => {
  const repository = { getAiProviderConfigurations: async () => [{ providerCode: "OPENAI", enabled: true, model: "saved-model", secrets: { apiKey: "stored-secret" } }] };
  const service = new AcquisitionSearchService({ repository, env: {}, fetchImpl: async (_url, options) => {
    assert.equal(options.headers.authorization, "Bearer stored-secret");
    assert.equal(JSON.parse(options.body).tools, undefined);
    return Response.json({ output: [{ content: [{ type: "output_text", text: "Generated", annotations: [{ type: "url_citation", url: "javascript:alert(1)" }] }] }] });
  } });
  const result = await service.search({ provider: "openai", query: "test" });
  assert.equal(result.webSearchUsed, false);
  assert.match(result.notice, /live web search was not used/);
  assert.deepEqual(result.sources, []);
  for (const status of [401, 429, 500]) {
    service.fetchImpl = async () => Response.json({ error: { message: "stored-secret" } }, { status });
    await assert.rejects(service.search({ provider: "openai", query: "test" }), (error) => !error.message.includes("stored-secret") && error.statusCode === (status === 401 ? 409 : status === 429 ? 429 : 502));
  }
  service.fetchImpl = async () => { throw new DOMException("stored-secret", "TimeoutError"); };
  await assert.rejects(service.search({ provider: "openai", query: "test" }), /timed out/);
});

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

test("Apollo connection testing reports endpoint authorization separately from valid credentials", async () => {
  const calls = [];
  const provider = new ApolloProvider({
    apiKey: "valid-but-restricted",
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      calls.push(parsed.pathname);
      if (parsed.pathname === "/api/v1/users/api_profile") {
        return new Response(JSON.stringify({ user: { email: "owner@example.test" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Your team is not permitted to call this endpoint." }), { status: 403 });
    },
  });
  const status = await provider.testConnection({ settings: { peopleSearchEnabled: true } });
  assert.equal(status.connected, true);
  assert.equal(status.searchCapability, "PEOPLE_SEARCH");
  assert.equal(status.searchAccessAuthorized, false);
  assert.match(status.searchAccessMessage, /not permitted/i);
  assert.deepEqual(calls, ["/api/v1/users/api_profile", "/api/v1/mixed_people/api_search"]);
});

test("Apollo access denial opens a persistent circuit breaker until a successful manual access check", async () => {
  const config = apolloConfiguration({ peopleSearchEnabled: true });
  const usage = [];
  let permitSearch = false;
  let searchCalls = 0;
  let sequence = 0;
  const repository = {
    getAcquisitionConfigurations: async () => [config],
    getAcquisitionDiscoveryCountToday: async () => 0,
    getAcquisitionProspectDomains: async () => [],
    getApolloUsage: async () => ({ summary: {}, requests: usage }),
    saveApolloUsage: async (entry) => {
      const timestamp = new Date(Date.UTC(2026, 8, 25, 0, 0, sequence++)).toISOString();
      const existing = usage.find((item) => item.requestKey === entry.requestKey);
      if (existing) Object.assign(existing, entry, { updatedAt: timestamp });
      else usage.push({ id: sequence, ...entry, createdAt: timestamp, updatedAt: timestamp });
      return existing || usage.at(-1);
    },
  };
  const provider = new ApolloProvider({ apiKey: "test", fetchImpl: async (url) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/users/api_profile") {
      return new Response(JSON.stringify({ user: { email: "owner@example.test" } }), { status: 200 });
    }
    searchCalls += 1;
    return permitSearch
      ? new Response(JSON.stringify({ people: [] }), { status: 200 })
      : new Response(JSON.stringify({ error: "Your team is not permitted to call this endpoint." }), { status: 403 });
  } });
  const service = new AcquisitionService({ repository, aiProviderService: {}, discoveryProviders: new Map([["APOLLO_IO", provider]]) });

  const first = await service.discover(8);
  assert.match(first.results.find((result) => result.sourceCode === "APOLLO_IO").error, /not permitted/i);
  assert.equal(usage.find((request) => request.requestKind === "PEOPLE_SEARCH").status, "ACCESS_DENIED");

  const second = await service.discover(8);
  assert.equal(second.results.find((result) => result.sourceCode === "APOLLO_IO").skipped, true);
  assert.equal(searchCalls, 1, "scheduled discovery does not retry a permanently denied endpoint");

  permitSearch = true;
  const retest = await service.apolloStatus(8, { test: true });
  assert.equal(retest.searchAccessAuthorized, true);
  await service.discover(8);
  assert.equal(searchCalls, 3, "one manual access check and the later discovery call are allowed after access is granted");
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
  const searchProviders = await request("/acquisition/ai-search/providers");
  assert.deepEqual((await searchProviders.json()).providers.map((item) => item.id), ["openai", "google", "anthropic"]);
  const invalidSearch = await request("/acquisition/ai-search", { method: "POST", body: JSON.stringify({ provider: "invalid", query: "test" }) });
  assert.equal(invalidSearch.status, 400);
  const unconfiguredSearch = await request("/acquisition/ai-search", { method: "POST", body: JSON.stringify({ provider: "google", query: "test" }) });
  assert.equal(unconfiguredSearch.status, 409);
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
  assert.match(sql, /AIAcquisitionApolloUsage_Reserve/);
  assert.match(sql, /WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.match(sql, /AIAcquisitionProspectContacts/);
  assert.doesNotMatch(sql, /CREATE\s+TABLE\s+dbo\.(?:AIAcquisitionProspects|Leads)\b/i);
  assert.doesNotMatch(sql, /LeadScore_Recalculate|CRMLead_UpsertFromRoutine/);
  assert.doesNotMatch(sql, /WhatsAppNumber\s*=/i, "Apollo phone is never promoted to WhatsApp");
});

test("Apollo compliance migration classifies endpoint denial and keeps it separate from rate limits", () => {
  const sql = readFileSync(new URL("../sql/029_apollo_access_compliance.sql", import.meta.url), "utf8");
  assert.match(sql, /ACCESS_DENIED/);
  assert.match(sql, /not permitted/);
  assert.match(sql, /AccessDeniedRequests/);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.AIAcquisitionApolloUsage_Get/);
  assert.doesNotMatch(sql, /LeadScore_Recalculate|WhatsAppNumber\s*=/i);
});
