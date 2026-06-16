import type { ReactNode } from "react";
import { requireInternalAccessPage } from "@/lib/auth-page";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  await requireInternalAccessPage();

  return children;
}
