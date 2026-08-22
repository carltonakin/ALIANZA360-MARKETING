import { randomUUID } from "node:crypto";

function safeMessage(error) {
  return String(error?.message || error || "Campaign execution failed.")
    .replace(/(access[_ -]?token|bearer|api[_ -]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500);
}

export function nextCampaignRun(campaign, now = new Date(), retryCount = 0) {
  const cadenceMinutes = Math.max(1, Math.min(10_080, Number(campaign.cadenceMinutes) || 60));
  const retryDelay = retryCount > 0 ? Math.min(cadenceMinutes, 2 ** Math.min(retryCount, 8)) : cadenceMinutes;
  return new Date(now.getTime() + retryDelay * 60_000).toISOString();
}

export class CampaignAutomationEngine {
  constructor({ repository, listener, logger = console, clock = () => new Date(), batchSize = 10 }) {
    this.repository = repository;
    this.listener = listener;
    this.logger = logger;
    this.clock = clock;
    this.batchSize = Math.max(1, Math.min(100, Number(batchSize) || 10));
    this.running = false;
  }

  async runCampaign(campaign) {
    const startedAt = this.clock();
    try {
      const result = await this.listener.runCampaign(campaign);
      const nextRunAt = nextCampaignRun(campaign, startedAt);
      await this.repository.completeCampaignRun(campaign.id, {
        lockToken: campaign.lockToken,
        succeeded: true,
        lastRunAt: startedAt.toISOString(),
        nextRunAt,
        metrics: result.metrics,
        processed: result.processed,
      });
      return { campaignId: campaign.id, status: "succeeded", nextRunAt, ...result };
    } catch (error) {
      const retryCount = Number(campaign.retryCount || 0) + 1;
      const retryable = error?.retryable !== false && retryCount <= Number(campaign.maxRetries ?? 3);
      const nextRunAt = retryable ? nextCampaignRun(campaign, startedAt, retryCount) : null;
      const message = safeMessage(error);
      await this.repository.completeCampaignRun(campaign.id, {
        lockToken: campaign.lockToken,
        succeeded: false,
        lastRunAt: startedAt.toISOString(),
        nextRunAt,
        retryCount,
        retryable,
        error: message,
      });
      await this.repository.recordError({
        channel: campaign.platform,
        operation: "campaign_automation",
        code: error?.code,
        transient: retryable,
        message,
      });
      return { campaignId: campaign.id, status: retryable ? "retry_scheduled" : "failed", nextRunAt, error: message };
    }
  }

  async tick() {
    if (this.running) return { skipped: true, reason: "automation_tick_already_running", campaigns: [] };
    this.running = true;
    try {
      const now = this.clock();
      const lockToken = randomUUID();
      const campaigns = await this.repository.claimDueCampaigns({
        now: now.toISOString(),
        limit: this.batchSize,
        lockToken,
      });
      const results = await Promise.all(campaigns.map((campaign) => this.runCampaign(campaign)));
      return { skipped: false, claimed: campaigns.length, campaigns: results };
    } finally {
      this.running = false;
    }
  }
}
