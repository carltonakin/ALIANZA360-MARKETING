import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "../auth/server";

export default async function SettingsPage() {
  await requireAuthenticatedUser("ADMIN");
  redirect("/dashboard?view=Settings");
}
