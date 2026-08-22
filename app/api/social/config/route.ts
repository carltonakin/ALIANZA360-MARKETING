import { isSocialConfigAdmin, socialConfigSummary } from "../_config";

function unauthorized() {
  return Response.json({ ok: false, message: "Only the site owner can configure the Social Listener." }, { status: 403 });
}

export async function GET(request: Request) {
  if (!isSocialConfigAdmin(request)) return unauthorized();
  try {
    return Response.json({ ok: true, ...(await socialConfigSummary()) });
  } catch {
    return Response.json({ ok: false, message: "The saved configuration could not be read." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSocialConfigAdmin(request)) return unauthorized();
  return Response.json({ok:false,message:"Backend credentials must be set with SOCIAL_LISTENER_SERVICE_URL and SOCIAL_LISTENER_SERVICE_TOKEN environment variables."},{status:405,headers:{allow:"GET"}});
}

export async function DELETE(request: Request) {
  if (!isSocialConfigAdmin(request)) return unauthorized();
  return Response.json({ok:false,message:"Backend credentials are environment-managed and cannot be removed from the browser."},{status:405,headers:{allow:"GET"}});
}
