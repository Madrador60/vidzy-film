'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { gzipSync } = require('node:zlib');
const { EpgService, normalizeChannelName, parseXmltvDate, parseXmltvStream, programProgress } = require('../lib/epg-service');

const XMLTV = `<?xml version="1.0"?><tv>
<channel id="tf1.fr"><display-name>TF1 HD</display-name></channel>
<channel id="fr2.fr"><display-name>France 2</display-name></channel>
<programme start="20260802190000 +0200" stop="20260802200000 +0200" channel="tf1.fr"><title>Journal</title><desc>Actualités</desc><category>Information</category></programme>
<programme start="20260802200000 +0200" stop="20260802220000 +0200" channel="tf1.fr"><title>Le Film</title></programme>
</tv>`;

test('parse les dates XMLTV avec leur fuseau horaire', () => {
  assert.equal(parseXmltvDate('20260802200000 +0200').toISOString(), '2026-08-02T18:00:00.000Z');
});

test('parse efficacement les chaînes et programmes XMLTV', async () => {
  const parsed = await parseXmltvStream(Readable.from([XMLTV]), { now: Date.parse('2026-08-02T16:00:00Z') });
  assert.equal(parsed.channels.get('tf1.fr').names[0], 'TF1 HD');
  assert.equal(parsed.programs.get('tf1.fr').length, 2);
  assert.equal(parsed.programs.get('tf1.fr')[0].description, 'Actualités');
});

test('applique un décalage propre à une source sans modifier le parseur de date', async () => {
  const parsed = await parseXmltvStream(Readable.from([XMLTV]), {
    now: Date.parse('2026-08-02T08:00:00Z'), timeShiftMs: -8 * 3600000
  });
  assert.equal(parsed.programs.get('tf1.fr')[0].start.toISOString(), '2026-08-02T09:00:00.000Z');
  assert.equal(parseXmltvDate('20260802190000 +0200').toISOString(), '2026-08-02T17:00:00.000Z');
});

test('associe les variantes IPTV aux chaînes EPG', () => {
  const service = new EpgService();
  service.snapshot.channels = new Map([['tf1.fr', { id: 'tf1.fr', names: ['TF1 HD'] }], ['bfm.fr', { id: 'bfm.fr', names: ['BFM TV'] }]]);
  assert.equal(service.matchChannel('TF1 FHD').channel.id, 'tf1.fr');
  assert.equal(service.matchChannel('BFMTV').channel.id, 'bfm.fr');
  assert.equal(normalizeChannelName('France 2 HD'), 'france 2');
  assert.equal(service.matchChannel('beIN SPORTS USA'), null);
});

test('calcule et borne la progression du programme en cours', () => {
  const program = { start: new Date('2026-08-02T18:00:00Z'), end: new Date('2026-08-02T20:00:00Z') };
  assert.equal(programProgress(program, Date.parse('2026-08-02T19:00:00Z')), 50);
  assert.equal(programProgress(program, Date.parse('2026-08-02T17:00:00Z')), 0);
  assert.equal(programProgress(program, Date.parse('2026-08-02T20:00:00Z')), 0);
});

test('met le XMLTV en cache et conserve la dernière grille si la source tombe', async () => {
  let calls = 0;
  let fail = false;
  const service = new EpgService({ fetchImpl: async () => {
    calls += 1;
    if (fail) throw new Error('source coupée');
    return new Response(gzipSync(XMLTV), { status: 200, headers: { 'content-length': String(gzipSync(XMLTV).length) } });
  } });
  await service.refresh();
  await service.refresh();
  assert.equal(calls, 1);
  fail = true;
  const stale = await service.refresh(true);
  assert.equal(stale.channels.size, 2);
  assert.equal(service.lastError, 'source coupée');
});

test('signale proprement une source EPG absente sans créer de grille vide', async () => {
  const service = new EpgService({ fetchImpl: async () => { throw new Error('EPG hors ligne'); } });
  await assert.rejects(service.refresh(), /EPG hors ligne/);
  assert.equal(service.status().available, false);
  assert.equal(service.status().lastError, 'EPG hors ligne');
});
