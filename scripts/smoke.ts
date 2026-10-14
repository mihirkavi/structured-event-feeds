// Live check against public sources. Prints counts and a few titles only.
import { sources, StructuredFeedClient } from '../src/index.js';

const client = new StructuredFeedClient();
const start = new Date();
const end = new Date(start.getTime() + 7 * 86_400_000);
const targets = [
  sources.meetupFind({ place: 'us--ca--san-jose', topic: 'social' }),
  sources.eventbriteSearch({ place: 'ca--san-jose', topic: 'events', start, end }),
  'https://events.stanford.edu/calendar.ics',
];
for (const url of targets) {
  try {
    const result = await client.read(url, { windowStart: start, windowEnd: end });
    console.log(JSON.stringify({ provider: result.provider, format: result.format, events: result.events.length, sample: result.events.slice(0, 2).map((e) => [e.title, e.startsAt]) }));
  } catch (error) {
    console.log(JSON.stringify({ url, error: (error as Error).message }));
  }
}
