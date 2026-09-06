import { normalizePostUrl } from "../../../lib/post-url.mjs";
import { proxySocialRequest } from "../social/_proxy";

type RegistrationBody = Record<string, unknown>;
type LandingPageRecord = {
  id?: string | number;
  campaignId?: string | number | null;
  status?: string;
  webinarUrl?: string | null;
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export async function POST(request: Request) {
  let body: RegistrationBody;
  try {
    body = await request.json() as RegistrationBody;
  } catch {
    return Response.json({ error: "Malformed JSON payload." }, { status: 400 });
  }

  const name = clean(body.name);
  const email = clean(body.email);
  const pageId = clean(body.pageId);
  if (!name || !email || !pageId) {
    return Response.json({ error: "Name, email and landing page are required" }, { status: 400 });
  }

  try {
    const contentResponse = await proxySocialRequest("/content", { cache: "no-store" });
    const content = await responseJson(contentResponse);
    if (!contentResponse.ok) return Response.json(content, { status: contentResponse.status });

    const pages = Array.isArray(content.pages) ? content.pages as LandingPageRecord[] : [];
    const page = pages.find((candidate) =>
      String(candidate.id) === pageId && String(candidate.status || "").toLowerCase() !== "archived");
    if (!page) return Response.json({ error: "Landing page not found." }, { status: 404 });

    // This is the authoritative redirect value. It is checked before any CRM write.
    const redirectUrl = normalizePostUrl(page.webinarUrl);
    const suppliedRegistrationId = clean(body.registrationId);
    const registrationId = /^[A-Za-z0-9_-]{8,128}$/.test(suppliedRegistrationId)
      ? suppliedRegistrationId
      : email.toLowerCase();
    const externalEventId = `${pageId}:${registrationId}`;

    const leadResponse = await proxySocialRequest("/routine-leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        routine: "landing_page_registration",
        externalEventId,
        name,
        email,
        phone: clean(body.phone) || null,
        instagram: clean(body.instagram) || clean(body.social) || null,
        facebook: clean(body.facebook) || null,
        x: clean(body.x) || null,
        message: clean(body.message) || clean(body.purpose) || null,
        source: "Landing Page",
        campaignId: page.campaignId || null,
        landingPageId: pageId,
        sourceDetail: `landing_page:${pageId}`,
      }),
    });
    const data = await responseJson(leadResponse);
    if (!leadResponse.ok) return Response.json(data, { status: leadResponse.status });

    // Redirect only after the registration has been persisted and scored successfully.
    return Response.json({ ok: true, ...data, redirectUrl });
  } catch (error) {
    const status = Number((error as { statusCode?: number })?.statusCode) || 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Registration failed" },
      { status },
    );
  }
}
