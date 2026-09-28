import { proxySocialRequest } from "../social/_proxy";

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

async function json(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function sourceError(response: Response, fallback: string) {
  const body = await json(response.clone());
  return clean(body.message) || clean(body.error) || fallback;
}

export async function GET() {
  const [leadResponse, contentResponse, analyticsResponse] = await Promise.all([
    proxySocialRequest("/leads?limit=500"),
    proxySocialRequest("/content"),
    proxySocialRequest("/landing-pages/analytics"),
  ]);
  const sources = {
    leads: leadResponse.ok,
    content: contentResponse.ok,
    landingPageAnalytics: analyticsResponse.ok,
  };
  const syncErrors: string[] = [];
  if (!sources.leads) syncErrors.push(await sourceError(leadResponse, "Leads could not be synchronized from SQL Server."));
  if (!sources.content) syncErrors.push(await sourceError(contentResponse, "Campaigns and landing pages could not be synchronized from SQL Server."));
  if (!sources.landingPageAnalytics) syncErrors.push(await sourceError(analyticsResponse, "Landing-page analytics could not be synchronized from SQL Server."));

  if (!sources.leads && !sources.content && !sources.landingPageAnalytics) {
    return Response.json(
      { ok: false, message: syncErrors[0] || "Production data could not be loaded from SQL Server.", sources, syncErrors },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  const [leadData, contentData, analyticsData] = await Promise.all([
    sources.leads ? json(leadResponse) : Promise.resolve<Record<string, unknown>>({}),
    sources.content ? json(contentResponse) : Promise.resolve<Record<string, unknown>>({}),
    sources.landingPageAnalytics ? json(analyticsResponse) : Promise.resolve<Record<string, unknown>>({}),
  ]);
  return Response.json({
    ok: syncErrors.length === 0,
    sources,
    syncErrors,
    ...(sources.leads ? { leads: Array.isArray(leadData.leads) ? leadData.leads : [] } : {}),
    ...(sources.content ? {
      campaigns: Array.isArray(contentData.campaigns) ? contentData.campaigns : [],
      pages: Array.isArray(contentData.pages) ? contentData.pages : [],
      webinars: Array.isArray(contentData.webinars) ? contentData.webinars : [],
    } : {}),
    ...(sources.landingPageAnalytics ? {
      landingPageAnalytics: Array.isArray(analyticsData.analytics) ? analyticsData.analytics : [],
    } : {}),
    activities: [],
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed JSON payload." }, { status: 400 });
  }
  const action = clean(body.action);
  let path = "";
  let method = "POST";
  let payload: Record<string, unknown> = {};
  if (action === "lead.create") {
    if (!clean(body.name) || !clean(body.email)) return Response.json({ error: "Name and email are required" }, { status: 400 });
    path = "/leads";
    payload = { name: clean(body.name), email: clean(body.email), phone: clean(body.phone), facebook: clean(body.facebook), instagram: clean(body.instagram) || clean(body.social), x: clean(body.x), source: clean(body.source) || "Manual", value: Number(body.value) || 0 };
  } else if (action === "lead.update") {
    path = "/leads";
    method = "PUT";
    payload = { leadId: Number(String(body.id).replace(/^social:/, "")), name: clean(body.name), email: clean(body.email), phone: clean(body.phone), facebook: clean(body.facebook), instagram: clean(body.instagram), x: clean(body.x), source: clean(body.source) || "Manual", value: Number(body.value) || 0 };
  } else if (action === "lead.status") {
    path = "/leads/status";
    payload = { leadId: Number(String(body.id).replace(/^social:/, "")), status: clean(body.status) };
  } else if (action === "campaign.create") {
    path = "/content";
    payload = { entity: "campaign", name: clean(body.name), platform: clean(body.platform) || "Instagram", audience: clean(body.audience), message: clean(body.message), budget: Number(body.budget) || 0, status: "draft" };
  } else if (action === "campaign.status") {
    path = "/content/campaign-mode";
    payload = { id: body.id, mode: clean(body.status).toLowerCase() };
  } else if (action === "page.create") {
    path = "/content";
    payload = { entity: "landing_page", title: clean(body.title), slug: clean(body.slug), headline: clean(body.headline), teaser: clean(body.teaser), webinarUrl: clean(body.webinarUrl), paymentUrl: clean(body.paymentUrl), status: "published" };
  } else {
    return Response.json({ error: "Unsupported action" }, { status: 400 });
  }
  const response = await proxySocialRequest(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await json(response);
  return Response.json(response.ok ? { record: data.record || data.lead, ...data } : data, { status: response.status });
}

export async function DELETE(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed JSON payload." }, { status: 400 });
  }
  const path = clean(body.entity) === "lead" ? "/leads" : "/content";
  return proxySocialRequest(path, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
