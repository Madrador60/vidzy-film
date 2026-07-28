'use strict';

const DEFAULT_ALLOWED_PLAYER_HOSTS = ['vidzy.org', 'www.vidzy.org', 'hesgoaler.com', 'www.youtube-nocookie.com'];

function allowedHosts(value = process.env.ALLOWED_PLAYER_HOSTS) {
  const configured = String(value || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_PLAYER_HOSTS);
}

function safePlayerUrl(value, hosts = allowedHosts()) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !hosts.has(url.hostname.toLowerCase())) return '';
    if (url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

module.exports = { DEFAULT_ALLOWED_PLAYER_HOSTS, allowedHosts, safePlayerUrl };
