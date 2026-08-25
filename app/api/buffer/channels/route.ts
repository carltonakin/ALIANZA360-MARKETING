import { isSocialConfigAdmin } from "../../social/_config";
import { proxySocialRequest } from "../../social/_proxy";

export async function GET(request: Request) {
  if (!isSocialConfigAdmin(request)) {
    return Response.json({ ok: false, error: "Only the site owner can view Buffer channels." }, { status: 403 });
  }
  return proxySocialRequest("/buffer/channels");
}
