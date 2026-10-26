# README assets

Images used by the repository's root `README.md`.

| File | What it is | How it was made |
| --- | --- | --- |
| `banner-light.png`, `banner-dark.png` | The README banner for light and dark GitHub themes | Rendered from an HTML template with headless Chromium (3200×1200) |
| `terminal.png` | The hero image: `npx tsx scripts/read.ts <url>` run against a Meetup find page, the Stanford events ICS feed and an Eventbrite browse page | Real output from live runs on 26 October 2026, rendered as a card with headless Chromium. Output was not edited apart from trimming trailing spaces. |

Notes for agents and contributors:

- Screenshots and terminal cards must show only public data or synthetic demo data. Never show attendee names, accounts, tokens or private calendars.
- Re-run the commands and re-render the card instead of editing the image by hand. Keep the date in the README caption accurate.
