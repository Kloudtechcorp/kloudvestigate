export function assertInternalAccess(request: Request): Response | null {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const expected = process.env.INTERNAL_ACCESS_TOKEN;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const internalHeader = request.headers.get("x-internal-access-token");

  if (!expected || bearer === expected || internalHeader === expected) {
    return null;
  }

  return Response.json(
    { error: "Unauthorized", message: "Internal telemetry access is required." },
    { status: 401 },
  );
}

export function writeAuditEvent(event: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      type: "telemetry_investigation_audit",
      occurredAt: new Date().toISOString(),
      ...event,
    }),
  );
}
