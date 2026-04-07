/**
 * Converts an ISO 8601 date string (YYYY-MM-DD) to a JavaScript Date object.
 * The date is parsed in UTC to avoid timezone shifts.
 */
export function isoStringToDate(s: string): Date {
  const [year, month, day] = s.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Converts a JavaScript Date object to an ISO 8601 date string (YYYY-MM-DD).
 * Uses UTC methods to match the UTC-based parsing in isoStringToDate and avoid
 * off-by-one errors in timezones behind UTC.
 */
export function dateToIsoString(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
