import { Resend } from "resend";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const ACQUISITION_TAG_NAME = "crm_source";
const ACQUISITION_TAG_VALUE = "ai_acquisition";
const RESEND_RETRYABLE_ERRORS = new Set([
  "application_error",
  "concurrent_idempotent_requests",
  "internal_server_error",
  "rate_limit_exceeded",
]);
const RESEND_FAILURE_EVENTS = new Set([
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
]);
const RESEND_EMAIL_EVENTS = new Set([
  "email.bounced",
  "email.clicked",
  "email.complained",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.opened",
  "email.sent",
  "email.suppressed",
]);

function clean(value, maximum = 10_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function enabled(value) {
  return TRUE_VALUES.has(clean(value, 16).toLowerCase());
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function safeErrorMessage(error) {
  return clean(error?.message || error || "Unexpected Resend delivery error.", 1000)
    .replace(/\b(re_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9_+/=-]+)\b/g, "[redacted]")
    .replace(/(api[_ -]?key|authorization|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function htmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlFromText(value) {
  return clean(value, 100_000)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${htmlEscape(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function interpolateSubject(template, context) {
  return clean(template, 500)
    .replaceAll("{companyName}", clean(context.companyName, 255))
    .replaceAll("{productOrService}", clean(context.productOrService, 255))
    .replaceAll("{acquisitionName}", clean(context.acquisitionName, 255))
    .trim()
    .slice(0, 500);
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => clean(item, 500)).filter(Boolean) : [clean(value, 500)].filter(Boolean);
}

function normalizePayload(value, expectedRecipient = "") {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const recipients = stringArray(payload.to);
  const recipient = clean(expectedRecipient, 320);
  if (recipient && (recipients.length !== 1 || recipients[0].toLowerCase() !== recipient.toLowerCase())) {
    throw Object.assign(new Error("The frozen email recipient does not match the acquisition attempt."), {
      code: "EMAIL_PAYLOAD_RECIPIENT_MISMATCH",
      retryable: false,
    });
  }
  const normalized = {
    from: clean(payload.from, 500),
    to: recipients[0] || recipient,
    subject: clean(payload.subject, 500),
    text: clean(payload.text, 100_000),
    html: clean(payload.html, 200_000),
  };
  const replyTo = stringArray(payload.replyTo);
  if (replyTo.length) normalized.replyTo = replyTo.length === 1 ? replyTo[0] : replyTo;
  if (payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)) {
    normalized.headers = Object.fromEntries(Object.entries(payload.headers)
      .map(([name, headerValue]) => [clean(name, 100), clean(headerValue, 1000)])
      .filter(([name, headerValue]) => name && headerValue));
  }
  const tags = Array.isArray(payload.tags) ? payload.tags
    .map((tag) => ({ name: clean(tag?.name, 256), value: clean(tag?.value, 256) }))
    .filter((tag) => tag.name && tag.value && tag.name !== ACQUISITION_TAG_NAME) : [];
  normalized.tags = [...tags, { name: ACQUISITION_TAG_NAME, value: ACQUISITION_TAG_VALUE }];
  if (!normalized.from || !normalized.to || !normalized.subject || (!normalized.text && !normalized.html)) {
    throw Object.assign(new Error("The frozen acquisition email payload is incomplete."), {
      code: "EMAIL_PAYLOAD_INCOMPLETE",
      retryable: false,
    });
  }
  return normalized;
}

function eventFailureReason(event) {
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  return clean(
    data.bounce?.message || data.failed?.reason || data.failed?.message || data.suppressed?.message ||
      data.complaint?.message || data.reason || "",
    1000,
  );
}

function eventTime(event) {
  const candidate = clean(event?.created_at || event?.data?.created_at, 64);
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function retryAt(attempt, error, now = new Date()) {
  const schedule = [60, 300, 900, 3600, 7200];
  const fallback = schedule[Math.min(Math.max(0, Number(attempt.attemptCount || 1) - 1), schedule.length - 1)];
  const seconds = boundedInteger(error?.retryAfterSeconds, fallback, 1, 21_600);
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function acquisitionEmailConfiguration(env = process.env) {
  const workerEnabled = enabled(env.ACQUISITION_EMAIL_WORKER_ENABLED);
  const apiKey = clean(env.RESEND_API_KEY, 10_000);
  const from = clean(env.RESEND_FROM_EMAIL, 500);
  const replyTo = clean(env.RESEND_REPLY_TO, 500);
  const webhookSecret = clean(env.RESEND_WEBHOOK_SECRET, 10_000);
  return {
    enabled: workerEnabled,
    apiKey,
    from,
    replyTo,
    webhookSecret,
    subjectTemplate: clean(env.RESEND_ACQUISITION_SUBJECT, 500),
    intervalMs: boundedInteger(env.ACQUISITION_EMAIL_WORKER_INTERVAL_MS, 10_000, 1_000, 300_000),
    batchSize: boundedInteger(env.ACQUISITION_EMAIL_WORKER_BATCH_SIZE, 10, 1, 100),
    requestTimeoutMs: boundedInteger(env.RESEND_REQUEST_TIMEOUT_MS, 15_000, 1_000, 60_000),
    sendConfigured: Boolean(apiKey && from),
    webhookConfigured: Boolean(webhookSecret),
    configured: Boolean(apiKey && from && webhookSecret),
  };
}

export function buildAcquisitionEmailPayload({ prospect, configuration, contactValue, message, subject, env = process.env } = {}) {
  const settings = acquisitionEmailConfiguration(env);
  if (!settings.from) return null;
  const context = {
    companyName: prospect?.companyName,
    productOrService: configuration?.productOrService,
    acquisitionName: configuration?.acquisitionName,
  };
  const fallbackSubject = context.companyName ? `A quick question for ${context.companyName}` : "A quick question";
  const resolvedSubject = clean(subject, 500) ||
    interpolateSubject(settings.subjectTemplate || fallbackSubject, context) || fallbackSubject;
  const text = clean(message, 100_000);
  return normalizePayload({
    from: settings.from,
    to: clean(contactValue, 320),
    subject: resolvedSubject,
    text,
    html: htmlFromText(text),
    ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
    headers: { "X-CRM-Template-Version": "acquisition-v1" },
  }, contactValue);
}

export class ResendEmailAdapter {
  constructor({ env = process.env, client } = {}) {
    this.configuration = acquisitionEmailConfiguration(env);
    this.client = client || null;
  }

  getClient({ webhookOnly = false } = {}) {
    if (this.client) return this.client;
    if (!webhookOnly && !this.configuration.apiKey) {
      throw Object.assign(new Error("Resend email delivery is not configured."), {
        code: "EMAIL_PROVIDER_NOT_CONFIGURED",
        statusCode: 503,
        retryable: false,
      });
    }
    this.client = new Resend(this.configuration.apiKey || "re_webhook_verification_only");
    return this.client;
  }

  async send(payload, { idempotencyKey } = {}) {
    const normalized = normalizePayload(payload);
    const key = clean(idempotencyKey, 256);
    if (!key) {
      throw Object.assign(new Error("A stable Resend idempotency key is required."), {
        code: "EMAIL_IDEMPOTENCY_KEY_REQUIRED",
        retryable: false,
      });
    }
    try {
      const response = await this.getClient().emails.send(normalized, {
        idempotencyKey: key,
        signal: AbortSignal.timeout(this.configuration.requestTimeoutMs),
      });
      if (response.error) {
        const error = Object.assign(new Error(safeErrorMessage(response.error)), {
          code: response.error.name || "RESEND_ERROR",
          statusCode: Number(response.error.statusCode) || 502,
          retryable: RESEND_RETRYABLE_ERRORS.has(response.error.name) || Number(response.error.statusCode) >= 500,
          retryAfterSeconds: Number(response.headers?.["retry-after"]) || null,
        });
        throw error;
      }
      const id = clean(response.data?.id, 255);
      if (!id) throw Object.assign(new Error("Resend accepted the request without returning an email ID."), {
        code: "RESEND_EMAIL_ID_MISSING",
        retryable: true,
      });
      return { id };
    } catch (error) {
      if (typeof error?.retryable === "boolean") throw error;
      throw Object.assign(new Error(safeErrorMessage(error)), {
        code: clean(error?.code, 64) || "RESEND_NETWORK_ERROR",
        statusCode: Number(error?.statusCode) || 502,
        retryable: true,
      });
    }
  }

  verifyWebhook(rawBody, headers) {
    if (!this.configuration.webhookSecret) {
      throw Object.assign(new Error("Resend webhook verification is not configured."), { statusCode: 503 });
    }
    const id = clean(headers?.id, 255);
    const timestamp = clean(headers?.timestamp, 255);
    const signature = clean(headers?.signature, 2000);
    if (!id || !timestamp || !signature) {
      throw Object.assign(new Error("Required Resend webhook signature headers are missing."), { statusCode: 401 });
    }
    try {
      return this.getClient({ webhookOnly: true }).webhooks.verify({
        payload: String(rawBody || ""),
        headers: { id, timestamp, signature },
        webhookSecret: this.configuration.webhookSecret,
      });
    } catch {
      throw Object.assign(new Error("Invalid Resend webhook signature."), { statusCode: 401 });
    }
  }
}

export class AcquisitionEmailWorker {
  constructor({ acquisitionService, repository, adapter, env = process.env, logger = console } = {}) {
    this.acquisitionService = acquisitionService;
    this.repository = repository;
    this.adapter = adapter || new ResendEmailAdapter({ env });
    this.configuration = acquisitionEmailConfiguration(env);
    this.env = env;
    this.logger = logger;
    this.running = false;
    this.stopped = true;
    this.timer = null;
    this.lastHeartbeatAt = null;
    this.lastStartedAt = null;
    this.lastCompletedAt = null;
    this.lastSuccessAt = null;
    this.lastError = "";
    this.lastBatch = { claimed: 0, accepted: 0, retrying: 0, failed: 0 };
  }

  start() {
    if (!this.configuration.enabled || !this.stopped) return false;
    this.stopped = false;
    const schedule = (delay) => {
      if (this.stopped) return;
      this.timer = setTimeout(async () => {
        try {
          await this.tick();
        } catch (error) {
          this.logger.error?.(JSON.stringify({
            component: "acquisition_email_worker",
            operation: "tick",
            status: "error",
            error: safeErrorMessage(error),
          }));
        } finally {
          schedule(this.configuration.intervalMs);
        }
      }, delay);
      this.timer.unref?.();
    };
    schedule(0);
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async prepareAttempt(attempt, lockToken) {
    let payload = attempt.emailPayload;
    if (!payload) {
      payload = buildAcquisitionEmailPayload({
        contactValue: attempt.contactValue,
        message: attempt.message,
        subject: this.configuration.subjectTemplate || "A quick question",
        env: this.env,
      });
      if (!payload) {
        throw Object.assign(new Error("RESEND_FROM_EMAIL is required to prepare acquisition email delivery."), {
          code: "RESEND_FROM_EMAIL_MISSING",
          retryable: false,
        });
      }
      if (typeof this.repository?.freezeAcquisitionEmailPayload === "function") {
        const frozen = await this.repository.freezeAcquisitionEmailPayload(attempt.id, lockToken, payload);
        payload = frozen?.emailPayload || payload;
      }
    }
    return normalizePayload(payload, attempt.contactValue);
  }

  async processAttempt(attempt, lockToken) {
    let payload;
    let delivery;
    try {
      payload = await this.prepareAttempt(attempt, lockToken);
      delivery = await this.adapter.send(payload, { idempotencyKey: attempt.idempotencyKey });
    } catch (error) {
      const retryable = error?.retryable === true;
      await this.acquisitionService.completeOutreach(attempt.id, {
        lockToken,
        succeeded: false,
        retryable,
        nextAttemptAt: retryable ? retryAt(attempt, error) : null,
        error: safeErrorMessage(error),
        providerStatus: retryable ? "RETRY_SCHEDULED" : "REJECTED",
      });
      this.logger.error?.(JSON.stringify({
        component: "acquisition_email_worker",
        operation: "send",
        status: retryable ? "retry_scheduled" : "failed",
        attemptId: attempt.id,
        errorCode: clean(error?.code, 64) || "RESEND_ERROR",
        error: safeErrorMessage(error),
      }));
      return retryable ? "retrying" : "failed";
    }
    await this.acquisitionService.completeOutreach(attempt.id, {
      lockToken,
      succeeded: true,
      externalMessageId: delivery.id,
      providerStatus: "ACCEPTED",
    });
    this.lastSuccessAt = new Date().toISOString();
    return "accepted";
  }

  async tick() {
    this.lastHeartbeatAt = new Date().toISOString();
    if (!this.configuration.enabled) return { skipped: "disabled", ...this.lastBatch };
    if (!this.configuration.sendConfigured) {
      this.lastError = "Resend sending configuration is incomplete.";
      throw Object.assign(new Error(this.lastError), { code: "RESEND_CONFIGURATION_INCOMPLETE" });
    }
    if (this.running) return { skipped: "already_running", ...this.lastBatch };
    this.running = true;
    this.lastStartedAt = new Date().toISOString();
    const batch = { claimed: 0, accepted: 0, retrying: 0, failed: 0 };
    try {
      const claim = await this.acquisitionService.claimOutreach({
        limit: this.configuration.batchSize,
        channel: "EMAIL",
      });
      const attempts = Array.isArray(claim.attempts) ? claim.attempts : [];
      batch.claimed = attempts.length;
      for (const attempt of attempts) {
        const outcome = await this.processAttempt(attempt, claim.lockToken);
        batch[outcome] += 1;
      }
      this.lastBatch = batch;
      this.lastError = "";
      return batch;
    } catch (error) {
      this.lastError = safeErrorMessage(error);
      throw error;
    } finally {
      this.running = false;
      this.lastCompletedAt = new Date().toISOString();
    }
  }

  async handleWebhook(rawBody, headers) {
    const event = this.adapter.verifyWebhook(rawBody, headers);
    const eventType = clean(event?.type, 64).toLowerCase();
    if (!RESEND_EMAIL_EVENTS.has(eventType)) return { ignored: true, eventType };
    const tags = event?.data?.tags && typeof event.data.tags === "object" ? event.data.tags : {};
    if (clean(tags[ACQUISITION_TAG_NAME], 256) !== ACQUISITION_TAG_VALUE) {
      return { ignored: true, eventType, reason: "foreign_application" };
    }
    const externalMessageId = clean(event?.data?.email_id, 255);
    if (!externalMessageId) {
      throw Object.assign(new Error("Resend webhook did not include an email ID."), { statusCode: 400 });
    }
    if (typeof this.repository?.applyAcquisitionEmailEvent !== "function") {
      throw Object.assign(new Error("Acquisition email event storage is unavailable."), { statusCode: 503 });
    }
    const result = await this.repository.applyAcquisitionEmailEvent({
      webhookEventId: clean(headers?.id, 255),
      externalMessageId,
      eventType,
      eventAt: eventTime(event),
      failureReason: RESEND_FAILURE_EVENTS.has(eventType) ? eventFailureReason(event) : "",
      payload: event,
    });
    if (result?.matched === false) {
      throw Object.assign(new Error("The Resend email has not been linked to its acquisition attempt yet."), {
        statusCode: 503,
        code: "RESEND_ATTEMPT_NOT_LINKED",
      });
    }
    return { ignored: false, eventType, duplicate: Boolean(result?.duplicate), attemptId: result?.attemptId || null };
  }

  async health() {
    const queue = typeof this.repository?.getAcquisitionEmailQueueHealth === "function"
      ? await this.repository.getAcquisitionEmailQueueHealth()
      : { queued: 0, due: 0, processing: 0, failedLast24Hours: 0, oldestPendingAt: null, lastAcceptedAt: null, lastDeliveredAt: null };
    const status = !this.configuration.enabled ? "DISABLED"
      : !this.configuration.configured ? "MISCONFIGURED"
        : this.running ? "RUNNING"
          : this.lastError ? "DEGRADED" : "READY";
    return {
      status,
      enabled: this.configuration.enabled,
      configured: this.configuration.configured,
      sendConfigured: this.configuration.sendConfigured,
      webhookConfigured: this.configuration.webhookConfigured,
      running: this.running,
      intervalMs: this.configuration.intervalMs,
      batchSize: this.configuration.batchSize,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastStartedAt: this.lastStartedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError || null,
      lastBatch: { ...this.lastBatch },
      queue,
    };
  }
}
