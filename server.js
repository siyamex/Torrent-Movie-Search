require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const TorrentSearchApi = require('torrent-search-api');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Some torrent providers occasionally throw from deep async code. Keep the
// server alive instead of letting one bad provider crash the whole process.
process.on('unhandledRejection', (reason) => {
  console.warn('Unhandled rejection (ignored):', reason && reason.message ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.warn('Uncaught exception (ignored):', err && err.message ? err.message : err);
});

const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

// --- Enable torrent providers (public, no auth) -----------------------------
// These are the more reliable scrapers. If one breaks upstream it is skipped
// at search time rather than crashing the whole request.
const PROVIDERS = ['Yts', '1337x', 'ThePirateBay', 'Limetorrents', 'Eztv'];
for (const p of PROVIDERS) {
  try {
    TorrentSearchApi.enableProvider(p);
  } catch (err) {
    console.warn(`Could not enable provider ${p}: ${err.message}`);
  }
}

// In-memory cache of search results so the /api/magnet endpoint can lazily
// resolve a magnet for a result the client picked. Entries expire after 1h.
const torrentCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

function cacheTorrent(torrent) {
  const id = crypto.randomBytes(8).toString('hex');
  torrentCache.set(id, { torrent, expires: Date.now() + CACHE_TTL });
  return id;
}

// periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of torrentCache) {
    if (entry.expires < now) torrentCache.delete(id);
  }
}, CACHE_TTL).unref();

// --- TMDB poster lookup -----------------------------------------------------
const posterCache = new Map();

// Strip release tags from a torrent title to get a clean movie title + year.
function parseTitle(raw) {
  if (!raw) return { title: '', year: '' };
  let s = raw.replace(/[._]/g, ' ');
  const yearMatch = s.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : '';
  // cut everything from the year or the first quality/codec tag onward
  s = s.split(/\b(19|20)\d{2}\b/)[0];
  s = s.split(/\b(720p|1080p|2160p|480p|4k|x264|x265|h264|h265|hevc|bluray|brrip|web-?dl|webrip|hdrip|dvdrip|cam|hdcam)\b/i)[0];
  s = s.replace(/[\[\(].*?[\]\)]/g, ' ').replace(/\s+/g, ' ').trim();
  return { title: s, year };
}

async function tmdbPoster(title, year) {
  if (!TMDB_API_KEY) return null;
  try {
    const url = new URL('https://api.themoviedb.org/3/search/movie');
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('query', title);
    if (year) url.searchParams.set('year', year);
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data.results && data.results.find((r) => r.poster_path);
    return hit ? TMDB_IMG + hit.poster_path : null;
  } catch {
    return null;
  }
}

// Keyless fallback: Apple's iTunes Search API returns movie artwork with no key.
async function itunesPoster(title) {
  try {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', title);
    // The movie-only media/entity filter returns nothing in some storefronts,
    // so search broadly and prefer an actual movie among the top results.
    url.searchParams.set('limit', '5');
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    const pick = results.find((r) => r.kind === 'feature-movie' && r.artworkUrl100)
      || results.find((r) => r.artworkUrl100);
    // upscale the thumbnail to a poster-sized image
    return pick ? pick.artworkUrl100.replace('100x100bb', '600x600bb') : null;
  } catch {
    return null;
  }
}

// Try TMDB first (best art), then fall back to the keyless iTunes source so
// posters still appear when no TMDB key is configured.
async function fetchPoster(rawTitle) {
  const { title, year } = parseTitle(rawTitle);
  if (!title) return null;

  const key = `${title}|${year}`.toLowerCase();
  if (posterCache.has(key)) return posterCache.get(key);

  let poster = await tmdbPoster(title, year);
  if (!poster) poster = await itunesPoster(title);
  posterCache.set(key, poster);
  return poster;
}

function toNumber(v) {
  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

// Reject if a promise (e.g. a hung scraper) takes too long, so a single slow
// provider can't make a request hang forever.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

// --- Routes -----------------------------------------------------------------
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = req.query.category || 'All';
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
  if (!q) return res.status(400).json({ error: 'Missing search query' });

  try {
    let results = await withTimeout(
      TorrentSearchApi.search(q, category, limit), 25000, 'Search');
    results = (results || []).filter((t) => t && t.title);

    // sort by seeders desc
    results.sort((a, b) => toNumber(b.seeds) - toNumber(a.seeds));

    const enriched = await Promise.all(
      results.map(async (t) => ({
        id: cacheTorrent(t),
        title: t.title,
        provider: t.provider || '',
        size: t.size || '',
        seeds: toNumber(t.seeds),
        peers: toNumber(t.peers),
        time: t.time || '',
        desc: t.desc || '',
        // magnet may already be present on some providers (e.g. YTS)
        magnet: typeof t.magnet === 'string' ? t.magnet : null,
        poster: await fetchPoster(t.title),
      }))
    );

    res.json({ count: enriched.length, results: enriched });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
});

// Lazily resolve a magnet link for a cached search result.
app.get('/api/magnet/:id', async (req, res) => {
  const entry = torrentCache.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Result expired, search again' });
  try {
    if (typeof entry.torrent.magnet === 'string' && entry.torrent.magnet) {
      return res.json({ magnet: entry.torrent.magnet });
    }
    const magnet = await TorrentSearchApi.getMagnet(entry.torrent);
    if (!magnet) return res.status(404).json({ error: 'No magnet available for this result' });
    res.json({ magnet });
  } catch (err) {
    res.status(500).json({ error: 'Could not get magnet: ' + err.message });
  }
});

// --- Browse / tags via the keyless YTS API ----------------------------------
// YTS returns movies with posters, ratings, seeders and torrent hashes, so we
// can power "Most Seeded", genre and quality tags with zero configuration.
const YTS_TRACKERS = [
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.coppersurfer.tk:6969',
  'udp://glotorrents.pw:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://torrent.gresille.org:80/announce',
  'udp://p4p.arenabg.com:1337',
  'udp://tracker.leechers-paradise.org:6969',
];

function ytsMagnet(hash, name) {
  const tr = YTS_TRACKERS.map((t) => '&tr=' + encodeURIComponent(t)).join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${tr}`;
}

const ALLOWED_SORTS = ['seeds', 'peers', 'download_count', 'like_count', 'rating', 'year', 'date_added'];

// YTS's main domain is DNS-blocked by many ISPs, so try a list of mirrors.
// Override or reorder with the YTS_HOSTS env var (comma-separated).
const YTS_HOSTS = (process.env.YTS_HOSTS || 'yts.mx,yts.am,yts.lt,yts.rs')
  .split(',').map((h) => h.trim()).filter(Boolean);

// Fetch a YTS API path, trying each mirror until one returns valid JSON.
async function ytsFetch(query) {
  let lastErr;
  for (const host of YTS_HOSTS) {
    try {
      const r = await fetch(`https://${host}/api/v2/list_movies.json?${query}`, {
        signal: AbortSignal.timeout(9000),
        headers: { accept: 'application/json' },
      });
      if (!r.ok) { lastErr = new Error(`${host} returned ${r.status}`); continue; }
      const data = await r.json(); // throws if the mirror served an HTML page
      if (data && data.status === 'ok') return data;
      lastErr = new Error(`${host} returned an unexpected payload`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All YTS mirrors failed');
}

app.get('/api/browse', async (req, res) => {
  const sort = ALLOWED_SORTS.includes(req.query.sort) ? req.query.sort : 'download_count';
  const genre = (req.query.genre || '').trim();
  const quality = (req.query.quality || '').trim();
  const minRating = req.query.minRating || '0';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  try {
    // YTS's own sort_by=seeds is unreliable (the list endpoint reports live
    // seeders inconsistently). For "Most Seeded" we pull the popular pool and
    // re-sort by actual seeders below.
    const ytsSort = sort === 'seeds' ? 'download_count' : sort;
    const params = new URLSearchParams({
      sort_by: ytsSort,
      order_by: 'desc',
      limit: '30',
      page: String(page),
    });
    if (genre) params.set('genre', genre);
    if (quality) params.set('quality', quality);
    if (minRating !== '0') params.set('minimum_rating', minRating);

    const data = await ytsFetch(params.toString());
    const movies = (data.data && data.data.movies) || [];

    const results = movies.map((m) => ({
      title: m.title_long || m.title,
      year: m.year,
      rating: m.rating,
      genres: m.genres || [],
      poster: m.medium_cover_image || m.large_cover_image || null,
      backdrop: m.large_cover_image || m.medium_cover_image || null,
      summary: m.summary || '',
      // one entry per available quality, each with a ready-to-use magnet
      torrents: (m.torrents || []).map((t) => ({
        quality: `${t.quality}${t.type ? ' ' + t.type : ''}`,
        seeds: t.seeds || 0,
        peers: t.peers || 0,
        size: t.size || '',
        magnet: ytsMagnet(t.hash, m.title_long || m.title),
      })),
    })).filter((m) => m.torrents.length);

    if (sort === 'seeds') {
      const maxSeeds = (m) => Math.max(0, ...m.torrents.map((t) => t.seeds));
      results.sort((a, b) => maxSeeds(b) - maxSeeds(a));
    }

    res.json({ count: results.length, page, results });
  } catch (err) {
    console.error('Browse error:', err.message);
    res.status(500).json({ error: 'Browse failed: ' + err.message });
  }
});

// --- Seedr.cc integration ---------------------------------------------------
// Uses Seedr's "chrome" OAuth API: log in with email/password to get a token,
// then call resource.php with func=add_torrent.
const SEEDR_TOKEN_URL = 'https://www.seedr.cc/oauth_test/token.php';
const SEEDR_RESOURCE_URL = 'https://www.seedr.cc/oauth_test/resource.php';

app.post('/api/seedr/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: 'seedr_chrome',
      type: 'login',
      username: email,
      password,
    });
    const r = await fetch(SEEDR_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json().catch(() => ({}));
    if (!data.access_token) {
      return res.status(401).json({ error: data.error_description || data.error || 'Login failed' });
    }
    res.json({ token: data.access_token });
  } catch (err) {
    res.status(500).json({ error: 'Seedr login failed: ' + err.message });
  }
});

app.post('/api/seedr/add', async (req, res) => {
  const { token, magnet } = req.body || {};
  if (!token || !magnet) return res.status(400).json({ error: 'Token and magnet required' });
  try {
    const body = new URLSearchParams({
      access_token: token,
      func: 'add_torrent',
      torrent_magnet: magnet,
    });
    const r = await fetch(SEEDR_RESOURCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json().catch(() => ({}));
    if (data.result === true || data.result === 'success' || data.code === 200) {
      return res.json({ ok: true, title: data.title || 'Added', detail: data });
    }
    res.status(400).json({ error: data.error || data.result || 'Seedr rejected the magnet', detail: data });
  } catch (err) {
    res.status(500).json({ error: 'Seedr add failed: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Torrent Movie Search running at http://localhost:${PORT}`);
  console.log(`  Providers: ${PROVIDERS.join(', ')}`);
  console.log(`  TMDB posters: ${TMDB_API_KEY ? 'enabled' : 'DISABLED (set TMDB_API_KEY in .env)'}\n`);
});
