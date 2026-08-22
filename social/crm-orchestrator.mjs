import { createHash, randomUUID } from "node:crypto";
import { ProviderError } from "./core.mjs";

function safeMessage(error) {
  return String(error?.message || error || "Integration action failed.")
    .replace(/(access[_ -]?token|bearer|api[_ -]?key|client[_ -]?secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .slice(0, 1000);
}

export function sanitizeIntegrationData(value) {
  if (Array.isArray(value)) return value.map(sanitizeIntegrationData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /(token|secret|password|authorization|api.?key)/i.test(key) ? "[redacted]" : sanitizeIntegrationData(item),
  ]));
}

function defaultIdempotencyKey(input) {
  return createHash("sha256").update(JSON.stringify({
    provider: input.provider,
    actionType: input.actionType,
    campaignId: input.campaignId || null,
    payload: sanitizeIntegrationData(input.payload || {}),
  })).digest("hex");
}

function retryAt(attempt, now = new Date()) {
  const minutes = Math.min(60, 2 ** Math.max(0, Number(attempt || 1) - 1));
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export class CrmSocialOrchestrator {
  constructor({ repository, listener, sprout, logger = console, clock = () => new Date() }) {
    this.repository = repository;
    this.listener = listener;
    this.sprout = sprout;
    this.logger = logger;
    this.clock = clock;
    this.running = false;
  }

  getIntegrationStatuses() {
    return [this.sprout.status()];
  }

  testIntegration(provider) {
    if (provider !== "sprout") throw Object.assign(new Error("Unsupported integration provider."), { statusCode: 400 });
    return this.sprout.healthCheck();
  }

  async collectSproutMetrics(options = {}) {
    const values = await this.sprout.collectMetrics(options);
    await this.repository.saveMetrics("sprout", values);
    await this.repository.insertAuditLog?.({
      entityType: "Integration",
      entityId: "sprout",
      action: "METRICS_REFRESHED",
      actorType: "SYSTEM",
      actorId: "crm-social-orchestrator",
      correlationId: null,
      details: { profiles: values.profiles.length, posts: values.posts.length },
    });
    return values;
  }

  async queueAction(input) {
    const provider = String(input.provider || "sprout").toLowerCase();
    const actionType = String(input.actionType || "PUBLISH_POST").toUpperCase();
    if (provider !== "sprout") throw Object.assign(new Error("Only the Sprout integration is supported by this action queue."), { statusCode: 400 });
    if (actionType !== "PUBLISH_POST") throw Object.assign(new Error("Unsupported CRM integration action."), { statusCode: 400 });
    const payload = sanitizeIntegrationData(input.payload || {});
    if (!String(payload.text || "").trim()) throw Object.assign(new Error("Post text is required."), { statusCode: 400 });
    const action = await this.repository.createIntegrationAction({
      provider,
      channel: input.channel || null,
      direction: "OUTBOUND",
      eventType: actionType,
      idempotencyKey: String(input.idempotencyKey || defaultIdempotencyKey({ ...input, provider, actionType, payload })),
      campaignId: input.campaignId || null,
      leadId: input.leadId || null,
      request: payload,
      maxAttempts: Math.max(1, Math.min(10, Number(input.maxAttempts || 4))),
    });
    await this.repository.insertAuditLog?.({
      entityType: "IntegrationEvent",
      entityId: action.id,
      action: action.duplicate ? "ACTION_DEDUPLICATED" : "ACTION_QUEUED",
      actorType: "CRM",
      actorId: input.actorId || "crm-dashboard",
      correlationId: action.idempotencyKey,
      details: { provider, actionType, campaignId: input.campaignId || null },
    });
    return action;
  }

  async executeAction(action) {
    const workflow = await this.repository.startWorkflowRun?.({
      workflowType: "SOCIAL_OUTBOUND",
      triggerType: "INTEGRATION_EVENT",
      triggerRecordId: action.id,
      integrationEventId: action.id,
      context: { provider: action.provider, eventType: action.eventType },
    });
    try {
      if (action.provider !== "sprout" || action.eventType !== "PUBLISH_POST") {
        throw new ProviderError("No adapter supports this integration action.", { retryable: false });
      }
      const result = await this.sprout.createPublishingDraft(action.request);
      const completed = await this.repository.completeIntegrationAction(action.id, {
        lockToken: action.lockToken,
        succeeded: true,
        externalId: result.externalId,
        externalStatus: result.externalStatus,
        response: sanitizeIntegrationData(result),
        processedAt: this.clock().toISOString(),
      });
      await this.repository.completeWorkflowRun?.(workflow?.id, { state: "SUCCEEDED", currentStep: "DELIVERY_RECORDED" });
      await this.repository.insertAuditLog?.({
        entityType: "IntegrationEvent",
        entityId: action.id,
        action: "ACTION_SUCCEEDED",
        actorType: "SYSTEM",
        actorId: "crm-social-orchestrator",
        correlationId: action.idempotencyKey,
        details: { externalId: result.externalId, externalStatus: result.externalStatus, isDraft: true },
      });
      return completed;
    } catch (error) {
      const retryable = error?.retryable === true;
      const nextAttemptAt = retryable && Number(action.attemptCount || 1) < Number(action.maxAttempts || 4)
        ? retryAt(action.attemptCount, this.clock())
        : null;
      const failed = await this.repository.completeIntegrationAction(action.id, {
        lockToken: action.lockToken,
        succeeded: false,
        retryable,
        nextAttemptAt,
        error: safeMessage(error),
        processedAt: this.clock().toISOString(),
      });
      await this.repository.completeWorkflowRun?.(workflow?.id, {
        state: nextAttemptAt ? "RETRY_SCHEDULED" : "FAILED",
        currentStep: "DELIVERY_FAILED",
        error: safeMessage(error),
      });
      await this.repository.insertAuditLog?.({
        entityType: "IntegrationEvent",
        entityId: action.id,
        action: nextAttemptAt ? "ACTION_RETRY_SCHEDULED" : "ACTION_FAILED",
        actorType: "SYSTEM",
        actorId: "crm-social-orchestrator",
        correlationId: action.idempotencyKey,
        details: { retryable, nextAttemptAt, error: safeMessage(error) },
      });
      return failed;
    }
  }

  async runDue({ limit = 10, actionId = null } = {}) {
    if (this.running) return { skipped: true, reason: "integration_action_tick_already_running", actions: [] };
    this.running = true;
    try {
      const actions = await this.repository.claimDueIntegrationActions({
        now: this.clock().toISOString(),
        limit,
        lockToken: randomUUID(),
        actionId,
      });
      const results = [];
      for (const action of actions) results.push(await this.executeAction(action));
      return { skipped: false, claimed: actions.length, actions: results };
    } finally {
      this.running = false;
    }
  }

  async syncSprout(options = {}) {
    const workflow = await this.repository.startWorkflowRun?.({
      workflowType: "SOCIAL_INBOUND",
      triggerType: "SPROUT_SYNC",
      context: { since: options.since || null },
    });
    let processed = 0;
    let duplicates = 0;
    let unsupported = 0;
    let errors = 0;
    try {
      const payloads = await this.sprout.fetchInboundEvents(options);
      for (const payload of payloads) {
        const event = this.sprout.normalizeEvent(payload);
        if (!event) {
          unsupported += 1;
          continue;
        }
        const receiptInput = {
          provider: "sprout",
          channel: event.channel,
          eventType: event.eventType,
          idempotencyKey: `sprout:${event.channel}:${event.externalEventId}`,
          externalId: event.externalEventId,
          request: { source: payload.sprout_source, topicId: payload.sprout_topic_id || null },
        };
        try {
          const result = await this.listener.processNormalizedEvent(event);
          const receipt = await this.repository.recordInboundIntegrationEvent?.({ ...receiptInput, succeeded: true });
          if (result.duplicate || receipt?.duplicate) duplicates += 1;
          else processed += 1;
        } catch (error) {
          errors += 1;
          await this.repository.recordInboundIntegrationEvent?.({ ...receiptInput, succeeded: false, error: safeMessage(error) });
          await this.repository.recordError?.({
            channel: event.channel,
            operation: "sprout_inbound_processing",
            transient: error?.retryable === true,
            message: safeMessage(error),
          });
        }
      }
      await this.repository.completeWorkflowRun?.(workflow?.id, {
        state: errors ? "FAILED" : "SUCCEEDED",
        currentStep: errors ? "CRM_PARTIALLY_UPDATED" : "CRM_UPDATED",
        error: errors ? `${errors} Sprout event(s) could not be processed.` : null,
      });
      return { received: payloads.length, processed, duplicates, unsupported, errors };
    } catch (error) {
      await this.repository.completeWorkflowRun?.(workflow?.id, { state: "FAILED", currentStep: "INGEST_FAILED", error: safeMessage(error) });
      throw error;
    }
  }
}
