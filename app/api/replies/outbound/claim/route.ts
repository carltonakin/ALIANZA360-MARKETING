import { forwardJson } from "../../../social/_proxy";

export async function POST(request: Request) {
  return forwardJson(request, "/reply-requests/claim");
}
