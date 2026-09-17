import { proxySocialRequest } from "../../social/_proxy";

export async function GET(request: Request) {
  const after = new URL(request.url).searchParams.get("after");
  if (after !== null && (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)))) {
    return Response.json({ error: "Invalid lead cursor." }, { status: 400 });
  }
  return proxySocialRequest(`/leads/changes${after === null ? "" : `?after=${after}`}`, { cache: "no-store" });
}
