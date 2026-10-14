import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expandRule, parseIcs } from '../src/index.js';

const feed = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-TIMEZONE:America/Los_Angeles',
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'BEGIN:STANDARD',
  'DTSTART:19701101T020000',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:volleyball@example.org',
  'DTSTART;TZID=America/Los_Angeles:20261014T190000',
  'DTEND;TZID=America/Los_Angeles:20261014T210000',
  'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10',
  'EXDATE;TZID=America/Los_Angeles:20261021T190000',
  'SUMMARY:Open volleyball\\, all levels',
  'LOCATION:Community Center\\, 1 Main St\\, San Jose\\, CA',
  'DESCRIPTION:Bring water.\\nRSVP at https://example.org/vb',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:talk@example.org',
  'DTSTART:20261016T013000Z',
  'DURATION:PT1H30M',
  'SUMMARY:Wireless systems talk',
  'URL:https://example.org/talk',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:fair@example.org',
  'DTSTART;VALUE=DATE:20261017',
  'SUMMARY:Street fair',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parses zoned, UTC, and all-day events with recurrence', () => {
  const events = parseIcs(feed, {
    provider: 'example',
    sourceUrl: 'https://example.org/cal.ics',
    windowStart: new Date('2026-10-13T00:00:00Z'),
    windowEnd: new Date('2026-11-01T00:00:00Z'),
  });
  const volleyball = events.filter((event) => event.title === 'Open volleyball, all levels');
  // Oct 14 and 28 (Oct 21 excluded by EXDATE).
  assert.deepEqual(volleyball.map((event) => event.startsAt), ['2026-10-15T02:00:00.000Z', '2026-10-29T02:00:00.000Z']);
  assert.equal(volleyball[0]?.endsAt, '2026-10-15T04:00:00.000Z');
  assert.equal(volleyball[0]?.recurrence?.isRecurring, true);
  assert.equal(volleyball[0]?.url, 'https://example.org/vb');
  assert.equal(volleyball[0]?.venue?.name, 'Community Center');
  const talk = events.find((event) => event.title === 'Wireless systems talk');
  assert.equal(talk?.status, 'cancelled');
  assert.equal(talk?.endsAt, '2026-10-16T03:00:00.000Z');
  const fair = events.find((event) => event.title === 'Street fair');
  assert.equal(fair?.dateOnly, true);
  assert.equal(fair?.startsAt, '2026-10-17');
});

test('converts zoned wall times across DST', () => {
  const events = parseIcs(
    'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART;TZID=America/Los_Angeles:20261205T180000\nSUMMARY:Winter\nEND:VEVENT\nEND:VCALENDAR',
    { provider: 'x', sourceUrl: 'https://x.test/' },
  );
  assert.equal(events[0]?.startsAt, '2026-12-06T02:00:00.000Z');
  assert.equal(events[0]?.timezone, 'America/Los_Angeles');
});

test('expands daily rules with an UNTIL bound', () => {
  const dates = expandRule(new Date('2026-10-13T17:00:00Z'), 'FREQ=DAILY;INTERVAL=2;UNTIL=20261019T235959Z', new Set(), new Date('2026-10-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'));
  assert.equal(dates.length, 4);
});
