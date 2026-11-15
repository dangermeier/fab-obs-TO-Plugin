# FAB OBS TO Plugin

A local server that provides live OBS Studio Browser Source overlays for [GEM](https://gem.fabtcg.com) — the official tournament management platform for Flesh and Blood TCG.

![Version](https://img.shields.io/badge/version-1.0.0-gold) ![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-OBS%20Studio-purple)

---

## Features

### Live Overlays

* Pairings board with hero portraits and hero names, round progress, and smooth infinite scroll
* Standings table with live W–L record, hero portraits, and infinite scroll
* Pairings and Standings also come as a **ticker** — a band that runs across the bottom of the frame in a loop, one cell per table with both players, their heroes and records (`?mode=ticker`)
* Top Cut elimination bracket arranged left to right (Top 4 / Top 8) with connector lines; matches are ordered by who actually advanced, and the Finals winner is labelled Champion
* Hero Breakdown bar chart showing hero popularity across all registered players — always fills the frame, however many heroes there are
* Featured Match screen — a full-frame matchup: both hero cards large, both players with record, life and class, and event, format, round and table between them. `?layout=banner` gives the compact lower third for use over a camera instead
* Life Counter badges with a transparent background, ready to sit over your camera feed
* Winner screens for the left and the right player of the featured match — their camera through one half, their hero in the other, event, format and round between them
* Round Status card that stays invisible until the featured match ends, then shows how far the running round has got (`?always=1` keeps it up)

### Life Counter on a Tablet

* Open the control page on any tablet in the same network and track both players' life totals
* Left and right are labelled and follow a **swap sides** button, so the tablet always matches what the camera sees
* Life starts at each hero's own printed life total, looked up automatically (Kayo 44, Iyslander 30, Blitz heroes 20 …)
* Big `+1` / `−1` targets plus `−2 / −4 / −5 / −10` quick damage, and undo — nothing else to hit by accident
* Changes appear in the stream overlay instantly — pushed over Server-Sent Events, not polled
* When a player hits 0 the tablet asks whether the match is over; confirming reminds you to have both players report, and reveals the Round Status overlay in the stream
* Keeps working if GEM goes down mid-round, and a manual mode lets you run a match GEM knows nothing about
* Protected by a 4-digit PIN so nobody else on the venue Wi-Fi can touch it

### Privacy

* Player names can be shown as **Dorinthea Ironsong**, **Dorinthea I.** (default) or **D. I.**
* The setting applies to every overlay at once, without reloading them in OBS

### Language

* Everything viewers read on the overlays is available in **English** and **German** — pick it on the config page; it switches live

### Broadcast Frame

* `life.html?layout=broadcast` is a full-screen frame around three camera windows — the table in the middle, one player on each side — in the arrangement tournament coverage usually uses
* Player names, hero portraits and hero names, records, live life totals, event, format, round and table are all filled in from the featured match; nothing to type
* No player cameras? `&cams=0` fills those two windows with large hero artwork
* Optional card slot: search any card on the separate **Cards** page (`/cards/`) and put it on stream with one click. `&card=0` removes the slot; `card.html` shows the same card as a stand-alone source
* `&debug=1` outlines the three windows and prints their size and position, for lining up the cameras in OBS

### Look

* Titles, names and numbers are set in Oswald, which is shipped with the plugin (SIL Open Font License) — nothing is fetched from the internet while you are on air
* Dividing lines fade out before they reach an edge and break in the middle for a small star

### Background Animation

* Every overlay is gently in motion: motes of light rise through the boards, the broadcast frame's panels, the ticker band, the featured-match banner and the life badges; the boards also have large soft patches of light drifting behind the content, and a band of light crosses each floating panel now and then
* Cheap by construction — only position and opacity are animated. `?fx=0` switches it off per source

### Themes

* Four themes for the boards, the tickers, the broadcast frame and the matchup and winner screens, chosen from a dropdown on the config page and switched live: **Mastery Pack Assassin** (after its key art: a yard of cranes and girders at night, dim cyan haze and magenta mist along the ground, with falling blood-red petals and the glint of a blade as its own background animation), **Usurp the Shadow Throne** (the current main set and the default — violet and magenta, with arcane circles, drifting rock shards and embers), **Black** and **White**
* Built to grow: a theme is one block of colour tokens plus one line in a list

### Demo Tournament

* **Off by default.** Switch it on with `DEMO_MODE=on` — in `.env` (read by Docker Compose and by `npm start` alike) or as an environment variable — and restart; the config page then shows a "Demo tournament" card
* A built-in 128-player event — seven Swiss rounds and a Top 8 — for trying every overlay and the tablet, or building your OBS scenes, without a GEM login or a running event
* Advance it by hand from the config page: report some results, finish the round, pair the next one, or jump straight to any stage (Round 1 … Finals, Finished)
* Open overlays follow instantly; your selected event is restored when you leave the demo
* Append `?eventId=demo` to a single overlay URL to show the demo in that source only

### GEM Integration

* One-click login — opens your browser on GEM, session is detected and saved automatically
* Manual fallback via `sessionid` cookie paste for environments where the browser flow doesn't work
* Automatic event discovery for judge, scorekeeper, and store-owner events
* Store tab pulls tournaments from all stores linked to your GEM account

### Stream-Ready

* All overlays auto-refresh on a configurable interval (default 30 s). A healthy source shows nothing but the board; problems appear as a small badge in the corner, and `?debug=1` adds the refresh countdown
* Boards size their type from the source width — readable on a 1080p stream, sharp at 4K, and usable as a narrow side panel
* Unchanged data is never re-rendered, so artwork does not flicker on refresh
* Hero portrait art fetched automatically from the card database and cached for 24 h
* New data applied at the scroll boundary — no visible jump mid-scroll
* Scales to any OBS Browser Source resolution; Bracket and Breakdown fill the frame automatically

---

## Installation

Two ways to run it. Both behave identically once started — same pages, same PIN, same overlays.

### A · Directly on your machine

Requires [Node.js](https://nodejs.org) 18 or later. Google Chrome or Microsoft Edge enables the one-click GEM login; without one you can still paste the session cookie by hand.

```bash
git clone https://github.com/YOUR_USERNAME/fab-obs-TO-Plugin.git
cd fab-obs-TO-Plugin
npm install
npm start
```

On Windows you can also just double-click **`start.bat`** — it checks Node, installs the dependencies and opens the config page for you. `start.sh` does the same on macOS and Linux.

### B · In Docker

For a NAS or a small always-on server. Copy the project over, then:

```bash
PUBLIC_HOST=192.168.2.10 docker compose up -d
```

**`PUBLIC_HOST` is required.** Inside the container the only visible address is the Docker bridge (`172.17.x`), which no tablet can reach — so the address to hand out has to be stated explicitly. Use the LAN address (or host name) of the machine running Docker.

| Variable | Meaning |
|---|---|
| `PUBLIC_HOST` | **required** — LAN address of the Docker host, e.g. `192.168.2.10` or `nas.local:3000` |
| `CONTROL_PIN` | Optional. Fixes the PIN instead of generating a random one. `off` disables protection entirely. |
| `PORT` / `HOST` | Default `3000` / `0.0.0.0` |

`./data` is mounted as a volume — that is where the GEM session, the PIN and the live life totals live. Without it they are lost whenever the container is recreated.

**The one-click GEM login does not work in Docker**: it drives a real desktop browser, and there is none in the container. The config page detects this and offers the manual session cookie instead — everything else is unchanged. That is the only difference between the two variants.

Forgot the PIN? It is printed on every start: `docker compose logs | grep PIN`.

---

## Access

The server listens on your whole network so the tablet can reach it. That also means anyone else on the venue Wi-Fi can reach it, so:

* **Reading is open.** Overlays, tournament data and the live channel need no PIN — OBS must never face a prompt.
* **Every change needs the PIN.** Config page and tablet alike: picking the event, logging in to GEM, the name mode, and every life total.

There is deliberately no exemption for the machine running the server. It would not stop anyone on the same Wi-Fi, and relying on the source IP breaks the moment the server runs in a container.

The PIN is shown in the server console on every start, and on the config page once unlocked. Change or disable it there — doing so signs out every paired browser.

---

## Usage

**First login:** Open <http://localhost:3000> and click **Login with GEM**. Your default browser opens on gem.fabtcg.com — log in normally. The session is detected and saved automatically. If the browser flow doesn't work, paste your `sessionid` cookie value via the *Manual session cookie* section.

**Select an event:** After logging in, your active and recent events appear as a list. Click the event you want to stream. Use the **Judge / Scorekeeper** and **Store** toggle to switch between event types. You can also enter a GEM Event ID manually — find it in the run URL: `gem.fabtcg.com/gem/`**`12345`**`/run/`

**Add overlays to OBS:** Go to **Sources → + → Browser Source** and paste the URL for each overlay you need. Set Width and Height to match your stream resolution (e.g. 1920 × 1080).

| Overlay | URL |
|---|---|
| Pairings | `http://localhost:3000/overlays/pairings.html` |
| Standings | `http://localhost:3000/overlays/standings.html` |
| Top Cut Bracket | `http://localhost:3000/overlays/bracket.html` |
| Hero Breakdown | `http://localhost:3000/overlays/breakdown.html` |
| Featured Match | `http://localhost:3000/overlays/match.html` |
| Life Counter | `http://localhost:3000/overlays/life.html` |
| Round Status | `http://localhost:3000/overlays/round.html` |

Featured Match and Life Counter have a **transparent background** so you can lay them over your gameplay camera. Add them as a full 1920 × 1080 Browser Source and position the elements with the URL parameters below.

**Round Status shows nothing at all** until you confirm on the tablet that the featured match is over. It then fades in as a full board over the whole source, listing every table of the running round — finished ones name the winner in green, the rest say *läuft*. Leave it in the scene permanently; it appears and disappears by itself, and while hidden it paints nothing and makes no requests to GEM.

Add `?bg=transparent` if you would rather have the board float over your footage without its own background. Very long rounds scroll by themselves.

**Refresh interval:** Append `?refresh=60` to any overlay URL to change the polling interval (in seconds). Featured Match and Life Counter update instantly via a push channel; the interval is only their fallback.

**GEM language:** Set your GEM account language to **English** for best results. Hero names from the coverage CSVs are matched against the card database by name; English names resolve artwork correctly.

---

## Life Counter

The life counter has two halves: a **control page** you open on a tablet at the table, and the **Life Counter overlay** in OBS that follows it live.

### Setting it up

1. Start the server. The console prints the tablet address and the PIN. The same
   list is on the config page once you unlock it, each address labelled by its
   network adapter — pick the one on your Wi-Fi, not a  one. In Docker
   the address comes from .
2. On the first start Windows asks whether to allow  through the
   firewall. Answer **yes for private networks**, otherwise the tablet cannot connect.
3. Open the address on the tablet and enter the PIN once. It is remembered in
   that browser.
4. Tap **⚙ Match**, pick the round and the table you are streaming, and confirm.

Both players appear with hero artwork, name and record, and their life totals start at their heroes' printed values.

### At the table

| Control | What it does |
|---|---|
| `+1` / `−1` | The two large buttons — life up and down |
| `−2 −4 −5 −10` | Quick damage for the usual hit sizes |
| Tap the number | Type an exact life total |
| **↶ Rückgängig** | Undo the last change |
| **⇄ Seiten tauschen** | Swap left and right — do this once so the tablet matches your camera |
| **⚙ Match** | Pick the round and table, or enter a match by hand |
| ⛶ (top right) | Fullscreen — hides the browser bars so the tablet is all counter |

That is deliberately everything. A FAB match is a single game, so there is no best-of-3 counter, and nothing else can be hit by accident mid-round.

Tick **"Diesem Tisch jede Runde folgen"** and the counter re-loads the players and resets the life totals by itself whenever a new round starts. Leave it off to pin one specific match.

### When a player hits 0

As soon as either life total reaches zero or below, the tablet asks a single question: **"Ist das laufende Match beendet?"**

* **Nein** — the question goes away and does not come back while that player stays down. Heal back up and drop to zero again, and it asks afresh.
* **Ja** — the tablet is taken over by a full-screen **MATCH BEENDET · Bitte jetzt das Ergebnis in GEM melden**, which both players can read across the table. At the same time the **Round Status** overlay fades into the stream showing how far the running round has got, while the life badges stay on screen with the final score.

Tap **Weiter** when the result is in, or just load the next match — the takeover and the stream overlay both disappear either way.

### When GEM misbehaves

Once a match is loaded the counter no longer depends on GEM. If the session expires or the site goes down, a warning appears but the life totals, names and game score stay exactly as they are and remain fully usable. Under **⚙ Match → Manuell überschreiben** you can also type names, heroes and starting life by hand — useful for a side event, or if GEM never comes back.

### Security

The server listens on your whole local network so the tablet can reach it. Reading is open — OBS browser sources never see a prompt — but every change requires the PIN, on the config page and the tablet alike, from any computer. Change or disable the PIN on the config page; doing so signs out every paired tablet. To go back to local-only operation, start with `HOST=127.0.0.1 npm start` (the tablet then cannot connect).

---

## Overlay URL parameters

| Parameter | Overlays | Meaning |
|---|---|---|
| `eventId` | all | Use a different event than the globally selected one |
| `refresh` | all | Polling interval in seconds (default 30; round uses 15 and only polls while visible) |
| `names` | all with player names | `full`, `short` or `initials` — overrides the global setting for this source only |
| `lang` | all | `en` or `de` — overrides the global overlay language for this source only |
| `bg` | match, life | `solid` adds the dark panel; default is transparent |
| `bg` | round | `transparent` removes the board background; default is solid |
| `scale` | all | Size multiplier, e.g. `1.4` |
| `max` | breakdown | Most heroes listed before the rest is summed up as "Other heroes" (default 18) |
| `mode` | pairings, standings | `ticker` turns the board into a band running across the frame — use a full-width source about 140 px high |
| `theme` | boards, tickers, broadcast frame | `mpa`, `usurp`, `dark` or `light` — overrides the global theme for this source only |
| `fx` | all | `0` turns the background animation off for this source |
| `side` | winner | `left` or `right` — which player of the featured match is announced; `auto` picks the one still standing once the other is at 0 life |
| `always` | round | `1` shows the board all the time instead of only after the featured match has ended |
| `layout` | match | `banner` shows the lower third over the camera instead of the full matchup screen; `bg`, `pos`, `margin`, `life` and `hero` below apply to it |
| `layout` | life | `broadcast` shows the full frame around three camera windows instead of the two badges |
| `cams` | life (broadcast) | `0` for a setup without player cameras: their two windows show the heroes' artwork instead |
| `card` | life (broadcast) | `0` removes the card slot; the player camera window then runs the full height |
| `align` | card | `left` or `right` pins the card to that edge of the source |
| `pos` | ticker | `top` pins the strip to the top edge when the source is taller than the strip |
| `speed` | pairings, standings | Scroll speed in pixels per second (default 48 for the boards, 90 for the tickers) |
| `top` | standings | Only the leading places, e.g. `16` — worth it for a ticker at a large event |
| `debug` | all | `1` keeps the status badge visible while everything is fine |
| `pos` | match, life | `top`, `center` or `bottom` |
| `margin` | match, life | Distance from that edge in pixels |
| `life` | match | `1` shows the live life totals inside the banner |
| `side` | life | `left`, `right` or `both` — use two sources for full freedom in OBS |
| `inset` | life | Distance from the left/right screen edge in pixels |
| `hero` | match, life, round | Hero portrait size in pixels |

---

## Data & Privacy

The plugin runs entirely on your local machine. No tournament data, player names, or session credentials are sent to any external server by this plugin. Hero card artwork is fetched on demand from [goagain.dev](https://api.goagain.dev) and cached locally for 24 hours.

Your GEM session cookie is stored in `data/session.json` on your machine and is listed in `.gitignore`. It is never transmitted anywhere other than to gem.fabtcg.com for API requests.

**Player names on stream.** Overlays show **Dorinthea I.** by default — first name plus the initial of the surname. Switch to **D. I.** for less, or to the full name if your players have agreed to being named, for example through your tournament terms or a notice at the venue. The setting lives on the config page and applies to every overlay at once. Append `?names=full` to a single overlay URL to override it for that source alone.

**Nicknames.** Some players put one in their GEM profile, which makes it part of the name GEM hands over: `Rhinar, Katsu "Rhino"`. Overlays drop it and show `Katsu Rhinar` / `Katsu R.` / `K. R.` — the quoted part is never abbreviated into an initial. Nothing to configure.

**Network exposure.** The server listens on your local network so a tablet can reach the life counter. Anyone on the same network can *read* the tournament data it serves; every change — on the config page and the tablet — requires the PIN. See [Access](#access) above. Start with `HOST=127.0.0.1 npm start` to keep everything local, at the cost of the tablet.

---

## Development

The server is plain Node.js with Express, no build step required.

```
fab-obs-TO-Plugin/
├── server.js              # Express entry point
├── src/
│   ├── auth.js            # GEM session management, Puppeteer login
│   ├── fetcher.js         # GEM HTTP fetching, hero stats + artwork, caching
│   ├── parser.js          # HTML/CSV parsing for tournament data
│   ├── state.js           # Settings + life counter state, persistence, event bus
│   ├── match.js           # Resolves the featured match from GEM data
│   ├── demo.js            # Built-in demo tournament (event id "demo")
│   ├── lan.js             # Network addresses the tablet can reach
│   └── routes.js          # API routes (/api/tournament, /api/live, /api/match, …)
├── public/
│   ├── config/            # Configuration UI (event, tablet URL, PIN, name mode)
│   ├── control/           # Tablet life counter
│   ├── cards/             # Card search — puts a card on stream
│   ├── overlays/          # OBS Browser Source pages
│   │   ├── pairings.html
│   │   ├── standings.html
│   │   ├── bracket.html
│   │   ├── breakdown.html
│   │   ├── match.html     # Featured match: matchup screen, or lower third (?layout=banner)
│   │   ├── life.html      # Life counter badges, or the broadcast frame (?layout=broadcast)
│   │   ├── card.html      # The card on show, stand-alone
│   │   ├── winner.html    # Winner screen, ?side=left|right|auto
│   │   └── round.html     # Round progress, revealed when a match ends
│   └── shared/
│       ├── fonts/         # Oswald (OFL), the display typeface
│       ├── overlay.css    # Design tokens + shared component styles
│       └── overlay.js     # Shared helpers (names, language, hero art, scroller, SSE)
├── test/                  # `npm test` — parser, name matching, language
├── design_idea.md         # The design system, portable to other projects
├── start.bat / start.sh   # Double-click launchers: check Node, install, open config
└── data/                  # Runtime data — all gitignored
    ├── session.json       # GEM cookie + selected event
    ├── settings.json      # Name mode, overlay language, theme, control PIN
    └── match.json         # Featured match and life totals
```

Styling follows a documented design system — tokens live in `public/shared/overlay.css`, the full spec including a portable brief for designers is in [`design_idea.md`](design_idea.md).

Live updates use **Server-Sent Events** on `GET /api/live`, which carries `match` and `settings` events. There is no WebSocket dependency; `EventSource` handles reconnection on its own. Anything that mutates state goes through `src/state.js`, which persists it and broadcasts on the shared event bus.

To contribute, fork the repo, make your changes and open a pull request. Edit the files directly and restart the server to test; `npm test` runs the unit tests (Node's built-in runner, no extra dependencies).

---

## Acknowledgements

Card data and artwork sourced from [goagain.dev](https://api.goagain.dev), a community-maintained Flesh and Blood card database.

Flesh and Blood is a trademark of [Legend Story Studios](https://legendstory.com).

---

## Support

If this tool saves you time at your events, a coffee is always appreciated.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-dangermeier-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/dangermeier)

---

## License

MIT see [LICENSE](LICENSE)
