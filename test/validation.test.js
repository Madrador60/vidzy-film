'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../lib/validation');
const { safePlayerUrl, allowedHosts } = require('../lib/player-url');
const { safeHlsUrl, allowedHlsHosts, isPrivateIp, validateHlsRedirects } = require('../lib/hls-url');
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

test('valide strictement les flux HLS directs', () => {
  const hosts = allowedHlsHosts('cdn.example.com');
  assert.equal(safeHlsUrl('http://cdn.example.com/live.m3u8', hosts), '');
  assert.equal(safeHlsUrl('https://evil.example/live.m3u8', hosts), '');
  assert.equal(safeHlsUrl('https://cdn.example.com/player.html', hosts), '');
  assert.equal(safeHlsUrl('https://127.0.0.1/live.m3u8', new Set(['127.0.0.1'])), '');
  assert.equal(isPrivateIp('192.168.1.20'), true);
  assert.match(safeHlsUrl('https://cdn.example.com/live/channel.m3u8?token=test', hosts), /^https:\/\/cdn\.example\.com/);
});

test('refuse une redirection HLS hors liste blanche', async () => {
  const hosts = allowedHlsHosts('cdn.example.com');
  const redirectingFetch = async () => new Response(null, {
    status: 302,
    headers: { location: 'https://evil.example/live.m3u8' }
  });
  await assert.rejects(
    validateHlsRedirects('https://cdn.example.com/live.m3u8', { hosts, fetchImpl: redirectingFetch }),
    /Redirection HLS non autorisée/
  );
});

test('accepte une chaîne de redirection HLS autorisée', async () => {
  const hosts = allowedHlsHosts('cdn.example.com,edge.example.com');
  const calls = [];
  const redirectingFetch = async url => {
    calls.push(url);
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://edge.example.com/final.m3u8' } })
      : new Response(null, { status: 200 });
  };
  assert.equal(
    await validateHlsRedirects('https://cdn.example.com/live.m3u8', { hosts, fetchImpl: redirectingFetch }),
    'https://edge.example.com/final.m3u8'
  );
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
