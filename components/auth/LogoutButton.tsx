"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function logOut() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return (
    <button
      aria-label="Log out"
      className="icon-button"
      disabled={pending}
      onClick={() => void logOut()}
      title="Log out"
      type="button"
    >
      <LogOut aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
