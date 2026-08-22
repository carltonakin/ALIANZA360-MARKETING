import { proxySocialRequest } from "../_proxy";

export async function GET() {
  return proxySocialRequest("/status");
}

