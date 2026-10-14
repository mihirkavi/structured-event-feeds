# structured-event-feeds

Read public events from **iCalendar (ICS/webcal) feeds** and from **schema.org `Event` data** embedded in public web pages. Results use the same small *open event record* as [luma-discovery](https://github.com/mihirkavi/luma-discovery).

One small reader covers a lot of the event web without writing a scraper per site:

| Source | How | Example |
|---|---|---|
| Meetup topic and city pages | schema.org JSON-LD on the public `/find/<place>/<topic>/` pages Meetup lists in its sitemap | `sources.meetupFind({ place: 'us--ca--san-jose', topic: 'hiking' })` |
| Meetup groups | each group's public ICS feed | `sources.meetupGroupIcs('sfpython')` |
| Eventbrite | schema.org JSON-LD on public `/d/<place>/<topic>/` browse pages and event pages | `sources.eventbriteSearch({ place: 'ca--san-jose', topic: 'social' })` |
| Luma calendars | each public calendar's ICS feed | `sources.lumaCalendarIcs('cal-…')` |
| Universities, IEEE/ACM chapters, cities, libraries, venues | any ICS feed or page with schema.org events | `https://events.stanford.edu/calendar.ics` |

Part of [Open Media Events](https://github.com/mihirkavi/open-media/tree/main/docs/events), but usable on its own.

## Behavior

- **ICS:** line unfolding, escaped text, UTC, floating, `TZID` (including common Windows/Rails zone names) and all-day dates. Expands `DAILY`, `WEEKLY` (with `BYDAY`) and `MONTHLY`-by-day rules with `INTERVAL`, `COUNT`, `UNTIL` and `EXDATE` in the event's own timezone. Applies `RECURRENCE-ID` overrides. Other rules return the first occurrence, marked as recurring.
- **JSON-LD:** finds `Event` and its subtypes (`SocialEvent`, `BusinessEvent`, …) inside `ItemList`, `ListItem` and `@graph`. Maps status, attendance mode, venue and geo, organizer, offers (free or price range, sold out) and image. Date-only listings are flagged `dateOnly: true`.
- **Polite fetching:** unauthenticated GET only. Follows robots.txt `User-agent: *` rules by default. Refuses private-network hosts. Has a timeout and a 6 MB size cap.

Meetup's robots.txt disallows the `keywords`, `source` and `dateRange` query parameters, so this package never uses Meetup's search query parameters. It reads the sitemap-listed topic pages and filters by date itself.

## Use

```bash
npm install github:mihirkavi/structured-event-feeds
```

```ts
import { sources, StructuredFeedClient } from 'structured-event-feeds';

const feeds = new StructuredFeedClient();
const start = new Date();
const end = new Date(Date.now() + 7 * 86_400_000);
const meetup = await feeds.read(sources.meetupFind({ place: 'us--ca--san-jose', topic: 'social' }), { windowStart: start, windowEnd: end });
const stanford = await feeds.read('https://events.stanford.edu/calendar.ics', { windowStart: start, windowEnd: end });
```

`parseIcs(text, options)` and `extractJsonLdEvents(html, options)` are also exported for content you fetched yourself.

### MCP server

`npm run mcp` starts a stdio server with `read_event_feed`, `search_meetup` and `search_eventbrite`.

## What it does not do

- No sign-in, RSVP, ticket purchase or form submission.
- No RSS/Atom yet. RSS items rarely carry machine-readable event times.
- Eventbrite browse pages list dates only. Read the event page itself for the exact start time.

## Development

```bash
npm test && npm run typecheck
npm run smoke   # live: Meetup, Eventbrite, Stanford (prints counts and titles only)
```

## Status

v0.1, verified live on 2026-10-13: 16 Meetup social events, 20 Eventbrite events and 147 Stanford calendar events for the following week. Site markup can change. Sources without structured data return `format: 'none'` instead of guessed events.

## License

MIT
