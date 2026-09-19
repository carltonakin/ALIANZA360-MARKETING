import { proxySocialRequest } from "../../social/_proxy";

async function forward(request: Request, context: RouteContext<"/api/acquisition/[...path]">) {
  const { path } = await context.params;
  const incoming = new URL(request.url);
  const suffix = Array.isArray(path) ? path.map(encodeURIComponent).join("/") : "";
  const target = `/acquisition/${suffix}${incoming.search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const method = request.method.toUpperCase();
  return proxySocialRequest(target, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    cache: "no-store",
  });
}

export async function GET(request: Request, context: RouteContext<"/api/acquisition/[...path]">) {
  return forward(request, context);
}

export async function POST(request: Request, context: RouteContext<"/api/acquisition/[...path]">) {
  return forward(request, context);
}

export async function PUT(request: Request, context: RouteContext<"/api/acquisition/[...path]">) {
  return forward(request, context);
}
