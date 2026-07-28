'use strict';

function positiveInteger(value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function tmdbId(value) {
  return positiveInteger(value, { min: 1, max: 2_147_483_647 });
}

function page(value) {
  if (value === undefined || value === '') return 1;
  return positiveInteger(value, { min: 1, max: 500 });
}

function year(value) {
  if (value === undefined || value === '') return '';
  const text = String(value).trim();
  return /^(18|19|20|21)\d{2}$/.test(text) ? text : null;
}

function genre(value) {
  if (value === undefined || value === '') return '';
  const number = positiveInteger(value, { min: 1, max: 99999 });
  return number === null ? null : String(number);
}

function searchQuery(value) {
  const cleaned = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length >= 2 && cleaned.length <= 100 ? cleaned : null;
}

function mediaType(value, { allowMovie = true, allowTv = true } = {}) {
  const normalized = String(value || '').toLowerCase();
  if (allowMovie && normalized === 'movie') return 'movie';
  if (allowTv && ['tv', 'series', 'serie'].includes(normalized)) return 'tv';
  return null;
}

module.exports = { positiveInteger, tmdbId, page, year, genre, searchQuery, mediaType };
