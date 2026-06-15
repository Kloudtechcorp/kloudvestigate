"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";

import type { KloudtrackEnvironment } from "@/lib/kloudtrack-environment";

type EnvironmentPayload = {
  environment: KloudtrackEnvironment;
  configured: boolean;
};

export function KloudtrackEnvironmentSwitch() {
  const [environment, setEnvironment] = useState<KloudtrackEnvironment>("live");
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadEnvironment() {
      try {
        const response = await fetch("/api/kloudtrack-environment", { cache: "no-store" });
        if (!response.ok) return;

        const payload = (await response.json()) as EnvironmentPayload;
        if (!mounted) return;

        setEnvironment(payload.environment);
        setConfigured(payload.configured);
      } finally {
        if (mounted) setLoaded(true);
      }
    }

    void loadEnvironment();

    return () => {
      mounted = false;
    };
  }, []);

  async function toggleEnvironment() {
    const nextEnvironment: KloudtrackEnvironment = environment === "beta" ? "live" : "beta";

    setBusy(true);

    try {
      const response = await fetch("/api/kloudtrack-environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: nextEnvironment }),
      });

      if (!response.ok) throw new Error(`Environment switch failed (${response.status})`);

      const payload = (await response.json()) as EnvironmentPayload;
      setEnvironment(payload.environment);
      setConfigured(payload.configured);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  const betaEnabled = environment === "beta";
  const label = betaEnabled ? "Beta" : "Live";

  return (
    <button
      aria-label={`KloudTrack environment: ${label}`}
      aria-pressed={betaEnabled}
      aria-busy={busy || !loaded}
      className={`env-switch ${betaEnabled ? "env-switch-beta" : ""}`}
      disabled={busy}
      onClick={() => void toggleEnvironment()}
      title={`KloudTrack environment: ${label}`}
      type="button"
    >
      <FlaskConical aria-hidden="true" className="h-4 w-4" />
      <span>{busy || !loaded ? "..." : label}</span>
      {!configured ? <span className="env-switch-dot" aria-hidden="true" /> : null}
    </button>
  );
}
