import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "../../auth/server";

export default async function UserManagementPage() {
  await requireAuthenticatedUser("ADMIN");
  redirect("/dashboard?view=User%20Management");
}
