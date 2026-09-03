import { proxySocialRequest } from "../../social/_proxy";

const REPORT_PATHS = new Set([
  "leads/scoring",
  "leads/temperature",
  "leads/intents",
  "leads/sources",
  "campaigns/lead-performance",
  "leads/engagement",
  "leads/hot",
]);

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const reportPath = path.join("/");
  if (!REPORT_PATHS.has(reportPath)) {
    return Response.json({ ok: false, error: "Report not found." }, { status: 404 });
  }

  const query = new URL(request.url).search;
  return proxySocialRequest(`/reports/${reportPath}${query}`);
}
