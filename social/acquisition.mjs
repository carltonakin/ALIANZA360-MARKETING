import { createHash, randomUUID } from "node:crypto";

export const ACQUISITION_STATUSES = Object.freeze([
  "DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "STOPPED", "FAILED",
]);

export const PROSPECT_STATUSES = Object.freeze([
  "DISCOVERED", "ENRICHING", "CONTACTABLE", "CONTACTING", "CONTACTED", "ENGAGED",
  "QUALIFYING", "QUALIFIED", "CONVERSION_READY", "HUMAN_HANDOFF", "CONVERTED_TO_LEAD",
  "NOT_INTERESTED", "LOST", "DO_NOT_CONTACT", "FAILED",
]);

export const SEARCH_SOURCE_DEFINITIONS = Object.freeze([
  { code: "GOOGLE_PLACES", name: "Google Places / business search", implemented: true },
  { code: "APOLLO_IO", name: "Apollo.io decision-maker discovery", implemented: true },
  { code: "EXISTING_CRM", name: "Existing Next2TheTop CRM data", implemented: true },
  { code: "INACTIVE_LEADS", name: "Existing cold/inactive Leads", implemented: true },
  { code: "LANDING_PAGE", name: "Landing Page registrations/activity", implemented: true },
  { code: "INSTAGRAM_INBOUND", name: "Instagram inbound activity", implemented: true },
  { code: "FACEBOOK_INBOUND", name: "Facebook inbound activity", implemented: true },
  { code: "WEBSITE_FORMS", name: "Website forms", implemented: false },
  { code: "CSV_IMPORT", name: "CSV prospect import", implemented: true },
  { code: "BUSINESS_DIRECTORY", name: "Approved business directories", implemented: false },
  { code: "PARTNER_API", name: "Partner/API data sources", implemented: false },
]);

export const COMMUNICATION_CHANNELS = Object.freeze([
  "EMAIL", "WHATSAPP_BUSINESS", "INSTAGRAM", "FACEBOOK", "SMS", "MANUAL_HUMAN_FOLLOW_UP",
]);

export const ACQUISITION_DECISION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "intent", "confidence", "next_action", "response", "qualification_field",
    "extracted_information", "request_human",
  ],
  properties: {
    intent: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    next_action: { type: "string" },
    response: { type: "string" },
    qualification_field: { type: "string" },
    extracted_information: {
      type: "object",
      additionalProperties: false,
      required: ["ContactName", "BusinessName", "Industry", "Location", "ProductOrServiceInterest", "BusinessGoal", "Timeline", "Email", "WhatsAppNumber", "Phone", "SocialAccounts"],
      properties: Object.fromEntries([
        "ContactName", "BusinessName", "Industry", "Location", "ProductOrServiceInterest",
        "BusinessGoal", "Timeline", "Email", "WhatsAppNumber", "Phone", "SocialAccounts",
      ].map((field) => [field, { type: "string" }])),
    },
    request_human: { type: "boolean" },
  },
});

function clean(value, maximum = 16_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function objectValue(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function optionalPositiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function isoDate(value) {
  const candidate = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function validationError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function defaultSources() {
  return SEARCH_SOURCE_DEFINITIONS.map((source, index) => ({
    sourceCode: source.code,
    enabled: source.code === "EXISTING_CRM" || source.code === "INACTIVE_LEADS",
    priority: index + 1,
    settings: {},
  }));
}

function defaultCommunicationMethods() {
  return COMMUNICATION_CHANNELS.map((channel, index) => ({
    channel,
    enabled: channel === "EMAIL" || channel === "MANUAL_HUMAN_FOLLOW_UP",
    priority: index + 1,
    maximumAttempts: channel === "MANUAL_HUMAN_FOLLOW_UP" ? 1 : 3,
    retryDelayMinutes: 1440,
    delayBeforeNextChannelMinutes: 1440,
    stopOnResponse: true,
    allowSimultaneous: false,
  }));
}

export function normalizeAcquisitionInput(value, { existingStatus = "DRAFT" } = {}) {
  const input = objectValue(value);
  const acquisitionName = clean(input.acquisitionName || input.name, 255);
  const objective = clean(input.objective, 2000);
  const productOrService = clean(input.productOrService, 1000);
  if (!acquisitionName) throw validationError("Acquisition name is required.");
  if (!objective) throw validationError("Acquisition objective is required.");
  if (!productOrService) throw validationError("A product or service is required.");

  const aiProviderId = optionalPositiveId(input.aiProviderId);
  if (!aiProviderId) throw validationError("Select an existing AI provider.");
  const fallbackAIProviderId = optionalPositiveId(input.fallbackAIProviderId || input.fallbackAiProviderId);
  if (fallbackAIProviderId && fallbackAIProviderId === aiProviderId) {
    throw validationError("Fallback AI provider must differ from the primary provider.");
  }
  const startDate = isoDate(input.startDate);
  const endDate = isoDate(input.endDate);
  if (startDate && endDate && endDate < startDate) throw validationError("End date must be on or after start date.");

  const knownSources = new Set(SEARCH_SOURCE_DEFINITIONS.map((item) => item.code));
  const suppliedSources = arrayValue(input.searchSources);
  const sources = (suppliedSources.length ? suppliedSources : defaultSources()).map((item, index) => {
    const source = typeof item === "string" ? { sourceCode: item } : objectValue(item);
    const sourceCode = clean(source.sourceCode || source.code, 64).toUpperCase();
    if (!knownSources.has(sourceCode)) throw validationError(`Unsupported search source: ${sourceCode || "empty"}.`);
    return {
      sourceCode,
      enabled: Boolean(source.enabled),
      priority: boundedInteger(source.priority, index + 1, 1, 100),
      settings: objectValue(source.settings),
    };
  });
  if (new Set(sources.map((source) => source.sourceCode)).size !== sources.length) {
    throw validationError("Search sources must not be repeated.");
  }

  const knownChannels = new Set(COMMUNICATION_CHANNELS);
  const suppliedMethods = arrayValue(input.communicationMethods);
  const communicationMethods = (suppliedMethods.length ? suppliedMethods : defaultCommunicationMethods()).map((item, index) => {
    const method = typeof item === "string" ? { channel: item } : objectValue(item);
    const channel = clean(method.channel || method.method, 64).toUpperCase();
    if (!knownChannels.has(channel)) throw validationError(`Unsupported communication channel: ${channel || "empty"}.`);
    return {
      channel,
      enabled: Boolean(method.enabled),
      priority: boundedInteger(method.priority, index + 1, 1, 100),
      maximumAttempts: boundedInteger(method.maximumAttempts, 3, 1, 20),
      retryDelayMinutes: boundedInteger(method.retryDelayMinutes ?? method.retrySettings, 1440, 1, 100_800),
      delayBeforeNextChannelMinutes: boundedInteger(method.delayBeforeNextChannelMinutes ?? method.delayBeforeNextChannel, 1440, 0, 100_800),
      stopOnResponse: method.stopOnResponse !== false,
      allowSimultaneous: Boolean(method.allowSimultaneous),
    };
  });
  if (new Set(communicationMethods.map((method) => method.channel)).size !== communicationMethods.length) {
    throw validationError("Communication channels must not be repeated.");
  }

  return {
    id: optionalPositiveId(input.id || input.acquisitionConfigurationId),
    acquisitionName,
    objective,
    companyProfileId: optionalPositiveId(input.companyProfileId) || 1,
    productOrService,
    targetIndustry: clean(input.targetIndustry, 500),
    targetCustomerType: clean(input.targetCustomerType, 500),
    targetLocation: clean(input.targetLocation, 500),
    keywords: clean(input.keywords, 2000),
    businessSize: clean(input.businessSize, 255),
    startDate,
    endDate,
    dailyProspectLimit: boundedInteger(input.dailyProspectLimit, 50, 1, 10_000),
    automaticOutreachEnabled: input.automaticOutreachEnabled === true,
    aiProviderId,
    fallbackAIProviderId,
    minimumProspectFitScore: boundedInteger(input.minimumProspectFitScore, 50, 0, 100),
    qualificationQuestions: arrayValue(input.qualificationQuestions).map((item) => clean(item, 1000)).filter(Boolean).slice(0, 50),
    landingPageOrCTA: clean(input.landingPageOrCTA, 2048),
    humanHandoffRules: {
      minimumLeadScore: boundedInteger(input.humanHandoffRules?.minimumLeadScore, 80, 0, 100),
      minimumAIConfidence: Math.max(0, Math.min(1, Number(input.humanHandoffRules?.minimumAIConfidence ?? 0.65))),
      onHumanRequest: input.humanHandoffRules?.onHumanRequest !== false,
      onPricingNegotiation: input.humanHandoffRules?.onPricingNegotiation !== false,
      onContractDiscussion: input.humanHandoffRules?.onContractDiscussion !== false,
      onPaymentIssue: input.humanHandoffRules?.onPaymentIssue !== false,
    },
    followUpRules: {
      enabled: input.followUpRules?.enabled !== false,
      maximumFollowUps: boundedInteger(input.followUpRules?.maximumFollowUps, 3, 0, 20),
      delayBetweenAttemptsMinutes: boundedInteger(input.followUpRules?.delayBetweenAttemptsMinutes, 1440, 1, 100_800),
      channelEscalationEnabled: input.followUpRules?.channelEscalationEnabled !== false,
      stopOnResponse: input.followUpRules?.stopOnResponse !== false,
      stopOnOptOut: input.followUpRules?.stopOnOptOut !== false,
      stopOnDoNotContact: input.followUpRules?.stopOnDoNotContact !== false,
    },
    conversionCriteria: {
      requireEngagement: input.conversionCriteria?.requireEngagement !== false,
      allowLandingRegistration: input.conversionCriteria?.allowLandingRegistration !== false,
      minimumFitScore: boundedInteger(input.conversionCriteria?.minimumFitScore, 0, 0, 100),
    },
    status: ACQUISITION_STATUSES.includes(clean(existingStatus, 32).toUpperCase())
      ? clean(existingStatus, 32).toUpperCase()
      : "DRAFT",
    searchSources: sources,
    communicationMethods,
  };
}

function normalizedHandle(value) {
  return clean(value, 500).replace(/^@/, "");
}

function normalizedDomain(value) {
  const candidate = clean(value, 2048);
  if (!candidate) return "";
  try { return new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return candidate.toLowerCase().replace(/^www\./, "").replace(/\/$/, ""); }
}

function contactRows(raw, sourceCode) {
  const candidates = [
    ["EMAIL", raw.email || raw.businessEmail],
    ["PHONE", raw.phone || raw.businessPhone],
    ["WHATSAPP_BUSINESS", raw.whatsAppNumber || raw.whatsapp || raw.whatsAppBusinessNumber],
    ["INSTAGRAM", raw.instagram || raw.instagramBusinessAccount],
    ["FACEBOOK", raw.facebook || raw.facebookBusinessPage],
    ["X", raw.x],
    ["WEBSITE", raw.website],
  ];
  const provenance = objectValue(raw.contactProvenance);
  return candidates.map(([type, value]) => ({
    type,
    value: ["INSTAGRAM", "FACEBOOK", "X"].includes(type) ? normalizedHandle(value) : clean(value, 2048),
    source: clean(provenance[type]?.source || provenance[type] || sourceCode, 255),
    sourceUrl: clean(provenance[type]?.sourceUrl || raw.sourceUrl, 2048),
    verified: Boolean(provenance[type]?.verified),
  })).filter((contact) => contact.value);
}

function prospectIdentity(raw, sourceCode) {
  const external = clean(raw.externalSourceId || raw.externalId || raw.placeId, 255);
  if (external) return createHash("sha256").update(`${sourceCode}:${external.toLowerCase()}`).digest("hex");
  const identity = [
    clean(raw.companyName || raw.name, 255).toLowerCase(), normalizedDomain(raw.website),
    clean(raw.email || raw.businessEmail, 320).toLowerCase(), clean(raw.phone || raw.businessPhone, 80).replace(/\D/g, ""),
    clean(raw.location || raw.address, 500).toLowerCase(),
  ].filter(Boolean).join("|");
  return createHash("sha256").update(identity || JSON.stringify(raw)).digest("hex");
}

export function calculateProspectFit(raw, configuration) {
  const haystack = [raw.companyName, raw.contactName, raw.firstName, raw.lastName, raw.jobTitle, raw.title,
    raw.seniority, raw.industry, raw.location, raw.description, raw.categories, raw.website, raw.companyDomain]
    .flat().map((item) => clean(item, 2000).toLowerCase()).join(" ");
  const criteria = [configuration.targetIndustry, configuration.targetLocation, configuration.targetCustomerType,
    configuration.businessSize, ...clean(configuration.keywords, 2000).split(/[,\n]/)]
    .map((item) => clean(item, 255).toLowerCase()).filter(Boolean);
  const matched = criteria.filter((item) => haystack.includes(item));
  const knownContactBonus = contactRows(raw, clean(raw.source || "DISCOVERY", 64)).some((contact) => contact.type !== "WEBSITE") ? 20 : 0;
  const base = criteria.length ? Math.round((matched.length / criteria.length) * 70) : 50;
  const explicitFit = raw.fitScore === undefined || raw.fitScore === null || raw.fitScore === "" ? NaN : Number(raw.fitScore);
  const fitScore = Math.max(0, Math.min(100, Number.isFinite(explicitFit) ? explicitFit : base + knownContactBonus));
  return {
    fitScore,
    fitReason: clean(raw.fitReason, 1000) || (matched.length
      ? `Matched ${matched.length} configured target signal${matched.length === 1 ? "" : "s"}: ${matched.join(", ")}.`
      : "Fit is based on the available business profile and contactability."),
  };
}

export function normalizeProspect(rawValue, { sourceCode, configuration }) {
  const raw = objectValue(rawValue);
  const companyName = clean(raw.companyName || raw.name, 255);
  if (!companyName) throw validationError("A discovered prospect must include a company name.");
  const source = clean(sourceCode || raw.source, 64).toUpperCase();
  const contacts = contactRows(raw, source);
  const fit = calculateProspectFit(raw, configuration);
  const consentStatus = clean(raw.consentStatus, 32).toUpperCase();
  const optedOut = [true, 1, "1", "true", "yes"].includes(typeof raw.optedOut === "string" ? raw.optedOut.toLowerCase() : raw.optedOut) ||
    ["DENIED", "REVOKED", "OPTED_OUT"].includes(consentStatus) ||
    ["DO_NOT_CONTACT", "DO NOT CONTACT"].includes(clean(raw.status, 32).toUpperCase());
  return {
    acquisitionConfigurationId: Number(configuration.id),
    identityKey: prospectIdentity(raw, source),
    companyName,
    contactName: clean(raw.contactName, 255),
    industry: clean(raw.industry || arrayValue(raw.categories).join(", "), 500),
    location: clean(raw.location || raw.address, 500),
    website: clean(raw.website, 2048),
    email: clean(raw.email || raw.businessEmail, 320),
    phone: clean(raw.phone || raw.businessPhone, 80),
    whatsAppNumber: clean(raw.whatsAppNumber || raw.whatsapp || raw.whatsAppBusinessNumber, 80),
    instagram: normalizedHandle(raw.instagram || raw.instagramBusinessAccount),
    facebook: normalizedHandle(raw.facebook || raw.facebookBusinessPage),
    x: normalizedHandle(raw.x),
    source,
    externalSourceId: clean(raw.externalSourceId || raw.externalId || raw.placeId, 255),
    sourceUrl: clean(raw.sourceUrl, 2048),
    fitScore: fit.fitScore,
    fitReason: fit.fitReason,
    status: optedOut ? "DO_NOT_CONTACT" : contacts.some((contact) => contact.type !== "WEBSITE") ? "CONTACTABLE" : "DISCOVERED",
    consentStatus,
    optedOut,
    contacts,
    metadata: objectValue(raw.metadata),
  };
}

export class ProspectDiscoveryProvider {
  constructor(code) { this.code = code; }
  async searchProspects() { return []; }
  async getProspectDetails(prospect) { return prospect; }
  async enrichProspect(prospect) { return prospect; }
  normalizeProspect(prospect, context) { return normalizeProspect(prospect, { ...context, sourceCode: this.code }); }
  validateProspect(prospect) { return Boolean(prospect?.companyName && prospect?.identityKey); }
}

export class GooglePlacesProvider extends ProspectDiscoveryProvider {
  constructor({ apiKey, fetchImpl = globalThis.fetch } = {}) {
    super("GOOGLE_PLACES");
    this.apiKey = clean(apiKey, 10_000);
    this.fetchImpl = fetchImpl;
  }

  async searchProspects({ configuration, settings = {} }) {
    if (!this.apiKey) throw validationError("Google Places discovery is enabled but GOOGLE_PLACES_API_KEY is not configured.", 409);
    const textQuery = clean(settings.searchTerms || [settings.industryOrCategory || configuration.targetIndustry,
      settings.keywords || configuration.keywords, settings.location || configuration.targetLocation].filter(Boolean).join(" "), 1000);
    if (!textQuery) throw validationError("Google Places requires search terms, an industry, keywords, or a location.");
    const response = await this.fetchImpl("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
        "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.primaryType,places.types,places.googleMapsUri",
      },
      body: JSON.stringify({ textQuery, pageSize: boundedInteger(settings.resultLimit, configuration.dailyProspectLimit, 1, 20) }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw validationError(clean(body?.error?.message, 1000) || `Google Places returned HTTP ${response.status}.`, response.status);
    return arrayValue(body.places).map((place) => ({
      companyName: clean(place?.displayName?.text || place?.displayName, 255),
      location: clean(place?.formattedAddress, 500),
      website: clean(place?.websiteUri, 2048),
      phone: clean(place?.internationalPhoneNumber || place?.nationalPhoneNumber, 80),
      industry: clean(place?.primaryType || arrayValue(place?.types).join(", "), 500),
      externalSourceId: clean(place?.id, 255),
      sourceUrl: clean(place?.googleMapsUri, 2048),
      metadata: { placeTypes: arrayValue(place?.types) },
      contactProvenance: {
        PHONE: { source: "GOOGLE_PLACES", sourceUrl: place?.googleMapsUri, verified: false },
        WEBSITE: { source: "GOOGLE_PLACES", sourceUrl: place?.googleMapsUri, verified: false },
      },
    }));
  }
}

function sourceSettingList(value, fallback = []) {
  const supplied = Array.isArray(value) ? value : value ? String(value).split(/[;\n]/) : fallback;
  return [...new Set(supplied.map((item) => clean(item, 500)).filter(Boolean))];
}

function apolloWebsite(organization) {
  const website = clean(organization?.website_url, 2048);
  if (website) return website;
  const domain = clean(organization?.primary_domain, 500).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  return domain ? `https://${domain}` : "";
}

const APOLLO_DEFAULT_TITLES = Object.freeze([
  "Owner", "Founder", "Co-Founder", "CEO", "President", "Managing Director",
  "Marketing Director", "Marketing Manager", "Business Development Director",
]);

const APOLLO_DEFAULT_SENIORITIES = Object.freeze([
  "owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager",
]);

function apolloHeaders(apiKey) {
  return {
    accept: "application/json",
    "cache-control": "no-cache",
    "content-type": "application/json",
    "x-api-key": apiKey,
  };
}

function apolloError(body, responseText, status) {
  return clean(body?.error_details?.message || body?.error_message || body?.message || body?.error || responseText, 1000) ||
    `Apollo.io returned HTTP ${status}.`;
}

function apolloLocation(value) {
  return [value?.city, value?.state, value?.country].map((item) => clean(item, 255)).filter(Boolean).join(", ");
}

function apolloPersonDetails(person) {
  const organization = objectValue(person?.organization);
  const firstName = clean(person?.first_name, 255);
  const lastName = clean(person?.last_name || person?.last_name_obfuscated, 255);
  const fullName = clean(person?.name || [firstName, lastName].filter(Boolean).join(" "), 255);
  const companyDomain = normalizedDomain(organization?.primary_domain || organization?.website_url);
  return {
    companyName: clean(organization?.name || person?.organization_name, 255),
    contactName: fullName,
    firstName,
    lastName,
    jobTitle: clean(person?.title, 500),
    seniority: clean(person?.seniority, 100),
    industry: clean(organization?.industry, 500),
    location: apolloLocation(person),
    website: apolloWebsite(organization),
    companyDomain,
    externalSourceId: clean(person?.id, 255),
    sourceUrl: clean(person?.linkedin_url || apolloWebsite(organization), 2048),
    metadata: {
      apolloPersonId: clean(person?.id, 255),
      apolloOrganizationId: clean(person?.organization_id || organization?.id, 255),
      firstName,
      lastName,
      fullName,
      jobTitle: clean(person?.title, 500),
      seniority: clean(person?.seniority, 100),
      companyDomain,
      linkedInUrl: clean(person?.linkedin_url, 2048),
      hasEmail: Boolean(person?.has_email),
      hasDirectPhone: Boolean(person?.has_direct_phone),
      discoveryTimestamp: new Date().toISOString(),
    },
    contactProvenance: {
      WEBSITE: { source: "APOLLO_IO", sourceUrl: clean(person?.linkedin_url, 2048), verified: false },
    },
  };
}

export class ApolloProvider extends ProspectDiscoveryProvider {
  constructor({ apiKey, fetchImpl = globalThis.fetch } = {}) {
    super("APOLLO_IO");
    this.apiKey = clean(apiKey, 10_000);
    this.fetchImpl = fetchImpl;
  }

  requireApiKey() {
    if (!this.apiKey) throw validationError("Apollo.io discovery is enabled but APOLLO_API_KEY is not configured.", 409);
  }

  async request(url, init = {}, { attempts = 3 } = {}) {
    this.requireApiKey();
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          headers: { ...apolloHeaders(this.apiKey), ...(init.headers || {}) },
          signal: init.signal || AbortSignal.timeout(30_000),
        });
        const responseText = await response.text();
        let body = {};
        try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = {}; }
        if (response.ok) return { body, response };
        const error = validationError(apolloError(body, responseText, response.status), response.status);
        error.apolloCode = clean(body?.error_details?.code || body?.error_code, 255);
        error.retryAfterSeconds = Number(body?.retry_after_seconds || response.headers?.get?.("retry-after") || 0);
        if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= attempts) throw error;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000, Math.max(100, error.retryAfterSeconds * 1000 || attempt * 250))));
      } catch (error) {
        if (error?.statusCode || attempt >= attempts) throw error;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
    throw lastError || validationError("Apollo.io request failed.", 502);
  }

  async searchProspects({ configuration, settings = {} }) {
    if (settings.peopleSearchEnabled === false && settings.companySearchEnabled === true) {
      return this.searchOrganizations({ configuration, settings });
    }
    this.requireApiKey();
    const url = new URL("https://api.apollo.io/api/v1/mixed_people/api_search");
    const addList = (name, values) => values.forEach((value) => url.searchParams.append(name, value));
    const titles = sourceSettingList(settings.decisionMakerTitles || settings.personTitles, APOLLO_DEFAULT_TITLES);
    const seniorities = sourceSettingList(settings.seniorities || settings.personSeniorities, APOLLO_DEFAULT_SENIORITIES)
      .map((item) => item.toLowerCase().replace(/[ -]+/g, "_"));
    const organizationLocations = sourceSettingList(settings.organizationLocations || settings.locations,
      configuration.targetLocation ? [configuration.targetLocation] : []);
    const personLocations = sourceSettingList(settings.personLocations);
    const domains = sourceSettingList(settings.domains || settings.organizationDomains).map(normalizedDomain).filter(Boolean);
    const organizationIds = sourceSettingList(settings.organizationIds);
    const excludedDomains = sourceSettingList(settings.excludedDomains).map(normalizedDomain).filter(Boolean);
    const employeeRanges = sourceSettingList(settings.employeeRanges || settings.organizationEmployeeRanges,
      /^\s*\d+\s*,\s*\d+\s*$/.test(clean(configuration.businessSize, 255)) ? [configuration.businessSize] : [])
      .map((range) => range.replace(/\s+/g, "")).filter((range) => /^\d+,\d+$/.test(range));
    const technologyUids = sourceSettingList(settings.technologyUids);
    const keywords = clean(settings.keywords || [configuration.targetIndustry, configuration.keywords]
      .filter(Boolean).join(" "), 1000);

    addList("person_titles[]", titles);
    addList("person_seniorities[]", seniorities);
    addList("organization_locations[]", organizationLocations);
    addList("person_locations[]", personLocations);
    addList("q_organization_domains_list[]", domains);
    addList("organization_ids[]", organizationIds);
    addList("not_organization_websites_list[]", excludedDomains);
    addList("organization_num_employees_ranges[]", employeeRanges);
    addList("currently_using_any_of_technology_uids[]", technologyUids);
    if (keywords) url.searchParams.set("q_keywords", keywords);
    if (settings.includeSimilarTitles === false) url.searchParams.set("include_similar_titles", "false");
    if (![organizationLocations, personLocations, domains, organizationIds, employeeRanges, technologyUids].some((values) => values.length) && !keywords) {
      throw validationError("Apollo.io People Search requires a keyword, location, domain, organization ID, employee range, or technology filter.");
    }
    url.searchParams.set("page", String(boundedInteger(settings.page, 1, 1, 500)));
    url.searchParams.set("per_page", String(boundedInteger(settings.resultLimit,
      Math.min(configuration.dailyProspectLimit || 25, 100), 1, 100)));
    const { body } = await this.request(url, { method: "POST" });
    return arrayValue(body.people).map(apolloPersonDetails)
      .filter((person) => person.companyName && person.externalSourceId);
  }

  async searchOrganizations({ configuration, settings = {} }) {
    this.requireApiKey();
    const url = new URL("https://api.apollo.io/api/v1/mixed_companies/search");
    const addList = (name, values) => values.forEach((value) => url.searchParams.append(name, value));
    const locations = sourceSettingList(settings.locations || settings.organizationLocations,
      configuration.targetLocation ? [configuration.targetLocation] : []);
    const keywordFallback = [configuration.targetIndustry,
      ...clean(configuration.keywords, 2000).split(/[,\n]/)].map((item) => clean(item, 500)).filter(Boolean);
    const keywordTags = sourceSettingList(settings.keywordTags || settings.keywords, keywordFallback);
    const employeeRanges = sourceSettingList(settings.employeeRanges || settings.organizationEmployeeRanges,
      /^\s*\d+\s*,\s*\d+\s*$/.test(clean(configuration.businessSize, 255)) ? [configuration.businessSize] : [])
      .map((range) => range.replace(/\s+/g, ""))
      .filter((range) => /^\d+,\d+$/.test(range));
    const domains = sourceSettingList(settings.domains || settings.organizationDomains);
    const excludedDomains = sourceSettingList(settings.excludedDomains);
    const technologyUids = sourceSettingList(settings.technologyUids);
    const organizationName = clean(settings.organizationName, 500);

    addList("organization_locations[]", locations);
    addList("q_organization_keyword_tags[]", keywordTags);
    addList("organization_num_employees_ranges[]", employeeRanges);
    addList("q_organization_domains_list[]", domains);
    addList("not_organization_websites_list[]", excludedDomains);
    addList("currently_using_any_of_technology_uids[]", technologyUids);
    if (organizationName) url.searchParams.set("q_organization_name", organizationName);
    if (![locations, keywordTags, employeeRanges, domains, technologyUids].some((values) => values.length) && !organizationName) {
      throw validationError("Apollo.io requires a company name, keyword, location, domain, employee range, or technology filter.");
    }
    url.searchParams.set("page", String(boundedInteger(settings.page, 1, 1, 500)));
    url.searchParams.set("per_page", String(boundedInteger(settings.resultLimit, Math.min(configuration.dailyProspectLimit || 25, 100), 1, 100)));

    const { body } = await this.request(url, { method: "POST" });
    return arrayValue(body.organizations).map((organization) => {
      const website = apolloWebsite(organization);
      const sourceUrl = clean(organization?.linkedin_url || website, 2048);
      const phone = clean(organization?.primary_phone?.sanitized_number || organization?.sanitized_phone ||
        organization?.primary_phone?.number || organization?.phone, 80);
      const location = [organization?.city, organization?.state, organization?.country]
        .map((item) => clean(item, 255)).filter(Boolean).join(", ");
      return {
        companyName: clean(organization?.name, 255),
        industry: clean(organization?.industry || arrayValue(organization?.keywords).join(", "), 500),
        location,
        website,
        phone,
        facebook: clean(organization?.facebook_url, 500),
        x: clean(organization?.twitter_url, 500),
        externalSourceId: clean(organization?.id, 255),
        sourceUrl,
        metadata: {
          apolloOrganizationId: clean(organization?.id, 255),
          primaryDomain: clean(organization?.primary_domain, 500),
          employeeCount: Number(organization?.estimated_num_employees) || null,
          foundedYear: Number(organization?.founded_year) || null,
          linkedInUrl: clean(organization?.linkedin_url, 2048),
          logoUrl: clean(organization?.logo_url, 2048),
          languages: sourceSettingList(organization?.languages).slice(0, 50),
        },
        contactProvenance: {
          PHONE: { source: "APOLLO_IO", sourceUrl, verified: false },
          WEBSITE: { source: "APOLLO_IO", sourceUrl, verified: false },
          FACEBOOK: { source: "APOLLO_IO", sourceUrl, verified: false },
          X: { source: "APOLLO_IO", sourceUrl, verified: false },
        },
      };
    }).filter((organization) => organization.companyName && organization.externalSourceId);
  }

  async enrichPeople(profiles, kind = "STANDARD") {
    const batch = arrayValue(profiles).slice(0, 10);
    if (!batch.length) return { matches: [], total_requested_enrichments: 0, credits_consumed: 0 };
    const url = new URL("https://api.apollo.io/api/v1/people/bulk_match");
    url.searchParams.set("reveal_personal_emails", "false");
    url.searchParams.set("reveal_phone_number", kind === "PHONE" ? "true" : "false");
    if (kind === "WATERFALL_EMAIL") url.searchParams.set("run_waterfall_email", "true");
    if (kind === "WATERFALL_PHONE") url.searchParams.set("run_waterfall_phone", "true");
    if (kind !== "STANDARD") url.searchParams.set("poll_only", "true");
    const details = batch.map((profile) => {
      if (profile.apolloPersonId) return { id: profile.apolloPersonId };
      return {
        name: profile.fullName || profile.contactName || undefined,
        domain: profile.companyDomain || normalizedDomain(profile.website) || undefined,
        organization_name: profile.companyName || undefined,
        linkedin_url: profile.linkedInUrl || undefined,
      };
    });
    const { body } = await this.request(url, { method: "POST", body: JSON.stringify({ details }) });
    return body;
  }

  async pollEnrichment(requestId) {
    const id = clean(requestId, 64);
    if (!/^-?\d+$/.test(id)) throw validationError("Apollo request ID is invalid.");
    try {
      const { body } = await this.request(`https://api.apollo.io/api/v1/webhook_result/${id}`, { method: "GET" }, { attempts: 1 });
      return { pending: false, body };
    } catch (error) {
      if (error?.statusCode === 404 && error?.apolloCode === "result_pending") {
        return { pending: true, retryAfterSeconds: Number(error.retryAfterSeconds || 10) };
      }
      throw error;
    }
  }

  async testConnection() {
    const { body } = await this.request("https://api.apollo.io/api/v1/users/api_profile?include_credit_usage=true", { method: "GET" }, { attempts: 1 });
    const profile = objectValue(body?.user || body?.profile || body);
    return {
      connected: true,
      account: clean(profile?.email || profile?.name, 320) || "Apollo API",
      creditUsageAvailable: Boolean(body?.credit_usage || profile?.credit_usage || body?.team_credit_usage),
    };
  }
}

// Backwards-compatible adapter for callers that explicitly depend on company search.
export class ApolloOrganizationsProvider extends ApolloProvider {
  async searchProspects(context) { return this.searchOrganizations(context); }
}

export class RepositoryDiscoveryProvider extends ProspectDiscoveryProvider {
  constructor(code, repository) { super(code); this.repository = repository; }
  async searchProspects(context) {
    return typeof this.repository.discoverAcquisitionCandidates === "function"
      ? this.repository.discoverAcquisitionCandidates(this.code, context.configuration, context.settings)
      : [];
  }
}

export class CSVImportProvider extends ProspectDiscoveryProvider {
  constructor() { super("CSV_IMPORT"); }
  async searchProspects({ rows }) { return arrayValue(rows); }
}

export function createDiscoveryProviders({ repository, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return new Map([
    ["GOOGLE_PLACES", new GooglePlacesProvider({ apiKey: env.GOOGLE_PLACES_API_KEY, fetchImpl })],
    ["APOLLO_IO", new ApolloProvider({ apiKey: env.APOLLO_API_KEY, fetchImpl })],
    ["EXISTING_CRM", new RepositoryDiscoveryProvider("EXISTING_CRM", repository)],
    ["INACTIVE_LEADS", new RepositoryDiscoveryProvider("INACTIVE_LEADS", repository)],
    ["LANDING_PAGE", new RepositoryDiscoveryProvider("LANDING_PAGE", repository)],
    ["INSTAGRAM_INBOUND", new RepositoryDiscoveryProvider("INSTAGRAM_INBOUND", repository)],
    ["FACEBOOK_INBOUND", new RepositoryDiscoveryProvider("FACEBOOK_INBOUND", repository)],
    ["CSV_IMPORT", new CSVImportProvider()],
  ]);
}

function prospectContact(prospect, channel) {
  if (channel === "EMAIL") return prospect.email;
  if (channel === "WHATSAPP_BUSINESS") return prospect.whatsAppNumber;
  if (channel === "INSTAGRAM") return prospect.instagram;
  if (channel === "FACEBOOK") return prospect.facebook;
  if (channel === "SMS") return prospect.phone;
  if (channel === "MANUAL_HUMAN_FOLLOW_UP") return prospect.email || prospect.phone || prospect.website || "CRM_TASK";
  return "";
}

export class CommunicationPolicyEngine {
  evaluate({ prospect, method, attempts = 0, now = new Date(), isReply = false }) {
    const reasons = [];
    if (!method?.enabled) reasons.push("CHANNEL_DISABLED");
    if (!prospectContact(prospect, method?.channel)) reasons.push("CONTACT_INFORMATION_MISSING");
    if (prospect.status === "DO_NOT_CONTACT") reasons.push("DO_NOT_CONTACT");
    if (["CONVERTED_TO_LEAD", "NOT_INTERESTED", "LOST"].includes(prospect.status)) reasons.push("PROSPECT_NOT_CONTACTABLE");
    if (prospect.optedOut) reasons.push("OPTED_OUT");
    if (prospect.responded && !isReply && method?.channel !== "MANUAL_HUMAN_FOLLOW_UP" && method?.stopOnResponse !== false) reasons.push("RESPONSE_STOPS_ESCALATION");
    if (attempts >= Number(method?.maximumAttempts || 0)) reasons.push("MAXIMUM_ATTEMPTS_REACHED");
    if (prospect.consentStatus && ["DENIED", "REVOKED", "OPTED_OUT"].includes(String(prospect.consentStatus).toUpperCase())) reasons.push("CONSENT_POLICY_BLOCKED");
    if (prospect.contactSourceValid === false) reasons.push("CONTACT_SOURCE_INVALID");
    if (prospectContact(prospect, method?.channel) && method?.channel !== "MANUAL_HUMAN_FOLLOW_UP" && !isReply) {
      const type = method?.channel === "EMAIL" ? "EMAIL" : method?.channel === "SMS" ? "PHONE" : method?.channel;
      const contact = prospectContact(prospect, method?.channel);
      if (!Array.isArray(prospect.contacts) || !prospect.contacts.some((item) => item.type === type && item.value === contact && item.source)) {
        reasons.push("CONTACT_PROVENANCE_MISSING");
      }
    }
    if (["WHATSAPP_BUSINESS", "INSTAGRAM", "FACEBOOK", "SMS"].includes(method?.channel) && !isReply &&
        !["GRANTED", "OPT_IN"].includes(String(prospect.consentStatus || "").toUpperCase())) {
      reasons.push("CONSENT_NOT_ESTABLISHED");
    }
    if (prospect.nextContactAt && new Date(prospect.nextContactAt) > now) reasons.push("CHANNEL_DELAY_ACTIVE");
    return { allowed: reasons.length === 0, reasons };
  }

  select({ prospect, methods, attemptsByChannel = {}, now = new Date() }) {
    const evaluations = [...arrayValue(methods)].sort((left, right) => Number(left.priority) - Number(right.priority)).map((method) => ({
      method,
      contact: prospectContact(prospect, method.channel),
      policy: this.evaluate({ prospect, method, attempts: Number(attemptsByChannel[method.channel] || 0), now }),
    }));
    return { selected: evaluations.find((item) => item.policy.allowed) || null, evaluations };
  }
}

export function normalizeAcquisitionDecision(value) {
  const decision = objectValue(value);
  return {
    intent: clean(decision.intent, 100) || "UNKNOWN",
    confidence: Math.max(0, Math.min(1, Number(decision.confidence) || 0)),
    next_action: clean(decision.next_action, 100) || "WAIT",
    response: clean(decision.response, 16_000),
    qualification_field: clean(decision.qualification_field, 255),
    extracted_information: objectValue(decision.extracted_information),
    request_human: Boolean(decision.request_human),
  };
}

function conversationPrompt(context) {
  return [
    "You guide a business acquisition conversation for Next2TheTop CRM.",
    "Return only JSON matching the schema. Use only known facts; never invent prospect details, pricing, consent, or a prior relationship.",
    "Do not ask for information already known. Select the next useful missing qualification field instead of following a rigid questionnaire.",
    "Set request_human for an explicit human request, pricing negotiation, contract/payment discussion, sensitive request, or low confidence.",
    "The application policy engine—not the model—decides whether communication can be sent.",
    JSON.stringify(context),
  ].join("\n\n");
}

function apolloSource(configuration) {
  return arrayValue(configuration?.searchSources).find((source) => source.sourceCode === "APOLLO_IO") || null;
}

function apolloResponseMatches(value) {
  const body = objectValue(value);
  const root = objectValue(body.webhook_result || body.result || body.data || body);
  if (Array.isArray(root.matches)) return root.matches;
  if (Array.isArray(root.people)) return root.people;
  if (Array.isArray(root.contacts)) return root.contacts;
  if (root.person && typeof root.person === "object") return [root.person];
  if (root.data && root.data !== root) return apolloResponseMatches(root.data);
  return [];
}

function apolloResponseRequestId(value) {
  const body = objectValue(value);
  const requestId = body.request_id ?? body.waterfall?.request_id ?? body.webhook_request_id;
  return requestId == null ? "" : clean(requestId, 64);
}

function apolloMatchId(match) {
  return clean(match?.id || match?.person_id || match?.apollo_person_id, 255);
}

function apolloPhone(match) {
  const phone = arrayValue(match?.phone_numbers)[0] || objectValue(match?.phone_number);
  if (typeof phone === "string") return { number: clean(phone, 80), type: "", status: "" };
  return {
    number: clean(phone?.sanitized_number || phone?.raw_number || phone?.number || match?.phone, 80),
    type: clean(phone?.type || phone?.type_cd, 64),
    status: clean(phone?.status || phone?.confidence, 64),
  };
}

function apolloMatchFields(matchValue) {
  const match = objectValue(matchValue);
  const organization = objectValue(match.organization);
  const phone = apolloPhone(match);
  return {
    firstName: clean(match.first_name, 255),
    lastName: clean(match.last_name, 255),
    fullName: clean(match.name || [match.first_name, match.last_name].filter(Boolean).join(" "), 255),
    jobTitle: clean(match.title, 500),
    seniority: clean(match.seniority, 100),
    companyDomain: normalizedDomain(organization.primary_domain || organization.website_url),
    linkedInUrl: clean(match.linkedin_url, 2048),
    email: clean(match.email, 320),
    emailStatus: clean(match.email_status, 64),
    phone: phone.number,
    phoneType: phone.type,
    phoneStatus: phone.status,
    matchConfidence: clean(match.match_confidence || (apolloMatchId(match) ? "high" : "none"), 32).toLowerCase(),
  };
}

function acceptableApolloConfidence(confidence, settings) {
  const value = clean(confidence, 32).toLowerCase();
  return value === "high" || (value === "medium" && settings.acceptMediumConfidence === true) ||
    (value === "low" && settings.allowLowConfidenceContact === true);
}

function acceptableApolloEmail(fields, settings) {
  const accepted = sourceSettingList(settings.acceptedEmailStatuses, ["verified", "likely to engage"])
    .map((item) => item.toLowerCase().replaceAll("_", " "));
  return Boolean(fields.email && acceptableApolloConfidence(fields.matchConfidence, settings) &&
    accepted.includes(fields.emailStatus.toLowerCase().replaceAll("_", " ")));
}

function apolloPhoneNeeded(configuration, profile, settings) {
  const phoneMethods = arrayValue(configuration.communicationMethods)
    .filter((method) => method.enabled && ["SMS", "WHATSAPP_BUSINESS"].includes(method.channel));
  if (!phoneMethods.length || profile.prospectPhone || profile.phone) return false;
  const email = profile.prospectEmail || (acceptableApolloEmail(profile, settings) ? profile.email : "");
  const emailMethod = arrayValue(configuration.communicationMethods).find((method) => method.enabled && method.channel === "EMAIL");
  if (email && emailMethod && settings.enrichPhoneEvenWhenEmailAvailable !== true &&
      phoneMethods.every((method) => Number(emailMethod.priority) < Number(method.priority))) return false;
  return true;
}

export class AcquisitionService {
  constructor({ repository, aiProviderService, discoveryProviders, policyEngine, env = process.env, fetchImpl } = {}) {
    this.repository = repository;
    this.aiProviderService = aiProviderService;
    this.discoveryProviders = discoveryProviders || createDiscoveryProviders({ repository, env, fetchImpl });
    this.policyEngine = policyEngine || new CommunicationPolicyEngine();
    this.outreachBatchSize = boundedInteger(env.AI_ACQUISITION_OUTREACH_BATCH_SIZE, 10, 1, 100);
  }

  async configurations(id = null) { return this.repository.getAcquisitionConfigurations(id); }
  async overview(configurationId = null) { return this.repository.getAcquisitionOverview(configurationId); }
  async analytics(configurationId = null) { return this.repository.getAcquisitionAnalytics(configurationId); }
  async prospects(filters = {}) { return this.repository.getAcquisitionProspects(filters); }
  async conversations(filters = {}) { return this.repository.getAcquisitionConversations(filters); }
  async manualTasks(configurationId = null) { return this.repository.getAcquisitionManualTasks(configurationId); }

  async completeManualTask(attemptIdValue) {
    const attemptId = optionalPositiveId(attemptIdValue);
    if (!attemptId) throw validationError("A manual task ID is required.");
    return this.repository.completeAcquisitionManualTask(attemptId);
  }

  async saveConfiguration(body) {
    const existingId = optionalPositiveId(body?.id || body?.acquisitionConfigurationId);
    const existing = existingId ? (await this.configurations(existingId))[0] : null;
    if (existingId && !existing) throw validationError("Acquisition configuration was not found.", 404);
    const input = normalizeAcquisitionInput(body, { existingStatus: existing?.status || "DRAFT" });
    return this.repository.saveAcquisitionConfiguration(input);
  }

  async setStatus(idValue, actionValue) {
    const id = optionalPositiveId(idValue);
    if (!id) throw validationError("An acquisition configuration ID is required.");
    const action = clean(actionValue, 32).toUpperCase();
    const transitions = { START: "ACTIVE", RESUME: "ACTIVE", PAUSE: "PAUSED", STOP: "STOPPED", COMPLETE: "COMPLETED" };
    const status = transitions[action];
    if (!status) throw validationError("Supported actions are START, RESUME, PAUSE, STOP, and COMPLETE.");
    return this.repository.setAcquisitionConfigurationStatus(id, status);
  }

  async discover(configurationIdValue, { sourceCode = null, rows = [] } = {}) {
    const configurationId = optionalPositiveId(configurationIdValue);
    const configuration = (await this.configurations(configurationId))[0];
    if (!configuration) throw validationError("Acquisition configuration was not found.", 404);
    if (["STOPPED", "COMPLETED"].includes(configuration.status)) throw validationError("This acquisition configuration is not discoverable.", 409);
    const alreadyDiscovered = typeof this.repository.getAcquisitionDiscoveryCountToday === "function"
      ? await this.repository.getAcquisitionDiscoveryCountToday(configurationId)
      : 0;
    let remaining = Math.max(0, configuration.dailyProspectLimit - alreadyDiscovered);
    const enabledSources = configuration.searchSources
      .filter((source) => source.enabled && (!sourceCode || source.sourceCode === clean(sourceCode, 64).toUpperCase()))
      .sort((left, right) => left.priority - right.priority);
    if (!enabledSources.length && rows.length) enabledSources.push({ sourceCode: "CSV_IMPORT", enabled: true, priority: 1, settings: {} });
    if (!enabledSources.length) throw validationError("Enable at least one matching search source.", 409);
    const results = [];
    for (const source of enabledSources) {
      if (remaining < 1) break;
      const sourceLimit = Math.min(remaining, boundedInteger(source.settings?.dailyProspectLimit, remaining, 1, 10_000));
      const minimumFit = Math.max(configuration.minimumProspectFitScore,
        boundedInteger(source.settings?.minimumFitScore, configuration.minimumProspectFitScore, 0, 100));
      const provider = this.discoveryProviders.get(source.sourceCode);
      if (!provider) {
        results.push({ sourceCode: source.sourceCode, discovered: 0, skipped: true, reason: "No provider adapter is installed for this configured source." });
        continue;
      }
      try {
        let providerSettings = source.settings || {};
        if (source.sourceCode === "APOLLO_IO" && providerSettings.preferKnownDomains !== false &&
            !sourceSettingList(providerSettings.domains || providerSettings.organizationDomains).length &&
            typeof this.repository.getAcquisitionProspectDomains === "function") {
          const knownDomains = (await this.repository.getAcquisitionProspectDomains(configuration.id,
            boundedInteger(providerSettings.domainScopeLimit, 100, 1, 1000))).map(normalizedDomain).filter(Boolean);
          if (knownDomains.length) providerSettings = { ...providerSettings, domains: [...new Set(knownDomains)] };
        }
        const apolloSearchKey = source.sourceCode === "APOLLO_IO" ? `apollo-search:${configuration.id}:${randomUUID()}` : "";
        if (apolloSearchKey && typeof this.repository.saveApolloUsage === "function") {
          await this.repository.saveApolloUsage({ acquisitionConfigurationId: configuration.id, requestKey: apolloSearchKey,
            requestKind: "PEOPLE_SEARCH", requestedCount: 1, status: "REQUESTED" });
        }
        let found;
        try {
          found = await provider.searchProspects({ configuration, settings: providerSettings, rows });
          if (apolloSearchKey && typeof this.repository.saveApolloUsage === "function") {
            await this.repository.saveApolloUsage({ acquisitionConfigurationId: configuration.id, requestKey: apolloSearchKey,
              requestKind: "PEOPLE_SEARCH", requestedCount: 1, successCount: 1, status: "COMPLETED" });
          }
        } catch (error) {
          if (apolloSearchKey && typeof this.repository.saveApolloUsage === "function") {
            await this.repository.saveApolloUsage({ acquisitionConfigurationId: configuration.id, requestKey: apolloSearchKey,
              requestKind: "PEOPLE_SEARCH", requestedCount: 1, status: error?.statusCode === 429 ? "RATE_LIMITED" : "FAILED",
              errorCode: error?.apolloCode || "", errorMessage: clean(error?.message || error, 1000) });
          }
          throw error;
        }
        let persisted = 0;
        let belowMinimum = 0;
        for (const candidate of found) {
          const detailed = await provider.getProspectDetails(candidate, { configuration, settings: providerSettings });
          const enriched = await provider.enrichProspect(detailed, { configuration, settings: providerSettings });
          const prospect = provider.normalizeProspect(enriched, { configuration });
          if (!provider.validateProspect(prospect)) continue;
          if (prospect.fitScore < minimumFit) { belowMinimum += 1; continue; }
          const apolloMetadata = source.sourceCode === "APOLLO_IO" ? objectValue(prospect.metadata) : null;
          const existing = apolloMetadata && typeof this.repository.findApolloProspectMatch === "function"
            ? await this.repository.findApolloProspectMatch({
              acquisitionConfigurationId: configuration.id,
              apolloPersonId: apolloMetadata.apolloPersonId,
              linkedInUrl: apolloMetadata.linkedInUrl,
              fullName: apolloMetadata.fullName,
              companyDomain: apolloMetadata.companyDomain,
            }) : null;
          const saved = existing || await this.repository.upsertAcquisitionProspect(prospect);
          if (saved && apolloMetadata?.apolloPersonId && typeof this.repository.upsertApolloProfileDiscovery === "function") {
            await this.repository.upsertApolloProfileDiscovery({
              prospectId: saved.id,
              acquisitionConfigurationId: configuration.id,
              apolloPersonId: apolloMetadata.apolloPersonId,
              apolloOrganizationId: apolloMetadata.apolloOrganizationId,
              firstName: apolloMetadata.firstName,
              lastName: apolloMetadata.lastName,
              fullName: apolloMetadata.fullName,
              jobTitle: apolloMetadata.jobTitle,
              seniority: apolloMetadata.seniority,
              companyDomain: apolloMetadata.companyDomain,
              linkedInUrl: apolloMetadata.linkedInUrl,
            });
          }
          if (saved?.inserted !== false) {
            persisted += 1;
            remaining -= 1;
          }
          if (remaining < 1 || persisted >= sourceLimit) break;
        }
        results.push({ sourceCode: source.sourceCode, discovered: persisted, belowMinimum });
      } catch (error) {
        results.push({ sourceCode: source.sourceCode, discovered: 0, error: clean(error?.message || error, 1000) });
      }
    }
    return { configurationId, remainingDailyLimit: remaining, results };
  }

  async apolloUsage(configurationIdValue) {
    const configurationId = optionalPositiveId(configurationIdValue);
    if (!configurationId) throw validationError("An acquisition configuration ID is required.");
    const configuration = (await this.configurations(configurationId))[0];
    if (!configuration) throw validationError("Acquisition configuration was not found.", 404);
    const source = apolloSource(configuration);
    const usage = typeof this.repository.getApolloUsage === "function"
      ? await this.repository.getApolloUsage(configurationId) : { summary: {}, requests: [] };
    return { ...usage, limits: {
      dailyCreditLimit: boundedInteger(source?.settings?.dailyCreditLimit, 0, 0, 1_000_000),
      monthlyCreditLimit: boundedInteger(source?.settings?.monthlyCreditLimit, 0, 0, 10_000_000),
    } };
  }

  async apolloStatus(configurationIdValue, { test = false } = {}) {
    const configurationId = optionalPositiveId(configurationIdValue);
    const configuration = configurationId ? (await this.configurations(configurationId))[0] : null;
    if (configurationId && !configuration) throw validationError("Acquisition configuration was not found.", 404);
    const source = configuration ? apolloSource(configuration) : null;
    const provider = this.discoveryProviders.get("APOLLO_IO");
    const status = {
      configured: Boolean(provider?.apiKey),
      enabled: Boolean(source?.enabled),
      peopleSearchEnabled: source?.settings?.peopleSearchEnabled !== false,
      standardEnrichmentEnabled: source?.settings?.standardPeopleEnrichmentEnabled === true,
      polling: true,
    };
    if (test) return { ...status, ...(await provider.testConnection()) };
    return status;
  }

  async apolloBudgetAllows(configuration, estimatedCredits) {
    const settings = apolloSource(configuration)?.settings || {};
    const dailyLimit = boundedInteger(settings.dailyCreditLimit, 0, 0, 1_000_000);
    const monthlyLimit = boundedInteger(settings.monthlyCreditLimit, 0, 0, 10_000_000);
    if (!dailyLimit || !monthlyLimit) return false;
    const usage = typeof this.repository.getApolloUsage === "function"
      ? await this.repository.getApolloUsage(configuration.id, 1) : { summary: {} };
    const daily = Number(usage.summary?.dailyCreditsConsumed || 0) + Number(usage.summary?.dailyEstimatedCredits || 0);
    const monthly = Number(usage.summary?.monthlyCreditsConsumed || 0) + Number(usage.summary?.monthlyEstimatedCredits || 0);
    return daily + estimatedCredits <= dailyLimit && monthly + estimatedCredits <= monthlyLimit;
  }

  async applyApolloMatch(configuration, profile, match, kind) {
    const settings = apolloSource(configuration)?.settings || {};
    const fields = apolloMatchFields(match);
    const matched = acceptableApolloConfidence(fields.matchConfidence, settings);
    const acceptedEmail = acceptableApolloEmail(fields, settings);
    const acceptedPhone = Boolean(fields.phone && matched);
    return this.repository.updateApolloProfile({
      prospectId: profile.prospectId,
      ...fields,
      persistEmail: acceptedEmail,
      persistPhone: acceptedPhone,
      enrichmentStatus: kind.startsWith("WATERFALL") ? "WATERFALL_COMPLETED" : matched ? "STANDARD_COMPLETED" : "NO_DATA",
      pendingRequestKind: null,
      apolloRequestId: null,
      pendingUsageKey: null,
      lastError: null,
      standardEnrichmentUsed: kind === "STANDARD" ? true : undefined,
      waterfallEmailUsed: kind === "WATERFALL_EMAIL" ? true : undefined,
      phoneEnrichmentUsed: kind === "PHONE" ? true : undefined,
      waterfallPhoneUsed: kind === "WATERFALL_PHONE" ? true : undefined,
    });
  }

  async runApolloBatch(configuration, profiles, kind, estimatedPerPerson) {
    if (!profiles.length) return { requested: 0, pending: 0, completed: 0, budgetBlocked: 0 };
    const provider = this.discoveryProviders.get("APOLLO_IO");
    const batch = profiles.slice(0, 10);
    const estimatedCredits = batch.length * estimatedPerPerson;
    const settings = apolloSource(configuration)?.settings || {};
    const requestKey = `apollo-enrichment:${configuration.id}:${kind}:${randomUUID()}`;
    const reservation = typeof this.repository.reserveApolloUsage === "function"
      ? await this.repository.reserveApolloUsage({
        acquisitionConfigurationId: configuration.id, requestKey, requestKind: kind,
        requestedCount: batch.length, estimatedCredits,
        dailyCreditLimit: boundedInteger(settings.dailyCreditLimit, 0, 0, 1_000_000),
        monthlyCreditLimit: boundedInteger(settings.monthlyCreditLimit, 0, 0, 10_000_000),
      })
      : { allowed: await this.apolloBudgetAllows(configuration, estimatedCredits) };
    if (!reservation.allowed) {
      for (const profile of batch) await this.repository.updateApolloProfile({
        prospectId: profile.prospectId, enrichmentStatus: "BUDGET_LIMIT_REACHED",
        lastError: "Apollo daily or monthly credit limit would be exceeded.",
      });
      return { requested: 0, pending: 0, completed: 0, budgetBlocked: batch.length };
    }
    if (typeof this.repository.reserveApolloUsage !== "function") {
      await this.repository.saveApolloUsage({ acquisitionConfigurationId: configuration.id, requestKey, requestKind: kind,
        requestedCount: batch.length, estimatedCredits, status: "REQUESTED" });
    }
    try {
      const response = await provider.enrichPeople(batch, kind);
      const requestId = apolloResponseRequestId(response);
      if (kind !== "STANDARD" && requestId) {
        const nextPollAt = new Date(Date.now() + 10_000).toISOString();
        for (const profile of batch) await this.repository.updateApolloProfile({
          prospectId: profile.prospectId,
          enrichmentStatus: kind.startsWith("WATERFALL") ? "WATERFALL_PENDING" : "PENDING",
          pendingRequestKind: kind,
          apolloRequestId: requestId,
          pendingUsageKey: requestKey,
          nextPollAt,
          standardEnrichmentUsed: kind === "STANDARD" ? true : undefined,
          waterfallEmailUsed: kind === "WATERFALL_EMAIL" ? true : undefined,
          phoneEnrichmentUsed: kind === "PHONE" ? true : undefined,
          waterfallPhoneUsed: kind === "WATERFALL_PHONE" ? true : undefined,
        });
        await this.repository.saveApolloUsage({ acquisitionConfigurationId: configuration.id, requestKey, requestKind: kind,
          apolloRequestId: requestId, requestedCount: batch.length, estimatedCredits, status: "PENDING" });
        return { requested: batch.length, pending: batch.length, completed: 0, budgetBlocked: 0 };
      }
      const matches = apolloResponseMatches(response);
      for (let index = 0; index < batch.length; index += 1) {
        const profile = batch[index];
        const match = matches.find((item) => apolloMatchId(item) === profile.apolloPersonId) ?? matches[index] ?? null;
        await this.applyApolloMatch(configuration, profile, match, kind);
      }
      const credits = Number(response.credits_consumed || 0);
      await this.repository.saveApolloUsage({ acquisitionConfigurationId: configuration.id, requestKey, requestKind: kind,
        requestedCount: batch.length, successCount: Number(response.unique_enriched_records || matches.filter(Boolean).length),
        creditsConsumed: credits, estimatedCredits: 0, status: "COMPLETED" });
      return { requested: batch.length, pending: 0, completed: batch.length, budgetBlocked: 0 };
    } catch (error) {
      const status = error?.statusCode === 429 ? "RATE_LIMITED" : "FAILED";
      await this.repository.saveApolloUsage({ acquisitionConfigurationId: configuration.id, requestKey, requestKind: kind,
        requestedCount: batch.length, estimatedCredits: 0, status, errorCode: error?.apolloCode || "",
        errorMessage: clean(error?.message || error, 1000) });
      for (const profile of batch) await this.repository.updateApolloProfile({
        prospectId: profile.prospectId, enrichmentStatus: status, lastError: clean(error?.message || error, 1000),
        standardEnrichmentUsed: kind === "STANDARD" ? true : undefined,
        waterfallEmailUsed: kind === "WATERFALL_EMAIL" ? true : undefined,
        phoneEnrichmentUsed: kind === "PHONE" ? true : undefined,
        waterfallPhoneUsed: kind === "WATERFALL_PHONE" ? true : undefined,
      });
      return { requested: batch.length, pending: 0, completed: 0, budgetBlocked: 0, error: clean(error?.message || error, 1000) };
    }
  }

  async pollApolloEnrichments(configuration) {
    const provider = this.discoveryProviders.get("APOLLO_IO");
    const pending = await this.repository.getApolloProfiles({ configurationId: configuration.id, pendingOnly: true, limit: 100 });
    const groups = new Map();
    for (const profile of pending) {
      const key = `${profile.apolloRequestId}:${profile.pendingRequestKind}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(profile);
    }
    const result = { polled: 0, completed: 0, pending: 0, errors: [] };
    for (const profiles of groups.values()) {
      const first = profiles[0];
      result.polled += 1;
      try {
        const response = await provider.pollEnrichment(first.apolloRequestId);
        if (response.pending) {
          const nextPollAt = new Date(Date.now() + Math.max(5, response.retryAfterSeconds || 10) * 1000).toISOString();
          for (const profile of profiles) await this.repository.updateApolloProfile({
            prospectId: profile.prospectId, enrichmentStatus: profile.enrichmentStatus,
            pendingRequestKind: profile.pendingRequestKind, apolloRequestId: profile.apolloRequestId,
            pendingUsageKey: profile.pendingUsageKey, nextPollAt,
          });
          result.pending += profiles.length;
          continue;
        }
        const matches = apolloResponseMatches(response.body);
        for (let index = 0; index < profiles.length; index += 1) {
          const profile = profiles[index];
          const match = matches.find((item) => apolloMatchId(item) === profile.apolloPersonId) ?? matches[index] ?? null;
          await this.applyApolloMatch(configuration, profile, match, profile.pendingRequestKind);
        }
        const root = objectValue(response.body.webhook_result || response.body);
        await this.repository.saveApolloUsage({ acquisitionConfigurationId: configuration.id,
          requestKey: first.pendingUsageKey || `apollo-poll:${first.apolloRequestId}`,
          requestKind: first.pendingRequestKind, apolloRequestId: first.apolloRequestId,
          requestedCount: profiles.length, successCount: Number(root.unique_enriched_records || matches.filter(Boolean).length),
          creditsConsumed: Number(root.credits_consumed || 0), estimatedCredits: 0, status: "COMPLETED" });
        result.completed += profiles.length;
      } catch (error) {
        result.errors.push({ requestId: first.apolloRequestId, error: clean(error?.message || error, 500) });
        for (const profile of profiles) await this.repository.updateApolloProfile({ prospectId: profile.prospectId,
          enrichmentStatus: error?.statusCode === 429 ? "RATE_LIMITED" : "FAILED", lastError: clean(error?.message || error, 1000) });
      }
    }
    return result;
  }

  async enrichApollo(configurationIdValue) {
    const configurationId = optionalPositiveId(configurationIdValue);
    const configuration = (await this.configurations(configurationId))[0];
    if (!configuration) throw validationError("Acquisition configuration was not found.", 404);
    const source = apolloSource(configuration);
    if (!source?.enabled) return { skipped: "Apollo is disabled for this acquisition configuration." };
    if (typeof this.repository.getApolloProfiles !== "function") return { skipped: "Apollo enrichment schema is not installed." };
    const settings = source.settings || {};
    const result = { polling: await this.pollApolloEnrichments(configuration), stages: {} };
    let profiles = await this.repository.getApolloProfiles({ configurationId, limit: 1000 });
    const safe = (profile) => !profile.optedOut && profile.prospectStatus !== "DO_NOT_CONTACT";
    if (settings.standardPeopleEnrichmentEnabled === true) {
      const threshold = boundedInteger(settings.minimumFitScoreForStandardEnrichment, 60, 0, 100);
      const candidates = profiles.filter((profile) => safe(profile) && !profile.standardEnrichmentUsed &&
        profile.fitScore >= threshold && !profile.apolloRequestId).slice(0, 10);
      result.stages.standard = await this.runApolloBatch(configuration, candidates, "STANDARD", 1);
    }
    profiles = await this.repository.getApolloProfiles({ configurationId, limit: 1000 });
    if (settings.waterfallEmailEnabled === true) {
      const threshold = boundedInteger(settings.minimumFitScoreForWaterfallEmail, 80, 0, 100);
      const candidates = profiles.filter((profile) => safe(profile) && profile.standardEnrichmentUsed &&
        !profile.waterfallEmailUsed && !profile.prospectEmail && !acceptableApolloEmail(profile, settings) &&
        profile.fitScore >= threshold && !profile.apolloRequestId).slice(0, 10);
      result.stages.waterfallEmail = await this.runApolloBatch(configuration, candidates, "WATERFALL_EMAIL",
        Math.max(1, Number(settings.estimatedWaterfallEmailCredits || 1)));
    }
    profiles = await this.repository.getApolloProfiles({ configurationId, limit: 1000 });
    if (settings.phoneEnrichmentEnabled === true) {
      const threshold = boundedInteger(settings.minimumFitScoreForPhone, 80, 0, 100);
      const candidates = profiles.filter((profile) => safe(profile) && profile.standardEnrichmentUsed &&
        !profile.phoneEnrichmentUsed && profile.fitScore >= threshold && !profile.apolloRequestId &&
        apolloPhoneNeeded(configuration, profile, settings)).slice(0, 10);
      result.stages.phone = await this.runApolloBatch(configuration, candidates, "PHONE", 9);
    }
    profiles = await this.repository.getApolloProfiles({ configurationId, limit: 1000 });
    if (settings.waterfallPhoneEnabled === true) {
      const threshold = boundedInteger(settings.minimumFitScoreForPhone, 80, 0, 100);
      const candidates = profiles.filter((profile) => safe(profile) && profile.phoneEnrichmentUsed &&
        !profile.waterfallPhoneUsed && !profile.prospectPhone && !profile.phone && profile.fitScore >= threshold &&
        !profile.apolloRequestId && apolloPhoneNeeded(configuration, profile, settings)).slice(0, 10);
      result.stages.waterfallPhone = await this.runApolloBatch(configuration, candidates, "WATERFALL_PHONE",
        Math.max(1, Number(settings.estimatedWaterfallPhoneCredits || 9)));
    }
    return result;
  }

  async communicationSelection(prospectIdValue) {
    const prospectId = optionalPositiveId(prospectIdValue);
    if (!prospectId) throw validationError("A prospect ID is required.");
    const prospect = (await this.prospects({ prospectId }))[0];
    if (!prospect) throw validationError("Prospect was not found.", 404);
    const configuration = (await this.configurations(prospect.acquisitionConfigurationId))[0];
    const attempts = typeof this.repository.getAcquisitionContactAttempts === "function"
      ? await this.repository.getAcquisitionContactAttempts(prospectId)
      : [];
    const attemptsByChannel = attempts.reduce((summary, attempt) => {
      if (attempt.status !== "CANCELLED") summary[attempt.channel] = (summary[attempt.channel] || 0) + 1;
      return summary;
    }, {});
    return { prospect, configuration, attempts, ...this.policyEngine.select({ prospect, methods: configuration.communicationMethods, attemptsByChannel }) };
  }

  async queueContact(prospectId, body = {}) {
    const selection = await this.communicationSelection(prospectId);
    if (!selection.selected) throw validationError("No enabled, available communication channel passes policy.", 409);
    const requestedChannel = clean(body.channel, 64).toUpperCase();
    let chosen = requestedChannel
      ? selection.evaluations.find((item) => item.method.channel === requestedChannel)
      : selection.selected;
    if (!chosen?.policy.allowed) throw validationError(`Communication policy blocked ${requestedChannel || "the requested channel"}.`, 409);
    if (chosen.method.channel !== "MANUAL_HUMAN_FOLLOW_UP" && !chosen.method.allowSimultaneous &&
        selection.attempts.some((attempt) => ["QUEUED", "RETRY", "PROCESSING"].includes(attempt.status))) {
      throw validationError("A contact attempt is already pending for this prospect.", 409);
    }
    let message = clean(body.message, 16_000);
    let origin = message ? "HUMAN" : "AI";
    if (!message && chosen.method.channel === "MANUAL_HUMAN_FOLLOW_UP") {
      message = `Review and follow up with ${selection.prospect.companyName}.`;
      origin = "HUMAN";
    } else if (!message) {
      const history = await this.conversations({ prospectId: selection.prospect.id, limit: 100 });
      const generated = await this.decide({
        prospect: selection.prospect,
        configuration: selection.configuration,
        history,
        incomingMessage: "Create the initial personalized outreach using only the known facts.",
        channel: chosen.method.channel,
      });
      if (generated.decision.request_human || generated.decision.confidence < Number(selection.configuration.humanHandoffRules?.minimumAIConfidence ?? 0.65)) {
        const manual = selection.evaluations.find((item) => item.method.channel === "MANUAL_HUMAN_FOLLOW_UP" && item.policy.allowed);
        if (!manual) throw validationError("AI requested human review and no manual follow-up method is available.", 409);
        chosen = manual;
        message = `Review AI acquisition handoff for ${selection.prospect.companyName}.`;
        origin = "HUMAN";
        await this.repository.updateAcquisitionProspectEngagement(selection.prospect.id, { status: "HUMAN_HANDOFF", responded: false });
      } else {
        message = generated.decision.response;
        if (!message) throw validationError("The AI provider did not return outreach text.", 502);
        await this.repository.saveAcquisitionConversation({
          acquisitionConfigurationId: selection.configuration.id,
          prospectId: selection.prospect.id,
          leadId: selection.prospect.convertedLeadId,
          channel: chosen.method.channel,
          direction: "OUTBOUND",
          message,
          origin: "AI",
          deliveryStatus: "PROPOSED",
          externalMessageId: null,
          aiProviderId: generated.providerId,
          aiModel: generated.model,
          decision: generated.decision,
        });
      }
    }
    const attempt = await this.repository.createAcquisitionContactAttempt({
      prospectId: selection.prospect.id,
      acquisitionConfigurationId: selection.configuration.id,
      channel: chosen.method.channel,
      contactValue: chosen.contact,
      message,
      origin,
      idempotencyKey: clean(body.idempotencyKey, 255) || `acquisition:${selection.prospect.id}:${chosen.method.channel}:${Date.now()}`,
      status: "QUEUED",
    });
    return { attempt, selectedChannel: chosen.method.channel, policy: chosen.policy };
  }

  async claimOutreach({ limit = 10, lockToken = randomUUID() } = {}) {
    const attempts = await this.repository.claimAcquisitionContactAttempts({ limit, lockToken });
    return { lockToken, attempts };
  }

  async completeOutreach(attemptIdValue, body = {}) {
    const attemptId = optionalPositiveId(attemptIdValue);
    const lockToken = clean(body.lockToken, 64);
    if (!attemptId || !lockToken) throw validationError("Attempt ID and lock token are required.");
    return this.repository.completeAcquisitionContactAttempt(attemptId, {
      lockToken,
      succeeded: body.succeeded === true,
      externalMessageId: clean(body.externalMessageId, 255),
      error: clean(body.error, 1000),
      retryable: body.retryable === true,
      nextAttemptAt: body.nextAttemptAt || null,
    });
  }

  async decide({ prospect, configuration, history, incomingMessage, channel }) {
    const profile = await this.repository.getCompanyProfile();
    const known = {
      companyProfile: profile,
      acquisition: configuration,
      prospect,
      conversationHistory: history,
      incomingMessage,
      selectedChannel: channel,
      missingQualificationInformation: configuration.qualificationQuestions.filter((question) => {
        const key = question.split(":")[0].trim();
        return key && !prospect.qualification?.[key];
      }),
    };
    const generated = await this.aiProviderService.generateStructuredOutput({
      providerId: configuration.aiProviderId,
      fallbackProviderId: configuration.fallbackAIProviderId,
      schemaName: "next2thetop_acquisition_decision",
      schema: ACQUISITION_DECISION_SCHEMA,
      prompt: conversationPrompt(known),
    });
    return { ...generated, decision: normalizeAcquisitionDecision(generated.output) };
  }

  async receiveMessage(prospectIdValue, body = {}) {
    const prospectId = optionalPositiveId(prospectIdValue);
    const message = clean(body.message, 16_000);
    const externalMessageId = clean(body.externalMessageId, 255);
    if (!prospectId || !message || !externalMessageId) throw validationError("Prospect ID, message, and external message ID are required.");
    const prospect = (await this.prospects({ prospectId }))[0];
    if (!prospect) throw validationError("Prospect was not found.", 404);
    const configuration = (await this.configurations(prospect.acquisitionConfigurationId))[0];
    const channel = clean(body.channel, 64).toUpperCase();
    if (!COMMUNICATION_CHANNELS.includes(channel) || channel === "MANUAL_HUMAN_FOLLOW_UP") {
      throw validationError("A supported inbound communication channel is required.");
    }
    const inbound = await this.repository.saveAcquisitionConversation({
      acquisitionConfigurationId: configuration.id,
      prospectId,
      leadId: prospect.convertedLeadId,
      channel,
      direction: "INBOUND",
      message,
      origin: "PROSPECT",
      deliveryStatus: "RECEIVED",
      externalMessageId,
      aiProviderId: null,
      aiModel: null,
      decision: null,
    });
    if (inbound?.duplicate) return { inbound, duplicate: true, proposed: null, humanHandoff: false };
    if (/^(stop|unsubscribe|opt[ -]?out|remove me)[.!\s]*$/i.test(message) || /do not contact me|don't contact me|no me contacte/i.test(message)) {
      await this.repository.updateAcquisitionProspectEngagement(prospectId, { status: "DO_NOT_CONTACT", responded: true, optedOut: true });
      return { inbound, proposed: null, optedOut: true, humanHandoff: false };
    }
    if (prospect.status === "DO_NOT_CONTACT" || prospect.optedOut || prospect.status === "CONVERTED_TO_LEAD") {
      return { inbound, proposed: null, policy: { allowed: false, reasons: [prospect.status] }, humanHandoff: false };
    }
    const preservedStatus = ["DO_NOT_CONTACT", "CONVERTED_TO_LEAD", "HUMAN_HANDOFF"].includes(prospect.status) ? prospect.status : "ENGAGED";
    await this.repository.updateAcquisitionProspectEngagement(prospectId, { status: preservedStatus, responded: true });
    const history = await this.conversations({ prospectId, limit: 100 });
    const generated = await this.decide({ prospect: { ...prospect, responded: true }, configuration, history, incomingMessage: message, channel });
    if (["OPT_OUT", "UNSUBSCRIBE", "DO_NOT_CONTACT", "STOP_CONTACT"].includes(generated.decision.intent.toUpperCase()) ||
        ["OPT_OUT", "UNSUBSCRIBE", "DO_NOT_CONTACT", "STOP_CONTACT"].includes(generated.decision.next_action.toUpperCase())) {
      await this.repository.updateAcquisitionProspectEngagement(prospectId, { status: "DO_NOT_CONTACT", responded: true, optedOut: true });
      return { inbound, proposed: null, optedOut: true, humanHandoff: false };
    }
    const extracted = Object.fromEntries(Object.entries(generated.decision.extracted_information)
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([key, value]) => [key, clean(value, 1000)]));
    const qualification = { ...(prospect.qualification || {}), ...extracted };
    if (Object.keys(extracted).length) {
      await this.repository.updateAcquisitionProspectEngagement(prospectId, {
        status: prospect.status === "HUMAN_HANDOFF" ? "HUMAN_HANDOFF" : "QUALIFYING",
        responded: true,
        qualification,
      });
    }
    const rules = configuration.humanHandoffRules || {};
    const requiresHandoff = generated.decision.request_human || generated.decision.confidence < Number(rules.minimumAIConfidence ?? 0.65) || prospect.status === "HUMAN_HANDOFF";
    if (requiresHandoff && prospect.status !== "DO_NOT_CONTACT") {
      await this.repository.updateAcquisitionProspectEngagement(prospectId, { status: "HUMAN_HANDOFF", responded: true });
      const manual = configuration.communicationMethods.find((method) => method.channel === "MANUAL_HUMAN_FOLLOW_UP" && method.enabled);
      if (manual) await this.queueContact(prospectId, {
        channel: "MANUAL_HUMAN_FOLLOW_UP",
        message: `Review acquisition conversation for ${prospect.companyName}.`,
        idempotencyKey: `acquisition:handoff:${inbound.id}`,
      });
    }
    let policy = { allowed: false, reasons: requiresHandoff ? ["HUMAN_HANDOFF"] : [] };
    if (!requiresHandoff) {
      const method = configuration.communicationMethods.find((candidate) => candidate.channel === channel);
      policy = this.policyEngine.evaluate({ prospect: { ...prospect, responded: true }, method, attempts: 0, isReply: true });
    }
    const proposed = generated.decision.response ? await this.repository.saveAcquisitionConversation({
      acquisitionConfigurationId: configuration.id,
      prospectId,
      leadId: prospect.convertedLeadId,
      channel,
      direction: "OUTBOUND",
      message: generated.decision.response,
      origin: "AI",
      deliveryStatus: policy.allowed ? "PROPOSED" : "BLOCKED",
      externalMessageId: null,
      aiProviderId: generated.providerId,
      aiModel: generated.model,
      decision: generated.decision,
    }) : null;
    let attempt = null;
    if (proposed && policy.allowed && configuration.status === "ACTIVE") {
      attempt = await this.repository.createAcquisitionContactAttempt({
        acquisitionConfigurationId: configuration.id,
        prospectId,
        channel,
        contactValue: prospectContact(prospect, channel),
        message: proposed.message,
        origin: "AI",
        isReply: true,
        idempotencyKey: `acquisition:reply:${inbound.id}`,
        status: "QUEUED",
      });
    }
    return { inbound, proposed, attempt, decision: generated.decision, policy, humanHandoff: requiresHandoff };
  }

  async convert(prospectIdValue) {
    const prospectId = optionalPositiveId(prospectIdValue);
    if (!prospectId) throw validationError("A prospect ID is required.");
    const prospect = (await this.prospects({ prospectId }))[0];
    if (!prospect) throw validationError("Prospect was not found.", 404);
    if (prospect.convertedLeadId) return this.repository.convertAcquisitionProspect(prospectId);
    const configuration = (await this.configurations(prospect.acquisitionConfigurationId))[0];
    const criteria = configuration.conversionCriteria || {};
    const engaged = prospect.responded || ["ENGAGED", "QUALIFYING", "QUALIFIED", "CONVERSION_READY", "HUMAN_HANDOFF"].includes(prospect.status);
    const registered = criteria.allowLandingRegistration !== false && prospect.source === "LANDING_PAGE";
    if (criteria.requireEngagement !== false && !engaged && !registered) {
      throw validationError("This prospect has not engaged or registered and does not meet conversion criteria.", 409);
    }
    if (prospect.fitScore < Number(criteria.minimumFitScore || 0)) {
      throw validationError("This prospect is below the configured conversion fit score.", 409);
    }
    if (prospect.status === "DO_NOT_CONTACT" || prospect.optedOut) throw validationError("Do-not-contact prospects cannot be converted.", 409);
    return this.repository.convertAcquisitionProspect(prospectId);
  }

  async scheduleOutreach(configuration, { now = new Date(), limit = this.outreachBatchSize } = {}) {
    if (!configuration.automaticOutreachEnabled || configuration.status !== "ACTIVE") {
      return { queued: 0, skipped: "Automatic outreach is disabled or the configuration is not active." };
    }
    const prospects = typeof this.repository.getAcquisitionOutreachCandidates === "function"
      ? await this.repository.getAcquisitionOutreachCandidates(configuration.id, 1000)
      : await this.prospects({ configurationId: configuration.id, limit: 1000 });
    const result = { queued: 0, inspected: 0, errors: [] };
    for (const prospect of prospects) {
      if (result.queued >= limit) break;
      result.inspected += 1;
      if (!["GRANTED", "OPT_IN"].includes(String(prospect.consentStatus || "").toUpperCase())) continue;
      if (prospect.responded || prospect.optedOut || prospect.convertedLeadId ||
          ["DO_NOT_CONTACT", "NOT_INTERESTED", "LOST", "HUMAN_HANDOFF"].includes(prospect.status)) continue;
      try {
        const selection = await this.communicationSelection(prospect.id);
        const attempts = selection.attempts;
        if (attempts.some((attempt) => ["QUEUED", "RETRY", "PROCESSING"].includes(attempt.status))) continue;
        const sent = attempts.filter((attempt) => attempt.status === "SENT")
          .sort((left, right) => new Date(left.attemptedAt || left.createdAt) - new Date(right.attemptedAt || right.createdAt));
        if (attempts.some((attempt) => attempt.status === "FAILED") && !sent.length) continue;
        if (sent.length) {
          if (configuration.followUpRules?.enabled === false ||
              sent.length - 1 >= Number(configuration.followUpRules?.maximumFollowUps ?? 3)) continue;
          const lastSent = sent.at(-1);
          const nextDue = new Date(lastSent.attemptedAt || lastSent.createdAt).getTime() +
            Number(configuration.followUpRules?.delayBetweenAttemptsMinutes ?? 1440) * 60_000;
          if (now.getTime() < nextDue) continue;
        }
        const selected = selection.selected;
        if (!selected || selected.method.channel === "MANUAL_HUMAN_FOLLOW_UP") continue;
        if (sent.length && configuration.followUpRules?.channelEscalationEnabled === false &&
            selected.method.channel !== sent[0].channel) continue;
        await this.queueContact(prospect.id, {
          channel: selected.method.channel,
          idempotencyKey: `acquisition:auto:${prospect.id}:${sent.length}`,
        });
        result.queued += 1;
      } catch (error) {
        result.errors.push({ prospectId: prospect.id, error: clean(error?.message || error, 500) });
      }
    }
    return result;
  }

  async tick(now = new Date()) {
    const date = now.toISOString().slice(0, 10);
    const configurations = (await this.configurations()).filter((configuration) =>
      configuration.status === "ACTIVE" &&
      (!configuration.startDate || configuration.startDate <= date) &&
      (!configuration.endDate || configuration.endDate >= date));
    const results = [];
    for (const configuration of configurations) {
      const result = { configurationId: configuration.id };
      try {
        result.discovery = await this.discover(configuration.id);
      } catch (error) {
        result.discoveryError = clean(error?.message || error, 1000);
      }
      try { result.apolloEnrichment = await this.enrichApollo(configuration.id); }
      catch (error) { result.apolloEnrichmentError = clean(error?.message || error, 1000); }
      try { result.outreach = await this.scheduleOutreach(configuration, { now }); }
      catch (error) { result.outreachError = clean(error?.message || error, 1000); }
      results.push(result);
    }
    return results;
  }
}
