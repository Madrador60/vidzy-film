'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../lib/validation');
const { safePlayerUrl, allowedHosts } = require('../lib/player-url');
const { BoundedCache } = require('../lib/bounded-cache');

test('valide les identifiants, pages, années et recherches', () => {
  assert.equal(validation.tmdbId('123'), 123);
  assert.equal(validation.tmdbId('-1'), null);
  assert.equal(validation.page('501'), null);
  assert.equal(validation.page(undefined), 1);
  assert.equal(validation.year('2024'), '2024');
  assert.equal(validation.year('24'), null);
  assert.equal(validation.searchQuery('  leonardo   dicaprio '), 'leonardo dicaprio');
  assert.equal(validation.searchQuery('x'), null);
});

test('valide strictement les URL de lecteurs', () => {
  const hosts = allowedHosts('vidzy.org,hesgoaler.com');
  assert.equal(safePlayerUrl('javascript:alert(1)', hosts), '');
  assert.equal(safePlayerUrl('data:text/html,test', hosts), '');
  assert.equal(safePlayerUrl('https://evil.example/player', hosts), '');
  assert.match(safePlayerUrl('https://vidzy.org/movie/123', hosts), /^https:\/\/vidzy\.org/);
});

test('le cache borné supprime les entrées les plus anciennes', () => {
  const cache = new BoundedCache({ maxEntries: 2, ttlMs: 60_000 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('c'), 3);
});
