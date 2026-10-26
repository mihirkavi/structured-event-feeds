# README assets

Images used by the repository's root `README.md`.

| File | What it is | How it was made |
| --- | --- | --- |
| `banner-light.png`, `banner-dark.png` | The README banner for light and dark GitHub themes: ICS and JSON-LD snippets flowing into one month grid | Rendered from `source/banner.html` with headless Chromium (1600×600 at 2×, 3200×1200). See `source/README.md` |
| `terminal.png` | The hero image: `npx tsx scripts/read.ts <url>` run against a Meetup find page, the Stanford events ICS feed and an Eventbrite browse page | Real output from live runs on 26 October 2026, rendered as a card with headless Chromium. Output was not edited apart from trimming trailing spaces. |

## Visual identity

- **Type:** Bricolage Grotesque at its condensed width for display, JetBrains Mono for code and labels.
- **Colours:** deep teal `#0d2b2e`, teal `#0f7f78`, tomato `#e8553e`, calendar paper `#f3f0e6` (dark: `#0a2224` background).
- **Motif:** raw ICS and schema.org JSON-LD syntax feeding one month grid. The snippets illustrate the formats; they are not output from a run.
- **Family:** a sibling of [luma-discovery](https://github.com/mihirkavi/luma-discovery), which shares the type families with a warm coral palette and a map motif.
- Badges use the same hex colours.

Notes for agents and contributors:

- Screenshots and terminal cards must show only public data or synthetic demo data. Never show attendee names, accounts, tokens or private calendars.
- Re-run the commands and re-render the card instead of editing the image by hand. Keep the date in the README caption accurate.
