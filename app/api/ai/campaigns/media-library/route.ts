import { proxySocialRequest } from "../../../social/_proxy";

export async function GET() {
  return proxySocialRequest("/ai/campaigns/media-library", { cache: "no-store" });
}
