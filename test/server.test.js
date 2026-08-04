'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, normalizeItem, parseDirectChannels } = require('../server');
const { fetchWithTimeout } = require('../lib/fetch-timeout');

test('GET /api/health retourne un état cohérent sans secret', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.app, 'vidzy');
  assert.equal(response.body.data.status, 'operational');
  assert.equal(typeof response.body.data.uptimeSeconds, 'number');
  assert.equal('token' in response.body.data, false);
});

test('une route API inconnue retourne une erreur JSON cohérente', async () => {
  const response = await request(app).get('/api/inconnue').expect(404);
  assert.deepEqual(response.body, { ok: false, error: 'Route API introuvable.' });
});

test('les paramètres invalides sont rejetés avant tout appel externe', async () => {
  const badId = await request(app).get('/api/details/movie/abc').expect(400);
  assert.equal(badId.body.ok, false);
  const badPage = await request(app).get('/api/catalog/movie?page=999').expect(400);
  assert.equal(badPage.body.error, 'Page invalide.');
  const badSearch = await request(app).get('/api/search?q=x&type=movie').expect(400);
  assert.match(badSearch.body.error, /2 et 100/);
});

test('normalizeItem produit un contenu stable', () => {
  const item = normalizeItem({
    id: 42,
    title: 'Film',
    original_title: 'Movie',
    release_date: '2024-04-10',
    vote_average: 7.5,
    poster_path: '/poster.jpg'
  }, 'movie');
  assert.equal(item.id, 42);
  assert.equal(item.type, 'movie');
  assert.equal(item.year, '2024');
  assert.equal(item.poster, '/api/image/w500/poster.jpg');
});

test('le proxy d’images refuse les chemins non autorisés', async () => {
  await request(app).get('/api/image/giant/poster.jpg').expect(400);
  await request(app).get('/api/image/w500/x').expect(400);
});

test('normalizeItem accepte un film sans date de sortie', () => {
  const item = normalizeItem({ id: 43, title: 'Film sans date' }, 'movie');
  assert.equal(item.year, '');
  assert.equal(item.date, undefined);
});

test('les en-têtes de sécurité et la limite JSON sont actifs', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.match(response.headers['content-security-policy'], /default-src 'self'/);
  assert.match(response.headers['permissions-policy'], /camera=\(\)/);
  const oversized = 'x'.repeat(40 * 1024);
  const rejected = await request(app).post('/api/unknown').send({ oversized }).expect(413);
  assert.equal(rejected.body.ok, false);
  assert.equal(rejected.body.error, 'La requête est trop volumineuse.');
});

test('une page inconnue renvoie une vraie page 404', async () => {
  const response = await request(app).get('/adresse-inconnue').expect(404);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.text, /Page introuvable/);
});

test('le serveur écoute par défaut sur toutes les interfaces', async (t) => {
  const { startServer } = require('../server');
  const server = startServer(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  assert.equal(server.address().address, '0.0.0.0');
});

test('le serveur reste stable sous plusieurs requêtes successives', async () => {
  const responses = await Promise.all(Array.from({ length: 40 }, () => request(app).get('/api/health')));
  assert.equal(responses.every(response => response.status === 200 && response.body.ok === true), true);
});

test('la route EPG refuse un nom vide avant tout appel externe', async () => {
  const response = await request(app).get('/api/epg?channel=').expect(400);
  assert.deepEqual(response.body, { ok: false, error: 'Nom de chaîne invalide.' });
});

test('les nouvelles routes Direct et EPG existent et gardent une enveloppe cohérente', async () => {
  const status = await request(app).get('/api/epg/status').expect(200);
  assert.equal(status.body.ok, true);
  assert.equal(status.body.data.source, 'EPG.PW France');
  const invalidChannel = await request(app).get('/api/epg/channel/%20').expect(400);
  assert.equal(invalidChannel.body.error, 'Identifiant EPG invalide.');

  const previousFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify([
    { channel_name: 'TF1 FR', url: 'https://hesgoaler.com/madra.php?ch=TF1FR', country: 'France', category: 'General' },
    { channel_name: 'Doublon', url: 'https://hesgoaler.com/madra.php?ch=TF1FR' },
    { channel_name: 'Invalide', url: 'https://example.com/watch?ch=nope' }
  ]), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const direct = await request(app).get('/api/direct/channels').expect(200);
    assert.equal(direct.body.ok, true);
    assert.equal(direct.body.data.channels.length, 1);
    assert.equal(direct.body.data.channels[0].id, 'TF1FR');
  } finally {
    global.fetch = previousFetch;
  }
});

test('parse, valide et déduplique le catalogue de chaînes', () => {
  const channels = parseDirectChannels([
    { channel_name: 'TF1', url: 'https://hesgoaler.com/madra.php?ch=TF1FR', country: 'France' },
    { channel_name: 'TF1 doublon', url: 'https://hesgoaler.com/madra.php?ch=TF1FR' },
    { channel_name: 'Interdite', url: 'https://evil.example/watch?ch=TF1FR' },
    { channel_name: 'Sans identifiant', url: 'https://hesgoaler.com/madra.php' }
  ]);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].id, 'TF1FR');
  assert.equal(channels[0].sources[0], 'https://hesgoaler.com/madra.php?ch=TF1FR');
});

test('conserve un flux HLS autorisé sans remplacer les lecteurs iframe', () => {
  const channels = parseDirectChannels([
    { id: 'TESTHLS', channel_name: 'Test HLS', url: 'https://hesgoaler.com/live/test.m3u8' },
    { id: 'PRIVATE', channel_name: 'Interdit', url: 'https://127.0.0.1/live.m3u8' }
  ]);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].hlsSource, 'https://hesgoaler.com/live/test.m3u8');
  assert.deepEqual(channels[0].sources, []);
});

test('annule une requête réseau qui dépasse le délai', async () => {
  const slowFetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  await assert.rejects(fetchWithTimeout('https://example.test', {}, 10, slowFetch), error => error.name === 'AbortError');
});

test('TMDB absent reste une réponse publique propre sans nom de variable', async () => {
  const config = await request(app).get('/api/config').expect(200);
  assert.equal(typeof config.body.data.tmdbConfigured, 'boolean');
  if (!config.body.data.tmdbConfigured) {
    const catalogue = await request(app).get('/api/catalog/movie').expect(503);
    assert.equal(catalogue.body.ok, false);
    assert.equal(/TMDB_|\.env/i.test(catalogue.body.error), false);
  }
});
