/**
 * One display convention for every server timestamp in the Admin Panel:
 *   formatDateTime -> "21 Oct 2026, 6:34 pm IST"   (Asia/Kolkata, the zone is always shown)
 *   formatDate     -> "21 Oct 2026"
 * Only the display changes: API values are never rewritten. Missing or unparsable input shows "—".
 * A timestamp without a zone is read as UTC, which is how the API stores and returns them.
 * A bare date ("2026-10-19", e.g. a refund date) is shown as that calendar date, without zone shifting.
 */

const ZONE = 'Asia/Kolkata';
const ZONE_LABEL = 'IST'; // India has no daylight saving, so the label is always correct
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NO_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export type DateInput = string | Date | null | undefined;

function parse(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  const date = new Date(NO_ZONE.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function zoned(date: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of parts.formatToParts(date)) out[part.type] = part.value;
  return out;
}

function dateOnly(text: string): string | null {
  const match = DATE_ONLY.exec(text.trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${day} ${MONTHS[month - 1]} ${match[1]}`;
}

export function formatDate(value: DateInput): string {
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) return dateOnly(value) ?? '—';
  const date = parse(value);
  if (!date) return '—';
  const p = zoned(date);
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
}

export function formatDateTime(value: DateInput): string {
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) return dateOnly(value) ?? '—';
  const date = parse(value);
  if (!date) return '—';
  const p = zoned(date);
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()} ${ZONE_LABEL}`;
}
