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

module.exports = { DEFAULT_ALLOWED_HLS_HOSTS, allowedHlsHosts, isPrivateIp, safeHlsUrl };
