# 🎬 TorrentFlix — Torrent Movie Search

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

## How it works

| Piece | Where | Notes |
|-------|-------|-------|
| Torrent search | `server.js` → `/api/search` | Scraping must run server-side; results cached in memory so magnets can be resolved lazily |
| Browse tags | `/api/browse` | Calls the keyless YTS API (with mirror fallback); returns posters, ratings, per-quality torrents with magnets built from the hash |
| Magnet resolve | `/api/magnet/:id` | Search results: some providers include the magnet inline, others are fetched on demand via `getMagnet()`. Browse cards carry the magnet inline. |
| Posters | `fetchPoster()` | Cleans the release title, tries TMDB then iTunes, caches results |
| Seedr login | `/api/seedr/login` | `POST token.php` with `client_id=seedr_chrome` |
| Seedr add | `/api/seedr/add` | `POST resource.php` with `func=add_torrent` |

## Notes & caveats

- `torrent-search-api` scrapes public sites; individual providers break upstream
  from time to time. If one returns nothing, others still work.
- This is for **personal/educational use**. Only download content you are
  legally entitled to.
