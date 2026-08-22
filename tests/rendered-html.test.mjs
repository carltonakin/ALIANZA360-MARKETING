import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
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
