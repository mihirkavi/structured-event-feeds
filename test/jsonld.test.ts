import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractJsonLdEvents, parseRobots, providerIdFromUrl, robotsRuleMatches, sources, StructuredFeedClient } from '../src/index.js';

const page = `<html><head>
<script type="application/ld+json">{"@type":"Organization","name":"Site"}</script>
<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
 {"@type":"ListItem","position":1,"item":{"@type":"SocialEvent","name":"Board game night","url":"https://www.meetup.com/games-sj/events/316770489/",
  "startDate":"2026-10-17T19:00:00-07:00","endDate":"2026-10-17T22:00:00-07:00","eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode",
  "eventStatus":"https://schema.org/EventScheduled","location":{"@type":"Place","name":"Cafe","address":{"@type":"PostalAddress","addressLocality":"San Jose","addressRegion":"CA"},
  "geo":{"latitude":"37.33","longitude":"-121.89"}},"organizer":{"@type":"Organization","name":"SJ Games","url":"https://www.meetup.com/games-sj/"},
  "offers":{"@type":"Offer","price":"0","priceCurrency":"USD","availability":"https://schema.org/InStock"},"description":"<p>Bring &amp; share</p>"}},
 {"@type":"ListItem","position":2,"item":{"@type":"BusinessEvent","name":"Founder conference","url":"https://www.eventbrite.com/e/founder-conference-tickets-1748900150429","startDate":"2026-10-18",
  "offers":[{"@type":"AggregateOffer","lowPrice":"25","highPrice":"80","priceCurrency":"USD","availability":"SoldOut"}]}}
]}</script>
<script type="application/ld+json">{ broken json </script>
</head></html>`;

test('extracts events from nested ItemList JSON-LD', () => {
  const events = extractJsonLdEvents(page, { provider: 'meetup', pageUrl: 'https://www.meetup.com/find/' });
  assert.equal(events.length, 2);
  const [games, conference] = events;
  assert.equal(games?.providerEventId, 'games-sj/316770489');
  assert.equal(games?.startsAt, '2026-10-18T02:00:00.000Z');
  assert.equal(games?.venue?.city, 'San Jose');
  assert.equal(games?.venue?.latitude, 37.33);
  assert.equal(games?.price?.isFree, true);
  assert.equal(games?.registration?.availability, 'open');
  assert.equal(games?.description, 'Bring & share');
  assert.equal(conference?.dateOnly, true);
  assert.equal(conference?.providerEventId, '1748900150429');
  assert.equal(conference?.price?.minCents, 2500);
  assert.equal(conference?.registration?.availability, 'sold_out');
});

test('robots rules', () => {
  const rules = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /n/*\nDisallow: /private$\n');
  assert.deepEqual(rules, ['/n/*', '/private$']);
  assert.equal(robotsRuleMatches('/n/*', '/n/abc'), true);
  assert.equal(robotsRuleMatches('/private$', '/private/x'), false);
  assert.equal(robotsRuleMatches('/n/*', '/find/'), false);
});

test('client refuses robots-disallowed paths and private hosts', async () => {
  const fetchStub = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /blocked');
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const client = new StructuredFeedClient({ fetch: fetchStub });
  await assert.rejects(client.read('https://example.org/blocked/page'), /robots/);
  await assert.rejects(client.read('http://127.0.0.1/feed.ics'), /Private/);
  const result = await client.read('https://www.meetup.com/find/?x=1', {
    windowStart: new Date('2026-10-17T00:00:00Z'),
    windowEnd: new Date('2026-10-18T05:00:00Z'),
  });
  assert.equal(result.provider, 'meetup');
  assert.equal(result.format, 'jsonld');
  assert.equal(result.events.length, 2);
});

test('source URL builders', () => {
  assert.equal(sources.meetupFind({ place: 'us--ca--san-jose', topic: 'Board Games' }), 'https://www.meetup.com/find/us--ca--san-jose/board-games/');
  assert.equal(sources.eventbriteSearch({ place: 'ca--san-jose', topic: 'Board Games', start: new Date('2026-10-17T12:00:00Z') }), 'https://www.eventbrite.com/d/ca--san-jose/board-games/?start_date=2026-10-17');
  assert.equal(providerIdFromUrl('https://example.org/x'), undefined);
});
