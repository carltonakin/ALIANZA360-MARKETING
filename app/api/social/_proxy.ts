import { resolveSocialListenerConfig } from "./_config";

function configurationError() {
  return Response.json(
    {
      ok: false,
      status: "missing_configuration",
      message: "The Social Listener backend service is not configured.",
      channels: [],
    },
    { status: 503 },
  );
}

export async function proxySocialRequest(
  path: string,
  init: RequestInit = {},
  { requiresServiceToken = true }: { requiresServiceToken?: boolean } = {},
) {
  let config;
  try {
    config = await resolveSocialListenerConfig();
  } catch {
    return configurationError();
  }
  if (!config || (requiresServiceToken && !config.serviceToken)) return configurationError();

  try {
    const headers = new Headers(init.headers);
    if (requiresServiceToken) headers.set("authorization", `Bearer ${config.serviceToken}`);
    const response = await fetch(`${config.serviceUrl}${path}`, { ...init, headers });
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        ok: false,
        status: "error",
        message: "The Social Listener backend service could not be reached.",
        channels: [],
      },
      { status: 502 },
    );
  }
}

export async function forwardJson(request: Request, path: string) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Malformed JSON payload." }, { status: 400 });
  }
  return proxySocialRequest(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
