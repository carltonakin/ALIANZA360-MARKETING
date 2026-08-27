import { proxySocialRequest } from "../../social/_proxy";

export async function GET() {
  return proxySocialRequest("/buffer/channels");
}
