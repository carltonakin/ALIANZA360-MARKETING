import { proxySocialRequest } from "../../social/_proxy";

export async function GET() {
  return proxySocialRequest("/landing-pages/analytics", { cache: "no-store" });
}
