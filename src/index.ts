import { parseIcs } from './ics.js';
import { extractJsonLdEvents } from './jsonld.js';
import type { DiscoveredEvent } from './types.js';

export type * from './types.js';
export { parseIcs, expandRule } from './ics.js';
export { extractJsonLdEvents, normalizeJsonLdEvent, providerIdFromUrl } from './jsonld.js';
export { zonedWallTimeToUtc } from './time.js';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; structured-event-feeds/0.1; +https://github.com/mihirkavi/structured-event-feeds)';
const MAX_BYTES = 6 * 1024 * 1024;

export interface FeedClientOptions {
  userAgent?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Respect robots.txt `User-agent: *` disallow rules. Defaults to true. */
  respectRobots?: boolean;
}

export interface ReadOptions {
  /** Provider label. Inferred from the host when omitted. */
  provider?: string;
  windowStart?: Date;
  windowEnd?: Date;
}

export interface FeedResult {
  url: string;
  provider: string;
  format: 'ics' | 'jsonld' | 'none';
  events: DiscoveredEvent[];
}

export class FeedError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'FeedError';
  }
}

/**
 * Reads public event data from iCalendar feeds and from schema.org Event JSON-LD
 * embedded in public web pages. It only performs unauthenticated GET requests,
 * follows robots.txt by default, and never submits forms or registers anyone.
 */
export class StructuredFeedClient {
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly respectRobots: boolean;
  private readonly robotsCache = new Map<string, Promise<string[]>>();

  constructor(options: FeedClientOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.respectRobots = options.respectRobots ?? true;
  }

  /** Fetches a URL and returns whichever structured events it contains. */
  async read(rawUrl: string, options: ReadOptions = {}): Promise<FeedResult> {
    const url = normalizeFeedUrl(rawUrl);
    const provider = options.provider ?? providerForUrl(url);
    if (this.respectRobots && !(await this.allowedByRobots(url))) {
      throw new FeedError(`robots.txt for ${url.hostname} disallows ${url.pathname}.`);
    }
    const { body, contentType } = await this.get(url);
    const isIcs = /text\/calendar/i.test(contentType) || /^\s*BEGIN:VCALENDAR/.test(body);
    if (isIcs) {
      const events = parseIcs(body, { provider, sourceUrl: url.toString(), windowStart: options.windowStart, windowEnd: options.windowEnd });
      return { url: url.toString(), provider, format: 'ics', events };
    }
    const events = filterWindow(extractJsonLdEvents(body, { provider, pageUrl: url.toString() }), options);
    return { url: url.toString(), provider, format: events.length ? 'jsonld' : 'none', events };
  }

  private async get(url: URL): Promise<{ body: string; contentType: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { 'user-agent': this.userAgent, accept: 'text/calendar, text/html;q=0.9, application/xhtml+xml;q=0.8, */*;q=0.5' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) throw new FeedError(`${url.hostname} returned HTTP ${response.status}.`, response.status);
      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > MAX_BYTES) throw new FeedError('Feed is too large.');
      const body = await response.text();
      if (body.length > MAX_BYTES) throw new FeedError('Feed is too large.');
      return { body, contentType: response.headers.get('content-type') ?? '' };
    } catch (error) {
      if (error instanceof FeedError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new FeedError(`${url.hostname} timed out.`);
      throw new FeedError(error instanceof Error ? error.message : 'Feed request failed.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async allowedByRobots(url: URL): Promise<boolean> {
    let rules = this.robotsCache.get(url.origin);
    if (!rules) {
      rules = this.fetchRobots(url.origin);
      this.robotsCache.set(url.origin, rules);
    }
    const path = `${url.pathname}${url.search}`;
    return !(await rules).some((rule) => robotsRuleMatches(rule, path));
  }

  private async fetchRobots(origin: string): Promise<string[]> {
    try {
      const { body } = await this.get(new URL('/robots.txt', origin));
      return parseRobots(body);
    } catch {
      return [];
    }
  }
}

/** Disallow rules that apply to every crawler (`User-agent: *`). */
export function parseRobots(body: string): string[] {
  const rules: string[] = [];
  let applies = false;
  let sawRule = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === 'user-agent') {
      if (sawRule) {
        applies = false;
        sawRule = false;
      }
      if (value === '*') applies = true;
    } else {
      sawRule = true;
      if (applies && key === 'disallow' && value) rules.push(value);
    }
  }
  return rules;
}

export function robotsRuleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const pattern = rule.replace(/\$$/, '').split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
}

function normalizeFeedUrl(raw: string): URL {
  const value = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FeedError('Expected an absolute http(s), webcal, or ICS URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FeedError('Only http(s) and webcal URLs are supported.');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname) || url.hostname.endsWith('.local')) {
    throw new FeedError('Private network addresses are not allowed.');
  }
  return url;
}

export function providerForUrl(url: URL | string): string {
  const host = (typeof url === 'string' ? new URL(url) : url).hostname.replace(/^www\./, '');
  if (host.endsWith('meetup.com')) return 'meetup';
  if (/(^|\.)eventbrite\./.test(host)) return 'eventbrite';
  if (host === 'lu.ma' || host.endsWith('.lu.ma') || host === 'luma.com') return 'luma';
  return host;
}

function filterWindow(events: DiscoveredEvent[], options: ReadOptions): DiscoveredEvent[] {
  if (!options.windowStart && !options.windowEnd) return events;
  const start = options.windowStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  const end = options.windowEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  return events.filter((event) => {
    const time = Date.parse(event.startsAt);
    // Date-only values are compared generously so a local-date event is not dropped at a UTC boundary.
    return event.dateOnly ? time >= start - 86_400_000 && time < end + 86_400_000 : time >= start && time < end;
  });
}

/** URL builders for public listing pages that embed schema.org Event data. */
export const sources = {
  /**
   * Meetup's public "find" pages, as listed in Meetup's sitemap. `place` is a
   * slug such as `us--ca--san-jose`; `topic` is an optional slug such as
   * `hiking` or `20s-30s-social`. Meetup's robots.txt disallows the
   * `keywords`, `source` and `dateRange` query parameters, so this builder never
   * adds them; filter by date after reading.
   */
  meetupFind(input: { place: string; topic?: string }): string {
    const place = slug(input.place);
    const topic = input.topic ? slug(input.topic) : '';
    return `https://www.meetup.com/find/${place}/${topic ? `${topic}/` : ''}`;
  },
  /** A Meetup group's public iCalendar feed. */
  meetupGroupIcs(groupUrlName: string): string {
    return `https://www.meetup.com/${encodeURIComponent(groupUrlName)}/events/ical/`;
  },
  /**
   * Eventbrite's public browse page. `place` uses Eventbrite's slug, e.g.
   * `ca--san-jose`; `topic` is a slug such as `social`, `hiking` or `events`.
   */
  eventbriteSearch(input: { place: string; topic?: string; start?: Date; end?: Date; page?: number }): string {
    const topic = slug(input.topic ?? 'events') || 'events';
    const url = new URL(`https://www.eventbrite.com/d/${input.place}/${topic}/`);
    if (input.start) url.searchParams.set('start_date', input.start.toISOString().slice(0, 10));
    if (input.end) url.searchParams.set('end_date', input.end.toISOString().slice(0, 10));
    if (input.page && input.page > 1) url.searchParams.set('page', String(input.page));
    return url.toString();
  },
  /** A public Luma calendar's iCalendar feed, by `cal-…` id. */
  lumaCalendarIcs(calendarId: string): string {
    return `https://api.lu.ma/ics/get?entity=calendar&id=${encodeURIComponent(calendarId)}`;
  },
};

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^([a-z]{2})-([a-z]{2})-/, '$1--$2--');
}
