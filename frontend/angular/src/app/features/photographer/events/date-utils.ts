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
 */
export function dateToIsoString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
