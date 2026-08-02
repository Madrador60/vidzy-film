'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, normalizeItem } = require('../server');

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
