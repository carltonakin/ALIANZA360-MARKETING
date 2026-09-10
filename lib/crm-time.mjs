export const CRM_AUTHORITATIVE_TIME_ZONE = "UTC";
export const CRM_DISPLAY_TIME_ZONE = "DEVICE_LOCAL";
// Retained only for the short-lived API compatibility fields introduced by
// migration 022. The browser no longer uses a fixed display timezone.
export const BOGOTA_UTC_OFFSET = "-05:00";

const BOGOTA_OFFSET_MILLISECONDS = 5 * 60 * 60 * 1000;

export function toUtcIso(value) {
  if (value === null || value === undefined || value === "") return null;
  let input = value;
  if (typeof input === "string") {
    const trimmed = input.trim();
    const utcConventionWithoutZone = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?$/.test(trimmed);
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    if (utcConventionWithoutZone) input = `${trimmed.replace(" ", "T")}Z`;
    else if (!hasExplicitZone) return null;
  }
  const parsed = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function toBogotaIso(value) {
  const utc = toUtcIso(value);
  if (!utc) return null;
  const bogotaWallClock = new Date(new Date(utc).getTime() - BOGOTA_OFFSET_MILLISECONDS);
  return bogotaWallClock.toISOString().replace(/Z$/, BOGOTA_UTC_OFFSET);
}

export function dualTimestamp(value) {
  const utc = toUtcIso(value);
  return {
    utc,
    bogota: utc ? toBogotaIso(utc) : null,
  };
}

export function canonicalTimelineTimestamp(record = {}) {
  const explicit = toUtcIso(record.eventTimestampUtc);
  if (explicit) return explicit;

  const direction = String(record.direction || "").toUpperCase();
  if (direction === "OUTBOUND") {
    const sent = toUtcIso(record.sentAtUtc || record.sentAt);
    if (sent) return sent;
  }

  return toUtcIso(
    record.occurredAtUtc || record.occurredAt || record.createdAtUtc || record.createdAt,
  );
}

export function enrichTimelineRecord(record = {}) {
  const occurredAt = dualTimestamp(record.occurredAtUtc || record.occurredAt);
  const sentAt = dualTimestamp(record.sentAtUtc || record.sentAt);
  const eventTimestamp = dualTimestamp(canonicalTimelineTimestamp({
    ...record,
    occurredAtUtc: occurredAt.utc,
    sentAtUtc: sentAt.utc,
  }));
  const eventType = String(record.interactionType || record.type || "").toUpperCase();
  const isRegistration = eventType === "LEAD_FORM_SUBMISSION";

  return {
    ...record,
    occurredAt: occurredAt.utc || record.occurredAt || null,
    occurredAtUtc: occurredAt.utc,
    occurredAtBogota: occurredAt.bogota,
    sentAt: sentAt.utc || record.sentAt || null,
    sentAtUtc: sentAt.utc,
    sentAtBogota: sentAt.bogota,
    eventTimestampUtc: eventTimestamp.utc,
    eventTimestampBogota: eventTimestamp.bogota,
    registeredAtUtc: isRegistration ? eventTimestamp.utc : null,
    registeredAtBogota: isRegistration ? eventTimestamp.bogota : null,
  };
}

function stableTimelineKey(record) {
  const raw = String(record?.id || "");
  const match = raw.match(/^(.*?):(\d+)$/);
  return {
    raw,
    prefix: match?.[1] || raw,
    number: match ? Number(match[2]) : null,
  };
}

export function compareTimelineNewestFirst(left, right) {
  const leftTimestamp = canonicalTimelineTimestamp(left);
  const rightTimestamp = canonicalTimelineTimestamp(right);
  const leftTime = leftTimestamp ? Date.parse(leftTimestamp) : Number.NEGATIVE_INFINITY;
  const rightTime = rightTimestamp ? Date.parse(rightTimestamp) : Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) return rightTime - leftTime;

  const leftKey = stableTimelineKey(left);
  const rightKey = stableTimelineKey(right);
  if (leftKey.prefix === rightKey.prefix && leftKey.number !== null && rightKey.number !== null && leftKey.number !== rightKey.number) {
    return rightKey.number - leftKey.number;
  }
  if (leftKey.raw === rightKey.raw) return 0;
  return rightKey.raw > leftKey.raw ? 1 : -1;
}

function normalizedTimelineType(record = {}) {
  const value = String(record.interactionType || record.type || "").toUpperCase();
  return ["DIRECT_MESSAGE", "STORY_REPLY"].includes(value) ? "DM" : value;
}

function timelineMirrorKey(record = {}) {
  const occurredAt = toUtcIso(record.occurredAtUtc || record.occurredAt) || "";
  const message = String(record.message || record.summary || record.intent || "").trim();
  const campaign = String(record.campaignId ?? record.campaignExternalId ?? "").trim();
  return `${normalizedTimelineType(record)}\u0000${occurredAt}\u0000${message}\u0000${campaign}`;
}

/**
 * SocialEvent_Process intentionally writes one SocialInteraction and one
 * LeadActivity for the same source event. The Unified Lead Timeline should
 * project that source event once. Only unambiguous one-to-one mirrors are
 * collapsed; repeated or otherwise ambiguous records remain visible.
 */
export function dedupeTimelineProjection(records = []) {
  const interactionCounts = new Map();
  const activityCounts = new Map();

  for (const record of records) {
    const key = timelineMirrorKey(record);
    const target = String(record?.id || "").startsWith("activity:") ? activityCounts : interactionCounts;
    target.set(key, (target.get(key) || 0) + 1);
  }

  return records.filter((record) => {
    if (!String(record?.id || "").startsWith("activity:")) return true;
    const key = timelineMirrorKey(record);
    return interactionCounts.get(key) !== 1 || activityCounts.get(key) !== 1;
  });
}
