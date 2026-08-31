import { forwardJson } from "../_proxy";

export async function POST(request: Request) {
  return forwardJson(request, "/lead-interactions");
}
