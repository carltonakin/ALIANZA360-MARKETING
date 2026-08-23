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

test("server-renders the CRM dashboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Alianza CRM Marketing 360<\/title>/i);
  assert.match(html, /CRM • MARKETING|CRM MARKETING FUNNEL 360/i);
  assert.match(html, /Social Listener/i);
  assert.match(html, /Overview/i);
});

test("dashboard exposes social listener configuration and live diagnostics", async () => {
  const [page, layout, leadsRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/social/leads/route.ts", import.meta.url), "utf8"),
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
  assert.match(page, /Lead updated successfully/i);
  assert.match(page, /Edit campaign/i);
  assert.match(page, /Edit page/i);
  assert.match(page, /Edit webinar/i);
  assert.match(page, /method: entity && updating \? "PUT" : "POST"/i);
  assert.doesNotMatch(page, /public landing-page mirror/i);
  assert.doesNotMatch(page, /name="(facebook|instagram|x)"[^>]*(readOnly|disabled)/i);
  assert.match(leadsRoute, /export async function PUT/i);
  assert.match(leadsRoute, /proxySocialRequest\(isStatusUpdate \? "\/leads\/status" : "\/leads"/i);
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
