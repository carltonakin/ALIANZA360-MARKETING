import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
let productionServer;
let dashboardUrl;
let serverOutput = "";

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Could not reserve a local port for the Next.js render test.");
  return port;
}

test.before(async () => {
  const port = await reservePort();
  dashboardUrl = `http://127.0.0.1:${port}`;
  productionServer = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  productionServer.stdout.on("data", (chunk) => { serverOutput += chunk; });
  productionServer.stderr.on("data", (chunk) => { serverOutput += chunk; });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (productionServer.exitCode !== null) {
      throw new Error(`Next.js exited before the render test. ${serverOutput.slice(-1000)}`);
    }
    try {
      const response = await fetch(dashboardUrl);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Next.js. ${serverOutput.slice(-1000)}`);
});

test.after(async () => {
  if (!productionServer || productionServer.exitCode !== null) return;
  productionServer.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => productionServer.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
});

async function render() {
  return fetch(dashboardUrl, { headers: { accept: "text/html" } });
}

test("server-renders Login and denies unauthenticated CRM/API access", async () => {
  const protectedPage = await fetch(dashboardUrl, { redirect: "manual" });
  assert.ok([302, 307, 308].includes(protectedPage.status));
  assert.match(protectedPage.headers.get("location") || "", /\/login/);

  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Alianza CRM Marketing 360<\/title>/i);
  assert.match(html, /CRM • MARKETING/i);
  assert.match(html, /SECURE ACCESS/i);
  assert.match(html, /Sign in/i);
  assert.doesNotMatch(html, /Alianza#123|PasswordHash/i);

  const api = await fetch(`${dashboardUrl}/api/data`);
  assert.equal(api.status, 401);
});

test("dashboard exposes social listener configuration and live diagnostics", async () => {
  const [page, layout, leadsRoute, interactionsRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/social/leads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/social/interactions/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /type SocialChannelConfig/i);
  assert.match(page, /Test all channels/i);
  assert.match(page, /environment-managed/i);
  assert.match(page, /Test failed/i);
  assert.match(page, /LIVE/i);
  assert.match(page, /Social Listener/i);
  assert.match(page, /SQL Server persistence/i);
  assert.match(page, /\/api\/social\/leads/i);
  assert.match(page, /Test server connection/i);
  assert.match(page, /\/api\/social\/config/i);
  assert.doesNotMatch(page, /name=["']DB_PASSWORD["']/i);
  assert.match(page, /label="Facebook" name="facebook"/i);
  assert.match(page, /label="Instagram" name="instagram"/i);
  assert.match(page, /label="X" name="x"/i);
  assert.match(page, /value=\{values\.facebook\}/i);
  assert.match(page, /value=\{values\.instagram\}/i);
  assert.match(page, /value=\{values\.x\}/i);
  assert.match(page, /label="Last Intent" name="lastIntent"/i);
  assert.match(page, /AI Response[\s\S]+?<textarea[\s\S]+?name="crmnotes"/i);
  assert.match(page, /LATEST COMMENT OR DM/i);
  assert.match(page, /Comment and DM history/i);
  assert.match(page, /scoreReason/i);
  assert.match(page, /item\.direction\.toLowerCase\(\)/i);
  assert.match(page, /\{\(l\.intent \|\| "—"\)\.replaceAll\("_", " "\)\}/i);
  assert.match(page, /\{l\.crmNotes \|\| "—"\}/i);
  const leadHeader = page.match(/className="data-table lead-cols table-head">([\s\S]+?)<\/div>/i);
  assert.ok(leadHeader, "The lead table header must remain inspectable.");
  assert.deepEqual(
    [...leadHeader[1].matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1].trim()),
    ["Contact", "Source", "Last Intent", "AI Response", "Stage"],
  );
  assert.match(page, /Lead updated successfully/i);
  assert.match(page, /Save to SQL and schedule in Buffer/i);
  assert.match(page, /campaignSaveError/i);
  assert.match(page, /setCampaignSaveError\(error instanceof Error/i);
  assert.match(page, /className="campaign-save-error" role="alert"/i);
  assert.match(page, /Dismiss campaign save error/i);
  assert.match(page, /Campaign saved to SQL, but all/i);
  assert.match(page, /persistedBufferFailure/i);
  const saveFailureBlock = page.match(/const saveBufferCampaign[\s\S]+?catch \(error\) \{([\s\S]+?)\} finally \{([\s\S]+?)\}/i);
  assert.ok(saveFailureBlock, "Campaign save catch/finally blocks must remain inspectable.");
  assert.match(saveFailureBlock[1], /setCampaignSaveError/i);
  assert.doesNotMatch(saveFailureBlock[1], /setModal|setEditingCampaign/i);
  assert.doesNotMatch(saveFailureBlock[2], /setCampaignSaveError|setModal|setEditingCampaign/i);
  assert.match(page, /no more than 300 MB/i);
  assert.match(page, /<option value="POST">Post<\/option>/i);
  assert.match(page, /<option value="REEL">Reel<\/option>/i);
  assert.match(page, /<option value="STORY">Story<\/option>/i);
  assert.match(page, /onDrop=\{onMediaDrop\}/i);
  assert.match(page, /Drop media here/i);
  assert.match(page, /Remove media/i);
  assert.match(page, /Edit campaign/i);
  assert.match(page, /Buffer AI Assist unavailable via public API/i);
  assert.match(page, /\/api\/buffer\/channels/i);
  assert.match(page, /\/api\/buffer\/campaigns/i);
  assert.match(page, /BUFFER_API_KEY/i);
  assert.doesNotMatch(page, /name=["']BUFFER_API_KEY["']/i);
  assert.match(page, /Edit page/i);
  assert.match(page, /Edit webinar/i);
  assert.match(page, /method: entity && updating \? "PUT" : "POST"/i);
  assert.doesNotMatch(page, /public landing-page mirror/i);
  assert.doesNotMatch(page, /name="(facebook|instagram|x)"[^>]*(readOnly|disabled)/i);
  assert.match(leadsRoute, /export async function PUT/i);
  assert.match(leadsRoute, /proxySocialRequest\(isStatusUpdate \? "\/leads\/status" : "\/leads"/i);
  assert.match(interactionsRoute, /forwardJson\(request, "\/lead-interactions"\)/i);
  assert.match(layout, /Alianza CRM Marketing 360/i);
  assert.match(layout, /AI-powered marketing funnel, lead capture and social campaign intelligence/i);
});

test("production dashboard uses the SQL-backed API without demo-record fallback", async () => {
  const [page, dataRoute, listener, repository] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/data/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../social/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../social/sql-server.mjs", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /seedLeads|safe seed view/i);
  assert.doesNotMatch(page, /alicia@mail\.com|jordan@mail\.com|samira@mail\.com/i);
  assert.match(page, /useState<Lead\[\]>\(\[\]\)/);
  assert.match(page, /fetch\("\/api\/data", \{ cache: "no-store" \}\)/);
  assert.match(page, /setDataError\(message\)/);
  assert.match(page, /setLeads\(\[\]\)/);
  assert.match(dataRoute, /proxySocialRequest\("\/leads\?limit=100"\)/);
  assert.match(dataRoute, /proxySocialRequest\("\/content"\)/);
  assert.match(listener, /SqlServerRepository\.connectFromEnv/);
  assert.match(repository, /openSqlConnection\(env\)/);
  assert.match(repository, /SocialLead_GetRecent/);
  assert.match(repository, /CRMContent_GetAll/);
});
