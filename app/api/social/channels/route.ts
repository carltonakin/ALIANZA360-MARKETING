import { isSocialConfigAdmin } from "../_config";
import { proxySocialRequest } from "../_proxy";

function forbidden() {
  return Response.json({ ok: false, message: "Only the site owner can configure social channels." }, { status: 403 });
}

function channelPath(value: unknown, suffix = "") {
  const channel = String(value || "").toLowerCase();
  return ["instagram", "facebook", "x"].includes(channel)
    ? `/channel-configurations/${channel}${suffix}`
    : null;
}

async function body(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  return proxySocialRequest("/channel-configurations");
}

export async function PUT(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  const payload = await body(request);
  const path = channelPath(payload?.channel);
  if (!payload || !path) return Response.json({ ok: false, message: "A supported channel is required." }, { status: 400 });
  return proxySocialRequest(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function POST(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  const payload = await body(request);
  const path = channelPath(payload?.channel, "/test");
  if (!payload || !path) return Response.json({ ok: false, message: "A supported channel is required." }, { status: 400 });
  return proxySocialRequest(path, { method: "POST" });
}

export async function DELETE(request: Request) {
  if (!isSocialConfigAdmin(request)) return forbidden();
  const payload = await body(request);
  const path = channelPath(payload?.channel);
  if (!payload || !path) return Response.json({ ok: false, message: "A supported channel is required." }, { status: 400 });
  return proxySocialRequest(path, { method: "DELETE" });
}
