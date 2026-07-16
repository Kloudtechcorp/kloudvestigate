import { NextResponse } from "next/server";
import { clearInternalAccessSessionCookie } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  const session = clearInternalAccessSessionCookie();
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
