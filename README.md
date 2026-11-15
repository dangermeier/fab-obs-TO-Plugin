# FAB OBS TO Plugin

A local server that turns a [GEM](https://gem.fabtcg.com) tournament (the official Flesh and Blood tournament software) into live Browser Source overlays for OBS Studio. It also serves a life counter for a tablet at the feature table.

![Version](https://img.shields.io/badge/version-1.0.0-gold) ![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-OBS%20Studio-purple)

## What it does

* Reads pairings, standings and hero data of one GEM event and serves them as overlays: pairings, standings, tickers, top cut bracket, hero breakdown, featured match, life counter, broadcast frame, winner screens, round status, single card.
* Tablet page for the life totals of the featured match. Changes reach the overlays immediately over Server-Sent Events.
* Config page for GEM login, event selection, player name format, overlay language (English or German) and theme. Settings apply to all open overlays without reloading them in OBS.
* Card search page that puts any card on stream.
* Optional built-in demo tournament for testing without GEM.

## Requirements

* [Node.js](https://nodejs.org) 18 or later, or Docker.
* Google Chrome or Microsoft Edge on the server machine for the one-click GEM login. Without one, paste the session cookie by hand.
* OBS Studio on a machine that can reach the server.

## Install and start

### With npm

```bash
git clone https://github.com/dangermeier/fab-obs-TO-Plugin.git
cd fab-obs-TO-Plugin
npm install
npm start
```

On Windows you can double-click `start.bat` instead. It checks for Node, installs the dependencies and opens the config page. `start.sh` does the same on macOS and Linux.

On the first start Windows asks whether to allow Node.js through the firewall. Allow it for private networks, otherwise the tablet cannot connect.

### With Docker

```bash
cp .env.example .env      # set PUBLIC_HOST
docker compose up -d
```

`PUBLIC_HOST` is required. Inside the container the only visible address is the Docker bridge (`172.17.x`), which a tablet cannot reach, so the address to show has to be given.

`./data` is mounted as a volume. It holds the GEM session, the settings including the PIN, and the life totals. Without it they are lost when the container is recreated.

The one-click GEM login does not work in Docker because there is no desktop browser in the container. The config page offers the manual session cookie instead. Everything else behaves the same.

The PIN is printed on every start: `docker compose logs | grep PIN`.

## Configuration

Set these as environment variables or in a `.env` file next to `server.js` (copy `.env.example`). Docker Compose reads `.env`, and so does `npm start` (Node.js 20.12 or later; on older versions set real environment variables). Real environment variables take precedence.

| Variable | Meaning |
| --- | --- |
| `PUBLIC_HOST` | Docker: required. LAN address or host name of the Docker host, e.g. `192.168.2.10`, `192.168.2.10:3010` or `nas.local:3000` |
| `HOST_PORT` | Docker only. Port on the host, default `3000`. If you change it, add the same port to `PUBLIC_HOST` |
| `CONTROL_PIN` | Optional. Fixes the PIN. Empty: a random PIN is generated on first start and kept in `data/settings.json`. `off` disables the PIN |
| `DEMO_MODE` | Optional. `on` adds the demo tournament to the config page. Default off |
| `PORT` / `HOST` | Without Docker. Default `3000` / `0.0.0.0`. `HOST=127.0.0.1` keeps the server local; the tablet then cannot connect |
| `TZ` | Docker only. Default `Europe/Berlin` |

## Access and PIN

The server listens on the whole local network so the tablet can reach it.

* Reading is open. Overlays, tournament data and the live channel need no PIN, so OBS never sees a prompt.
* Every change needs the PIN: selecting the event, GEM login, name format, language, theme, cards and life totals. This also applies on the machine running the server.

The PIN is printed in the server console on every start and shown on the config page once unlocked. You can change or disable it there. Doing so signs out every paired browser.

## Usage

1. Open <http://localhost:3000>. It redirects to the config page at `/config/`. Enter the PIN.
2. Click **Login with GEM**. A browser window opens on gem.fabtcg.com; log in there and the session is saved. If that does not work, open **Manual session cookie** and paste the value of your `sessionid` cookie (DevTools, Application, Cookies, gem.fabtcg.com).
3. Pick the event from the list. The **Judge / Scorekeeper** and **Store** buttons switch between event types. You can also enter the event ID by hand; it is the number in the run URL, `gem.fabtcg.com/gem/12345/run/`.
4. In OBS add a Browser Source per overlay (**Sources, +, Browser Source**), paste the URL and set width and height to your stream resolution, e.g. 1920 x 1080. The config page lists all URLs with a copy button.

Set your GEM account language to English. Hero names are matched against the card database by their English names.

## Overlays

All URLs start with `http://localhost:3000/overlays/`.

| Overlay | URL | Notes |
| --- | --- | --- |
| Pairings | `pairings.html` | Board with heroes and round progress, scrolls when it overflows |
| Standings | `standings.html` | Table with record and hero, scrolls when it overflows |
| Pairings ticker | `pairings.html?mode=ticker` | One-line band; use a full-width source about 140 px high |
| Standings ticker | `standings.html?mode=ticker&top=16` | Same, for the leading places |
| Top cut bracket | `bracket.html` | Top 4 or Top 8, left to right; fills the frame |
| Hero breakdown | `breakdown.html` | Bar chart of heroes played; fills the frame |
| Featured match | `match.html` | Full-screen matchup. `?layout=banner` is a lower third for use over a camera |
| Life counter | `life.html` | Two badges on a transparent background |
| Broadcast frame | `life.html?layout=broadcast` | Full-screen frame around three camera windows |
| Card | `card.html` | The card chosen on the card search page |
| Winner | `winner.html?side=left` or `?side=right` | Announces one player of the featured match |
| Round status | `round.html` | Progress of the running round |

Notes:

* Boards refresh every 30 seconds. Featured match, life counter, broadcast frame and round status follow the tablet immediately.
* Life counter and the featured match banner are transparent, so they can sit on top of a camera.
* **Broadcast frame:** table camera in the middle, one player camera on each side. Names, heroes, records, life totals, event, format, round and table come from the featured match. `&cams=0` shows hero artwork in place of the player cameras, `&card=0` removes the card slot, `&debug=1` outlines the camera windows and prints their size and position.
* **Winner:** the player's camera shows through one half, their hero fills the other. Make one scene per side, or use `?side=auto` to pick the player still standing once the other is at 0 life.
* **Round status** shows nothing until you confirm on the tablet that the featured match is over. Then it lists every table of the running round, with the winner for finished tables. Leave it in the scene; while hidden it makes no requests to GEM. `?always=1` keeps it visible, `?bg=transparent` removes its background.
* A working overlay shows only its content. Problems appear as a small badge in the corner.

### URL parameters

| Parameter | Overlays | Meaning |
| --- | --- | --- |
| `eventId` | all | Use a different event than the globally selected one; `demo` shows the demo tournament |
| `refresh` | all | Polling interval in seconds (default 30; round uses 15 and only polls while visible) |
| `names` | all with player names | `full`, `short` or `initials`. Overrides the global setting for this source |
| `lang` | all | `en` or `de`. Overrides the global overlay language for this source |
| `theme` | boards, tickers, broadcast frame | `mpa`, `usurp`, `dark` or `light`. Overrides the global theme for this source |
| `fx` | all | `0` turns the background animation off for this source |
| `scale` | all | Size multiplier, e.g. `1.4` |
| `debug` | all | `1` keeps the status badge and refresh countdown visible |
| `mode` | pairings, standings | `ticker` turns the board into a band running across the frame |
| `speed` | pairings, standings | Scroll speed in pixels per second (default 48 for the boards, 90 for the tickers) |
| `top` | standings | Only the leading places, e.g. `16` |
| `pos` | ticker | `top` pins the strip to the top edge when the source is taller than the strip |
| `max` | breakdown | Most heroes listed before the rest is summed up as "Other heroes" (default 18) |
| `layout` | match | `banner` shows the lower third instead of the full matchup screen; `bg`, `pos`, `margin`, `life` and `hero` apply to it |
| `layout` | life | `broadcast` shows the frame around three camera windows instead of the two badges |
| `cams` | life (broadcast) | `0` for a setup without player cameras: the two windows show hero artwork |
| `card` | life (broadcast) | `0` removes the card slot; the player camera window then runs the full height |
| `align` | card | `left` or `right` pins the card to that edge of the source |
| `side` | winner | `left`, `right` or `auto` |
| `side` | life | `left`, `right` or `both`. Use two sources to place the badges separately |
| `inset` | life | Distance from the left/right screen edge in pixels |
| `bg` | match, life | `solid` adds the dark panel; default is transparent |
| `bg` | round | `transparent` removes the board background; default is solid |
| `pos` | match, life | `top`, `center` or `bottom` |
| `margin` | match, life | Distance from that edge in pixels |
| `life` | match | `1` shows the live life totals inside the banner |
| `hero` | match, life, round | Hero portrait size in pixels |
| `always` | round | `1` shows the board all the time instead of only after the featured match has ended |

## Themes

Four themes, chosen on the config page and switched live: **Mastery Pack Assassin** (`mpa`), **Usurp the Shadow Throne** (`usurp`, the default), **Black** (`dark`) and **White** (`light`). They apply to the boards, tickers, broadcast frame, matchup and winner screens. The featured match banner and the life badges stay dark.

Each theme has its own background animation. Only position and opacity are animated; `?fx=0` turns it off per source.

Headings and numbers use Oswald, shipped in `public/shared/fonts/` under the SIL Open Font License. No fonts are loaded from the internet.

## Card search

Open `/cards/` (link on the config page), type at least two letters and click a card. It appears in the card slot of the broadcast frame and in `card.html`, and stays until you hide it or pick another one. Recently used cards are listed below the search. Showing or hiding a card needs the PIN.

## Life counter on a tablet

1. Start the server. The console prints the tablet address and the PIN. The config page lists the same addresses, labelled by network adapter. Use the one on your Wi-Fi, not a virtual one. In Docker the address comes from `PUBLIC_HOST`.
2. Open the address (`http://<server>:3000/control/`) on the tablet and enter the PIN once. That browser remembers it.
3. Tap **Match**, pick the round and the table you are streaming, and confirm.

Both players appear with hero, name and record. Life starts at each hero's printed life value. The page is in German.

| Control | What it does |
| --- | --- |
| `+1` / `−1` | Life up and down |
| `−2 −4 −5 −10` | Quick damage |
| Tap the number | Type an exact life total |
| **Rückgängig** | Undo the last change |
| **Seiten tauschen** | Swap left and right so the tablet matches the camera |
| **Match** | Pick round and table, or enter a match by hand |
| Fullscreen button (top right) | Hides the browser bars |

With **Diesem Tisch jede Runde folgen** ticked, the counter reloads the players and resets the life totals when a new round starts. Untick it to stay on one match.

**When a player reaches 0** the tablet asks "Ist das laufende Match beendet?".

* **Nein:** the question does not return while that player stays at 0 or below.
* **Ja:** the tablet shows "Match beendet", asking the players to report the result in GEM, and the Round Status overlay fades in on stream. The life badges stay visible. Tap **Weiter** or load the next match to end this state.

**If GEM is unreachable** a loaded match keeps working; a warning is shown but names and life totals stay. Under **Match, Manuell überschreiben** you can enter names, heroes and starting life by hand, also for matches GEM does not know.

## Demo tournament

Off by default. Set `DEMO_MODE=on` (in `.env` or as an environment variable) and restart. The config page then shows a **Demo tournament** card.

* A made-up event with 128 players, seven Swiss rounds and a Top 8. No GEM login needed.
* You advance it from the config page: report some results, finish the round, pair the next round, or jump to any stage.
* Open overlays follow at once. Your selected event is restored when you leave the demo.
* `?eventId=demo` on a single overlay URL shows the demo in that source only.

## Data and privacy

The plugin runs on your machine. It talks to gem.fabtcg.com for tournament data and to [goagain.dev](https://api.goagain.dev) for card data and artwork, which is cached for 24 hours. The GEM session cookie is stored in `data/session.json`, which is gitignored, and is only sent to gem.fabtcg.com.

**Player names.** The default is first name plus surname initial (`Dorinthea I.`). The config page also offers initials only (`D. I.`) and the full name; use full names only if your players have agreed. `?names=full` overrides it for one source. Nicknames in a GEM profile (`Rhinar, Katsu "Rhino"`) are dropped.

**Network.** Anyone on the same network can read the tournament data the server provides. Changes need the PIN, see [Access and PIN](#access-and-pin).

## Project structure

Plain Node.js with Express, no build step.

```text
fab-obs-TO-Plugin/
├── server.js              # Express entry point, reads .env
├── src/
│   ├── auth.js            # GEM session, browser login (puppeteer-core)
│   ├── fetcher.js         # GEM requests, hero stats, card data, caching
│   ├── parser.js          # HTML/CSV parsing of tournament data
│   ├── state.js           # Settings, life counter state, persistence, event bus
│   ├── match.js           # Resolves the featured match from GEM data
│   ├── demo.js            # Demo tournament (event id "demo")
│   ├── name.js            # Player name formatting
│   ├── lan.js             # Network addresses the tablet can reach
│   ├── paths.js           # Data directory (DATA_DIR)
│   └── routes.js          # API routes (/api/tournament, /api/live, /api/match, ...)
├── public/
│   ├── config/            # Config page
│   ├── control/           # Tablet life counter
│   ├── cards/             # Card search
│   ├── overlays/          # OBS Browser Source pages
│   │   ├── pairings.html
│   │   ├── standings.html
│   │   ├── bracket.html
│   │   ├── breakdown.html
│   │   ├── match.html     # Matchup screen or lower third (?layout=banner)
│   │   ├── life.html      # Life badges or broadcast frame (?layout=broadcast)
│   │   ├── card.html      # Card on stream
│   │   ├── winner.html    # Winner screen (?side=left|right|auto)
│   │   └── round.html     # Round status
│   └── shared/
│       ├── fonts/         # Oswald (OFL)
│       ├── themes/        # Theme artwork
│       ├── overlay.css    # Design tokens and shared styles
│       └── overlay.js     # Shared helpers (names, language, hero art, scroller, SSE)
├── test/                  # Unit tests, run with npm test
├── Dockerfile, docker-compose.yml, .env.example
├── start.bat / start.sh   # Launchers: check Node, install, open the config page
└── data/                  # Runtime data, gitignored
    ├── session.json       # GEM cookie and selected event
    ├── settings.json      # Name format, language, theme, PIN
    └── match.json         # Featured match and life totals
```

Live updates use Server-Sent Events on `GET /api/live` (`match` and `settings` events). All state changes go through `src/state.js`, which persists them and broadcasts on the event bus.

To contribute, fork the repo and open a pull request. Restart the server to test changes. `npm test` runs the unit tests with Node's built-in runner.

## Acknowledgements

Card data and artwork come from [goagain.dev](https://api.goagain.dev), a community-maintained Flesh and Blood card database. Flesh and Blood is a trademark of [Legend Story Studios](https://legendstory.com).

## Support

If this tool saves you time at your events, a coffee is appreciated.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-dangermeier-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/dangermeier)

## License

MIT, see [LICENSE](LICENSE).
