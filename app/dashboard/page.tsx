import Home from "../page";
import { requireAuthenticatedUser } from "../auth/server";
import { redirect } from "next/navigation";

const ADMIN_VIEWS = new Set(["Settings", "User Management"]);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; forbidden?: string | string[] }>;
}) {
  const user = await requireAuthenticatedUser();
  const query = await searchParams;
  const requested = typeof query.view === "string" ? query.view : "Overview";
  if (ADMIN_VIEWS.has(requested) && user.role !== "ADMIN") redirect("/dashboard?forbidden=1");
  return <Home />;
}
