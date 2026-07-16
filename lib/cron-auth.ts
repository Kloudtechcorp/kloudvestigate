import { createHmac, timingSafeEqual } from "crypto";

export function authorizeCron(request: Request): Response | null {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return Response.json(
      { error: "Cron is not configured", message: "Set CRON_SECRET before enabling the schedule." },
      { status: 503 },
    );
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!matchesSecret(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

function matchesSecret(value: string | undefined, expected: string) {
  if (!value) return false;
  const valueDigest = createHmac("sha256", expected).update(value).digest();
  const expectedDigest = createHmac("sha256", expected).update(expected).digest();
  return timingSafeEqual(valueDigest, expectedDigest);
}
