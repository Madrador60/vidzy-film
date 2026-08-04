'use strict';

const net = require('node:net');

const DEFAULT_ALLOWED_HLS_HOSTS = ['hesgoaler.com'];

function allowedHlsHosts(value = process.env.ALLOWED_HLS_HOSTS) {
  const configured = String(value || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_HLS_HOSTS);
}

function isPrivateIp(hostname) {
  if (!net.isIP(hostname)) return false;
  const host = hostname.toLowerCase();
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  const parts = host.split('.').map(Number);
  return parts.length === 4 && (
    parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function safeHlsUrl(value, hosts = allowedHlsHosts()) {
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (hostname === 'localhost' || hostname.endsWith('.local') || isPrivateIp(hostname)) return '';
    if (!hosts.has(hostname) || !/\.m3u8$/i.test(url.pathname)) return '';
    return url.toString();
  } catch { return ''; }
}

async function validateHlsRedirects(value, {
  hosts = allowedHlsHosts(), fetchImpl = fetch, maxRedirects = 4, timeoutMs = 8000
} = {}) {
  let current = safeHlsUrl(value, hosts);
  if (!current) throw new Error('Flux HLS non autorisé.');
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const response = await fetchImpl(current, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.1' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirect === maxRedirects) throw new Error('Redirection HLS invalide.');
      current = safeHlsUrl(new URL(location, current), hosts);
      if (!current) throw new Error('Redirection HLS non autorisée.');
      continue;
    }
    if (!response.ok) throw new Error(`Flux HLS indisponible (${response.status}).`);
    return current;
  }
  throw new Error('Trop de redirections HLS.');
}

module.exports = { DEFAULT_ALLOWED_HLS_HOSTS, allowedHlsHosts, isPrivateIp, safeHlsUrl, validateHlsRedirects };
