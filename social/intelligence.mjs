export const INTERACTION_TYPES = Object.freeze([
  "COMMENT", "REPLY", "MENTION", "LIKE", "REACTION", "SHARE", "REPOST",
  "DIRECT_MESSAGE", "STORY_REPLY", "STORY_MENTION", "LEAD_FORM_SUBMISSION",
  "ADVERTISEMENT_CLICK", "PROFILE_VISIT", "POST_INTERACTION",
]);

export const INTENT_CATEGORIES = Object.freeze([
  "INFORMATION_REQUEST", "PRICE_REQUEST", "QUOTE_REQUEST", "DEMO_REQUEST",
  "APPOINTMENT_REQUEST", "CALL_REQUEST", "PURCHASE_INTENT", "SUPPORT_REQUEST",
  "COMPLAINT", "REFUND_REQUEST", "PRODUCT_QUESTION", "AVAILABILITY_REQUEST",
  "LOCATION_REQUEST", "INSTALLATION_REQUEST", "CUSTOMIZATION_REQUEST",
  "PARTNERSHIP", "JOB_INQUIRY", "SPAM", "OTHER",
]);

export const DEFAULT_SCORING_RULES = Object.freeze({
  COMMENT_ON_ADVERTISEMENT: 10,
  DIRECT_MESSAGE: 15,
  PRICE_REQUEST: 20,
  QUOTE_REQUEST: 30,
  PHONE_NUMBER_PROVIDED: 25,
  EMAIL_PROVIDED: 20,
  APPOINTMENT_REQUEST: 25,
  DEMO_REQUEST: 30,
  PURCHASE_INTEREST_CONFIRMED: 40,
});

export const DEFAULT_TEMPERATURE_THRESHOLDS = Object.freeze({
  COLD: 0,
  WARM: 20,
  HOT: 50,
  VERY_HOT: 80,
});

const INTERACTION_ALIASES = Object.freeze({
  comment: "COMMENT",
  comments: "COMMENT",
  reply: "REPLY",
  mention: "MENTION",
  like: "LIKE",
  reaction: "REACTION",
  share: "SHARE",
  repost: "REPOST",
  retweet: "REPOST",
  message: "DIRECT_MESSAGE",
  direct_message: "DIRECT_MESSAGE",
  dm: "DIRECT_MESSAGE",
  story_reply: "STORY_REPLY",
  story_mention: "STORY_MENTION",
  lead: "LEAD_FORM_SUBMISSION",
  leadgen: "LEAD_FORM_SUBMISSION",
  lead_form_submission: "LEAD_FORM_SUBMISSION",
  ad_click: "ADVERTISEMENT_CLICK",
  advertisement_click: "ADVERTISEMENT_CLICK",
  profile_visit: "PROFILE_VISIT",
});

const INTENT_PATTERNS = Object.freeze([
  ["SPAM", /\b(spam|crypto giveaway|guaranteed followers|click my bio)\b/i],
  ["REFUND_REQUEST", /\b(refund|money back|chargeback)\b/i],
  ["COMPLAINT", /\b(complaint|unhappy|terrible|poor service|not satisfied)\b/i],
  ["SUPPORT_REQUEST", /\b(help|support|not working|issue|problem|broken)\b/i],
  ["QUOTE_REQUEST", /\b(quote|quotation|estimate|proposal)\b/i],
  ["PRICE_REQUEST", /\b(price|pricing|cost|how much|rate)\b/i],
  ["DEMO_REQUEST", /\b(demo|demonstration|show me how)\b/i],
  ["APPOINTMENT_REQUEST", /\b(appointment|book a meeting|schedule a meeting|consultation)\b/i],
  ["CALL_REQUEST", /\b(call me|phone me|give me a call)\b/i],
  ["PURCHASE_INTENT", /\b(buy|purchase|order|sign[ -]?up|subscribe|ready to start|register)\b/i],
  ["AVAILABILITY_REQUEST", /\b(available|availability|in stock|openings)\b/i],
  ["LOCATION_REQUEST", /\b(where are you|location|located|address|nearest)\b/i],
  ["INSTALLATION_REQUEST", /\b(install|installation|setup service)\b/i],
  ["CUSTOMIZATION_REQUEST", /\b(custom|customize|customise|tailor|bespoke)\b/i],
  ["PARTNERSHIP", /\b(partner|partnership|collaborat|affiliate|reseller)\b/i],
  ["JOB_INQUIRY", /\b(job|career|hiring|vacancy|resume|cv)\b/i],
  ["PRODUCT_QUESTION", /\b(product|service|feature|package|plan).*(\?|details|include|work)/i],
  ["INFORMATION_REQUEST", /\b(details|information|learn more|tell me more|send (?:me )?info|webinar)\b/i],
]);

const LEAD_CREATING_INTENTS = new Set([
  "INFORMATION_REQUEST", "PRICE_REQUEST", "QUOTE_REQUEST", "DEMO_REQUEST",
  "APPOINTMENT_REQUEST", "CALL_REQUEST", "PURCHASE_INTENT", "PRODUCT_QUESTION",
  "AVAILABILITY_REQUEST", "LOCATION_REQUEST", "INSTALLATION_REQUEST",
  "CUSTOMIZATION_REQUEST", "PARTNERSHIP",
]);

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeInteractionType(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  return INTERACTION_ALIASES[normalized] || "POST_INTERACTION";
}

export function classifyIntent(message, interactionType = "POST_INTERACTION") {
  const text = clean(message) || "";
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(text)) return intent;
  }
  if (interactionType === "LEAD_FORM_SUBMISSION") return "INFORMATION_REQUEST";
  return "OTHER";
}

export function extractQualification(message, intent = "OTHER") {
  const text = clean(message) || "";
  const quantity = text.match(/\b(\d{1,6})\s*(units?|licenses?|seats?|people|items?|copies?)\b/i);
  const budget = text.match(/(?:budget(?: is| of)?\s*)?(?:USD\s*)?\$\s?([\d,]+(?:\.\d{1,2})?)/i);
  const location = text.match(/\b(?:in|near|located in|from)\s+([A-Za-z][A-Za-z .'-]{1,60})(?:[,.!?]|$)/i);
  const product = text.match(/\b(?:interested in|need|want|looking for)\s+([^,.!?]{2,100})/i);
  const timeline = text.match(/\b(today|tomorrow|this week|next week|this month|next month|immediately|as soon as possible|asap|within \d+ (?:days?|weeks?|months?))\b/i);
  return {
    customerNeed: product?.[1]?.trim() || null,
    productService: product?.[1]?.trim() || null,
    quantity: quantity ? Number(quantity[1]) : null,
    location: location?.[1]?.trim() || null,
    budget: budget ? Number(budget[1].replace(/,/g, "")) : null,
    purchaseTimeline: timeline?.[1]?.toLowerCase() || null,
    decisionMaker: /\b(i am|i'm|im) (?:the )?(?:owner|founder|decision maker|manager)\b/i.test(text) ? true : null,
    buyingIntent: intent === "PURCHASE_INTENT" || intent === "QUOTE_REQUEST" || intent === "PRICE_REQUEST",
  };
}

export function calculateScore(event, intelligence, rules = DEFAULT_SCORING_RULES) {
  const keys = [];
  if (intelligence.interactionType === "COMMENT" && event.adId) keys.push("COMMENT_ON_ADVERTISEMENT");
  if (intelligence.interactionType === "DIRECT_MESSAGE") keys.push("DIRECT_MESSAGE");
  if (intelligence.intent === "PRICE_REQUEST") keys.push("PRICE_REQUEST");
  if (intelligence.intent === "QUOTE_REQUEST") keys.push("QUOTE_REQUEST");
  if (event.phone) keys.push("PHONE_NUMBER_PROVIDED");
  if (event.email) keys.push("EMAIL_PROVIDED");
  if (intelligence.intent === "APPOINTMENT_REQUEST") keys.push("APPOINTMENT_REQUEST");
  if (intelligence.intent === "DEMO_REQUEST") keys.push("DEMO_REQUEST");
  if (intelligence.intent === "PURCHASE_INTENT") keys.push("PURCHASE_INTEREST_CONFIRMED");
  return {
    scoreDelta: keys.reduce((total, key) => total + Math.max(0, Number(rules[key]) || 0), 0),
    appliedRules: keys,
  };
}

export function temperatureForScore(score, thresholds = DEFAULT_TEMPERATURE_THRESHOLDS) {
  const value = Number(score) || 0;
  if (value >= Number(thresholds.VERY_HOT ?? 80)) return "VERY_HOT";
  if (value >= Number(thresholds.HOT ?? 50)) return "HOT";
  if (value >= Number(thresholds.WARM ?? 20)) return "WARM";
  return "COLD";
}

export function shouldCreateLead(interactionType, intent) {
  if (["LIKE", "REACTION", "SHARE", "REPOST", "PROFILE_VISIT"].includes(interactionType)) return false;
  if (interactionType === "LEAD_FORM_SUBMISSION") return true;
  if (interactionType === "DIRECT_MESSAGE") return LEAD_CREATING_INTENTS.has(intent);
  if (["COMMENT", "REPLY", "MENTION", "STORY_REPLY", "STORY_MENTION"].includes(interactionType)) {
    return LEAD_CREATING_INTENTS.has(intent);
  }
  return ["PRICE_REQUEST", "QUOTE_REQUEST", "PURCHASE_INTENT"].includes(intent);
}

export function evaluateSocialEvent(event, {
  scoringRules = DEFAULT_SCORING_RULES,
  temperatureThresholds = DEFAULT_TEMPERATURE_THRESHOLDS,
  currentScore = 0,
} = {}) {
  const interactionType = normalizeInteractionType(event.eventType);
  const intent = classifyIntent(event.message, interactionType);
  const qualification = extractQualification(event.message, intent);
  const sentiment = ["COMPLAINT", "REFUND_REQUEST"].includes(intent)
    ? "NEGATIVE"
    : /\b(great|love|excellent|amazing|thank|helpful)\b/i.test(event.message || "")
      ? "POSITIVE"
      : "NEUTRAL";
  const scoring = calculateScore(event, { interactionType, intent }, scoringRules);
  const projectedScore = Math.max(0, Number(currentScore) || 0) + scoring.scoreDelta;
  return {
    interactionType,
    intent,
    sentiment,
    qualification,
    scoreDelta: scoring.scoreDelta,
    appliedScoringRules: scoring.appliedRules,
    projectedScore,
    temperature: temperatureForScore(projectedScore, temperatureThresholds),
    shouldCreateLead: shouldCreateLead(interactionType, intent),
    sourceType: event.adId || event.leadFormId ? "PAID" : "ORGANIC",
  };
}
