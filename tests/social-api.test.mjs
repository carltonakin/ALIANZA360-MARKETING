import assert from "node:assert/strict";
import test from "node:test";
import {
  FacebookAdapter,
  InMemorySocialRepository,
  InstagramAdapter,
  XAdapter,
} from "../social/core.mjs";
import { createSocialListenerApp, validateServiceConfiguration } from "../social/server.mjs";
import { decryptChannelSecrets, encryptChannelSecrets } from "../social/channel-config.mjs";

const silentLogger = { info() {}, error() {}, log() {} };
const serviceEnv = {
  SERVICE_AUTH_TOKEN: "service-token",
  META_VERIFY_TOKEN: "verify-token",
  META_APP_SECRET: "app-secret",
};

function providerResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function adapters(fetchImpl) {
  const options = { fetchImpl, logger: silentLogger, sleep: async () => {} };
  return {
    instagram: new InstagramAdapter({ accessToken: "meta-token", accountId: "ig-1" }, options),
    facebook: new FacebookAdapter({ accessToken: "meta-token", pageId: "page-1" }, options),
    x: new XAdapter({ bearerToken: "x-token" }, options),
  };
}

async function createApp(fetchImpl = async (url) =>
  String(url).includes("api.x.com")
    ? providerResponse({ data: { id: "x-1", username: "x-account", name: "X Account" } })
    : providerResponse({ id: "meta-1", username: "meta-account", name: "Meta Account" })) {
  const repository = new InMemorySocialRepository();
  const app = await createSocialListenerApp({
    env: serviceEnv,
    repository,
    adapters: adapters(fetchImpl),
    logger: silentLogger,
  });
  return { app, repository };
}

function serviceRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer service-token");
  return new Request(`http://listener.test${path}`, { ...init, headers });
}

async function sign(body) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode("app-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `sha256=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

test("listener startup validates only required server configuration", () => {
  assert.deepEqual(validateServiceConfiguration({
    SERVICE_AUTH_TOKEN: "service-token",
    DB_SERVER: "sql.example", DB_NAME: "crm", DB_USER: "crm_app", DB_PASSWORD: "password",
  }), { valid: true });
  assert.throws(
    () => validateServiceConfiguration({}),
    /SERVICE_AUTH_TOKEN, DB_SERVER\/DB_NAME\/DB_USER\/DB_PASSWORD/,
  );
});

test("status endpoint requires service authentication and never returns secrets", async () => {
  const { app } = await createApp();
  const unauthorized = await app.handle(new Request("http://listener.test/status"));
  assert.equal(unauthorized.status, 401);

  const response = await app.handle(serviceRequest("/status"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.channels.length, 3);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /meta-token|x-token|service-token|app-secret/);
  assert.ok(body.channels.every((channel) => channel.status === "disconnected"));
});

test("health endpoint reports a database failure without leaking credentials",async()=>{const repository=new InMemorySocialRepository();repository.healthCheck=async()=>false;const app=await createSocialListenerApp({env:serviceEnv,repository,adapters:adapters(async()=>providerResponse({id:"provider"})),logger:silentLogger});const response=await app.handle(new Request("http://listener.test/health"));assert.equal(response.status,503);const body=await response.json();assert.deepEqual(body,{ok:false,service:"crm360-social-listener",database:"sql_server",databaseConnected:false});assert.doesNotMatch(JSON.stringify(body),/token|password|secret/i)});

test("health endpoint safely handles a thrown SQL connection error",async()=>{const repository=new InMemorySocialRepository();repository.healthCheck=async()=>{throw new Error("password=must-not-leak")};const app=await createSocialListenerApp({env:serviceEnv,repository,adapters:adapters(async()=>providerResponse({id:"provider"})),logger:silentLogger});const response=await app.handle(new Request("http://listener.test/health"));assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/must-not-leak|password/i)});

test("connection endpoint reports connected only after real mocked identity responses", async () => {
  const { app } = await createApp();
  const response = await app.handle(serviceRequest("/connections/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channels: ["instagram", "facebook", "x"] }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.channels.map((channel) => channel.status), ["connected", "connected", "connected"]);
});

test("authentication failures cannot produce connected status", async () => {
  const { app } = await createApp(async () =>
    providerResponse({ error: { message: "expired access token" } }, 401));
  const response = await app.handle(serviceRequest("/connections/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channels: ["instagram"] }),
  }));
  const body = await response.json();
  assert.equal(response.status, 424);
  assert.equal(body.ok, false);
  assert.equal(body.channels[0].status, "invalid_credentials");
  assert.notEqual(body.channels[0].status, "connected");
});

test("connection endpoint rejects malformed and unsupported requests", async () => {
  const { app } = await createApp();
  const malformed = await app.handle(serviceRequest("/connections/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }));
  assert.equal(malformed.status, 400);

  const unsupported = await app.handle(serviceRequest("/connections/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channels: ["unsupported"] }),
  }));
  assert.equal(unsupported.status, 400);
});

test("Meta webhook verification validates the configured token", async () => {
  const { app } = await createApp();
  const ok = await app.handle(new Request(
    "http://listener.test/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-value",
  ));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "challenge-value");

  const rejected = await app.handle(new Request(
    "http://listener.test/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-value",
  ));
  assert.equal(rejected.status, 403);
});

test("valid signed webhooks create a lead once and duplicate delivery is idempotent", async () => {
  const { app, repository } = await createApp();
  const payload = {
    object: "instagram",
    entry: [{
      time: 1_787_000_000,
      changes: [{
        field: "comments",
        value: {
          id: "webhook-comment-1",
          text: "Please send webinar pricing",
          username: "webhook-buyer",
          from: { id: "webhook-person-1", name: "Webhook Buyer" },
          media: { id: "post-1" },
        },
      }],
    }],
  };
  const rawBody = JSON.stringify(payload);
  const signature = await sign(rawBody);
  const deliver = () => app.handle(new Request("http://listener.test/webhooks/meta", {
    method: "POST",
    headers: { "x-hub-signature-256": signature },
    body: rawBody,
  }));

  const first = await deliver();
  const firstBody = await first.json();
  const duplicate = await deliver();
  const duplicateBody = await duplicate.json();
  assert.equal(first.status, 200);
  assert.deepEqual(firstBody, { ok: true, received: 1, processed: 1, duplicates: 0, errors: 0 });
  assert.deepEqual(duplicateBody, { ok: true, received: 1, processed: 0, duplicates: 1, errors: 0 });
  assert.equal(repository.events.size, 1);
  assert.equal(repository.leads.size, 1);

  const leadsResponse = await app.handle(serviceRequest("/leads"));
  const leadsBody = await leadsResponse.json();
  assert.equal(leadsBody.leads.length, 1);
  assert.equal(leadsBody.leads[0].id, "social:1");
  assert.equal(leadsBody.leads[0].source, "Instagram");

  const statusResponse = await app.handle(serviceRequest("/leads/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leadId: 1, status: "Hot" }),
  }));
  assert.equal(statusResponse.status, 200);
  const updatedLeads = await repository.getLeads();
  assert.equal(updatedLeads[0].status, "Hot");
});

test("social lead status endpoint rejects malformed updates", async () => {
  const { app } = await createApp();
  const malformedResponse = await app.handle(serviceRequest("/leads/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leadId: "not-a-number", status: "Hot" }),
  }));
  assert.equal(malformedResponse.status, 400);

  const invalidStatusResponse = await app.handle(serviceRequest("/leads/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leadId: 1, status: "Anything" }),
  }));
  assert.equal(invalidStatusResponse.status, 400);
});

test("manual lead create, update, reload, and clear persist every social field", async () => {
  const { app } = await createApp();
  const createResponse = await app.handle(serviceRequest("/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Editable Lead",
      email: "editable@example.com",
      phone: "305-555-0199",
      facebook: "facebook.com/editable",
      instagram: "@editable",
      x: "@editable_x",
      source: "Manual",
      value: 1750,
    }),
  }));
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).lead;
  assert.equal(created.facebook, "facebook.com/editable");
  assert.equal(created.instagram, "@editable");
  assert.equal(created.x, "@editable_x");

  const updateResponse = await app.handle(serviceRequest("/leads", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      leadId: 1,
      name: "Editable Lead",
      email: "editable@example.com",
      phone: "",
      facebook: "",
      instagram: "@updated",
      x: "",
      source: "Instagram",
      value: 2000,
    }),
  }));
  assert.equal(updateResponse.status, 200);

  const reloadResponse = await app.handle(serviceRequest("/leads"));
  const reloaded = (await reloadResponse.json()).leads[0];
  assert.equal(reloaded.facebook, "");
  assert.equal(reloaded.instagram, "@updated");
  assert.equal(reloaded.x, "");
  assert.equal(reloaded.phone, "");
  assert.equal(reloaded.value, 2000);
});

test("lead and content delete operations complete through authenticated server endpoints",async()=>{
 const {app}=await createApp();
 await app.handle(serviceRequest("/leads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Delete Me",email:"delete@example.com",source:"Manual",value:0})}));
 const deletedLead=await app.handle(serviceRequest("/leads",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({id:"social:1"})}));
 assert.equal(deletedLead.status,200);assert.equal((await deletedLead.json()).deleted,true);
 const campaignResponse=await app.handle(serviceRequest("/content",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({entity:"campaign",name:"Delete Campaign",platform:"Instagram",audience:"Founders",message:"Join",budget:10})}));
 const campaign=(await campaignResponse.json()).record;
 const deletedContent=await app.handle(serviceRequest("/content",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({entity:"campaign",id:campaign.id})}));
 assert.equal(deletedContent.status,200);assert.equal((await deletedContent.json()).deleted,true);
});

test("webhooks reject invalid signatures, malformed JSON, and malformed payloads", async () => {
  const { app } = await createApp();
  const invalidSignature = await app.handle(new Request("http://listener.test/webhooks/meta", {
    method: "POST",
    headers: { "x-hub-signature-256": "sha256=invalid" },
    body: "{}",
  }));
  assert.equal(invalidSignature.status, 401);

  const malformedJson = "{";
  const malformedJsonResponse = await app.handle(new Request("http://listener.test/webhooks/meta", {
    method: "POST",
    headers: { "x-hub-signature-256": await sign(malformedJson) },
    body: malformedJson,
  }));
  assert.equal(malformedJsonResponse.status, 400);

  const malformedPayload = "{}";
  const malformedPayloadResponse = await app.handle(new Request("http://listener.test/webhooks/meta", {
    method: "POST",
    headers: { "x-hub-signature-256": await sign(malformedPayload) },
    body: malformedPayload,
  }));
  assert.equal(malformedPayloadResponse.status, 400);
});

test("unsupported Meta events are acknowledged without creating records", async () => {
  const { app, repository } = await createApp();
  const rawBody = JSON.stringify({
    object: "page",
    entry: [{ changes: [{ field: "unsupported", value: {} }] }],
  });
  const response = await app.handle(new Request("http://listener.test/webhooks/meta", {
    method: "POST",
    headers: { "x-hub-signature-256": await sign(rawBody) },
    body: rawBody,
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.received, 0);
  assert.equal(repository.events.size, 0);
});

test("channel secrets encrypt at rest and are never returned by configuration APIs", async () => {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  const envelope = encryptChannelSecrets({ accessToken: "provider-secret" }, encryptionKey);
  assert.notEqual(envelope.ciphertext, "provider-secret");
  assert.deepEqual(decryptChannelSecrets(envelope, encryptionKey), { accessToken: "provider-secret" });

  const repository = new InMemorySocialRepository();
  const app = await createSocialListenerApp({
    env: { ...serviceEnv, CHANNEL_CONFIG_ENCRYPTION_KEY: encryptionKey },
    repository,
    fetchImpl: async () => providerResponse({ id: "page-42", name: "Saved Page" }),
    logger: silentLogger,
  });
  const save = await app.handle(serviceRequest("/channel-configurations/facebook", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      environment: "production",
      pageId: "page-42",
      adAccountId: "act_42",
      appId: "app-42",
      loginMode: "facebook_login",
      tokenType: "page",
      callbackUrl: "https://crm.example.com/oauth/meta",
      requiredScopes: "pages_read_engagement pages_messaging ads_management",
      grantedScopes: "pages_read_engagement pages_messaging ads_management",
      permissionsValidatedAt: "2026-08-17T12:00:00Z",
      appMode: "live",
      advancedAccessStatus: "approved",
      businessVerificationStatus: "verified",
      webhookUrl: "https://listener.example.com/webhooks/meta",
      webhookSubscribedFields: "messages feed",
      webhookSubscribedAt: "2026-08-17T12:00:00Z",
      secrets: { accessToken: "provider-secret", appSecret: "app-secret-42" },
    }),
  }));
  assert.equal(save.status, 200);

  const list = await app.handle(serviceRequest("/channel-configurations"));
  const listed = await list.json();
  const serialized = JSON.stringify(listed);
  assert.doesNotMatch(serialized, /provider-secret|app-secret-42/);
  assert.match(serialized, /\*\*\*\*\*\*\*\*/);
  const facebook = listed.channels.find((item) => item.channel === "facebook");
  assert.equal(facebook.adAccountId, "act_42");
  assert.equal(facebook.productionReadiness.ready, false);

  const verify = await app.handle(serviceRequest("/channel-configurations/facebook/test", { method: "POST" }));
  assert.equal(verify.status, 200);
  const verified = await verify.json();
  assert.equal(verified.result.status, "connected");
  assert.equal(verified.channel.status, "connected");
  assert.equal(verified.channel.productionReadiness.ready, true);
});

test("content persists with relationships and production mode is gated by provider readiness", async () => {
  const encryptionKey = Buffer.alloc(32, 8).toString("base64");
  const repository = new InMemorySocialRepository();
  const app = await createSocialListenerApp({
    env: { ...serviceEnv, CHANNEL_CONFIG_ENCRYPTION_KEY: encryptionKey },
    repository,
    fetchImpl: async () => providerResponse({ id: "ig-42", username: "saved-account" }),
    logger: silentLogger,
  });
  await app.handle(serviceRequest("/channel-configurations/instagram", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, accountId: "ig-42", pageId: "page-42", secrets: { accessToken: "ig-secret" } }),
  }));
  await app.handle(serviceRequest("/channel-configurations/instagram/test", { method: "POST" }));

  const campaignResponse = await app.handle(serviceRequest("/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entity: "campaign", name: "SQL Campaign", platform: "Instagram", audience: "Founders", message: "Register now", budget: 25 }),
  }));
  const campaign = (await campaignResponse.json()).record;
  assert.equal(campaign.status, "draft");

  const blocked = await app.handle(serviceRequest("/content/campaign-mode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: campaign.id, mode: "production" }),
  }));
  assert.equal(blocked.status, 409);

  const pageResponse = await app.handle(serviceRequest("/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entity: "landing_page", campaignId: campaign.id, title: "SQL Page", slug: "sql-page", headline: "Join us" }),
  }));
  assert.equal(pageResponse.status, 201);
  const production = await app.handle(serviceRequest("/content/campaign-mode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: campaign.id, mode: "production" }),
  }));
  assert.equal(production.status, 200);
  assert.equal((await production.json()).record.status, "production");

  const productionEdit = await app.handle(serviceRequest("/content", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      entity: "campaign", id: campaign.id, name: "SQL Campaign Updated",
      platform: "Instagram", audience: "Founders", message: "Updated while live",
      budget: 30, status: "production",
    }),
  }));
  assert.equal(productionEdit.status, 200);
  assert.equal((await productionEdit.json()).record.status, "production");

  const reload = await app.handle(serviceRequest("/content"));
  const content = await reload.json();
  assert.equal(content.campaigns.length, 1);
  assert.equal(content.campaigns[0].message, "Updated while live");
  assert.equal(content.pages[0].campaignId, campaign.id);
});

test("campaign, landing page, and webinar edits update existing records without duplicates", async () => {
  const { app } = await createApp();
  const save = async (method, payload) => {
    const response = await app.handle(serviceRequest("/content", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    return { response, body: await response.json() };
  };

  const createdCampaign = await save("POST", {
    entity: "campaign", name: "Original campaign", platform: "Instagram",
    audience: "Founders", message: "Original message", budget: 20, status: "draft",
  });
  assert.equal(createdCampaign.response.status, 201);
  const campaignId = createdCampaign.body.record.id;

  const createdPage = await save("POST", {
    entity: "landing_page", campaignId, title: "Original page", slug: "original-page",
    headline: "Original headline", webinarUrl: "https://example.com/original",
    paymentUrl: "https://example.com/pay", status: "published",
  });
  assert.equal(createdPage.response.status, 201);
  const pageId = createdPage.body.record.id;

  const createdWebinar = await save("POST", {
    entity: "webinar", campaignId, landingPageId: pageId, title: "Original webinar",
    description: "Original description", webinarUrl: "https://example.com/webinar", status: "draft",
  });
  assert.equal(createdWebinar.response.status, 201);
  const webinarId = createdWebinar.body.record.id;

  const campaignUpdate = await save("PUT", {
    entity: "campaign", id: campaignId, name: "Edited campaign", platform: "Multi-channel",
    audience: "Growth teams", message: "Edited message", budget: 75, status: "draft",
  });
  assert.equal(campaignUpdate.response.status, 200);
  assert.equal(campaignUpdate.body.record.name, "Edited campaign");

  const pageUpdate = await save("PUT", {
    entity: "landing_page", id: pageId, campaignId, title: "Edited page", slug: "edited-page",
    headline: "Edited headline", teaser: "Edited teaser", webinarUrl: "https://example.com/edited",
    paymentUrl: "https://example.com/checkout", status: "published",
  });
  assert.equal(pageUpdate.response.status, 200);
  assert.equal(pageUpdate.body.record.slug, "edited-page");

  const webinarUpdate = await save("PUT", {
    entity: "webinar", id: webinarId, campaignId, landingPageId: pageId,
    title: "Edited webinar", description: "Edited description",
    scheduledAt: "2026-09-01T14:30:00.000Z", webinarUrl: "https://example.com/live",
    status: "published",
  });
  assert.equal(webinarUpdate.response.status, 200);
  assert.equal(webinarUpdate.body.record.title, "Edited webinar");

  const reload = await app.handle(serviceRequest("/content"));
  const content = await reload.json();
  assert.equal(content.campaigns.length, 1);
  assert.equal(content.pages.length, 1);
  assert.equal(content.webinars.length, 1);
  assert.equal(content.campaigns[0].message, "Edited message");
  assert.equal(content.pages[0].headline, "Edited headline");
  assert.equal(content.webinars[0].description, "Edited description");
  assert.equal(content.webinars[0].landingPageId, pageId);

  const missing = await save("PUT", {
    entity: "campaign", id: "campaign:999", name: "Missing", platform: "Instagram",
    audience: "Founders", message: "No insert", budget: 0, status: "draft",
  });
  assert.equal(missing.response.status, 404);
  assert.equal((await (await app.handle(serviceRequest("/content"))).json()).campaigns.length, 1);

  const missingId = await save("PUT", {
    entity: "webinar", title: "No ID", status: "draft",
  });
  assert.equal(missingId.response.status, 400);

  const invalidUrl = await save("PUT", {
    entity: "landing_page", id: pageId, campaignId, title: "Edited page", slug: "edited-page",
    headline: "Edited headline", webinarUrl: "not-a-url", status: "published",
  });
  assert.equal(invalidUrl.response.status, 400);
});

test("every routine lead path is idempotent and persists attribution", async () => {
  const { app, repository } = await createApp();
  for (const routine of [
    "facebook_listener", "instagram_listener", "x_listener", "landing_page_registration",
    "webinar_registration", "campaign_conversion", "ai_social_listener",
  ]) {
    const request = () => app.handle(serviceRequest("/routine-leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ routine, externalEventId: `${routine}-1`, name: "Routine Lead", email: "routine@example.com" }),
    }));
    assert.equal((await request()).status, 201);
    const duplicate = await request();
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
  }
  assert.equal(repository.routineEvents.size, 7);
  assert.equal(repository.leads.size, 1);
});

test("AI uses a structured Responses API result and saves a reviewable SQL draft", async () => {
  const repository = new InMemorySocialRepository();
  const app = await createSocialListenerApp({
    env: { ...serviceEnv, OPENAI_API_KEY: "test-openai-key", OPENAI_MODEL: "gpt-5.6" },
    repository,
    adapters: adapters(async () => providerResponse({ id: "provider-1" })),
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const requestBody = JSON.parse(init.body);
      assert.equal(requestBody.text.format.type, "json_schema");
      assert.equal(requestBody.text.format.strict, true);
      return providerResponse({
        id: "resp_test",
        output_text: JSON.stringify({ name: "AI Campaign", platform: "Instagram", audience: "Founders", message: "Join the webinar", budget: 50 }),
      });
    },
    logger: silentLogger,
  });
  const response = await app.handle(serviceRequest("/ai/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entity: "campaign", brief: "Create a founder webinar campaign." }),
  }));
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.record.createdByAi, true);
  assert.equal(result.record.status, "draft");
  assert.match(result.record.id, /^campaign:/);
});

test("automation, scoring, and unified lead endpoints are independently operable", async () => {
  const { app } = await createApp();
  const createdResponse = await app.handle(serviceRequest("/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      entity: "campaign",
      name: "Paid webinar leads",
      platform: "Facebook",
      audience: "Business owners",
      message: "Request pricing and watch the webinar.",
      budget: 80,
      status: "draft",
      sourceType: "PAID",
      externalCampaignId: "meta-campaign-1",
      leadFormId: "meta-form-1",
      cadenceMinutes: 15,
      maxRetries: 4,
    }),
  }));
  assert.equal(createdResponse.status, 201);
  const campaign = (await createdResponse.json()).record;
  assert.equal(campaign.sourceType, "PAID");
  assert.equal(campaign.cadenceMinutes, 15);

  const started = await app.handle(serviceRequest("/campaign-automation/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: campaign.id, action: "start" }),
  }));
  assert.equal(started.status, 200);
  assert.equal((await started.json()).record.automationStatus, "RUNNING");
  const automation = await (await app.handle(serviceRequest("/campaign-automation"))).json();
  assert.equal(automation.campaigns.length, 1);
  assert.equal(automation.campaigns[0].leadFormId, "meta-form-1");

  const scoringResponse = await app.handle(serviceRequest("/scoring", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rules: { PRICE_REQUEST: 35 },
      thresholds: { COLD: 0, WARM: 25, HOT: 60, VERY_HOT: 90 },
    }),
  }));
  assert.equal(scoringResponse.status, 200);
  const scoring = await scoringResponse.json();
  assert.equal(scoring.rules.PRICE_REQUEST, 35);
  assert.equal(scoring.thresholds.VERY_HOT, 90);

  const leadResponse = await app.handle(serviceRequest("/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Unified Person", email: "unified@example.test", source: "Manual", value: 0 }),
  }));
  const lead = (await leadResponse.json()).lead;
  const leadId = String(lead.id).replace("social:", "");
  const unifiedResponse = await app.handle(serviceRequest(`/leads/${leadId}/unified`));
  assert.equal(unifiedResponse.status, 200);
  assert.equal((await unifiedResponse.json()).lead.email, "unified@example.test");
});

test("CRM integration endpoints queue, execute, deduplicate, and report Sprout actions", async () => {
  const repository = new InMemorySocialRepository();
  let deliveries = 0;
  const sproutAdapter = {
    status: () => ({
      provider: "sprout", name: "Sprout Social", configured: true, status: "configured",
      reason: "Ready for validation.", checkedAt: null, customerId: "customer-42", profileCount: 1,
      listeningTopicCount: 1, publishingReady: true, publishingMissing: [], capabilities: ["draft_publishing"],
    }),
    healthCheck: async () => ({
      provider: "sprout", name: "Sprout Social", configured: true, status: "connected",
      reason: "Sprout customer access was validated.", checkedAt: "2026-08-18T12:00:00Z",
      customerId: "customer-42", profileCount: 1, listeningTopicCount: 1,
      publishingReady: true, publishingMissing: [], capabilities: ["draft_publishing"],
    }),
    createPublishingDraft: async () => {
      deliveries += 1;
      return { externalId: "sprout-post-501", externalIds: ["sprout-post-501"], externalStatus: "PENDING", isDraft: true };
    },
    fetchInboundEvents: async () => [],
    collectMetrics: async () => ({ profiles: [{ impressions: 100 }], posts: [{ text: "Webinar" }] }),
  };
  const app = await createSocialListenerApp({
    env: serviceEnv,
    repository,
    adapters: adapters(async () => providerResponse({ id: "provider-1" })),
    sproutAdapter,
    logger: silentLogger,
  });

  const statusResponse = await app.handle(serviceRequest("/integrations"));
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.integrations[0].provider, "sprout");
  assert.equal(status.actions.length, 0);

  const requestBody = {
    provider: "sprout", actionType: "PUBLISH_POST", campaignId: null,
    text: "Register for the webinar", idempotencyKey: "api-action-1", executeNow: true,
  };
  const create = () => app.handle(serviceRequest("/integration-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  }));
  const createdResponse = await create();
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.action.status, "SUCCEEDED");
  assert.equal(created.action.externalId, "sprout-post-501");
  assert.equal(created.action.externalStatus, "PENDING");

  const duplicateResponse = await create();
  assert.equal(duplicateResponse.status, 200);
  assert.equal((await duplicateResponse.json()).duplicate, true);
  assert.equal(deliveries, 1);
  assert.equal((await repository.getIntegrationActions()).length, 1);

  const testResponse = await app.handle(serviceRequest("/integrations/sprout/test", { method: "POST" }));
  assert.equal(testResponse.status, 200);
  assert.equal((await testResponse.json()).integration.status, "connected");

  const metricsResponse = await app.handle(serviceRequest("/integrations/sprout/metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(metricsResponse.status, 200);
  assert.equal((await metricsResponse.json()).metrics.posts.length, 1);
});

test("CRM integration action API rejects credentials in unknown fields and never persists them", async () => {
  const repository = new InMemorySocialRepository();
  const app = await createSocialListenerApp({
    env: serviceEnv,
    repository,
    adapters: adapters(async () => providerResponse({ id: "provider-1" })),
    sproutAdapter: {
      status: () => ({ provider: "sprout", configured: true, status: "configured" }),
      createPublishingDraft: async () => ({ externalId: "501", externalStatus: "PENDING", isDraft: true }),
    },
    logger: silentLogger,
  });
  const response = await app.handle(serviceRequest("/integration-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Safe post", accessToken: "must-never-persist", idempotencyKey: "safe-action" }),
  }));
  assert.equal(response.status, 201);
  assert.doesNotMatch(JSON.stringify(await repository.getIntegrationActions()), /must-never-persist/);
});
