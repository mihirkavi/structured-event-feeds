/** Converts a wall-clock time in an IANA zone to a UTC Date. */
export function zonedWallTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // Two passes settle the offset, including across DST transitions.
  let utc = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  utc = guess - offsetMinutes(new Date(utc), timeZone) * 60_000;
  return new Date(utc);
}

/** Minutes the zone is ahead of UTC at the given instant. */
export function offsetMinutes(at: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(values.year!, values.month! - 1, values.day!, values.hour!, values.minute!, values.second!);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function isValidTimeZone(timeZone: string | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Windows and Rails-style zone names that appear in real-world ICS feeds. */
const ZONE_ALIASES: Record<string, string> = {
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Time (US & Canada)': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'Mountain Time (US & Canada)': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Central Time (US & Canada)': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Eastern Time (US & Canada)': 'America/New_York',
  'GMT Standard Time': 'Europe/London',
  'UTC': 'UTC',
};

export function resolveTimeZone(name: string | undefined, fallback?: string): string | undefined {
  if (!name) return fallback;
  const cleaned = name.replace(/^"|"$/g, '').replace(/^\/[^/]+\/[^/]+\//, '');
  if (isValidTimeZone(cleaned)) return cleaned;
  const alias = ZONE_ALIASES[cleaned];
  return alias ?? fallback;
}
