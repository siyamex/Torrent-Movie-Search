# 🎬 TorrentFlix — Torrent Movie Search

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white)
[![Docker Hub](https://img.shields.io/docker/v/siyamexcom/torrent-movies?logo=docker&logoColor=white&label=Docker%20Hub&sort=semver)](https://hub.docker.com/r/siyamexcom/torrent-movies)
![Docker image size](https://img.shields.io/docker/image-size/siyamexcom/torrent-movies/latest?logo=docker&logoColor=white)
![CasaOS](https://img.shields.io/badge/CasaOS-self--hosted-00b3ff)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

A small, self-hostable web app that searches torrent sites, shows movies as
poster cards with seeder counts, lets you **copy a magnet with one click**, and
**push a magnet straight to your [Seedr.cc](https://www.seedr.cc) cloud** with
one button. Runs great on a Raspberry Pi / Orange Pi (CasaOS) via Docker.

Built on [`torrent-search-api`](https://github.com/JimmyLaurent/torrent-search-api)
(backend scraping), the keyless YTS & iTunes APIs, optional TMDB for posters,
and the Seedr OAuth API.

![Home — browse tags and movie grid](docs/screenshot-home.png)

<p align="center">
  <img src="docs/screenshot-cards.png" width="49%" alt="Movie cards with ratings, seeders, quality selector and one-click actions" />
  <img src="docs/screenshot-search.png" width="49%" alt="Free-text search results with posters" />
</p>

## Features

- 🔎 Search across multiple public torrent providers (YTS, 1337x, TPB, LimeTorrents, EZTV)
- 🏷️ **Browse tags** — 🔥 Popular, 🌱 Most Seeded, 🆕 Latest, ⭐ Top Rated, genre chips (Action, Comedy, Horror, Sci-Fi…) and 4K / 1080p quality filters, powered by the keyless YTS API
- 🖼️ Movie poster art — **TMDB** if a key is set, otherwise a keyless **iTunes** fallback so photos still appear with zero config
- 🔍 **Click any poster to enlarge** it in a lightbox
- 🎚️ **Quality selector** on browse cards (720p / 1080p / 2160p) with per-quality seeders
- ▲ Seeder / ▼ peer counts and file size on every card, sorted by seeders
- ⧉ **Copy magnet** to clipboard with one click
- ＋ **Add to Seedr** — one click sends the magnet to your Seedr account

### About "Most Seeded"

The YTS API reports live seeders inconsistently in its bulk list, so the **Most
Seeded** tag pulls the popular pool and re-sorts by the seeders YTS *does*
report, defaulting each card to its best-seeded quality. For guaranteed-live
seeder numbers, use the search bar — that path scrapes the sites directly.

## Setup

```bash
npm install
cp .env.example .env      # then edit .env (PowerShell: copy .env.example .env)
npm start
```

Open <http://localhost:3000>.

### Posters (optional but recommended)

Posters need a free TMDB API key. Without it the app still works — cards just
show a 🎞️ placeholder.

1. Create an account at <https://www.themoviedb.org/>
2. Go to **Settings → API**, request a key
3. Put the **API Key (v3 auth)** value into `.env` as `TMDB_API_KEY=...`
4. Restart `npm start`

### Seedr

Click **Connect Seedr** in the top-right and enter your Seedr email + password.
Credentials are forwarded once to Seedr to obtain an access token; the token is
kept in your browser's localStorage and the server stores nothing. Then the
**＋ Seedr** button on any movie card sends that magnet to your account.

## 🛡️ Enable 1337x (Cloudflare bypass via FlareSolverr)

1337x sits behind Cloudflare's "Just a moment…" challenge, which plain scrapers
can't pass. To include 1337x results, run a [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)
container (a headless-browser solver) and point the app at it.

**With the provided Compose files it's automatic** — they already include a
`flaresolverr` service and set `FLARESOLVERR_URL=http://flaresolverr:8191`. Just
`docker compose up -d` and 1337x results appear under "More from other sources".

**Standalone / CasaOS custom app:** run FlareSolverr separately and set the env
var on the TorrentFlix container:

```bash
docker run -d --name flaresolverr -p 8191:8191 --restart unless-stopped \
  ghcr.io/flaresolverr/flaresolverr:v3.3.21
# then on the app:  FLARESOLVERR_URL=http://<host-ip>:8191
```

Notes:
- FlareSolverr uses a headless browser (~250 MB RAM); the **first** search is
  slow (it solves the challenge) then it speeds up. Fine on an arm64 Orange Pi.
- The image is pinned to **v3.3.21** — newer `v3.3.24` has an ARM Chrome-startup
  bug. If you're on amd64 you can use `:latest` freely.
- Without it, the app still works — you just won't get 1337x results (YTS and
  the other scrapers are unaffected).

## 🐳 Run from Docker Hub

A prebuilt multi-arch image (amd64 + arm64) is published to
[`siyamexcom/torrent-movies`](https://hub.docker.com/r/siyamexcom/torrent-movies)
by GitHub Actions on every push to `main`. No build needed:

```bash
docker run -d --name torrentflix -p 3000:3000 \
  -e TMDB_API_KEY=your_key_optional \
  siyamexcom/torrent-movies:latest
```

…or with Compose:

```bash
docker compose -f docker-compose.hub.yml up -d
```

Then open `http://localhost:3000` (or `http://<device-ip>:3000`).

## 🍊 Deploy on Orange Pi / Raspberry Pi (CasaOS) with Docker

CasaOS is built on Docker, so the cleanest way to self-host is a container.
You can pull the prebuilt image above, or build it **on the device itself**
(native ARM) — just never copy a host `node_modules` into the image.

```bash
# 1. Copy the project to the device (or git clone it), then SSH in:
cd ~/Torrent-Movie-Search

# 2. (optional) add a TMDB key for nicer posters
cp .env.example .env && nano .env

# 3. Build & run — CasaOS already ships Docker
docker compose up -d --build

# 4. Watch the logs
docker compose logs -f
```

Open `http://<device-ip>:3000`. The container also appears in the CasaOS
dashboard automatically; for a managed tile use **CasaOS → + → Install a
customized app** with image `torrentflix:latest`, port `3000`, and the optional
`TMDB_API_KEY` env var.

> **Tip:** YTS's main domain is DNS-blocked by some ISPs. The app already tries
> mirrors (`yts.mx → yts.am → yts.lt → yts.rs`); override with `YTS_HOSTS` in
> `.env` if needed.

## How it works

| Piece | Where | Notes |
|-------|-------|-------|
| Torrent search | `server.js` → `/api/search` | Scraping must run server-side; results cached in memory so magnets can be resolved lazily |
| YTS + 1337x search | `/api/search` | Merges YTS API results with `torrent-search-api` scrapers and (if `FLARESOLVERR_URL` is set) 1337x via FlareSolverr |
| Browse tags | `/api/browse` | Calls the keyless YTS API (with mirror fallback); returns posters, ratings, per-quality torrents with magnets built from the hash |
| 1337x scraper | `flaresolverr.js` | Routes 1337x search + detail pages through FlareSolverr to clear Cloudflare, parses with cheerio |
| Magnet resolve | `/api/magnet/:id` | Search results: some providers include the magnet inline, others are fetched on demand via `getMagnet()`. Browse cards carry the magnet inline. |
| Posters | `fetchPoster()` | Cleans the release title, tries TMDB then iTunes, caches results |
| Seedr login | `/api/seedr/login` | `POST token.php` with `client_id=seedr_chrome` |
| Seedr add | `/api/seedr/add` | `POST resource.php` with `func=add_torrent` |

## Notes & caveats

- `torrent-search-api` scrapes public sites; individual providers break upstream
  from time to time. If one returns nothing, others still work.
- This is for **personal/educational use**. Only download content you are
  legally entitled to.
