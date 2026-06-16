import { redirect } from "next/navigation";
import { hasInternalAccessSession } from "@/lib/auth";

export async function requireInternalAccessPage() {
  if (await hasInternalAccessSession()) return;

  redirect("/login");
}
