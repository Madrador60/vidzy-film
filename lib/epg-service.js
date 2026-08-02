'use strict';

const { Readable, Transform } = require('node:stream');
const { createGunzip } = require('node:zlib');
const sax = require('sax');

const DEFAULT_SOURCES = [{ id: 'epgpw-fr', name: 'EPG.PW France', url: 'https://epg.pw/xmltv/epg_FR.xml.gz', compressed: true }];
const DEFAULT_ALIASES = {
  'bfmtv': 'bfm tv', 'france info': 'franceinfo:', 'franceinfo': 'franceinfo:',
  'canal plus': 'canal+', 'canal': 'canal+', 'arte france': 'arte',
  'bein sports 1 france': 'bein sports 1', 'bein sports 2 france': 'bein sports 2',
  'bein sports 3 france': 'bein sports 3',
  'rmc decouverte': 'rmc découverte', 'equipe 21': "l'équipe"
};

function normalizeChannelName(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(?:uhd|fhd|full hd|hd|sd|fr)\b/g, ' ')
    .replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseXmltvDate(value = '') {
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-])(\d{2})(\d{2})/);
  if (!match) return null;
  const utc = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
  const offset = (+match[8] * 60 + +match[9]) * 60000 * (match[7] === '+' ? 1 : -1);
  return new Date(utc - offset);
}

function parseXmltvStream(stream, { now = Date.now(), maxPrograms = 250000 } = {}) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true, normalize: true });
    const channels = new Map();
    const programs = new Map();
    let currentChannel = null;
    let currentProgram = null;
    let field = '';
    let text = '';
    let count = 0;
    parser.on('opentag', node => {
      field = node.name;
      text = '';
      if (node.name === 'channel') currentChannel = { id: node.attributes.id || '', names: [], icon: '' };
      if (node.name === 'programme') currentProgram = {
        channelId: node.attributes.channel || '', start: parseXmltvDate(node.attributes.start),
        end: parseXmltvDate(node.attributes.stop), title: '', description: '', category: ''
      };
      if (node.name === 'icon' && currentChannel && node.attributes.src) currentChannel.icon = String(node.attributes.src);
    });
    parser.on('text', value => { text += value; });
    parser.on('cdata', value => { text += value; });
    parser.on('closetag', name => {
      const value = text.trim();
      if (currentChannel && name === 'display-name' && value) currentChannel.names.push(value);
      if (currentProgram && name === 'title' && !currentProgram.title) currentProgram.title = value;
      if (currentProgram && name === 'desc' && !currentProgram.description) currentProgram.description = value;
      if (currentProgram && name === 'category' && !currentProgram.category) currentProgram.category = value;
      if (name === 'channel' && currentChannel?.id) { channels.set(currentChannel.id, currentChannel); currentChannel = null; }
      if (name === 'programme' && currentProgram) {
        count += 1;
        if (count > maxPrograms) return stream.destroy(new Error('Le fichier XMLTV dépasse la limite autorisée.'));
        if (currentProgram.title && currentProgram.start && currentProgram.end && currentProgram.end.getTime() >= now - 12 * 3600000) {
          const list = programs.get(currentProgram.channelId) || [];
          list.push(currentProgram);
          programs.set(currentProgram.channelId, list);
        }
        currentProgram = null;
      }
      field = '';
      text = '';
    });
    parser.on('error', reject);
    parser.on('end', () => {
      for (const list of programs.values()) list.sort((a, b) => a.start - b.start);
      resolve({ channels, programs, programCount: count });
    });
    stream.on('error', reject).pipe(parser);
  });
}

class EpgService {
  constructor({ sources = DEFAULT_SOURCES, refreshMs = 8 * 3600000, fetchImpl = fetch, aliases = DEFAULT_ALIASES } = {}) {
    this.sources = sources;
    this.refreshMs = Math.min(12 * 3600000, Math.max(6 * 3600000, refreshMs));
    this.fetchImpl = fetchImpl;
    this.aliases = aliases;
    this.snapshot = { channels: new Map(), programs: new Map(), expires: 0, updatedAt: '', source: '', programCount: 0 };
    this.pending = null;
    this.lastError = '';
  }

  async refresh(force = false) {
    if (!force && this.snapshot.expires > Date.now() && this.snapshot.channels.size) return this.snapshot;
    if (this.pending) return this.pending;
    this.pending = this.loadSources().finally(() => { this.pending = null; });
    return this.pending;
  }

  async loadSources() {
    let lastError;
    for (const source of this.sources) {
      try {
        const response = await this.fetchImpl(source.url, { headers: { accept: 'application/gzip, application/xml, text/xml', 'user-agent': 'VidzyXMLTV/1.0' }, signal: AbortSignal.timeout(30000) });
        if (!response.ok || !response.body) throw new Error(`Source XMLTV indisponible (${response.status})`);
        const length = Number(response.headers.get('content-length') || 0);
        if (length > 10 * 1024 * 1024) throw new Error('Source XMLTV trop volumineuse.');
        let stream = Readable.fromWeb(response.body);
        const limiter = new Transform({ transform(chunk, _encoding, callback) { this.total = (this.total || 0) + chunk.length; callback(this.total > 80 * 1024 * 1024 ? new Error('XMLTV décompressé trop volumineux.') : null, chunk); } });
        stream = stream.pipe(source.compressed ? createGunzip() : new Transform({ transform(chunk, _encoding, callback) { callback(null, chunk); } })).pipe(limiter);
        const parsed = await parseXmltvStream(stream);
        this.snapshot = { ...parsed, expires: Date.now() + this.refreshMs, updatedAt: new Date().toISOString(), source: source.name };
        this.lastError = '';
        return this.snapshot;
      } catch (error) { lastError = error; }
    }
    this.lastError = lastError?.message || 'EPG indisponible';
    if (this.snapshot.channels.size) return this.snapshot;
    throw lastError || new Error('EPG indisponible');
  }

  matchChannel(name, snapshot = this.snapshot) {
    const original = normalizeChannelName(name);
    const alias = normalizeChannelName(this.aliases[original] || original);
    let best = null;
    for (const channel of snapshot.channels.values()) {
      const names = channel.names.map(normalizeChannelName);
      const exact = names.some(value => value === alias || value === original);
      const partial = !exact && names.some(value => {
        const aliasTokens = alias.split(' ');
        const valueTokens = value.split(' ');
        const common = aliasTokens.filter(token => valueTokens.includes(token));
        const extras = [...aliasTokens, ...valueTokens].filter(token => !common.includes(token));
        return common.length >= 2 && extras.length <= 1 && extras.every(token => ['tv', 'channel', 'chaine', 'network'].includes(token));
      });
      if (exact || (partial && !best)) best = { channel, confidence: exact ? 1 : .7 };
      if (exact) break;
    }
    return best;
  }

  async guide(name, limit = 24) {
    const snapshot = await this.refresh();
    const match = this.matchChannel(name, snapshot);
    if (!match) return null;
    const now = Date.now();
    const programs = (snapshot.programs.get(match.channel.id) || []).filter(item => item.end.getTime() >= now).slice(0, limit);
    return { channel: match.channel.names[0] || name, confidence: match.confidence, programs, source: snapshot.source, updatedAt: snapshot.updatedAt, stale: snapshot.expires <= now };
  }

  async overview(names = []) {
    const snapshot = await this.refresh();
    const now = Date.now();
    const result = {};
    for (const name of names.slice(0, 600)) {
      const match = this.matchChannel(name, snapshot);
      if (!match) continue;
      const list = snapshot.programs.get(match.channel.id) || [];
      const current = list.find(program => program.start.getTime() <= now && program.end.getTime() > now);
      const next = list.find(program => program.start.getTime() >= (current?.end.getTime() || now));
      if (current || next) result[name] = { matchedChannel: match.channel.names[0] || name, confidence: match.confidence, current, next };
    }
    return { channels: result, source: snapshot.source, updatedAt: snapshot.updatedAt };
  }
}

module.exports = { DEFAULT_SOURCES, EpgService, normalizeChannelName, parseXmltvDate, parseXmltvStream };
