// Try it: read any public ICS feed or schema.org event page and list the next events.
// Usage: npx tsx scripts/read.ts <url> [days]
// Prints public event fields only. Defaults to the next 7 days.
import { StructuredFeedClient } from '../src/index.js';

const [url, days = '7'] = process.argv.slice(2);
if (!url) {
  console.error('Usage: npx tsx scripts/read.ts <ics-or-page-url> [days]');
  process.exit(1);
}
const start = new Date();
const end = new Date(start.getTime() + Number(days) * 86_400_000);
const feed = await new StructuredFeedClient().read(url, { windowStart: start, windowEnd: end });

// Emoji are dropped from the printed table only, so the columns line up in a terminal.
const plain = (text: string) => text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').trim();
const clip = (text: string, width: number) => {
  const value = plain(text);
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
};
const shown = [...feed.events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 4);
for (const event of shown) {
  const when = event.dateOnly
    ? new Date(`${event.startsAt}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    : new Date(event.startsAt).toLocaleString('en-US', { timeZone: event.timezone ?? 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  console.log(`${clip(when, 12)}  ${clip(event.title, 50)}  ${clip(event.venue?.city ?? event.venue?.name ?? event.attendanceMode, 18)}`);
}
console.log(`↳ ${feed.provider} · ${feed.format} · ${feed.events.length} events in the next ${days} days${feed.events.length > shown.length ? ` (first ${shown.length} shown)` : ''}`);
