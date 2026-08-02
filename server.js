const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const packageJson = require('./package.json');
const { BoundedCache } = require('./lib/bounded-cache');
const { EpgService } = require('./lib/epg-service');
const validation = require('./lib/validation');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const STARTED_AT = new Date();
const TMDB_TOKEN = String(process.env.TMDB_BEARER_TOKEN || '').trim();
const TMDB_BASE = 'https://api.themoviedb.org/3';
const LIVE_FEED = 'https://hesgoaler.com/madra.json';
let liveCache = { expires: 0, channels: [] };
const epgService = new EpgService();
const vidzyAvailabilityCache = new BoundedCache({ maxEntries: 2000, ttlMs: 10 * 60 * 1000 });
const tmdbCache = new BoundedCache({ maxEntries: 1200, ttlMs: 10 * 60 * 1000 });
const tmdbPending = new Map();
const vidzyWaiters = [];
let vidzyActiveChecks = 0;
const VIDZY_MAX_CONCURRENT = 6;
const API_RATE_WINDOW_MS = 60 * 1000;
const API_RATE_LIMIT = 180;
const rateBuckets = new Map();

function routeError(error, fallback = 'Impossible de charger le contenu.') {
  const status = Number(error?.status) || 502;
  if (status === 404) return { status: 404, message: 'Contenu introuvable.' };
  if (status === 401 || status === 403) return { status: 502, message: 'La source a refusé la requête.' };
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return { status: 504, message: 'La source ne répond pas. Réessayez dans un instant.' };
  }
  return { status: status >= 400 && status < 500 ? status : 502, message: fallback };
}

function sendRouteError(res, error, fallback) {
  const safe = routeError(error, fallback);
  return res.status(safe.status).json({ error: safe.message });
}

function pruneMap(map, maxSize) {
  if (map.size <= maxSize) return;
  const overflow = map.size - maxSize;
  [...map.keys()].slice(0, overflow).forEach(key => map.delete(key));
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https://image.tmdb.org', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ['https://vidzy.org', 'https://hesgoaler.com', 'https://www.youtube-nocookie.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});
app.use(compression());
app.use(express.json({ limit: '32kb' }));
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + API_RATE_WINDOW_MS };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  pruneMap(rateBuckets, 5000);
  res.setHeader('RateLimit-Limit', String(API_RATE_LIMIT));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, API_RATE_LIMIT - bucket.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > API_RATE_LIMIT) return res.status(429).json({ ok: false, error: 'Trop de requêtes. Réessaie dans un instant.' });
  next();
});
app.use('/api', (_req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = payload => {
    if (payload && typeof payload === 'object' && typeof payload.ok === 'boolean') return sendJson(payload);
    if (res.statusCode >= 400 || payload?.error) {
      return sendJson({ ok: false, error: String(payload?.error || 'Une erreur est survenue.') });
    }
    return sendJson({ ok: true, data: payload ?? null });
  };
  next();
});
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' || req.path === '/health' || req.path === '/config') {
    res.setHeader('Cache-Control', 'no-store');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

async function tmdbRequest(endpoint, query = {}) {
  if (!TMDB_TOKEN) {
    const error = new Error('TMDB_BEARER_TOKEN manquant dans les variables d’environnement.');
    error.status = 503;
    throw error;
  }
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const cacheKey = url.toString();
  const cached = tmdbCache.get(cacheKey);
  if (cached) return cached;
  if (tmdbPending.has(cacheKey)) return tmdbPending.get(cacheKey);
  const request = (async () => {
    const response = await fetch(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${TMDB_TOKEN}` },
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.status_message || `Erreur TMDB ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const ttl = endpoint.includes('/trending/') ? 5 * 60 * 1000 : 15 * 60 * 1000;
    tmdbCache.set(cacheKey, data, ttl);
    return data;
  })();
  tmdbPending.set(cacheKey, request);
  try { return await request; }
  finally { tmdbPending.delete(cacheKey); }
}

async function acquireVidzySlot() {
  if (vidzyActiveChecks < VIDZY_MAX_CONCURRENT) {
    vidzyActiveChecks += 1;
    return;
  }
  await new Promise(resolve => vidzyWaiters.push(resolve));
  vidzyActiveChecks += 1;
}

function releaseVidzySlot() {
  vidzyActiveChecks = Math.max(0, vidzyActiveChecks - 1);
  const next = vidzyWaiters.shift();
  if (next) next();
}

async function getVidzyAvailability(tmdbId) {
  const key = String(tmdbId);
  const cached = vidzyAvailabilityCache.get(key);
  if (cached) return cached;
  await acquireVidzySlot();
  try {
    const response = await fetch(`https://vidzy.org/api/${key}`, {
      headers: { accept: 'application/json', 'user-agent': 'VidzyCatalogue/2.0' },
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json().catch(() => ({}));
    const result = {
      available: response.ok && data.available === true,
      languages: Array.isArray(data.languages) ? data.languages : [],
      checkedAt: Date.now()
    };
    vidzyAvailabilityCache.set(key, result, (data.available === true ? 60 : 10) * 60 * 1000);
    return result;
  } catch {
    const result = { available: false, languages: [], checkedAt: Date.now() };
    vidzyAvailabilityCache.set(key, result, 2 * 60 * 1000);
    return result;
  } finally {
    releaseVidzySlot();
  }
}

async function keepVidzyCompatible(items, enabled = true) {
  if (!enabled) return items;
  const checks = await Promise.all(items.map(async item => ({
    item,
    availability: await getVidzyAvailability(item.id)
  })));
  return checks
    .filter(entry => entry.availability.available)
    .map(entry => ({ ...entry.item, vidzyLanguages: entry.availability.languages }));
}

function normalizeItem(item, type) {
  return {
    id: item.id,
    type,
    title: type === 'movie' ? item.title : item.name,
    originalTitle: type === 'movie' ? item.original_title : item.original_name,
    date: type === 'movie' ? item.release_date : item.first_air_date,
    year: String(type === 'movie' ? (item.release_date || '') : (item.first_air_date || '')).slice(0, 4),
    poster: tmdbImageUrl('w500', item.poster_path),
    backdrop: tmdbImageUrl('w1280', item.backdrop_path),
    rating: Number(item.vote_average || 0),
    votes: Number(item.vote_count || 0),
    overview: item.overview || '',
    genreIds: item.genre_ids || [],
    popularity: Number(item.popularity || 0)
  };
}

function tmdbImageUrl(size, imagePath) {
  const filename = path.posix.basename(String(imagePath || ''));
  return filename ? `/api/image/${size}/${encodeURIComponent(filename)}` : '';
}

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  data: {
    app: 'vidzy',
    version: packageJson.version,
    status: 'operational',
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    tmdbConfigured: Boolean(TMDB_TOKEN)
  }
}));
app.get('/api/config', (_req, res) => res.json({ tmdbConfigured: Boolean(TMDB_TOKEN) }));

app.get('/api/image/:size/:filename', async (req, res) => {
  const allowedSizes = new Set(['w300', 'w500', 'w1280', 'h632', 'original']);
  const { size, filename } = req.params;
  if (!allowedSizes.has(size) || !/^[a-zA-Z0-9._-]{3,160}$/.test(filename)) {
    return res.status(400).json({ error: 'Image TMDB invalide.' });
  }
  try {
    const upstream = await fetch(`https://image.tmdb.org/t/p/${size}/${encodeURIComponent(filename)}`, {
      headers: { accept: 'image/avif,image/webp,image/jpeg,image/*' },
      signal: AbortSignal.timeout(15000)
    });
    if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).end();
    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return res.status(502).end();
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return res.status(502).end();
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    res.send(bytes);
  } catch {
    res.status(502).end();
  }
});

async function loadDirectChannels() {
  try {
    if (Date.now() < liveCache.expires && liveCache.channels.length) {
      return { channels: liveCache.channels, cached: true };
    }
    const response = await fetch(LIVE_FEED, {
      headers: { accept: 'application/json', 'user-agent': 'VidzyLive/1.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Flux direct indisponible (${response.status}).`);
    const source = await response.json();
    const parsedChannels = (Array.isArray(source) ? source : []).flatMap((item) => {
      try {
        const streamUrl = new URL(String(item.url || ''));
        const channelId = streamUrl.hostname === 'hesgoaler.com' && streamUrl.pathname === '/madra.php'
          ? streamUrl.searchParams.get('ch') : '';
        if (!channelId || !/^[a-zA-Z0-9_-]{1,80}$/.test(channelId)) return [];
        const image = String(item.image || '');
        return [{
          id: channelId,
          name: String(item.channel_name || channelId).trim().slice(0, 100),
          image: /^https?:\/\//i.test(image) ? image : '',
          logo: /^https?:\/\//i.test(image) ? image : '',
          country: String(item.country || 'International').trim().slice(0, 60),
          category: String(item.category || 'General').trim().slice(0, 40),
          language: String(item.language || '').trim().slice(0, 30),
          sources: [`https://hesgoaler.com/madra.php?ch=${encodeURIComponent(channelId)}`]
        }];
      } catch { return []; }
    });
    const channels = [...new Map(parsedChannels.map(channel => [channel.id, channel])).values()];
    if (!channels.length) throw new Error('La source Direct ne contient aucune chaîne valide.');
    liveCache = { expires: Date.now() + 5 * 60 * 1000, channels };
    return { channels, cached: false };
  } catch (error) {
    console.warn('[direct]', error.message);
    if (liveCache.channels.length) return { channels: liveCache.channels, cached: true, stale: true };
    throw error;
  }
}

async function directRoute(_req, res) {
  try {
    res.json(await loadDirectChannels());
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger les chaînes en direct.');
  }
}

app.get('/api/live', directRoute);
app.get('/api/direct/channels', directRoute);

function serializeProgram(program, now = Date.now()) {
  if (!program) return null;
  const start = program.start instanceof Date ? program.start : new Date(program.start);
  const end = program.end instanceof Date ? program.end : new Date(program.end);
  const current = start.getTime() <= now && end.getTime() > now;
  return {
    title: program.title,
    description: program.description || '',
    category: program.category || '',
    start: start.toISOString(),
    end: end.toISOString(),
    current,
    progress: current ? Math.max(0, Math.min(100, Math.round(((now - start.getTime()) / (end.getTime() - start.getTime())) * 100))) : 0
  };
}

function serializeGuide(guide) {
  const now = Date.now();
  return { ...guide, programs: guide.programs.map(program => serializeProgram(program, now)) };
}

app.get('/api/epg', async (req, res) => {
  const requested = String(req.query.channel || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!requested || requested.length > 100) return res.status(400).json({ error: 'Nom de chaîne invalide.' });
  try {
    const guide = await epgService.guide(requested, 36);
    if (!guide) return res.status(404).json({ error: 'Programme indisponible pour cette chaîne.' });
    res.json(serializeGuide(guide));
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger le programme TV.');
  }
});

app.get('/api/epg/status', (_req, res) => res.json(epgService.status()));

app.get('/api/epg/channels', async (_req, res) => {
  try {
    res.json(await epgService.channelList());
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger les chaînes du guide TV.');
  }
});

app.get('/api/epg/now', async (_req, res) => {
  try {
    const direct = await loadDirectChannels();
    res.json(await epgService.overview(direct.channels.map(channel => channel.name)));
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger les programmes en cours.');
  }
});

app.get('/api/epg/channel/:id', async (req, res) => {
  const id = String(req.params.id || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!id || id.length > 160) return res.status(400).json({ error: 'Identifiant EPG invalide.' });
  try {
    const guide = await epgService.guideById(id, 36);
    if (!guide) return res.status(404).json({ error: 'Programme indisponible pour cette chaîne.' });
    res.json(serializeGuide(guide));
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger le programme TV.');
  }
});

app.post('/api/epg/refresh', async (_req, res) => {
  try {
    await epgService.refresh(true);
    res.json(epgService.status());
  } catch (error) {
    sendRouteError(res, error, 'Impossible d’actualiser le guide TV.');
  }
});

app.get('/api/epg-overview', async (_req, res) => {
  try {
    const overview = await epgService.overview(liveCache.channels.map(channel => channel.name));
    const now = Date.now();
    const channels = Object.fromEntries(Object.entries(overview.channels).map(([name, entry]) => [name, {
      ...entry,
      current: entry.current ? {
        title: entry.current.title, start: entry.current.start, end: entry.current.end,
        progress: Math.max(0, Math.min(100, Math.round(((now - entry.current.start) / (entry.current.end - entry.current.start)) * 100)))
      } : null,
      next: entry.next ? { title: entry.next.title, start: entry.next.start, end: entry.next.end } : null
    }]));
    res.json({ ...overview, channels });
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger le résumé du guide TV.');
  }
});

app.get('/api/catalog/:type', async (req, res) => {
  const type = validation.mediaType(req.params.type);
  const page = validation.page(req.query.page);
  const genre = validation.genre(req.query.genre);
  const year = validation.year(req.query.year);
  if (!type) return res.status(400).json({ error: 'Type de catalogue invalide.' });
  if (page === null) return res.status(400).json({ error: 'Page invalide.' });
  if (genre === null) return res.status(400).json({ error: 'Genre invalide.' });
  if (year === null) return res.status(400).json({ error: 'Année invalide.' });
  const sort = ['popularity.desc', 'vote_average.desc', 'primary_release_date.desc', 'first_air_date.desc'].includes(req.query.sort)
    ? req.query.sort
    : 'popularity.desc';
  try {
    const query = {
      language: 'fr-FR', page, include_adult: false, sort_by: sort,
      'vote_count.gte': sort === 'vote_average.desc' ? 200 : undefined,
      with_genres: genre || undefined,
      [`${type === 'movie' ? 'primary_release_year' : 'first_air_date_year'}`]: year || undefined
    };
    const data = await tmdbRequest(`/discover/${type}`, query);
    const normalized = (data.results || []).map(item => normalizeItem(item, type === 'movie' ? 'movie' : 'serie'));
    const results = await keepVidzyCompatible(normalized, type === 'movie');
    res.json({
      page: data.page,
      totalPages: Math.min(500, data.total_pages || 1),
      totalResults: data.total_results || 0,
      compatibleCount: results.length,
      availabilityFiltered: type === 'movie',
      results
    });
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger le catalogue.');
  }
});

app.get('/api/trending', async (_req, res) => {
  try {
    const data = await tmdbRequest('/trending/all/day', { language: 'fr-FR' });
    const normalized = (data.results || [])
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .map(item => normalizeItem(item, item.media_type === 'movie' ? 'movie' : 'serie'));
    const checked = await Promise.all(normalized.map(async item => {
      if (item.type !== 'movie') return item;
      const [compatible] = await keepVidzyCompatible([item], true);
      return compatible || null;
    }));
    res.json({ results: checked.filter(Boolean).slice(0, 20) });
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger les tendances.');
  }
});

app.get('/api/search', async (req, res) => {
  const query = validation.searchQuery(req.query.q);
  const page = validation.page(req.query.page);
  const requestedType = validation.mediaType(req.query.type);
  if (!query) return res.status(400).json({ error: 'La recherche doit contenir entre 2 et 100 caractères.' });
  if (page === null) return res.status(400).json({ error: 'Page invalide.' });
  if (!requestedType) return res.status(400).json({ error: 'Type de recherche invalide.' });
  try {
    const data = await tmdbRequest(`/search/${requestedType}`, { query, language: 'fr-FR', page, include_adult: false });
    const normalizedType = requestedType === 'movie' ? 'movie' : 'serie';
    const normalized = (data.results || []).map(item => normalizeItem(item, normalizedType));
    const results = await keepVidzyCompatible(normalized, requestedType === 'movie');
    res.json({
      page: data.page,
      totalPages: Math.min(500, data.total_pages || 1),
      totalResults: data.total_results || 0,
      compatibleCount: results.length,
      availabilityFiltered: requestedType === 'movie',
      results
    });
  } catch (error) {
    sendRouteError(res, error, 'Impossible d’effectuer la recherche.');
  }
});

app.get('/api/search-all', async (req, res) => {
  const query = validation.searchQuery(req.query.q);
  if (!query) return res.status(400).json({ error: 'La recherche doit contenir entre 2 et 100 caractères.' });
  try {
    const data = await tmdbRequest('/search/multi', {
      query, language: 'fr-FR', page: 1, include_adult: false
    });
    const people = (data.results || [])
      .filter(item => item.media_type === 'person')
      .slice(0, 6)
      .map(person => ({
        id: person.id,
        name: person.name || 'Artiste',
        department: person.known_for_department || '',
        profile: tmdbImageUrl('w300', person.profile_path)
      }));
    const expanded = (data.results || []).flatMap(item =>
      item.media_type === 'person' ? (item.known_for || []) : [item]);
    const seen = new Set();
    const candidates = expanded
      .filter(item => {
        if (item.media_type !== 'movie' && item.media_type !== 'tv') return false;
        const key = `${item.media_type}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 24)
      .map(item => normalizeItem(item, item.media_type === 'movie' ? 'movie' : 'serie'));
    const checked = await Promise.all(candidates.map(async item => {
      if (item.type !== 'movie') return item;
      const [compatible] = await keepVidzyCompatible([item], true);
      return compatible || null;
    }));
    res.json({ people, results: checked.filter(Boolean).slice(0, 18) });
  } catch (error) {
    sendRouteError(res, error, 'Impossible d’effectuer la recherche.');
  }
});

app.get('/api/person/:id', async (req, res) => {
  const id = validation.tmdbId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de personne invalide.' });
  try {
    const person = await tmdbRequest(`/person/${id}`, {
      language: 'fr-FR',
      append_to_response: 'combined_credits,external_ids'
    });
    const seen = new Set();
    const credits = (person.combined_credits?.cast || [])
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .filter(item => {
        const key = `${item.media_type}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(item => ({
        ...normalizeItem(item, item.media_type === 'movie' ? 'movie' : 'serie'),
        character: item.character || '',
        episodeCount: Number(item.episode_count || 0)
      }))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    res.json({
      id: person.id,
      name: person.name,
      biography: person.biography || '',
      birthday: person.birthday || '',
      deathday: person.deathday || '',
      placeOfBirth: person.place_of_birth || '',
      department: person.known_for_department || '',
      profile: tmdbImageUrl('h632', person.profile_path),
      homepage: person.homepage || '',
      imdbId: person.external_ids?.imdb_id || '',
      credits
    });
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger cette personne.');
  }
});

app.get('/api/genres/:type', async (req, res) => {
  const type = validation.mediaType(req.params.type);
  if (!type) return res.status(400).json({ error: 'Type de catalogue invalide.' });
  try {
    const data = await tmdbRequest(`/genre/${type}/list`, { language: 'fr-FR' });
    res.json(data);
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger les genres.');
  }
});

app.get('/api/details/:type/:id', async (req, res) => {
  const type = validation.mediaType(req.params.type);
  const id = validation.tmdbId(req.params.id);
  if (!type || id === null) return res.status(400).json({ error: 'Type ou ID TMDB invalide.' });
  try {
    const data = await tmdbRequest(`/${type}/${id}`, {
      language: 'fr-FR',
      append_to_response: 'credits,recommendations,similar,release_dates,content_ratings'
    });
    const normalizedRecommendations = (data.recommendations?.results || []).map(item =>
      normalizeItem(item, type === 'movie' ? 'movie' : 'serie'));
    const compatibleRecommendations = await keepVidzyCompatible(normalizedRecommendations, type === 'movie');
    data.recommendations = {
      ...(data.recommendations || {}),
      results: compatibleRecommendations
    };
    const normalizedSimilar = (data.similar?.results || []).map(item =>
      normalizeItem(item, type === 'movie' ? 'movie' : 'serie'));
    data.similar = {
      ...(data.similar || {}),
      results: await keepVidzyCompatible(normalizedSimilar, type === 'movie')
    };
    res.json(data);
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger ce contenu.');
  }
});

app.get('/api/season/:id/:season', async (req, res) => {
  const id = validation.tmdbId(req.params.id);
  const season = validation.positiveInteger(req.params.season, { min: 0, max: 100 });
  if (id === null || season === null) {
    return res.status(400).json({ error: 'Saison invalide.' });
  }
  try {
    const data = await tmdbRequest(`/tv/${id}/season/${season}`, { language: 'fr-FR' });
    res.json({
      id: data.id,
      name: data.name || `Saison ${season}`,
      seasonNumber: data.season_number,
      overview: data.overview || '',
      episodes: (data.episodes || []).map(episode => ({
        id: episode.id,
        number: episode.episode_number,
        name: episode.name || `Épisode ${episode.episode_number}`,
        overview: episode.overview || '',
        runtime: episode.runtime || 0,
        airDate: episode.air_date || '',
        rating: Number(episode.vote_average || 0),
        image: tmdbImageUrl('w500', episode.still_path)
      }))
    });
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger cette saison.');
  }
});

app.get('/api/recommendations/:type/:id', async (req, res) => {
  const type = validation.mediaType(req.params.type);
  const id = validation.tmdbId(req.params.id);
  if (!type || id === null) return res.status(400).json({ error: 'Type ou ID TMDB invalide.' });
  try {
    const data = await tmdbRequest(`/${type}/${id}/recommendations`, { language: 'fr-FR', page: 1 });
    const normalized = (data.results || []).map(item =>
      normalizeItem(item, type === 'movie' ? 'movie' : 'serie'));
    const results = await keepVidzyCompatible(normalized, type === 'movie');
    res.json({ results });
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger les recommandations.');
  }
});

app.get('/api/videos/:type/:id', async (req, res) => {
  const type = validation.mediaType(req.params.type);
  const id = validation.tmdbId(req.params.id);
  if (!type || id === null) return res.status(400).json({ error: 'Type ou ID TMDB invalide.' });
  try {
    const french = await tmdbRequest(`/${type}/${id}/videos`, { language: 'fr-FR' });
    let videos = french.results || [];
    if (!videos.some(video => video.site === 'YouTube' && video.type === 'Trailer')) {
      const original = await tmdbRequest(`/${type}/${id}/videos`, { language: 'en-US' });
      videos = [...videos, ...(original.results || [])];
    }
    const trailer = videos.find(video => video.site === 'YouTube' && video.type === 'Trailer' && video.official)
      || videos.find(video => video.site === 'YouTube' && video.type === 'Trailer')
      || videos.find(video => video.site === 'YouTube' && video.type === 'Teaser');
    res.json(trailer ? {
      available: true,
      key: trailer.key,
      name: trailer.name,
      language: trailer.iso_639_1 || ''
    } : { available: false });
  } catch (error) {
    sendRouteError(res, error, 'Impossible de charger la bande-annonce.');
  }
});

app.get('/api/vidzy/:tmdbId', async (req, res) => {
  const tmdbId = validation.tmdbId(req.params.tmdbId);
  if (tmdbId === null) return res.status(400).json({ error: 'Identifiant TMDB invalide.' });
  const availability = await getVidzyAvailability(tmdbId);
  res.json({ available: availability.available, languages: availability.languages });
});

app.get('/player.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Route API introuvable.' }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/offline.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'offline.html')));
app.get('*', (_req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));
app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error('[server]', error.message);
  const message = status === 413
    ? 'La requête est trop volumineuse.'
    : status === 400 && error.type === 'entity.parse.failed'
      ? 'Le contenu de la requête est invalide.'
      : process.env.NODE_ENV === 'production' ? 'Erreur interne du serveur.' : error.message;
  res.status(status).json({ ok: false, error: message });
});

function startServer(port = PORT, host = '0.0.0.0') {
  const server = app.listen(port, host, () => {
    console.log(`Catalogue Vidzy lancé sur ${host}:${port}`);
    if (!TMDB_TOKEN) console.warn('[config] TMDB_BEARER_TOKEN absent : le catalogue est désactivé, le Direct et l’EPG restent disponibles.');
    else console.log('[config] TMDB_BEARER_TOKEN configuré.');
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Le port ${port} est déjà utilisé. Ferme l’autre instance de Vidzy ou configure PORT.`);
      process.exitCode = 1;
      return;
    }

    console.error('Impossible de démarrer le serveur Vidzy :', error.message);
    process.exitCode = 1;
  });
  return server;
}

if (require.main === module) {
  const server = startServer();
  epgService.refresh().catch(error => console.warn('[epg]', error.message));
  const epgRefreshTimer = setInterval(() => epgService.refresh(true).catch(error => console.warn('[epg]', error.message)), 8 * 60 * 60 * 1000);
  epgRefreshTimer.unref();
  const shutdown = signal => {
    console.log(`${signal} reçu, arrêt propre du serveur…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { app, startServer, normalizeItem, epgService };
