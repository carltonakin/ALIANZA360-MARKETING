import assert from "node:assert/strict";
import test from "node:test";
import { CampaignAutomationEngine, nextCampaignRun } from "../social/campaign-automation.mjs";
import { InMemorySocialRepository } from "../social/core.mjs";

test("campaign lifecycle supports independent start, pause, resume, stop, and due claiming", async () => {
  const repository = new InMemorySocialRepository();
  const campaign = await repository.saveCampaign({
    entity: "campaign",
    name: "Always on",
    platform: "Instagram",
    audience: "Founders",
    message: "Learn more",
    budget: 25,
    status: "draft",
  });
  await repository.saveCampaignAutomation({
    id: campaign.id,
    platform: campaign.platform,
    sourceType: "ORGANIC",
    cadenceMinutes: 30,
    automationEnabled: false,
    maxRetries: 3,
  });
  assert.equal((await repository.setCampaignAutomationStatus(campaign.id, "start", "2026-08-17T12:00:00.000Z")).automationStatus, "RUNNING");
  assert.equal((await repository.claimDueCampaigns({ now: "2026-08-17T12:00:00.000Z", limit: 10, lockToken: "lock-1" })).length, 1);
  await repository.completeCampaignRun(campaign.id, {
    lockToken: "lock-1",
    succeeded: true,
    lastRunAt: "2026-08-17T12:00:00.000Z",
    nextRunAt: "2026-08-17T12:30:00.000Z",
    metrics: { reach: 42 },
    processed: 4,
  });
  assert.equal((await repository.setCampaignAutomationStatus(campaign.id, "pause")).automationStatus, "PAUSED");
  assert.equal((await repository.setCampaignAutomationStatus(campaign.id, "resume")).automationStatus, "RUNNING");
  assert.equal((await repository.setCampaignAutomationStatus(campaign.id, "stop")).automationStatus, "STOPPED");
});

test("automation engine runs claimed campaigns concurrently and records success", async () => {
  const completed = [];
  const repository = {
    claimDueCampaigns: async ({ lockToken }) => [
      { id: 1, platform: "facebook", cadenceMinutes: 60, lockToken },
      { id: 2, platform: "instagram", cadenceMinutes: 60, lockToken },
    ],
    completeCampaignRun: async (id, result) => completed.push({ id, ...result }),
    recordError: async () => {},
  };
  const listener = { runCampaign: async (campaign) => ({ processed: campaign.id, metrics: { reach: campaign.id * 10 } }) };
  const engine = new CampaignAutomationEngine({
    repository,
    listener,
    clock: () => new Date("2026-08-17T12:00:00.000Z"),
  });
  const result = await engine.tick();
  assert.equal(result.claimed, 2);
  assert.equal(result.campaigns.every((item) => item.status === "succeeded"), true);
  assert.equal(completed.length, 2);
  assert.equal(completed.every((item) => item.succeeded), true);
});

test("automation engine schedules bounded retries and redacts provider secrets", async () => {
  let completion;
  let errorEntry;
  const repository = {
    claimDueCampaigns: async ({ lockToken }) => [{ id: 9, platform: "x", cadenceMinutes: 60, retryCount: 0, maxRetries: 2, lockToken }],
    completeCampaignRun: async (_id, result) => { completion = result; },
    recordError: async (entry) => { errorEntry = entry; },
  };
  const listener = { runCampaign: async () => { throw new Error("access_token=top-secret provider unavailable"); } };
  const engine = new CampaignAutomationEngine({ repository, listener, clock: () => new Date("2026-08-17T12:00:00.000Z") });
  const result = await engine.tick();
  assert.equal(result.campaigns[0].status, "retry_scheduled");
  assert.equal(completion.retryable, true);
  assert.equal(completion.retryCount, 1);
  assert.doesNotMatch(completion.error, /top-secret/);
  assert.doesNotMatch(errorEntry.message, /top-secret/);
  assert.equal(nextCampaignRun({ cadenceMinutes: 60 }, new Date("2026-08-17T12:00:00.000Z"), 1), "2026-08-17T12:02:00.000Z");
});
