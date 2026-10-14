import { offsetMinutes, resolveTimeZone, zonedWallTimeToUtc } from './time.js';
import type { DiscoveredEvent, EventStatus } from './types.js';

export interface IcsParseOptions {
  /** Provider label for the results, e.g. `meetup` or `stanford-events`. */
  provider: string;
  /** Feed URL, used as a fallback event link. */
  sourceUrl: string;
  /** Expand simple recurrence rules between these instants. */
  windowStart?: Date;
  windowEnd?: Date;
  /** Hard cap on returned occurrences. Defaults to 2,000. */
  maxEvents?: number;
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

type Component = Map<string, Property[]>;

/**
 * Parses an iCalendar (RFC 5545) feed into open event records.
 * Supports UTC, floating, TZID and all-day times, and expands DAILY, WEEKLY
 * and MONTHLY (by month-day) rules with INTERVAL, COUNT, UNTIL, BYDAY and EXDATE
 * inside the requested window. Rules it cannot expand return only the first
 * occurrence, marked as recurring.
 */
export function parseIcs(text: string, options: IcsParseOptions): DiscoveredEvent[] {
  const lines = unfold(text);
  const calendarZone = resolveTimeZone(findCalendarProperty(lines, 'X-WR-TIMEZONE'));
  const retrievedAt = new Date().toISOString();
  const maxEvents = options.maxEvents ?? 2_000;
  const events: DiscoveredEvent[] = [];
  const overrides = new Map<string, Component>();
  const masters: Component[] = [];

  for (const component of vevents(lines)) {
    const uid = first(component, 'UID')?.value;
    const recurrenceId = first(component, 'RECURRENCE-ID');
    const recurrenceTime = recurrenceId ? parseIcsTime(recurrenceId, calendarZone) : undefined;
    if (uid && recurrenceTime) overrides.set(`${uid}|${recurrenceTime.date.getTime()}`, component);
    else masters.push(component);
  }

  for (const component of masters) {
    const start = first(component, 'DTSTART');
    const summary = first(component, 'SUMMARY')?.value;
    if (!start || !summary) continue;
    const begin = parseIcsTime(start, calendarZone);
    if (!begin) continue;
    const endProperty = first(component, 'DTEND');
    const end = endProperty ? parseIcsTime(endProperty, calendarZone) : undefined;
    const durationMs = end ? end.date.getTime() - begin.date.getTime() : parseDuration(first(component, 'DURATION')?.value);
    const uid = first(component, 'UID')?.value ?? `${summary}|${start.value}`;
    const rrule = first(component, 'RRULE')?.value;
    const base = baseRecord(component, options, retrievedAt, unescape(summary));
    if (rrule) base.recurrence = { isRecurring: true, seriesId: uid };

    const occurrences = rrule && options.windowStart && options.windowEnd
      ? expandRule(begin.date, rrule, exdates(component, calendarZone), options.windowStart, options.windowEnd, begin.timeZone ?? 'UTC')
      : [begin.date];

    for (const occurrence of occurrences) {
      if (events.length >= maxEvents) return events;
      const occurrenceKey = `${uid}|${formatIcsUtc(occurrence)}`;
      const override = rrule ? overrides.get(`${uid}|${occurrence.getTime()}`) : undefined;
      const record = override
        ? { ...baseRecord(override, options, retrievedAt, unescape(first(override, 'SUMMARY')?.value ?? summary)), recurrence: base.recurrence }
        : { ...base };
      const overrideStart = override ? first(override, 'DTSTART') : undefined;
      const overrideBegin = overrideStart ? parseIcsTime(overrideStart, calendarZone) : undefined;
      const occurrenceStart = overrideBegin?.date ?? occurrence;
      record.providerEventId = rrule ? occurrenceKey : uid;
      if (begin.dateOnly) {
        record.startsAt = occurrenceStart.toISOString().slice(0, 10);
        record.dateOnly = true;
      } else {
        record.startsAt = occurrenceStart.toISOString();
        if (durationMs && durationMs > 0) record.endsAt = new Date(occurrenceStart.getTime() + durationMs).toISOString();
      }
      if (begin.timeZone) record.timezone = begin.timeZone;
      if (!rrule && options.windowStart && options.windowEnd) {
        const time = occurrenceStart.getTime();
        if (time < options.windowStart.getTime() - 86_400_000 || time >= options.windowEnd.getTime()) continue;
      }
      events.push(record);
    }
  }
  return events;
}

function baseRecord(component: Component, options: IcsParseOptions, retrievedAt: string, title: string): DiscoveredEvent {
  const description = first(component, 'DESCRIPTION')?.value;
  const location = first(component, 'LOCATION')?.value;
  const url = first(component, 'URL')?.value;
  const geo = first(component, 'GEO')?.value?.split(';').map(Number);
  const organizer = first(component, 'ORGANIZER');
  const status = first(component, 'STATUS')?.value?.toUpperCase();
  const categories = (component.get('CATEGORIES') ?? []).flatMap((item) => item.value.split(',')).map(unescape).filter(Boolean);
  const record: DiscoveredEvent = {
    provider: options.provider,
    providerEventId: '',
    url: safeUrl(url) ?? urlFromText(description) ?? options.sourceUrl,
    title: title.trim().slice(0, 300),
    startsAt: '',
    status: mapStatus(status),
    attendanceMode: location ? (/^https?:\/\//i.test(location.trim()) ? 'online' : 'in_person') : 'unknown',
    retrievedAt,
  };
  if (description) record.description = unescape(description).slice(0, 8_000);
  if (location && record.attendanceMode === 'in_person') {
    const address = unescape(location);
    record.venue = { address, name: address.split(',')[0]?.trim() || undefined };
    if (geo && geo.length === 2 && geo.every(Number.isFinite)) {
      record.venue.latitude = geo[0];
      record.venue.longitude = geo[1];
    }
  }
  const organizerName = organizer?.params.CN?.replace(/^"|"$/g, '');
  if (organizerName) record.organizer = { name: organizerName };
  if (categories.length) record.categories = categories;
  if (record.url) record.registration = { availability: status === 'CANCELLED' ? 'closed' : 'unknown', url: record.url };
  return record;
}

function mapStatus(status: string | undefined): EventStatus {
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'CONFIRMED' || status === 'TENTATIVE' || !status) return 'scheduled';
  return 'unknown';
}

/** RFC 5545 line unfolding. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line: string): Property | undefined {
  // Split on the first colon that is not inside a quoted parameter value.
  let inQuotes = false;
  let split = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') inQuotes = !inQuotes;
    if (char === ':' && !inQuotes) {
      split = index;
      break;
    }
  }
  if (split <= 0) return undefined;
  const [rawName = '', ...rawParams] = line.slice(0, split).split(';');
  const params: Record<string, string> = {};
  for (const param of rawParams) {
    const eq = param.indexOf('=');
    if (eq > 0) params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1);
  }
  return { name: rawName.toUpperCase(), params, value: line.slice(split + 1) };
}

function* vevents(lines: string[]): Generator<Component> {
  let current: Component | undefined;
  let nested = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = new Map();
      nested = 0;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('BEGIN:')) nested += 1;
    else if (line.startsWith('END:') && line !== 'END:VEVENT') nested -= 1;
    else if (line === 'END:VEVENT') {
      yield current;
      current = undefined;
    } else if (nested === 0) {
      const property = parseLine(line);
      if (property) current.set(property.name, [...(current.get(property.name) ?? []), property]);
    }
  }
}

function findCalendarProperty(lines: string[], name: string): string | undefined {
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') return undefined;
    const property = parseLine(line);
    if (property?.name === name) return property.value;
  }
  return undefined;
}

function first(component: Component, name: string): Property | undefined {
  return component.get(name)?.[0];
}

export function parseIcsTime(property: Property, calendarZone?: string): { date: Date; dateOnly: boolean; timeZone?: string } | undefined {
  const value = property.value.trim();
  const dateOnly = property.params.VALUE === 'DATE' || /^\d{8}$/.test(value);
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return undefined;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = match;
  const parts = { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi), second: Number(s) };
  if (dateOnly) return { date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)), dateOnly: true };
  if (z) return { date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)), dateOnly: false };
  const zone = resolveTimeZone(property.params.TZID, calendarZone);
  if (!zone) {
    // Floating time with no zone information: treat as UTC and let callers know nothing else.
    return { date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)), dateOnly: false };
  }
  return { date: zonedWallTimeToUtc(parts, zone), dateOnly: false, timeZone: zone };
}

function exdates(component: Component, calendarZone?: string): Set<number> {
  const result = new Set<number>();
  for (const property of component.get('EXDATE') ?? []) {
    for (const value of property.value.split(',')) {
      const parsed = parseIcsTime({ ...property, value }, calendarZone);
      if (parsed) result.add(parsed.date.getTime());
    }
  }
  return result;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Expands a subset of RRULE (DAILY, WEEKLY with BYDAY, MONTHLY by month-day). */
export function expandRule(
  start: Date,
  rule: string,
  excluded: Set<number>,
  windowStart: Date,
  windowEnd: Date,
  timeZone = 'UTC',
): Date[] {
  const parts = Object.fromEntries(rule.split(';').map((part) => part.split('=') as [string, string]));
  const freq = parts.FREQ;
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1));
  const count = parts.COUNT ? Number(parts.COUNT) : undefined;
  const untilProperty = parts.UNTIL ? parseIcsTime({ name: 'UNTIL', params: {}, value: parts.UNTIL }) : undefined;
  const until = untilProperty?.date.getTime() ?? Number.POSITIVE_INFINITY;
  const byDay = parts.BYDAY?.split(',').map((day) => WEEKDAYS.indexOf(day.slice(-2))).filter((day) => day >= 0);
  // Expand in the event's local wall time so weekdays and DST follow the source zone.
  const local = new Date(start.getTime() + offsetMinutes(start, timeZone) * 60_000);
  const toUtc = (wall: Date) => zonedWallTimeToUtc({
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
  }, timeZone);
  const results: Date[] = [];
  let produced = 0;
  const push = (wall: Date) => {
    const date = toUtc(wall);
    const time = date.getTime();
    if (time > until || time >= windowEnd.getTime()) return false;
    produced += 1;
    if (count !== undefined && produced > count) return false;
    if (time >= windowStart.getTime() && !excluded.has(time)) results.push(date);
    return true;
  };
  const day = 86_400_000;
  const limit = 3_000;

  if (freq === 'DAILY') {
    for (let index = 0; index < limit; index += 1) {
      if (!push(new Date(local.getTime() + index * interval * day))) break;
    }
  } else if (freq === 'WEEKLY') {
    const days = byDay && byDay.length ? byDay : [local.getUTCDay()];
    const weekStart = local.getTime() - local.getUTCDay() * day;
    outer: for (let week = 0; week < limit; week += 1) {
      for (const weekday of [...days].sort()) {
        const candidate = new Date(weekStart + (week * interval * 7 + weekday) * day);
        if (candidate.getTime() < local.getTime()) continue;
        if (!push(candidate)) break outer;
      }
    }
  } else if (freq === 'MONTHLY' && !parts.BYDAY) {
    for (let index = 0; index < limit; index += 1) {
      const candidate = new Date(local);
      candidate.setUTCMonth(local.getUTCMonth() + index * interval);
      if (candidate.getUTCDate() !== local.getUTCDate()) continue;
      if (!push(candidate)) break;
    }
  } else {
    push(local);
  }
  return results;
}

function parseDuration(value: string | undefined): number | undefined {
  const match = value?.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return undefined;
  const [, w = '0', d = '0', h = '0', m = '0', s = '0'] = match;
  return ((((Number(w) * 7 + Number(d)) * 24 + Number(h)) * 60 + Number(m)) * 60 + Number(s)) * 1_000;
}

function formatIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function unescape(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function urlFromText(text: string | undefined): string | undefined {
  const match = text?.match(/https?:\/\/[^\s\\<>"]+/);
  return safeUrl(match?.[0]);
}
