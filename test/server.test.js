'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, normalizeItem, parseEpgPrograms } = require('../server');

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

test('le parseur EPG extrait les horaires et titres nettoyés', () => {
  const html = '<a class="panel-block"><span class="has-text-weight-bold px-1">20:00</span> JT 20h </a><a class="panel-block"><span class="has-text-weight-bold">20:45</span><b>Le goût du détail</b></a>';
  assert.deepEqual(parseEpgPrograms(html), [
    { time: '20:00', title: 'JT 20h' },
    { time: '20:45', title: 'Le goût du détail' }
  ]);
});

test('la route EPG refuse un nom vide avant tout appel externe', async () => {
  const response = await request(app).get('/api/epg?channel=').expect(400);
  assert.deepEqual(response.body, { ok: false, error: 'Nom de chaîne invalide.' });
});
