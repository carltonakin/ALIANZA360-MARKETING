import { authenticatedAuthRequest } from "../../../auth/server";

export async function GET() {
  return authenticatedAuthRequest("/auth/me");
}
