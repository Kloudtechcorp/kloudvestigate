"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createInternalAccessSessionCookie,
  verifyInternalAccessPassword,
} from "@/lib/auth";

export type LoginState = {
  error?: string;
};

export async function loginWithInternalAccess(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");

  if (!verifyInternalAccessPassword(password)) {
    return { error: "Invalid internal access password." };
  }

  const session = createInternalAccessSessionCookie();
  (await cookies()).set(session.name, session.value, session.options);

  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
