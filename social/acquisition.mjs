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
  const haystack = [raw.companyName, raw.industry, raw.location, raw.description, raw.categories, raw.website]
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
        const found = await provider.searchProspects({ configuration, settings: source.settings, rows });
        let persisted = 0;
        let belowMinimum = 0;
        for (const candidate of found) {
          const detailed = await provider.getProspectDetails(candidate, { configuration, settings: source.settings });
          const enriched = await provider.enrichProspect(detailed, { configuration, settings: source.settings });
          const prospect = provider.normalizeProspect(enriched, { configuration });
          if (!provider.validateProspect(prospect)) continue;
          if (prospect.fitScore < minimumFit) { belowMinimum += 1; continue; }
          const saved = await this.repository.upsertAcquisitionProspect(prospect);
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
      try { result.outreach = await this.scheduleOutreach(configuration, { now }); }
      catch (error) { result.outreachError = clean(error?.message || error, 1000); }
      results.push(result);
    }
    return results;
  }
}
