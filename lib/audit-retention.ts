const PHT_OFFSET_MS = 8 * 60 * 60_000;

/** Detailed audit logs are kept only for the current Philippine month; summaries are kept forever. */
export function getCurrentPhilippineMonthScope(now = new Date()) {
  const phtNow = new Date(now.getTime() + PHT_OFFSET_MS);
  const year = phtNow.getUTCFullYear();
  const month = phtNow.getUTCMonth();

  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}

export function isAuditLogRetained(eventDate: Date, now = new Date()) {
  const month = getCurrentPhilippineMonthScope(now);
  return eventDate >= month.start && eventDate < month.end;
}
