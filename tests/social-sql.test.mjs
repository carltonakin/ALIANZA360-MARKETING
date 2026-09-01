import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SqlServerRepository, toSqlInteger } from "../social/sql-server.mjs";

const migrationUrl = new URL("../sql/001_social_listener.sql", import.meta.url);
const automationMigrationUrl = new URL("../sql/003_social_crm_automation.sql", import.meta.url);
const channelReadinessMigrationUrl = new URL("../sql/004_social_channel_production_readiness.sql", import.meta.url);
const integrationOrchestrationMigrationUrl = new URL("../sql/005_crm_integration_orchestration.sql", import.meta.url);
const bufferCampaignMigrationUrl = new URL("../sql/006_buffer_campaign_integration.sql", import.meta.url);
const campaignEditingMigrationUrl = new URL("../sql/007_campaign_post_types_media_editing.sql", import.meta.url);
const campaignVideoMigrationUrl = new URL("../sql/008_campaign_video_validation_metadata.sql", import.meta.url);
const cloudinaryCampaignMediaMigrationUrl = new URL("../sql/010_cloudinary_campaign_media.sql", import.meta.url);
const authenticationMigrationUrl = new URL("../sql/011_authentication_user_management.sql", import.meta.url);
const leadAiResponseMigrationUrl = new URL("../sql/012_lead_intent_ai_response.sql", import.meta.url);
const leadHistoryMigrationUrl = new URL("../sql/013_lead_scoring_interaction_history.sql", import.meta.url);
const leadInteractionApiMigrationUrl = new URL("../sql/014_crm_lead_interaction_api.sql", import.meta.url);

class FakeRequest {
  constructor(executions, result = { recordset: [] }) {
    this.executions = executions;
    this.result = result;
    this.parameters = new Map();
  }

  input(name, type, value) {
    this.parameters.set(name, { type, value });
    return this;
  }

  async execute(procedure) {
    this.executions.push({ procedure, parameters: this.parameters });
    return this.result;
  }
}

function fakeRepository(result = { recordset: [] }) {
  const executions = [];
  const sql = {
    MAX: -1,
    NVarChar: (size) => ({ type: "NVarChar", size }),
    Decimal: (precision, scale) => ({ type: "Decimal", precision, scale }),
    Bit: { type: "Bit" },
    Int: { type: "Int" },
    BigInt: { type: "BigInt" },
    VarBinary: (size) => ({ type: "VarBinary", size }),
    DateTime2: { type: "DateTime2" },
    UniqueIdentifier: { type: "UniqueIdentifier" },
  };
  const pool = {
    request: () => new FakeRequest(executions, result),
    close: async () => {},
  };
  return { repository: new SqlServerRepository(sql, pool), executions };
}

const event = {
  channel: "instagram",
  externalEventId: "event-1",
  eventType: "comment",
  externalUserId: "person-1",
  username: "buyer",
  displayName: "Buyer One",
  email: "buyer@example.com",
  phone: null,
  message: "send pricing",
  postId: "post-1",
  campaignId: "campaign-1",
  adId: "ad-1",
  sourceUrl: "https://instagram.com/example",
  occurredAt: "2026-08-16T12:00:00.000Z",
  rawPayload: { id: "event-1" },
};

const lead = {
  name: "Buyer One",
  email: "buyer@example.com",
  phone: null,
  socialUsername: "buyer",
  sourceChannel: "instagram",
};

test("T-SQL migration creates every Social Listener storage surface", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "SocialChannelConnections",
    "SocialEvents",
    "SocialListenerStatus",
    "SocialListenerErrors",
    "LeadSourceAttribution",
    "SocialMetrics",
    "SocialChannelConfigurations",
    "Campaigns",
    "LandingPages",
    "Webinars",
    "LeadRoutineEvents",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE dbo\\.${table}`, "i"));
  }
  assert.doesNotMatch(sql, /AccessToken|BearerToken|ApiSecret/i);
  assert.match(sql, /Facebook NVARCHAR\(500\) NULL/i);
  assert.match(sql, /Instagram NVARCHAR\(500\) NULL/i);
  assert.match(sql, /\[X\] NVARCHAR\(500\) NULL/i);
  assert.match(sql, /COL_LENGTH\(N'dbo\.Leads', N'Facebook'\)/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialLead_Create/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialLead_Update/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialChannelConfiguration_Upsert/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.CRMContent_GetAll/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.CRMLead_UpsertFromRoutine/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.Campaign_SetMode/i);
  assert.match(sql, /Mode IN \(N'draft', N'test', N'production', N'paused', N'archived'\)/i);
  assert.match(sql, /SecretCiphertext NVARCHAR\(MAX\)/i);
});

test("T-SQL enforces duplicate-event protection and source attribution", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /UNIQUE\s*\(Channel, ExternalEventId\)/i);
  assert.match(sql, /INSERT dbo\.LeadSourceAttribution/i);
  assert.match(sql, /CampaignId[\s\S]*AdId[\s\S]*PostId[\s\S]*ExternalEventId/i);
  assert.match(sql, /FirstTouchAt[\s\S]*LastInteractionAt/i);
});

test("T-SQL event processing uses a transaction and rolls back on failure", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const procedure = sql.slice(sql.indexOf("CREATE OR ALTER PROCEDURE dbo.SocialEvent_Process"));
  assert.match(procedure, /SET XACT_ABORT ON/i);
  assert.match(procedure, /BEGIN TRANSACTION/i);
  assert.match(procedure, /COMMIT TRANSACTION/i);
  assert.match(procedure, /IF XACT_STATE\(\) <> 0 ROLLBACK TRANSACTION/i);
  assert.match(procedure, /THROW/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialLead_GetRecent/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialLead_UpdateStatus/i);
});

test("automation migration creates the social CRM model, scoring, scheduler, and unified timeline", async () => {
  const sql = await readFile(automationMigrationUrl, "utf8");
  for (const table of [
    "SocialPlatforms", "SocialAccounts", "SocialCampaigns", "SocialConversations",
    "SocialInteractions", "LeadActivities", "Customers", "Opportunities", "SalesActivities",
    "Quotes", "Appointments", "CustomerConversions", "LeadScoringRules", "LeadTemperatureThresholds",
  ]) assert.match(sql, new RegExp(`CREATE TABLE dbo\\.${table}`, "i"));
  for (const procedure of [
    "LeadScoringConfiguration_Get", "SocialCampaign_Save", "SocialCampaign_SetStatus",
    "SocialCampaign_ClaimDue", "SocialCampaign_CompleteRun", "SocialLead_GetUnified",
  ]) assert.match(sql, new RegExp(`PROCEDURE dbo\\.${procedure}`, "i"));
  assert.match(sql, /UPDLOCK,READPAST,ROWLOCK/i);
  assert.match(sql, /PlatformUserId/i);
  assert.match(sql, /QualificationJson/i);
  assert.match(sql, /RawPayloadExpiresAt/i);
  assert.doesNotMatch(sql, /AccessToken|BearerToken|ApiSecret/i);
});

test("channel readiness migration adds production metadata and webhook tracking", async () => {
  const sql = await readFile(channelReadinessMigrationUrl, "utf8");
  for (const column of [
    "AdAccountId", "LoginMode", "TokenType", "AccessTokenExpiresAt", "RefreshTokenExpiresAt",
    "LastTokenRefreshAt", "NextTokenRefreshAt", "RequiredScopes", "GrantedScopes",
    "PermissionsValidatedAt", "WebhookSubscribedFields", "WebhookSubscriptionId",
    "WebhookSubscribedAt", "LastWebhookReceivedAt", "AppMode", "AdvancedAccessStatus",
    "BusinessVerificationStatus",
  ]) assert.match(sql, new RegExp(`COL_LENGTH\\(N'dbo\\.SocialChannelConfigurations', N'${column}'\\)`, "i"));
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialChannelConfiguration_Upsert/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialChannelConfiguration_MarkWebhookReceived/i);
  assert.doesNotMatch(sql, /AccessToken\s+NVARCHAR|RefreshToken\s+NVARCHAR|BearerToken\s+NVARCHAR/i);
});

test("CRM integration migration creates an idempotent action ledger, workflow runs, and audit history", async () => {
  const sql = await readFile(integrationOrchestrationMigrationUrl, "utf8");
  for (const table of ["IntegrationEvents", "WorkflowRuns", "AuditLogs"]) {
    assert.match(sql, new RegExp(`CREATE TABLE dbo\\.${table}`, "i"));
  }
  for (const procedure of [
    "CRMIntegrationEvent_Create", "CRMIntegrationEvent_RecordInbound", "CRMIntegrationEvent_ClaimDue",
    "CRMIntegrationEvent_Complete", "CRMIntegrationEvent_GetRecent", "CRMWorkflowRun_Start",
    "CRMWorkflowRun_Complete", "CRMAuditLog_Insert",
  ]) assert.match(sql, new RegExp(`PROCEDURE dbo\\.${procedure}`, "i"));
  assert.match(sql, /UNIQUE \(Provider, Direction, IdempotencyKey\)/i);
  assert.match(sql, /UPDLOCK, READPAST, ROWLOCK/i);
  assert.match(sql, /RequestJson NVARCHAR\(MAX\)/i);
  assert.match(sql, /ResponseJson NVARCHAR\(MAX\)/i);
  assert.doesNotMatch(sql, /AccessToken|ClientSecret|ApiToken|BearerToken/i);
});

test("Buffer campaign migration persists campaign requirements and complete post lifecycle state", async () => {
  const sql = await readFile(bufferCampaignMigrationUrl, "utf8");
  for (const column of [
    "CampaignObjective", "PostText", "MediaType", "MediaUrl", "PublishDateTime",
    "HighIntentKeywords", "AIReplyEnabled", "TargetSocialChannelsJson",
  ]) assert.match(sql, new RegExp(`COL_LENGTH\\(N'dbo\\.Campaigns', N'${column}'\\)`, "i"));
  assert.match(sql, /CREATE TABLE dbo\.CampaignPosts/i);
  for (const column of [
    "CampaignPostId", "CampaignId", "Platform", "BufferChannelId", "BufferPostId",
    "ScheduledAt", "PublishedAt", "PostStatus", "ExternalPostId", "PostUrl",
    "LastCheckedAt", "ErrorSource", "ErrorMessage", "LastAttemptAt",
  ]) assert.match(sql, new RegExp(`\\b${column}\\b`, "i"));
  assert.match(sql, /PostStatus IN \(N'DRAFT', N'SCHEDULED', N'QUEUED', N'PUBLISHED', N'FAILED'\)/i);
  for (const procedure of [
    "BufferCampaignPost_Create", "BufferCampaignPost_ApplyStatus", "BufferCampaignPost_Fail",
    "BufferCampaignPost_RecordAttemptError", "BufferCampaignPost_Get", "BufferCampaign_SetMode",
  ]) assert.match(sql, new RegExp(`PROCEDURE dbo\\.${procedure}`, "i"));
  assert.match(sql, /Every Buffer campaign post must be scheduled before production mode/i);
  assert.doesNotMatch(sql, /BUFFER_API_KEY|Authorization\s*:\s*Bearer/i);
});

test("campaign editing migration preserves post identity and adds media and post-type fields", async () => {
  const sql = await readFile(campaignEditingMigrationUrl, "utf8");
  for (const column of ["PostType", "MediaOriginalName", "MediaMimeType", "MediaSizeBytes"]) {
    assert.match(sql, new RegExp(`COL_LENGTH\\(N'dbo\\.Campaigns', N'${column}'\\)`, "i"));
  }
  assert.match(sql, /COL_LENGTH\(N'dbo\.CampaignPosts', N'IsActive'\)/i);
  assert.match(sql, /PostType IN \(N'POST', N'REEL', N'STORY'\)/i);
  assert.match(sql, /PROCEDURE dbo\.BufferCampaignPost_Upsert/i);
  assert.match(sql, /PROCEDURE dbo\.BufferCampaignPost_DeactivateMissingDrafts/i);
  assert.match(sql, /WHERE CampaignId = @CampaignId AND BufferChannelId = @BufferChannelId/i);
  assert.match(sql, /BufferPostId IS NULL/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE|BUFFER_API_KEY|Authorization\s*:\s*Bearer/i);
});

test("campaign video migration persists verified metadata and makes Campaign_Save transactional", async () => {
  const sql = await readFile(campaignVideoMigrationUrl, "utf8");
  for (const column of [
    "MediaId", "MediaWidth", "MediaHeight", "MediaDurationSeconds", "MediaFrameRate",
    "MediaVideoCodec", "MediaAudioCodec", "MediaAudioSampleRate", "MediaVideoBitrate", "MediaAudioBitrate",
  ]) {
    assert.match(sql, new RegExp(`COL_LENGTH\\(N'dbo\\.Campaigns', N'${column}'\\)`, "i"));
  }
  const procedure = sql.slice(sql.indexOf("CREATE OR ALTER PROCEDURE dbo.Campaign_Save"));
  assert.match(procedure, /SET XACT_ABORT ON/i);
  assert.match(procedure, /BEGIN TRANSACTION/i);
  assert.match(procedure, /COMMIT TRANSACTION/i);
  assert.match(procedure, /IF XACT_STATE\(\) <> 0 ROLLBACK TRANSACTION/i);
  assert.match(procedure, /MediaSizeBytes > 314572800/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.CRMContent_GetAll/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE|BUFFER_API_KEY|Authorization\s*:\s*Bearer/i);
});

test("Cloudinary migration persists provider identifiers without media binaries", async () => {
  const sql = await readFile(cloudinaryCampaignMediaMigrationUrl, "utf8");
  for (const column of ["CloudinaryAssetId", "CloudinaryPublicId", "CloudinaryResourceType", "CloudinaryFormat"]) {
    assert.match(sql, new RegExp(`COL_LENGTH\\(N'dbo\\.Campaigns', N'${column}'\\)`, "i"));
    assert.match(sql, new RegExp(`@${column}`, "i"));
  }
  assert.match(sql, /BEGIN TRANSACTION/i);
  assert.match(sql, /COMMIT TRANSACTION/i);
  assert.match(sql, /ROLLBACK TRANSACTION/i);
  assert.match(sql, /MediaId must match Cloudinary asset_id/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE|VARBINARY|BUFFER_API_KEY|CLOUDINARY_API_SECRET/i);
});

test("authentication migration stores only hashes and enforces safe role/session procedures", async () => {
  const sql = await readFile(authenticationMigrationUrl, "utf8");
  assert.match(sql, /CREATE TABLE dbo\.AppUsers/i);
  assert.match(sql, /CREATE TABLE dbo\.AuthSessions/i);
  assert.match(sql, /UQ_AppUsers_Username UNIQUE \(Username\)/i);
  assert.match(sql, /TokenHash BINARY\(32\)/i);
  assert.match(sql, /Role IN \(N'ADMIN', N'BASIC'\)/i);
  for (const procedure of [
    "AuthUser_GetByUsername", "AuthUser_List", "AuthUser_Create", "AuthUser_Update",
    "AuthUser_SetPassword", "AuthUser_RecordLogin", "AuthSession_Create", "AuthSession_Get", "AuthSession_Revoke",
  ]) assert.match(sql, new RegExp(`PROCEDURE dbo\\.${procedure}`, "i"));
  assert.match(sql, /last active ADMIN/i);
  assert.doesNotMatch(sql, /PlaintextPassword|Password NVARCHAR/i);
});

test("lead AI response migration reuses existing columns and preserves omitted values", async () => {
  const sql = await readFile(leadAiResponseMigrationUrl, "utf8");
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialLead_Create/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialLead_Update/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialLead_GetRecent/i);
  assert.match(sql, /@LastIntentProvided BIT = 0/i);
  assert.match(sql, /@CrmNotesProvided BIT = 0/i);
  assert.match(sql, /LastIntent = CASE WHEN @LastIntentProvided = 1/i);
  assert.match(sql, /CrmNotes = CASE WHEN @CrmNotesProvided = 1/i);
  assert.match(sql, /l\.LastIntent, l\.CrmNotes/i);
  assert.doesNotMatch(sql, /ALTER TABLE|ADD LastIntent|ADD CrmNotes/i);
});

test("lead history migration adds explainable scoring, identity reuse, and interaction uniqueness", async () => {
  const sql = await readFile(leadHistoryMigrationUrl, "utf8");
  for (const column of [
    "ScoreBand", "IntentScore", "EngagementScore", "FitScore", "RecencyScore", "SourceScore",
    "ScoreReason", "LastScoredAt", "LastInteractionAt", "LastInteractionType", "LastInteractionText",
    "LastResponseAt", "LastResponseType", "LastResponseText",
  ]) assert.match(sql, new RegExp(`COL_LENGTH\\(N'dbo\\.Leads', N'${column}'\\)`, "i"));
  for (const column of ["ExternalInteractionId", "IntentConfidence", "CampaignPostId", "ProcessedAt"]) {
    assert.match(sql, new RegExp(`COL_LENGTH\\(N'dbo\\.SocialInteractions', N'${column}'\\)`, "i"));
  }
  assert.match(sql, /CREATE UNIQUE INDEX UX_SocialInteractions_Platform_ExternalInteraction[\s\S]+SocialPlatformId, ExternalInteractionId/i);
  assert.match(sql, /PROCEDURE dbo\.LeadScore_Recalculate/i);
  assert.match(sql, /InteractionCount[\s\S]+RecencyWeight/i);
  assert.match(sql, /username:[\s\S]+LOWER/i);
  assert.match(sql, /InteractionInserted/i);
  assert.match(sql, /LeadScore >= 60/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE/i);
});

test("CRM lead interaction API migration supports explicit leads, race-safe idempotency, and AI intent rescoring", async () => {
  const sql = await readFile(leadInteractionApiMigrationUrl, "utf8");
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.SocialEvent_Process/i);
  assert.match(sql, /@RequestedLeadId BIGINT = NULL/i);
  assert.match(sql, /SocialPlatformId = @SocialPlatformId AND si\.ExternalInteractionId = @ExternalEventId/i);
  assert.match(sql, /WITH \(UPDLOCK, HOLDLOCK\)/i);
  assert.match(sql, /@ErrorNumber IN \(2601, 2627\)/i);
  assert.match(sql, /@SocialInteractionId InteractionId/i);
  assert.match(sql, /l\.ScoreReason/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.LeadInteraction_UpdateIntent/i);
  assert.match(sql, /SocialInteractionId = @InteractionId AND LeadId = @LeadId/i);
  assert.match(sql, /JSON_MODIFY[\s\S]+aiClassification/i);
  assert.match(sql, /EXEC dbo\.LeadScore_Recalculate/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE/i);
});

test("SQL integer normalization rounds finite media metadata and nulls invalid values", () => {
  assert.equal(toSqlInteger(891087.1719038817), 891087);
  assert.equal(toSqlInteger(891087), 891087);
  assert.equal(toSqlInteger("891087.1719038817"), 891087);
  assert.equal(toSqlInteger(null), null);
  assert.equal(toSqlInteger(undefined), null);
  assert.equal(toSqlInteger(""), null);
  assert.equal(toSqlInteger("   "), null);
  assert.equal(toSqlInteger("not-a-number"), null);
  assert.equal(toSqlInteger(Number.NaN), null);
  assert.equal(toSqlInteger(Number.POSITIVE_INFINITY), null);
  assert.equal(toSqlInteger(Number.NEGATIVE_INFINITY), null);
});

test("SQL Server repository parameterizes event and lead persistence", async () => {
  const { repository, executions } = fakeRepository({
    recordset: [{
      Duplicate: false, LeadCreated: true, LeadUpdated: false, InteractionInserted: true,
      LeadId: 42, SocialEventId: 99, InteractionId: 101, LeadScore: 72,
      ScoreBand: "QUALIFIED", ScoreReason: "Historical intent score.", Qualified: true,
    }],
  });
  const result = await repository.processEvent(event, lead);
  assert.deepEqual(result, {
    duplicate: false,
    leadCreated: true,
    leadUpdated: false,
    leadId: 42,
    socialEventId: 99,
    interactionId: 101,
    interactionInserted: true,
    score: 72,
    band: "QUALIFIED",
    qualified: true,
    scoreReason: "Historical intent score.",
  });
  assert.equal(executions.length, 1);
  assert.equal(executions[0].procedure, "dbo.SocialEvent_Process");
  assert.equal(executions[0].parameters.get("ExternalEventId").value, "event-1");
  assert.equal(executions[0].parameters.get("Qualified").value, 1);
  assert.equal(executions[0].parameters.get("RawPayload").value, JSON.stringify(event.rawPayload));
  assert.equal(executions[0].parameters.get("InteractionType").value, "POST_INTERACTION");
  assert.equal(executions[0].parameters.get("IntentConfidence").value, null);
  assert.equal(executions[0].parameters.get("CampaignPostId").value, null);
  assert.equal(executions[0].parameters.get("RawRetentionDays").value, 7);
  assert.equal(executions[0].parameters.get("RequestedLeadId").value, null);
});

test("SQL Server repository parameterizes AI classification and returns CRM-owned rescoring", async () => {
  const { repository, executions } = fakeRepository({
    recordset: [{
      LeadId: 42,
      InteractionId: 101,
      Intent: "APPOINTMENT_REQUEST",
      IntentConfidence: 0.96,
      AIClassificationJson: JSON.stringify({ pricingIntent: true, purchaseIntent: true }),
      LeadScore: 84,
      ScoreBand: "HOT",
      Qualified: true,
      IntentScore: 30,
      EngagementScore: 20,
      FitScore: 10,
      RecencyScore: 15,
      SourceScore: 9,
      ScoreReason: "CRM historical score.",
      LastScoredAt: new Date("2030-01-01T12:00:00.000Z"),
    }],
  });
  const result = await repository.updateLeadInteractionIntent(42, 101, {
    intent: "APPOINTMENT_REQUEST",
    intentConfidence: 0.96,
    pricingIntent: true,
    purchaseIntent: true,
  });
  assert.equal(executions[0].procedure, "dbo.LeadInteraction_UpdateIntent");
  assert.equal(executions[0].parameters.get("LeadId").value, 42);
  assert.equal(executions[0].parameters.get("InteractionId").value, 101);
  assert.equal(executions[0].parameters.get("Intent").value, "APPOINTMENT_REQUEST");
  assert.equal(executions[0].parameters.get("PricingIntent").value, true);
  assert.equal(result.score, 84);
  assert.equal(result.band, "HOT");
  assert.equal(result.scoreReason, "CRM historical score.");
  assert.deepEqual(result.aiClassification, { pricingIntent: true, purchaseIntent: true });
});

test("SQL Server repository parameterizes authentication without returning password hashes", async () => {
  const row = {
    UserId: 7,
    Username: "admin.user",
    PasswordHash: "scrypt$hash",
    Role: "ADMIN",
    IsActive: true,
    CreatedAt: new Date("2030-01-01T00:00:00.000Z"),
    UpdatedAt: new Date("2030-01-02T00:00:00.000Z"),
    LastLoginAt: null,
  };
  const { repository, executions } = fakeRepository({ recordset: [row] });
  const fullUser = await repository.getAuthUserByUsername("admin.user");
  const created = await repository.createAuthUser({ username: "basic.user", passwordHash: "scrypt$stored", role: "BASIC", isActive: true });
  await repository.listAuthUsers();
  await repository.updateAuthUser(7, { username: "admin.user", role: "ADMIN", isActive: true });
  await repository.setAuthUserPassword(7, "scrypt$replacement");
  await repository.recordAuthLogin(7);
  const tokenHash = Buffer.alloc(32, 1);
  await repository.createAuthSession({ userId: 7, tokenHash, expiresAt: new Date("2030-01-03T00:00:00.000Z") });
  await repository.getAuthSession(tokenHash);
  await repository.revokeAuthSession(tokenHash);

  assert.equal(fullUser.passwordHash, "scrypt$hash");
  assert.equal("passwordHash" in created, false);
  assert.deepEqual(executions.map((entry) => entry.procedure), [
    "dbo.AuthUser_GetByUsername", "dbo.AuthUser_Create", "dbo.AuthUser_List", "dbo.AuthUser_Update",
    "dbo.AuthUser_SetPassword", "dbo.AuthUser_RecordLogin", "dbo.AuthSession_Create", "dbo.AuthSession_Get", "dbo.AuthSession_Revoke",
  ]);
  assert.equal(executions[0].parameters.get("Username").value, "admin.user");
  assert.equal(executions[1].parameters.get("PasswordHash").value, "scrypt$stored");
  assert.deepEqual(executions[6].parameters.get("TokenHash").value, tokenHash);
  assert.equal(executions[6].parameters.get("TokenHash").type.size, 32);
});

test("SQL Server repository parameterizes campaign automation lifecycle", async () => {
  const { repository, executions } = fakeRepository({
    recordset: [{
      SocialCampaignId: 22,
      CampaignId: 7,
      Name: "Always on",
      Platform: "instagram",
      SourceType: "PAID",
      AutomationStatus: "RUNNING",
      AutomationEnabled: true,
      CadenceMinutes: 30,
      RetryCount: 0,
      MaxRetries: 3,
    }],
  });
  const saved = await repository.saveCampaignAutomation({
    id: "campaign:7",
    platform: "Instagram",
    sourceType: "PAID",
    externalCampaignId: "provider-campaign-7",
    cadenceMinutes: 30,
    automationEnabled: true,
    maxRetries: 3,
  });
  assert.equal(saved.id, 22);
  assert.equal(saved.sourceType, "PAID");
  await repository.setCampaignAutomationStatus("campaign:7", "pause", "2026-08-17T12:00:00.000Z");
  await repository.claimDueCampaigns({ now: "2026-08-17T12:00:00.000Z", limit: 5, lockToken: "45b31b29-7d22-4a5b-bbf7-6ff695185819" });
  await repository.completeCampaignRun(22, {
    lockToken: "45b31b29-7d22-4a5b-bbf7-6ff695185819",
    succeeded: true,
    lastRunAt: "2026-08-17T12:00:00.000Z",
    nextRunAt: "2026-08-17T12:30:00.000Z",
    metrics: { reach: 10 },
    processed: 2,
  });
  assert.deepEqual(executions.map((item) => item.procedure), [
    "dbo.SocialCampaign_Save",
    "dbo.SocialCampaign_SetStatus",
    "dbo.SocialCampaign_ClaimDue",
    "dbo.SocialCampaign_CompleteRun",
  ]);
  assert.equal(executions[0].parameters.get("ExternalCampaignId").value, "provider-campaign-7");
  assert.equal(executions[3].parameters.get("CurrentMetricsJson").value, JSON.stringify({ reach: 10 }));
});

test("SQL Server repository parameterizes CRM integration actions and workflow history", async () => {
  const row = {
    IntegrationEventId: 91,
    Provider: "sprout",
    Direction: "OUTBOUND",
    EventType: "PUBLISH_POST",
    IdempotencyKey: "action-91",
    Status: "PENDING",
    AttemptCount: 0,
    MaxAttempts: 4,
    CampaignId: 7,
    RequestJson: JSON.stringify({ text: "Join the webinar" }),
    CreatedAt: new Date("2026-08-18T12:00:00Z"),
    UpdatedAt: new Date("2026-08-18T12:00:00Z"),
  };
  const { repository, executions } = fakeRepository({ recordset: [row] });
  const action = await repository.createIntegrationAction({
    provider: "sprout", channel: "instagram", direction: "OUTBOUND", eventType: "PUBLISH_POST",
    idempotencyKey: "action-91", campaignId: "campaign:7", request: { text: "Join the webinar" }, maxAttempts: 4,
  });
  assert.equal(action.id, 91);
  assert.equal(action.request.text, "Join the webinar");
  await repository.claimDueIntegrationActions({
    now: "2026-08-18T12:00:00Z", limit: 1, lockToken: "45b31b29-7d22-4a5b-bbf7-6ff695185819", actionId: 91,
  });
  await repository.completeIntegrationAction(91, {
    lockToken: "45b31b29-7d22-4a5b-bbf7-6ff695185819", succeeded: true,
    externalId: "sprout-501", externalStatus: "PENDING", response: { isDraft: true }, processedAt: "2026-08-18T12:00:01Z",
  });
  await repository.startWorkflowRun({
    workflowType: "SOCIAL_OUTBOUND", triggerType: "INTEGRATION_EVENT", triggerRecordId: 91,
    integrationEventId: 91, context: { provider: "sprout" },
  });
  await repository.insertAuditLog({
    entityType: "IntegrationEvent", entityId: 91, action: "ACTION_SUCCEEDED", actorType: "SYSTEM",
    actorId: "crm-social-orchestrator", correlationId: "action-91", details: { externalId: "sprout-501" },
  });
  assert.deepEqual(executions.map((item) => item.procedure), [
    "dbo.CRMIntegrationEvent_Create",
    "dbo.CRMIntegrationEvent_ClaimDue",
    "dbo.CRMIntegrationEvent_Complete",
    "dbo.CRMWorkflowRun_Start",
    "dbo.CRMAuditLog_Insert",
  ]);
  assert.equal(executions[0].parameters.get("CampaignId").value, 7);
  assert.equal(executions[2].parameters.get("ExternalId").value, "sprout-501");
  assert.equal(executions[2].parameters.get("ResponseJson").value, JSON.stringify({ isDraft: true }));
});

test("SQL Server repository surfaces duplicate procedure results", async () => {
  const { repository } = fakeRepository({
    recordset: [{ Duplicate: true, LeadCreated: false, LeadUpdated: false, LeadId: null, SocialEventId: 99 }],
  });
  const result = await repository.processEvent(event, lead);
  assert.equal(result.duplicate, true);
  assert.equal(result.leadCreated, false);
  assert.equal(result.leadUpdated, false);
});

test("SQL Server status, error, and metric writes use stored procedures", async () => {
  const { repository, executions } = fakeRepository();
  await repository.upsertConnectionStatus({
    channel: "instagram",
    configured: true,
    status: "connected",
    checkedAt: "2026-08-16T12:00:00.000Z",
    reason: "Provider identity validation succeeded.",
    identity: { id: "account-1", name: "Account" },
  });
  await repository.recordError({
    channel: "instagram",
    operation: "fetch_events",
    message: "Temporary provider failure.",
    transient: true,
  });
  await repository.saveMetrics("instagram", [{ name: "reach", value: 10 }]);
  assert.deepEqual(executions.map((item) => item.procedure), [
    "dbo.SocialListenerStatus_Upsert",
    "dbo.SocialListenerError_Insert",
    "dbo.SocialMetric_Upsert",
  ]);
});

test("SQL Server repository exposes and updates social leads through parameterized procedures", async () => {
  const { repository, executions } = fakeRepository({
    recordset: [{
      LeadId: 7,
      Name: "Buyer Seven",
      Email: "buyer7@example.com",
      Phone: null,
      SocialUsername: "buyer7",
      Facebook: "facebook.com/buyer7",
      Instagram: "@buyer7",
      X: "@buyer7_x",
      SourceChannel: "x",
      Status: "Engaged",
      Value: 0,
      LastIntent: "PURCHASE_INTENT",
      CrmNotes: "Send pricing options.",
      CreatedAt: new Date("2026-08-16T12:00:00Z"),
    }],
  });
  const leads = await repository.getLeads(25);
  assert.equal(leads[0].id, "social:7");
  assert.equal(leads[0].source, "X");
  assert.equal(leads[0].facebook, "facebook.com/buyer7");
  assert.equal(leads[0].instagram, "@buyer7");
  assert.equal(leads[0].x, "@buyer7_x");
  assert.equal(leads[0].intent, "PURCHASE_INTENT");
  assert.equal(leads[0].crmNotes, "Send pricing options.");
  assert.equal(executions[0].procedure, "dbo.SocialLead_GetRecent");
  assert.equal(executions[0].parameters.get("Limit").value, 25);

  await repository.updateLeadStatus(7, "Hot");
  assert.equal(executions[1].procedure, "dbo.SocialLead_UpdateStatus");
  assert.equal(executions[1].parameters.get("LeadId").value, 7);
  assert.equal(executions[1].parameters.get("Status").value, "Hot");
});

test("SQL Server repository parameterizes create, update, and clearable social fields", async () => {
  const { repository, executions } = fakeRepository({
    recordset: [{
      LeadId: 9,
      Name: "Manual Lead",
      Email: "manual@example.com",
      Phone: null,
      Facebook: null,
      Instagram: "@manual",
      X: null,
      SourceChannel: "Instagram",
      Status: "New",
      Value: 900,
      CreatedAt: new Date("2026-08-16T12:00:00Z"),
    }],
  });
  const input = {
    name: "Manual Lead",
    email: "manual@example.com",
    phone: null,
    facebook: null,
    instagram: "@manual",
    x: null,
    source: "Instagram",
    value: 900,
    lastIntent: "PURCHASE_INTENT",
    crmNotes: "Send the pricing guide.",
    lastIntentProvided: true,
    crmNotesProvided: true,
  };
  await repository.createLead(input);
  await repository.updateLead(9, { ...input, instagram: null });

  assert.equal(executions[0].procedure, "dbo.SocialLead_Create");
  assert.equal(executions[0].parameters.get("Facebook").value, null);
  assert.equal(executions[0].parameters.get("Instagram").value, "@manual");
  assert.equal(executions[0].parameters.get("X").value, null);
  assert.equal(executions[0].parameters.get("LastIntent").value, "PURCHASE_INTENT");
  assert.equal(executions[0].parameters.get("CrmNotes").value, "Send the pricing guide.");
  assert.equal(executions[0].parameters.get("LastIntentProvided").value, 1);
  assert.equal(executions[0].parameters.get("CrmNotesProvided").value, 1);
  assert.equal(executions[1].procedure, "dbo.SocialLead_Update");
  assert.equal(executions[1].parameters.get("LeadId").value, 9);
  assert.equal(executions[1].parameters.get("Instagram").value, null);
});

test("SQL Server repository parameterizes encrypted channel configuration without plaintext secrets", async () => {
  const { repository, executions } = fakeRepository();
  await repository.upsertChannelConfiguration({
    channel: "facebook",
    enabled: true,
    environment: "production",
    accountId: null,
    pageId: "page-1",
    adAccountId: "act_123",
    businessId: "business-1",
    appId: "app-1",
    clientId: null,
    loginMode: "facebook_login",
    tokenType: "page",
    accessTokenExpiresAt: "2026-09-01T12:00:00.000Z",
    refreshTokenExpiresAt: null,
    lastTokenRefreshAt: "2026-08-17T12:00:00.000Z",
    nextTokenRefreshAt: "2026-08-31T12:00:00.000Z",
    webhookUrl: "https://listener.example.com/webhooks/meta",
    callbackUrl: null,
    scopes: "pages_read_engagement",
    requiredScopes: "pages_read_engagement pages_messaging",
    grantedScopes: "pages_read_engagement pages_messaging",
    permissionsValidatedAt: "2026-08-17T12:00:00.000Z",
    webhookSubscribedFields: "messages feed",
    webhookSubscriptionId: "subscription-1",
    webhookSubscribedAt: "2026-08-17T12:00:00.000Z",
    lastWebhookReceivedAt: null,
    apiVersion: "v23.0",
    appMode: "live",
    advancedAccessStatus: "approved",
    businessVerificationStatus: "verified",
    secrets: { accessToken: "never-write-plaintext" },
  }, {
    ciphertext: "ciphertext-value",
    iv: "iv-value",
    authTag: "tag-value",
    keyVersion: "v1",
  });
  const execution = executions[0];
  assert.equal(execution.procedure, "dbo.SocialChannelConfiguration_Upsert");
  assert.equal(execution.parameters.get("AdAccountId").value, "act_123");
  assert.equal(execution.parameters.get("LoginMode").value, "facebook_login");
  assert.equal(execution.parameters.get("RequiredScopes").value, "pages_read_engagement pages_messaging");
  assert.equal(execution.parameters.get("WebhookSubscribedFields").value, "messages feed");
  assert.equal(execution.parameters.get("SecretCiphertext").value, "ciphertext-value");
  assert.equal(execution.parameters.get("SecretFields").value, "accessToken");
  assert.doesNotMatch(JSON.stringify([...execution.parameters.values()]), /never-write-plaintext/);
});

test("SQL Server repository parameterizes campaign, page, webinar, mode, and routine lead procedures", async () => {
  const { repository, executions } = fakeRepository({ recordset: [] });
  await repository.saveCampaign({ id: "campaign:7", name: "Campaign", platform: "Instagram", audience: "Founders", message: "Join", budget: 10, status: "draft", createdByAi: false });
  await repository.saveLandingPage({ id: "page:8", campaignId: "campaign:7", title: "Page", slug: "page", headline: "Join", status: "draft", createdByAi: false });
  await repository.saveWebinar({ id: "webinar:9", campaignId: "campaign:7", landingPageId: "page:8", title: "Webinar", status: "draft", createdByAi: false });
  await repository.setCampaignMode("campaign:1", "test");
  await repository.upsertRoutineLead({
    routine: "landing_page_registration",
    externalEventId: "registration-1",
    name: "Registrant",
    email: "registrant@example.com",
    source: "Landing Page",
    occurredAt: "2026-08-16T12:00:00.000Z",
  });
  assert.deepEqual(executions.map((item) => item.procedure), [
    "dbo.Campaign_Save",
    "dbo.LandingPage_Save",
    "dbo.Webinar_Save",
    "dbo.Campaign_SetMode",
    "dbo.CRMLead_UpsertFromRoutine",
  ]);
  assert.equal(executions[0].parameters.get("CampaignId").value, 7);
  assert.equal(executions[1].parameters.get("LandingPageId").value, 8);
  assert.equal(executions[1].parameters.get("CampaignId").value, 7);
  assert.equal(executions[2].parameters.get("WebinarId").value, 9);
  assert.equal(executions[2].parameters.get("LandingPageId").value, 8);
  assert.equal(executions[3].parameters.get("CampaignId").value, 1);
  assert.equal(executions[4].parameters.get("ExternalEventId").value, "registration-1");
});

test("SQL Server repository parameterizes Buffer campaign and post lifecycle procedures", async () => {
  const { repository, executions } = fakeRepository({ recordset: [] });
  await repository.saveCampaign({
    name: "Buffer campaign", platform: "instagram", audience: "Registrations", message: "Join now",
    budget: 0, status: "draft", createdByAi: false, campaignObjective: "Registrations",
    postText: "Join now", mediaId: "cloudinary-asset-video",
    cloudinaryAssetId: "cloudinary-asset-video",
    cloudinaryPublicId: "crm-marketing/campaigns/story",
    cloudinaryResourceType: "video", cloudinaryFormat: "mp4",
    mediaType: "video", mediaUrl: "https://res.cloudinary.com/crm-cloud/video/upload/v1/crm-marketing/campaigns/story.mp4",
    postType: "STORY", mediaOriginalName: "story.mp4", mediaMimeType: "video/mp4", mediaSizeBytes: "2048.4",
    mediaWidth: 1079.6, mediaHeight: 1919.6, mediaDurationSeconds: 30.125, mediaFrameRate: 29.97003,
    mediaVideoCodec: "avc1.640028", mediaAudioCodec: "mp4a.40.2", mediaAudioSampleRate: "47999.6",
    mediaVideoBitrate: 891087.1719038817, mediaAudioBitrate: "128000.6",
    publishDateTime: "2030-08-26T15:00:00.000Z", highIntentKeywords: "pricing, demo",
    aiReplyEnabled: true, targetSocialChannels: [{ id: "channel-1", service: "instagram" }],
  });
  await repository.createCampaignPost({
    campaignId: "campaign:7", platform: "instagram", bufferChannelId: "channel-1",
    scheduledAt: "2030-08-26T15:00:00.000Z",
  });
  await repository.deactivateMissingCampaignPosts("campaign:7", ["channel-1"]);
  await repository.applyCampaignPostStatus(9, {
    bufferPostId: "buffer-post-9", scheduledAt: "2030-08-26T15:00:00.000Z",
    postStatus: "SCHEDULED", postUrl: null,
  });
  await repository.failCampaignPost(10, "Buffer rejected this post.");
  await repository.recordCampaignPostAttemptError(9, "Temporary Buffer status error.");
  await repository.getCampaignPosts({ campaignId: "campaign:7", syncableOnly: true });
  await repository.setBufferCampaignMode("campaign:7", "production");
  assert.deepEqual(executions.map((item) => item.procedure), [
    "dbo.Campaign_Save",
    "dbo.BufferCampaignPost_Upsert",
    "dbo.BufferCampaignPost_DeactivateMissingDrafts",
    "dbo.BufferCampaignPost_ApplyStatus",
    "dbo.BufferCampaignPost_Fail",
    "dbo.BufferCampaignPost_RecordAttemptError",
    "dbo.BufferCampaignPost_Get",
    "dbo.BufferCampaign_SetMode",
  ]);
  assert.equal(executions[0].parameters.get("MediaUrl").value, "https://res.cloudinary.com/crm-cloud/video/upload/v1/crm-marketing/campaigns/story.mp4");
  assert.equal(executions[0].parameters.get("PostType").value, "STORY");
  assert.equal(executions[0].parameters.get("MediaId").value, "cloudinary-asset-video");
  assert.equal(executions[0].parameters.get("CloudinaryAssetId").value, "cloudinary-asset-video");
  assert.equal(executions[0].parameters.get("CloudinaryPublicId").value, "crm-marketing/campaigns/story");
  assert.equal(executions[0].parameters.get("MediaMimeType").value, "video/mp4");
  assert.equal(executions[0].parameters.get("MediaSizeBytes").value, 2048);
  assert.equal(executions[0].parameters.get("MediaWidth").value, 1080);
  assert.equal(executions[0].parameters.get("MediaHeight").value, 1920);
  assert.equal(executions[0].parameters.get("MediaAudioSampleRate").value, 48000);
  assert.equal(executions[0].parameters.get("MediaVideoBitrate").value, 891087);
  assert.equal(executions[0].parameters.get("MediaAudioBitrate").value, 128001);
  assert.equal(executions[0].parameters.get("MediaDurationSeconds").value, 30.125);
  assert.equal(executions[0].parameters.get("MediaFrameRate").value, 29.97003);
  assert.equal(executions[0].parameters.get("MediaVideoCodec").value, "avc1.640028");
  assert.equal(executions[0].parameters.get("AIReplyEnabled").value, 1);
  assert.equal(executions[1].parameters.get("BufferChannelId").value, "channel-1");
  assert.equal(executions[3].parameters.get("BufferPostId").value, "buffer-post-9");
  assert.equal(executions[6].parameters.get("SyncableOnly").value, 1);
  assert.equal(executions[6].parameters.get("ActiveOnly").value, 0);
});

const hasSqlServer = Boolean(process.env.SQL_SERVER_CONNECTION_STRING || (process.env.DB_SERVER && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD));
test("real SQL Server connectivity smoke test", {
  skip: hasSqlServer ? false : "SQL Server DB_* credentials are not available.",
}, async () => {
  const sqlModule = await import("mssql");
  const sql = sqlModule.default || sqlModule;
  const connection=process.env.SQL_SERVER_CONNECTION_STRING||{server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:String(process.env.DB_ENCRYPT||"true").toLowerCase()!=="false",trustServerCertificate:String(process.env.DB_TRUST_SERVER_CERTIFICATE||"false").toLowerCase()==="true"}};
  const pool = await new sql.ConnectionPool(connection).connect();
  try {
    const result = await pool.request().query("SELECT CAST(1 AS INT) AS ok");
    assert.equal(result.recordset[0].ok, 1);
  } finally {
    await pool.close();
  }
});
