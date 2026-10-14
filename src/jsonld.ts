import type { AttendanceMode, DiscoveredEvent, EventStatus, RegistrationAvailability } from './types.js';

export interface JsonLdOptions {
  provider: string;
  pageUrl: string;
}

type Json = Record<string, unknown>;

/**
 * Extracts schema.org Event objects (including subtypes such as SocialEvent or
 * BusinessEvent) from every `application/ld+json` block in an HTML page,
 * following ItemList, ListItem and @graph containers.
 */
export function extractJsonLdEvents(html: string, options: JsonLdOptions): DiscoveredEvent[] {
  const retrievedAt = new Date().toISOString();
  const found: Json[] = [];
  const pattern = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = (match[1] ?? '').trim();
    if (!raw) continue;
    for (const candidate of [raw, decodeEntities(raw)]) {
      try {
        collectEvents(JSON.parse(candidate), found, 0);
        break;
      } catch {
        // Malformed or entity-encoded blocks are common on the web; try once decoded, then skip.
      }
    }
  }
  const events: DiscoveredEvent[] = [];
  const seen = new Set<string>();
  for (const item of found) {
    const event = normalizeJsonLdEvent(item, options, retrievedAt);
    if (!event) continue;
    const key = `${event.providerEventId}|${event.startsAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }
  return events;
}

function collectEvents(value: unknown, sink: Json[], depth: number) {
  if (depth > 6 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectEvents(item, sink, depth + 1);
    return;
  }
  const object = value as Json;
  if (isEventType(object['@type'])) sink.push(object);
  for (const key of ['@graph', 'itemListElement', 'item', 'subEvent', 'event', 'events']) {
    if (key in object) collectEvents(object[key], sink, depth + 1);
  }
}

function isEventType(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => typeof item === 'string' && /(^|[/:])\w*Event$/.test(item) && item !== 'EventSeries');
}

export function normalizeJsonLdEvent(item: Json, options: JsonLdOptions, retrievedAt: string): DiscoveredEvent | undefined {
  const title = text(item.name);
  const startDate = text(item.startDate);
  if (!title || !startDate) return undefined;
  const start = normalizeDate(startDate);
  if (!start) return undefined;
  const end = text(item.endDate) ? normalizeDate(text(item.endDate)!) : undefined;
  const url = absoluteUrl(text(item.url) ?? text(item['@id']), options.pageUrl) ?? options.pageUrl;
  const location = firstObject(item.location);
  const address = firstObject(location?.address);
  const geo = firstObject(location?.geo);
  const organizer = firstObject(item.organizer);
  const offers = asArray(item.offers).filter(isObject);

  const event: DiscoveredEvent = {
    provider: options.provider,
    providerEventId: providerIdFromUrl(url) ?? url,
    url,
    title: title.slice(0, 300),
    startsAt: start.value,
    ...(start.dateOnly ? { dateOnly: true } : {}),
    ...(end && !end.dateOnly && !start.dateOnly ? { endsAt: end.value } : {}),
    status: mapStatus(text(item.eventStatus)),
    attendanceMode: mapAttendance(text(item.eventAttendanceMode), location),
    retrievedAt,
  };
  const description = text(item.description);
  if (description) event.description = stripTags(description).slice(0, 8_000);
  if (location && text(location['@type']) !== 'VirtualLocation') {
    const street = typeof location.address === 'string' ? location.address : text(address?.streetAddress);
    event.venue = compact({
      name: text(location.name),
      address: street,
      city: text(address?.addressLocality),
      region: text(address?.addressRegion),
      country: typeof address?.addressCountry === 'object' ? text(firstObject(address.addressCountry)?.name) : text(address?.addressCountry),
      latitude: number(geo?.latitude),
      longitude: number(geo?.longitude),
    });
  }
  const organizerName = organizer ? text(organizer.name) : text(item.organizer);
  if (organizerName) event.organizer = compact({ name: organizerName, url: absoluteUrl(text(organizer?.url), options.pageUrl) });
  const image = imageUrl(item.image);
  if (image) event.imageUrl = image;
  if (offers.length) {
    const prices = offers.map((offer) => number(offer.price) ?? number(offer.lowPrice)).filter((value): value is number => value !== undefined);
    const highs = offers.map((offer) => number(offer.highPrice) ?? number(offer.price)).filter((value): value is number => value !== undefined);
    const currency = offers.map((offer) => text(offer.priceCurrency)).find(Boolean);
    event.price = compact({
      isFree: prices.length ? Math.max(...prices, ...highs) === 0 : undefined,
      minCents: prices.length ? Math.round(Math.min(...prices) * 100) : undefined,
      maxCents: highs.length ? Math.round(Math.max(...highs) * 100) : undefined,
      currency,
    });
  } else if (item.isAccessibleForFree === true || item.isAccessibleForFree === 'true') {
    event.price = { isFree: true };
  }
  event.registration = { availability: mapAvailability(offers, event.status), url: absoluteUrl(text(offers[0]?.url), options.pageUrl) ?? url };
  return event;
}

function normalizeDate(value: string): { value: string; dateOnly: boolean } | undefined {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { value: trimmed, dateOnly: true };
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  // Keep the source offset when present; otherwise the instant is ambiguous and we keep it as-is.
  return { value: new Date(parsed).toISOString(), dateOnly: false };
}

function mapStatus(status: string | undefined): EventStatus {
  if (!status) return 'scheduled';
  if (/Cancelled/i.test(status)) return 'cancelled';
  if (/Postponed/i.test(status)) return 'postponed';
  if (/Rescheduled/i.test(status)) return 'rescheduled';
  if (/Scheduled|MovedOnline/i.test(status)) return 'scheduled';
  return 'unknown';
}

function mapAttendance(mode: string | undefined, location: Json | undefined): AttendanceMode {
  if (mode && /Mixed/i.test(mode)) return 'hybrid';
  if (mode && /Online/i.test(mode)) return 'online';
  if (mode && /Offline/i.test(mode)) return 'in_person';
  if (location && text(location['@type']) === 'VirtualLocation') return 'online';
  if (location) return 'in_person';
  return 'unknown';
}

function mapAvailability(offers: Json[], status: EventStatus): RegistrationAvailability {
  if (status === 'cancelled') return 'closed';
  const values = offers.map((offer) => text(offer.availability) ?? '');
  if (values.some((value) => /InStock|LimitedAvailability|OnlineOnly|InStoreOnly/i.test(value))) return 'open';
  if (values.some((value) => /PreOrder|PreSale/i.test(value))) return 'open';
  if (values.length && values.every((value) => /SoldOut/i.test(value))) return 'sold_out';
  if (values.some((value) => /Discontinued|OutOfStock/i.test(value))) return 'closed';
  return 'unknown';
}

/** Stable provider ids for well-known event pages. */
export function providerIdFromUrl(url: string): string | undefined {
  const meetup = url.match(/meetup\.com\/([^/]+)\/events\/(\d+)/);
  if (meetup) return `${meetup[1]}/${meetup[2]}`;
  const eventbrite = url.match(/eventbrite\.[a-z.]+\/e\/[^?#]*?-(\d{6,})/);
  if (eventbrite) return eventbrite[1];
  return undefined;
}

function imageUrl(value: unknown): string | undefined {
  const firstValue = asArray(value)[0];
  if (typeof firstValue === 'string') return firstValue;
  if (isObject(firstValue)) return text(firstValue.url) ?? text(firstValue.contentUrl);
  return undefined;
}

function absoluteUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstObject(value: unknown): Json | undefined {
  return asArray(value).find(isObject);
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')) as T;
}
