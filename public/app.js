const state = { type: 'movie', page: 1, totalPages: 1, query: '', selected: null, selectedItem: null, favoritesOnly: false };
const $ = (selector) => document.querySelector(selector);
const grid = $('#grid');
const loading = $('#loading');
const profiles = [
  { id: 'madra', name: 'Madra', initial: 'M', color: '#7c6cff' },
  { id: 'cinema', name: 'Cinéma', initial: 'C', color: '#7c9cff' },
  { id: 'series', name: 'Séries', initial: 'S', color: '#ff7ca8' },
  { id: 'invite', name: 'Invité', initial: 'I', color: '#ffc857' }
];
const activeProfileId = localStorage.getItem('vidzy-active-profile') || 'madra';
const activeProfile = profiles.find(profile => profile.id === activeProfileId) || profiles[0];
const favoriteKey = `vidzy-favorites-v2-${activeProfile.id}`;
const historyKey = `vidzy-history-v2-${activeProfile.id}`;
const progressKey = `vidzy-progress-v1-${activeProfile.id}`;
const languageKey = `vidzy-language-v1-${activeProfile.id}`;
let liveChannels = [];
let liveLoaded = false;
let liveVisibleLimit = 60;
let globalSearchTimer = 0;
let globalSearchItems = [];
let globalSearchController = null;
let recentSearches = readLocalList('vidzy-recent-searches-v1').filter(value => typeof value === 'string').slice(0, 6);
let featuredItems = [];
let featuredIndex = 0;
let heroRotationTimer = 0;
let selectedEpisodeRuntime = 0;
let currentEpisodes = [];
let inlineProgressTimer = 0;
let inlineProgressContext = null;
let installPrompt = null;
const loadedHomeRails = new Set();
function tmdbImageUrl(imagePath, size = 'w500') {
  const filename = String(imagePath || '').split('/').pop();
  return filename ? `/api/image/${size}/${encodeURIComponent(filename)}` : '';
}
function readLocalList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
let favorites = readLocalList(favoriteKey);
let watchHistory = readLocalList(historyKey);
let watchProgress = {};
try { watchProgress = JSON.parse(localStorage.getItem(progressKey) || '{}') || {}; } catch { watchProgress = {}; }
$('#playLanguage').value = localStorage.getItem(languageKey) || '';
if (activeProfile.id === 'madra' && !localStorage.getItem('vidzy-profile-migration-v2')) {
  if (!favorites.length) favorites = readLocalList('vidzy-favorites-v1');
  if (!watchHistory.length) watchHistory = readLocalList('vidzy-history-v1');
  localStorage.setItem('vidzy-profile-migration-v2', 'done');
}

function saveFavorites() {
  localStorage.setItem(favoriteKey, JSON.stringify(favorites));
  $('#favoritesCount').textContent = favorites.length;
}

function isFavorite(type, id) {
  return favorites.some((item) => item.type === type && String(item.id) === String(id));
}

function toggleFavorite(item) {
  if (!item) return;
  const index = favorites.findIndex((favorite) => favorite.type === item.type && String(favorite.id) === String(item.id));
  if (index >= 0) favorites.splice(index, 1);
  else favorites.unshift(item);
  saveFavorites();
  if (state.favoritesOnly) render(favorites);
  else document.querySelectorAll(`.favorite-card[data-id="${item.id}"][data-type="${item.type}"]`).forEach((button) => {
    button.classList.toggle('active', isFavorite(item.type, item.id));
    button.textContent = isFavorite(item.type, item.id) ? '♥' : '♡';
  });
  updateDetailFavorite();
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function safeExternalUrl(value = '') {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch { return ''; }
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { accept: 'application/json', ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  return payload.ok === true && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

function renderProfiles() {
  $('#profileAvatar').textContent = activeProfile.initial;
  $('#profileAvatar').style.background = activeProfile.color;
  $('#profileName').textContent = activeProfile.name;
  $('#profileMenu').innerHTML = profiles.map(profile => `
    <button class="profile-option ${profile.id === activeProfile.id ? 'active' : ''}" type="button" role="menuitem" data-profile="${profile.id}">
      <span class="profile-option-avatar" style="background:${profile.color}">${profile.initial}</span>
      <span><strong>${profile.name}</strong><small>${profile.id === activeProfile.id ? 'Profil actif' : 'Changer de profil'}</small></span>
      ${profile.id === activeProfile.id ? '<span class="profile-option-check">✓</span>' : ''}
    </button>`).join('');
  $('#profileMenu').querySelectorAll('.profile-option').forEach(button => {
    button.addEventListener('click', () => {
      localStorage.setItem('vidzy-active-profile', button.dataset.profile);
      location.reload();
    });
  });
}

async function init() {
  renderProfiles();
  saveFavorites();
  try {
    const config = await json('/api/config');
    if (!config.tmdbConfigured) {
      $('#setup').classList.remove('hidden');
      loading.classList.add('hidden');
      return;
    }
    await refreshLocalCollections();
    await loadHome();
    if (location.hash === '#direct') enterLive();
  } catch (error) {
    loading.textContent = `Impossible de démarrer : ${error.message}`;
  }
}

async function refreshLocalCollections() {
  const availability = new Map();
  const movieIds = [...new Set([...favorites, ...watchHistory]
    .filter(item => item.type === 'movie')
    .map(item => String(item.id)))];
  await Promise.all(movieIds.map(async id => {
    try { availability.set(id, await json(`/api/vidzy/${id}`)); }
    catch { availability.set(id, { available: false, languages: [] }); }
  }));
  const clean = items => items.flatMap(item => {
    if (item.type !== 'movie') return [item];
    const status = availability.get(String(item.id));
    return status?.available ? [{ ...item, vidzyLanguages: status.languages || [] }] : [];
  });
  favorites = clean(favorites);
  watchHistory = clean(watchHistory);
  saveFavorites();
  localStorage.setItem(historyKey, JSON.stringify(watchHistory));
}

function languageBadges(item) {
  const languages = Array.isArray(item?.vidzyLanguages) ? item.vidzyLanguages : [];
  return languages.map(language => `<span>${esc(String(language).toUpperCase())}</span>`).join('');
}

function progressPercent(item) {
  const key = item.type === 'movie'
    ? `movie:${item.id}`
    : `series:${item.id}:${item.lastSeason || 1}:${item.lastEpisode || 1}`;
  const progress = watchProgress[key];
  if (!progress?.seconds) return 0;
  const durationSeconds = Math.max(60, Number(progress.durationSeconds) || 7200);
  return Math.min(95, Math.max(2, Math.round((progress.seconds / durationSeconds) * 100)));
}

function startHeroRotation() {
  window.clearInterval(heroRotationTimer);
  if (featuredItems.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  heroRotationTimer = window.setInterval(() => showFeatured(featuredIndex + 1), 9000);
}

function showFeatured(index) {
  if (!featuredItems.length) return;
  featuredIndex = (index + featuredItems.length) % featuredItems.length;
  updateHero(featuredItems[featuredIndex]);
  $('#heroDots').querySelectorAll('.hero-dot').forEach((dot, dotIndex) =>
    dot.classList.toggle('active', dotIndex === featuredIndex));
}

function setupFeatured(items) {
  featuredItems = items.filter(item => item.backdrop).slice(0, 5);
  if (!featuredItems.length) return;
  $('#heroDots').innerHTML = featuredItems.map((item, index) =>
    `<button class="hero-dot ${index === 0 ? 'active' : ''}" type="button" aria-label="Afficher ${esc(item.title)}"></button>`
  ).join('');
  $('#heroDots').querySelectorAll('.hero-dot').forEach((dot, index) =>
    dot.addEventListener('click', () => { showFeatured(index); startHeroRotation(); }));
  showFeatured(0);
  startHeroRotation();
}

function showCatalogueView(showHome = true) {
  $('#liveView').classList.add('hidden');
  $('#hero').classList.toggle('hidden', !showHome);
  $('#discovery').classList.toggle('hidden', !showHome);
  $('.catalogue').classList.toggle('hidden', showHome);
  $('#favoritesBtn').classList.remove('hidden');
  $('#liveTab').classList.remove('active');
  if (location.hash === '#direct') history.replaceState(null, '', location.pathname);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openGlobalSearch() {
  $('#globalSearch').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  renderRecentSearches();
  window.setTimeout(() => $('#globalSearchInput').focus(), 0);
}

function closeGlobalSearch() {
  $('#globalSearch').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}

function closePerson() {
  $('#personPage').classList.add('hidden');
  $('#personPage').setAttribute('aria-hidden', 'true');
  if ($('#modal').classList.contains('hidden')) document.body.classList.remove('no-scroll');
}

async function openPerson(personId) {
  if (!/^\d+$/.test(String(personId || ''))) return;
  $('#personPage').classList.remove('hidden');
  $('#personPage').setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
  $('#personName').textContent = 'Chargement…';
  $('#personMeta').textContent = '';
  $('#personBiography').textContent = '';
  $('#personCredits').innerHTML = '<div class="person-loading">Chargement de la filmographie…</div>';
  try {
    const person = await json(`/api/person/${personId}`);
    $('#personName').textContent = person.name || 'Artiste';
    $('#personPhoto').innerHTML = person.profile
      ? `<img src="${person.profile}" alt="Photo de ${esc(person.name)}">`
      : `<span>${esc((person.name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join(''))}</span>`;
    const birthday = person.birthday ? new Date(`${person.birthday}T12:00:00`) : null;
    const endDate = person.deathday ? new Date(`${person.deathday}T12:00:00`) : new Date();
    let age = '';
    if (birthday && !Number.isNaN(birthday.getTime())) {
      let years = endDate.getFullYear() - birthday.getFullYear();
      if (endDate < new Date(endDate.getFullYear(), birthday.getMonth(), birthday.getDate())) years -= 1;
      age = `${years} ans`;
    }
    const born = birthday ? birthday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const departmentLabels = { Acting: 'Interprétation', Directing: 'Réalisation', Production: 'Production', Writing: 'Écriture' };
    $('#personMeta').textContent = [
      departmentLabels[person.department] || person.department || 'Interprétation',
      born ? `Naissance : ${born}` : '',
      age,
      person.placeOfBirth
    ].filter(Boolean).join(' · ');
    const biography = person.biography || 'Aucune biographie en français n’est disponible pour le moment.';
    $('#personBiography').textContent = biography;
    $('#personBiography').classList.add('collapsed');
    $('#personBioToggle').classList.toggle('hidden', biography.length < 420);
    $('#personBioToggle').textContent = 'Lire la biographie complète';
    $('#personLinks').innerHTML = [
      person.imdbId ? `<a href="https://www.imdb.com/name/${esc(person.imdbId)}/" target="_blank" rel="noopener noreferrer">Voir sur IMDb ↗</a>` : '',
      safeExternalUrl(person.homepage) ? `<a href="${esc(safeExternalUrl(person.homepage))}" target="_blank" rel="noopener noreferrer">Site officiel ↗</a>` : ''
    ].join('');
    const credits = person.credits || [];
    $('#personCreditCount').textContent = `${credits.length} rôle${credits.length > 1 ? 's' : ''}`;
    $('#personCredits').innerHTML = credits.length ? credits.map(credit => `
      <button class="person-credit" type="button" data-id="${credit.id}" data-type="${credit.type}">
        <span class="person-credit-poster">
          ${credit.poster ? `<img loading="lazy" src="${credit.poster}" alt="Affiche de ${esc(credit.title)}">` : '<span>VIDZY</span>'}
          <em>${credit.type === 'movie' ? 'FILM' : 'SÉRIE'}</em>
        </span>
        <strong>${esc(credit.title || 'Titre inconnu')}</strong>
        <small>${esc([credit.year || 'Date inconnue', credit.character || '', credit.episodeCount ? `${credit.episodeCount} épisode${credit.episodeCount > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '))}</small>
      </button>`).join('') : '<div class="person-loading">Aucun rôle référencé.</div>';
    $('#personCredits').querySelectorAll('.person-credit').forEach(card => {
      card.addEventListener('click', () => {
        closePerson();
        openItem(card.dataset.type, card.dataset.id);
      });
    });
    $('#personPage').scrollTop = 0;
  } catch (error) {
    $('#personName').textContent = 'Fiche indisponible';
    $('#personCredits').innerHTML = `<div class="person-loading">${esc(error.message)}</div>`;
  }
}

async function runGlobalSearch() {
  const query = $('#globalSearchInput').value.trim();
  if (query.length < 2) {
    globalSearchItems = [];
    $('#globalSearchResults').innerHTML = '<p class="global-search-message">Saisissez au moins deux caractères.</p>';
    return;
  }
  globalSearchController?.abort();
  globalSearchController = new AbortController();
  $('#globalSearchResults').innerHTML = '<p class="global-search-message">Recherche en cours…</p>';
  try {
    const data = await json(`/api/search-all?q=${encodeURIComponent(query)}`, { signal: globalSearchController.signal });
    if ($('#globalSearchInput').value.trim() !== query) return;
    const selectedType = $('#globalSearchType').value;
    const selectedYear = String($('#globalSearchYear').value || '');
    const minimumRating = Number($('#globalSearchRating').value || 0);
    globalSearchItems = (data.results || []).filter(item =>
      (!selectedType || selectedType === item.type)
      && (!selectedYear || String(item.year) === selectedYear)
      && Number(item.rating || 0) >= minimumRating);
    const people = selectedType && selectedType !== 'person' ? [] : (data.people || []);
    recentSearches = [query, ...recentSearches.filter(value => value.toLocaleLowerCase('fr') !== query.toLocaleLowerCase('fr'))].slice(0, 6);
    localStorage.setItem('vidzy-recent-searches-v1', JSON.stringify(recentSearches));
    renderRecentSearches();
    if (!globalSearchItems.length && !people.length) {
      $('#globalSearchResults').innerHTML = '<p class="global-search-message">Aucun film ou série disponible ne correspond à cette recherche.</p>';
      return;
    }
    $('#globalSearchResults').innerHTML = people.map(person => `
      <button class="global-result global-person" type="button" data-person-id="${person.id}" aria-label="Ouvrir la fiche de ${esc(person.name)}">
        <span class="global-result-poster">
          ${person.profile ? `<img loading="lazy" decoding="async" src="${person.profile}" alt="Photo de ${esc(person.name)}">` : ''}
          <span>ARTISTE</span>
        </span>
        <strong>${esc(person.name)}</strong>
        <small>${esc(person.department || 'Interprétation')}</small>
      </button>`).join('') + globalSearchItems.map(item => `
      <button class="global-result" type="button" data-id="${item.id}" data-type="${item.type}" aria-label="Voir ${esc(item.title)}">
        <span class="global-result-poster">
          ${item.poster ? `<img loading="lazy" src="${item.poster}" alt="">` : ''}
          <span>${item.type === 'movie' ? 'FILM' : 'SÉRIE'}</span>
        </span>
        <strong>${esc(item.title)}</strong>
        <small>${item.year || 'À découvrir'} · ★ ${Number(item.rating || 0).toFixed(1)}</small>
      </button>`).join('');
    $('#globalSearchResults').querySelectorAll('.global-person').forEach(button => {
      button.addEventListener('click', () => {
        closeGlobalSearch();
        openPerson(button.dataset.personId);
      });
    });
    $('#globalSearchResults').querySelectorAll('.global-result[data-id]').forEach(button => {
      const item = globalSearchItems.find(entry => String(entry.id) === button.dataset.id && entry.type === button.dataset.type);
      button.addEventListener('click', () => {
        closeGlobalSearch();
        openItem(item.type, item.id, item);
      });
    });
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('#globalSearchResults').innerHTML = `<p class="global-search-message">Recherche impossible : ${esc(error.message)}</p>`;
  }
}

function renderRecentSearches() {
  const container = $('#recentSearches');
  container.classList.toggle('hidden', !recentSearches.length);
  container.innerHTML = recentSearches.length
    ? `<span>Récentes</span>${recentSearches.map(query => `<button type="button" data-query="${esc(query)}">${esc(query)}</button>`).join('')}`
    : '';
  container.querySelectorAll('button').forEach(button => {
    button.onclick = () => {
      $('#globalSearchInput').value = button.dataset.query;
      runGlobalSearch();
    };
  });
}

async function enterLive(categoryHint = '', activeButton = $('#liveTab')) {
  document.querySelectorAll('.tab').forEach(button => button.classList.remove('active'));
  activeButton.classList.add('active');
  $('#hero').classList.add('hidden');
  $('#discovery').classList.add('hidden');
  $('.catalogue').classList.add('hidden');
  $('#favoritesBtn').classList.add('hidden');
  $('#liveView').classList.remove('hidden');
  history.replaceState(null, '', '#direct');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (!liveLoaded) await loadLiveChannels();
  if (categoryHint) {
    const matching = [...$('#liveCategory').options].find(option => option.value.toLocaleLowerCase('fr').includes(categoryHint));
    if (matching) $('#liveCategory').value = matching.value;
    renderLiveChannels();
  }
}

async function loadLiveChannels() {
  $('#liveGrid').innerHTML = '<div class="live-loading">Chargement des chaînes…</div>';
  try {
    const data = await json('/api/live');
    liveChannels = data.channels || [];
    liveLoaded = true;
    const categories = [...new Set(liveChannels.map(channel => channel.category))].sort((a, b) => a.localeCompare(b, 'fr'));
    const countries = [...new Set(liveChannels.map(channel => channel.country))].sort((a, b) => a.localeCompare(b, 'fr'));
    $('#liveCategory').innerHTML = '<option value="">Toutes les catégories</option>' + categories.map(value => `<option>${esc(value)}</option>`).join('');
    $('#liveCountry').innerHTML = '<option value="">Tous les pays</option>' + countries.map(value => `<option>${esc(value)}</option>`).join('');
    renderLiveChannels();
  } catch (error) {
    $('#liveGrid').innerHTML = `<div class="live-empty">Impossible de charger le direct : ${esc(error.message)}</div>`;
    $('#liveCount').textContent = 'Indisponible';
  }
}

function renderLiveChannels() {
  const query = $('#liveSearch').value.trim().toLocaleLowerCase('fr');
  const category = $('#liveCategory').value;
  const country = $('#liveCountry').value;
  const filtered = liveChannels.filter(channel =>
    (!query || `${channel.name} ${channel.country} ${channel.category}`.toLocaleLowerCase('fr').includes(query))
    && (!category || channel.category === category)
    && (!country || channel.country === country)
  );
  $('#liveCount').textContent = `${filtered.length} chaîne${filtered.length > 1 ? 's' : ''} disponible${filtered.length > 1 ? 's' : ''}`;
  if (!filtered.length) {
    $('#liveMore').classList.add('hidden');
    $('#liveGrid').innerHTML = '<div class="live-empty">Aucune chaîne ne correspond à ces filtres.</div>';
    return;
  }
  const visibleChannels = filtered.slice(0, liveVisibleLimit);
  $('#liveMore').classList.toggle('hidden', visibleChannels.length >= filtered.length);
  $('#liveGrid').innerHTML = visibleChannels.map(channel => {
    const target = new URL('/live.html', location.origin);
    target.searchParams.set('ch', channel.id);
    target.searchParams.set('name', channel.name);
    return `<a class="live-card" href="${target.pathname}${target.search}">
      <span class="live-badge"><span class="live-dot"></span> EN DIRECT</span>
      ${channel.image ? `<img loading="lazy" src="${esc(channel.image)}" alt="Logo ${esc(channel.name)}">` : `<span class="live-card-logo-fallback">${esc(channel.name.slice(0, 1))}</span>`}
      <span class="live-card-info"><strong>${esc(channel.name)}</strong><span>${esc(channel.country)} · ${esc(channel.category)}</span></span>
    </a>`;
  }).join('');
}

function railMarkup(items, ranked = false) {
  return items.slice(0, 12).map((item, index) => `
    <article class="rail-card" tabindex="0" role="button" data-id="${item.id}" data-type="${item.type}" aria-label="Voir ${esc(item.title)}">
      ${item.backdrop ? `<img loading="lazy" src="${item.backdrop}" alt="">` : ''}
      <div class="rail-shade"></div>
      ${ranked ? `<span class="rail-rank">${index + 1}</span>` : ''}
      <span class="rail-play" aria-hidden="true">▶</span>
      ${item.type === 'movie' && languageBadges(item) ? `<span class="rail-languages">${languageBadges(item)}</span>` : ''}
      ${progressPercent(item) ? `<span class="watch-progress"><span style="width:${progressPercent(item)}%"></span></span>` : ''}
      <div class="rail-info"><strong>${esc(item.title)}</strong><span>${item.type === 'movie' ? 'Film' : 'Série'} · ${item.year || 'À découvrir'} · ★ ${Number(item.rating || 0).toFixed(1)}</span></div>
    </article>`).join('');
}

function bindRail(container, items) {
  container.querySelectorAll('.rail-card').forEach((card) => {
    const item = items.find((entry) => String(entry.id) === card.dataset.id && entry.type === card.dataset.type);
    const open = () => openItem(card.dataset.type, card.dataset.id, item);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
  });
}

function renderRail(selector, items, ranked = false) {
  const container = $(selector);
  container.classList.remove('rail-loading');
  container.innerHTML = railMarkup(items, ranked);
  bindRail(container, items);
  const section = container.closest('.rail-section');
  if (!section.querySelector('.rail-controls')) {
    const controls = document.createElement('div');
    controls.className = 'rail-controls';
    controls.innerHTML = '<button class="rail-control rail-prev" type="button" aria-label="Faire défiler vers la gauche">‹</button><button class="rail-control rail-next" type="button" aria-label="Faire défiler vers la droite">›</button>';
    section.appendChild(controls);
    controls.querySelector('.rail-prev').onclick = () => container.scrollBy({ left: -container.clientWidth * .8, behavior: 'smooth' });
    controls.querySelector('.rail-next').onclick = () => container.scrollBy({ left: container.clientWidth * .8, behavior: 'smooth' });
  }
}

function renderHistory() {
  const section = $('#continueSection');
  section.classList.toggle('hidden', !watchHistory.length);
  if (watchHistory.length) {
    renderRail('#continueRail', watchHistory);
    $('#continueRail').querySelectorAll('.rail-card').forEach(card => {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'history-remove';
      remove.setAttribute('aria-label', 'Retirer de l’historique');
      remove.textContent = '×';
      remove.onclick = event => {
        event.stopPropagation();
        watchHistory = watchHistory.filter(item => !(item.type === card.dataset.type && String(item.id) === card.dataset.id));
        localStorage.setItem(historyKey, JSON.stringify(watchHistory));
        renderHistory();
      };
      card.appendChild(remove);
    });
  }
}

async function loadHome() {
  renderHistory();
  const deferredPersonalization = () => loadPersonalizedRail();
  if ('requestIdleCallback' in window) window.requestIdleCallback(deferredPersonalization, { timeout: 2500 });
  else window.setTimeout(deferredPersonalization, 800);
  const rails = [
    { selector: '#trendingRail', url: '/api/trending', ranked: true },
    { selector: '#seriesRail', url: '/api/catalog/series?page=1&sort=popularity.desc' },
    { selector: '#actionRail', url: '/api/catalog/movie?page=1&sort=popularity.desc&genre=28' },
    { selector: '#ratedRail', url: '/api/catalog/movie?page=1&sort=vote_average.desc', ranked: true },
    { selector: '#newRail', url: `/api/catalog/movie?page=1&sort=primary_release_date.desc&year=${new Date().getFullYear()}` },
    { selector: '#comedyRail', url: '/api/catalog/movie?page=1&sort=popularity.desc&genre=35' },
    { selector: '#horrorRail', url: '/api/catalog/movie?page=1&sort=popularity.desc&genre=27' },
    { selector: '#animationRail', url: '/api/catalog/series?page=1&sort=popularity.desc&genre=16' },
    { selector: '#scifiRail', url: '/api/catalog/movie?page=1&sort=popularity.desc&genre=878' }
  ];
  await loadHomeRail({ selector: '#popularRail', url: '/api/catalog/movie?page=1&sort=popularity.desc', ranked: true, featured: true });
  rails.forEach(observeHomeRail);
}

async function loadHomeRail({ selector, url, ranked = false, featured = false }) {
  if (loadedHomeRails.has(selector)) return;
  loadedHomeRails.add(selector);
  try {
    const data = await json(url);
    const items = data.results || [];
    renderRail(selector, items, ranked);
    if (featured) setupFeatured(items);
  } catch {
    $(selector).classList.remove('rail-loading');
    $(selector).innerHTML = '<div class="message"><p>Cette sélection est momentanément indisponible.</p></div>';
  }
}

function observeHomeRail(config) {
  const rail = $(config.selector);
  if (!('IntersectionObserver' in window)) return void loadHomeRail(config);
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    loadHomeRail(config);
  }, { rootMargin: '350px 0px', threshold: 0.01 });
  observer.observe(rail.closest('.rail-section'));
}

async function loadPersonalizedRail() {
  const source = watchHistory[0] || favorites[0];
  const section = $('#personalizedSection');
  if (!source) {
    section.classList.add('hidden');
    return;
  }
  try {
    const data = await json(`/api/recommendations/${source.type}/${source.id}`);
    const recommendations = (data.results || []).filter(item =>
      !(item.type === source.type && String(item.id) === String(source.id)));
    if (!recommendations.length) return;
    $('#personalizedTitle').textContent = `Parce que ${activeProfile.name} a aimé « ${source.title} »`;
    section.classList.remove('hidden');
    renderRail('#personalizedRail', recommendations);
  } catch {
    section.classList.add('hidden');
  }
}

async function loadGenres() {
  const data = await json(`/api/genres/${state.type}`);
  $('#genre').innerHTML = '<option value="">Tous les genres</option>' +
    data.genres.map((genre) => `<option value="${genre.id}">${esc(genre.name)}</option>`).join('');
}

function showSkeletons() {
  grid.innerHTML = Array.from({ length: 10 }, () => `
    <article class="card skeleton" aria-hidden="true">
      <div class="poster"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div>
    </article>`).join('');
}

async function load() {
  loading.classList.remove('hidden');
  loading.textContent = 'Chargement du catalogue…';
  showSkeletons();
  try {
    let url;
    if (state.query) {
      const params = new URLSearchParams({ q: state.query, page: state.page, type: state.type });
      url = `/api/search?${params}`;
    } else {
      const params = new URLSearchParams({ page: state.page, sort: $('#sort').value });
      if ($('#genre').value) params.set('genre', $('#genre').value);
      if ($('#year').value) params.set('year', $('#year').value);
      url = `/api/catalog/${state.type}?${params}`;
    }
    const data = await json(url);
    const expectedType = state.type === 'movie' ? 'movie' : 'serie';
    const strictResults = (data.results || []).filter(item => item.type === expectedType);
    state.totalPages = Math.max(1, Number(data.totalPages) || 1);
    render(strictResults);
    if (!featuredItems.length) updateHero(strictResults[0]);
    $('#count').textContent = data.availabilityFiltered
      ? `${Number(data.compatibleCount || 0)} disponible${Number(data.compatibleCount || 0) > 1 ? 's' : ''} sur cette page`
      : `${Number(data.totalResults || 0).toLocaleString('fr-FR')} résultats`;
    $('#sectionTitle').textContent = state.query
      ? `Résultats ${state.type === 'movie' ? 'films' : 'séries'} pour « ${state.query} »`
      : (state.type === 'movie' ? 'Catalogue Films' : 'Catalogue Séries');
    updatePager();
  } catch (error) {
    grid.innerHTML = `<div class="setup"><h2>Erreur</h2><p>${esc(error.message)}</p></div>`;
  } finally {
    loading.classList.add('hidden');
  }
}

function render(items) {
  if (!items.length) {
    grid.innerHTML = `<div class="message"><h2>Aucun contenu disponible</h2><p>${state.type === 'movie' ? 'Aucun des films de cette page n’est actuellement signalé comme compatible avec Vidzy. Essayez la page suivante.' : 'Essayez une autre recherche ou retirez certains filtres.'}</p></div>`;
    return;
  }
  grid.innerHTML = items.map((item) => `
    <article class="card" tabindex="0" role="button" data-id="${item.id}" data-type="${item.type}" aria-label="Ouvrir ${esc(item.title)}">
      <div class="id">TMDB #${item.id}</div>
      <button class="favorite-card ${isFavorite(item.type, item.id) ? 'active' : ''}" data-id="${item.id}" data-type="${item.type}" type="button" aria-label="${isFavorite(item.type, item.id) ? 'Retirer de' : 'Ajouter à'} ma liste">${isFavorite(item.type, item.id) ? '♥' : '♡'}</button>
      <div class="poster"><span class="card-play" aria-hidden="true">▶</span>${item.type === 'movie' && languageBadges(item) ? `<span class="poster-languages">${languageBadges(item)}</span>` : ''}${item.poster
        ? `<img loading="lazy" src="${item.poster}" alt="Affiche de ${esc(item.title)}">`
        : '<div class="no-poster">Pas d’affiche</div>'}</div>
      <div class="card-body"><h3>${esc(item.title)}</h3><div class="meta"><span>${item.type === 'movie' ? 'Film' : 'Série'}</span><span class="dot"></span><span>${item.year || '—'}</span><span class="rating"><b>★</b> ${Number(item.rating || 0).toFixed(1)}</span></div></div>
    </article>`).join('');
  document.querySelectorAll('.card').forEach((card) => {
    const item = items.find((entry) => String(entry.id) === card.dataset.id && entry.type === card.dataset.type);
    const open = () => openItem(card.dataset.type, card.dataset.id, item);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
    card.querySelector('.favorite-card').addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(item);
    });
  });
}

function updateHero(item) {
  if (!item) return;
  $('#heroEyebrow').textContent = item.type === 'movie' ? `Film à la une · Disponible sur Vidzy` : 'Série à la une';
  $('#heroTitle').textContent = item.title;
  const languageMeta = (item.vidzyLanguages || []).map(language => `<span class="hero-language">${esc(String(language).toUpperCase())}</span>`).join('');
  $('#heroMeta').innerHTML = `<span>${item.year || 'Nouveauté'}</span><span>★ ${Number(item.rating || 0).toFixed(1)}</span>${languageMeta}`;
  $('#heroOverview').textContent = item.overview || 'Découvrez ce titre parmi les incontournables du moment.';
  $('#heroBackdrop').style.backgroundImage = item.backdrop ? `url("${item.backdrop}")` : 'none';
  $('#heroPlay').disabled = false;
  $('#browseBtn').disabled = false;
  $('#heroPlay').onclick = () => openPlayerFromCard(item.type, item.id, item.title);
  $('#browseBtn').onclick = () => openItem(item.type, item.id, item);
}

function openPlayerFromCard(type, id, title) {
  const knownItem = state.selectedItem && String(state.selectedItem.id) === String(id)
    ? state.selectedItem
    : { type, id: Number(id), title };
  rememberWatch(knownItem);
  const page = new URL('/player.html', window.location.origin);
  page.searchParams.set('type', type === 'movie' ? 'movie' : 'series');
  page.searchParams.set('id', id);
  page.searchParams.set('title', title || 'Lecture Vidzy');

  // Pour les séries, un clic sur l’affiche lance directement S01E01.
  if (type !== 'movie') {
    page.searchParams.set('season', '1');
    page.searchParams.set('episode', '1');
  }

  window.location.href = page.toString();
}

function rememberWatch(item) {
  if (!item?.id) return;
  watchHistory = [item, ...watchHistory.filter((entry) => !(entry.type === item.type && String(entry.id) === String(item.id)))].slice(0, 12);
  localStorage.setItem(historyKey, JSON.stringify(watchHistory));
  renderHistory();
}

function updatePager() {
  ['#pageInfo', '#pageInfo2'].forEach((selector) => { $(selector).textContent = `Page ${state.page} / ${state.totalPages}`; });
  ['#prev', '#prev2'].forEach((selector) => { $(selector).disabled = state.page <= 1; });
  ['#next', '#next2'].forEach((selector) => { $(selector).disabled = state.page >= state.totalPages; });
}

async function openItem(type, id, item = null) {
  try {
    state.selected = { type, id };
    state.selectedItem = item;
    const details = await json(`/api/details/${type}/${id}`);
    $('#modal').classList.remove('hidden');
    $('#modal').setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    $('#modalHero').classList.remove('hidden');
    $('#modalCard').scrollTop = 0;
    $('#availability').textContent = '';
    [...$('#playLanguage').options].forEach(option => { option.disabled = false; });
    $('#trailerPlayer').src = '';
    $('#trailerSection').classList.add('hidden');
    $('#trailerUnavailable').classList.add('hidden');
    $('#modalHero').style.backgroundImage = details.backdrop_path
      ? `url("${tmdbImageUrl(details.backdrop_path, 'original')}")`
      : 'none';
    $('#modalTitle').textContent = details.title || details.name || 'Titre inconnu';
    const date = details.release_date || details.first_air_date || '';
    $('#modalBadge').textContent = `${type === 'movie' ? 'FILM' : 'SÉRIE'} · ${date.slice(0, 4) || 'SÉLECTION VIDZY'}`;
    const runtime = details.runtime || (details.episode_run_time || [])[0];
    $('#modalMeta').textContent = `${date.slice(0, 4) || 'Année inconnue'} · ★ ${Number(details.vote_average || 0).toFixed(1)}${runtime ? ` · ${runtime} min` : ''}`;
    $('#modalOverview').textContent = details.overview || 'Aucun synopsis disponible.';
    $('#modalGenres').innerHTML = (details.genres || []).map(genre => `<span>${esc(genre.name)}</span>`).join('');
    const directors = (details.credits?.crew || []).filter(person => person.job === 'Director').map(person => person.name);
    const creators = (details.created_by || []).map(person => person.name);
    const frenchAgeRating = type === 'movie'
      ? (details.release_dates?.results || []).find(entry => entry.iso_3166_1 === 'FR')?.release_dates?.find(entry => entry.certification)?.certification
      : (details.content_ratings?.results || []).find(entry => entry.iso_3166_1 === 'FR')?.rating;
    const facts = [
      frenchAgeRating ? `Classification : ${frenchAgeRating}` : '',
      (details.original_title || details.original_name) && (details.original_title || details.original_name) !== (details.title || details.name)
        ? `Titre original : ${details.original_title || details.original_name}` : '',
      (directors.length || creators.length) ? `${type === 'movie' ? 'Réalisation' : 'Création'} : ${[...directors, ...creators].slice(0, 3).join(', ')}` : '',
      details.status ? `Statut : ${details.status}` : '',
      (details.production_countries || []).length ? `Pays : ${details.production_countries.map(country => country.name).slice(0, 3).join(', ')}` : '',
      (details.spoken_languages || []).length ? `Langues : ${details.spoken_languages.map(language => language.english_name || language.name).slice(0, 4).join(', ')}` : '',
      type !== 'movie' && details.number_of_seasons ? `${details.number_of_seasons} saison${details.number_of_seasons > 1 ? 's' : ''} · ${details.number_of_episodes || 0} épisodes` : ''
    ].filter(Boolean);
    $('#modalFacts').innerHTML = facts.map(fact => `<span>${esc(fact)}</span>`).join('');
    const cast = (details.credits?.cast || []).filter(person => person.name).slice(0, 12);
    $('#castSection').classList.toggle('hidden', !cast.length);
    $('#modalCast').innerHTML = cast.map(person => {
      const initials = person.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('');
      return `
        <button class="cast-card" type="button" data-person-id="${person.id}" aria-label="Ouvrir la fiche de ${esc(person.name)}">
          <div class="cast-photo">
            ${person.profile_path
              ? `<img loading="lazy" src="${tmdbImageUrl(person.profile_path, 'w300')}" alt="Photo de ${esc(person.name)}">`
              : `<span aria-hidden="true">${esc(initials)}</span>`}
          </div>
          <strong>${esc(person.name)}</strong>
          <small>${esc(person.character || 'Rôle non renseigné')}</small>
        </button>`;
    }).join('');
    $('#modalCast').querySelectorAll('.cast-card').forEach(card => {
      card.addEventListener('click', () => {
        openPerson(card.dataset.personId);
      });
    });
    state.selectedItem = {
      ...(item || {}),
      id: Number(id), type,
      title: details.title || details.name || item?.title || 'Titre inconnu',
      year: date.slice(0, 4),
      rating: Number(details.vote_average || item?.rating || 0),
      runtime: Number(runtime || item?.runtime || 0),
      poster: item?.poster || tmdbImageUrl(details.poster_path, 'w500'),
      backdrop: item?.backdrop || tmdbImageUrl(details.backdrop_path, 'w1280'),
      overview: details.overview || item?.overview || ''
    };
    if (type === 'movie') await showVidzyStatus(id);
    updateDetailFavorite();
    const isMovie = type === 'movie';
    $('#seriesControls').classList.toggle('hidden', isMovie);
    $('#nextEpisode').classList.add('hidden');
    currentEpisodes = [];
    if (isMovie) $('#play').textContent = '▶ Regarder maintenant';
    if (!isMovie) {
      const seasons = (details.seasons || []).filter(season => Number.isInteger(season.season_number));
      $('#season').innerHTML = seasons.map(season =>
        `<option value="${season.season_number}">${season.season_number === 0 ? 'Épisodes spéciaux' : `Saison ${season.season_number}`}</option>`
      ).join('');
      const rememberedSeason = Number(item?.lastSeason);
      const defaultSeason = seasons.some(season => season.season_number === rememberedSeason)
        ? rememberedSeason
        : (seasons.find(season => season.season_number > 0)?.season_number ?? seasons[0]?.season_number ?? 1);
      $('#season').value = String(defaultSeason);
      await loadSeason(id, defaultSeason, Number(item?.lastEpisode) || 1);
    }
    renderRecommendations(details.recommendations?.results || []);
    renderRecommendations(details.similar?.results || [], '#similarSection', '#similarRail');
    loadTrailer(type, id);
  } catch (error) {
    alert(`Impossible d’ouvrir ce contenu : ${error.message}`);
  }
}

async function loadSeason(seriesId, seasonNumber, preferredEpisode = 1) {
  $('#episodesList').innerHTML = '<div class="episodes-loading">Chargement des épisodes…</div>';
  try {
    const season = await json(`/api/season/${seriesId}/${seasonNumber}`);
    const episodes = season.episodes || [];
    currentEpisodes = episodes;
    if (!episodes.length) {
      $('#episodesList').innerHTML = '<div class="episodes-loading">Aucun épisode disponible pour cette saison.</div>';
      return;
    }
    const selectedEpisode = episodes.some(episode => episode.number === preferredEpisode)
      ? preferredEpisode : episodes[0].number;
    selectedEpisodeRuntime = Number(episodes.find(episode => episode.number === selectedEpisode)?.runtime || 0);
    $('#episode').value = String(selectedEpisode);
    $('#episodesList').innerHTML = episodes.map(episode => {
      const episodeImage = episode.image || state.selectedItem?.backdrop || state.selectedItem?.poster || '';
      const progress = watchProgress[`series:${seriesId}:${seasonNumber}:${episode.number}`] || {};
      const completed = Boolean(progress.completed) || (progress.durationSeconds && progress.seconds / progress.durationSeconds >= .9);
      return `
      <button class="episode-card ${episode.number === selectedEpisode ? 'active' : ''} ${completed ? 'completed' : ''}" type="button" data-episode="${episode.number}">
        <span class="episode-image ${episode.image ? '' : 'episode-image-fallback'}">${episodeImage ? `<img loading="lazy" src="${episodeImage}" alt="Illustration de l’épisode ${episode.number}">` : ''}<span>▶</span></span>
        <span class="episode-copy"><h4>${episode.number}. ${esc(episode.name)} ${completed ? '<span class="episode-status">✓ Terminé</span>' : ''}</h4><p>${esc(episode.overview || 'Résumé bientôt disponible.')}</p></span>
        <span class="episode-meta">${[
          episode.airDate ? new Date(`${episode.airDate}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
          episode.runtime ? `${episode.runtime} min` : '',
          episode.rating ? `★ ${episode.rating.toFixed(1)}` : ''
        ].filter(Boolean).join(' · ')}</span>
      </button>`;
    }).join('');
    $('#episodesList').querySelectorAll('.episode-card').forEach(card => {
      card.addEventListener('click', () => {
        $('#episode').value = card.dataset.episode;
        $('#episodesList').querySelectorAll('.episode-card').forEach(item => item.classList.remove('active'));
        card.classList.add('active');
        selectedEpisodeRuntime = Number(episodes.find(episode => String(episode.number) === card.dataset.episode)?.runtime || 0);
        if (state.selectedItem) rememberWatch({ ...state.selectedItem, lastSeason: Number(seasonNumber), lastEpisode: Number(card.dataset.episode) });
        $('#play').textContent = `▶ Regarder S${seasonNumber} E${card.dataset.episode}`;
        updateNextEpisodeButton();
      });
    });
    $('#play').textContent = `▶ Regarder S${seasonNumber} E${selectedEpisode}`;
    updateNextEpisodeButton();
  } catch (error) {
    $('#episodesList').innerHTML = `<div class="episodes-loading">Impossible de charger les épisodes : ${esc(error.message)}</div>`;
  }
}

function updateNextEpisodeButton() {
  const button = $('#nextEpisode');
  const currentNumber = Number($('#episode').value);
  const currentIndex = currentEpisodes.findIndex(episode => episode.number === currentNumber);
  const next = currentIndex >= 0 ? currentEpisodes[currentIndex + 1] : null;
  button.classList.toggle('hidden', !next);
  if (next) {
    button.textContent = `Épisode ${next.number} →`;
    button.dataset.episode = String(next.number);
  } else {
    delete button.dataset.episode;
  }
}

async function showVidzyStatus(id) {
  try {
    const status = await json(`/api/vidzy/${id}`);
    if (!status.available) {
      $('#availability').textContent = 'Indisponible sur Vidzy';
      return;
    }
    const languages = (status.languages || []).map(language => String(language).toUpperCase());
    $('#availability').textContent = `✓ Disponible sur Vidzy${languages.length ? ` · ${languages.join(' · ')}` : ''}`;
    if (state.selectedItem) state.selectedItem.vidzyLanguages = status.languages || [];
    [...$('#playLanguage').options].forEach(option => {
      option.disabled = Boolean(option.value) && languages.length > 0 && !languages.includes(option.value.toUpperCase());
    });
    if ($('#playLanguage').selectedOptions[0]?.disabled) $('#playLanguage').value = '';
  } catch {
    $('#availability').textContent = '';
  }
}

function renderRecommendations(items, sectionSelector = '#recommendationsSection', railSelector = '#recommendationsRail') {
  const section = $(sectionSelector);
  const available = items.filter(item => item.backdrop || item.poster).slice(0, 8);
  section.classList.toggle('hidden', !available.length);
  $(railSelector).innerHTML = available.map(item => `
    <button class="recommendation-card" type="button" data-id="${item.id}" data-type="${item.type}" aria-label="Voir ${esc(item.title)}">
      <img loading="lazy" src="${item.backdrop || item.poster}" alt="">
      <span>${esc(item.title)}</span>
    </button>`).join('');
  $(railSelector).querySelectorAll('.recommendation-card').forEach((card) => {
    const item = available.find(entry => String(entry.id) === card.dataset.id && entry.type === card.dataset.type);
    card.addEventListener('click', () => openItem(card.dataset.type, card.dataset.id, item));
  });
}

async function loadTrailer(type, id) {
  try {
    const trailer = await json(`/api/videos/${type}/${id}`);
    if (!trailer.available || !/^[\w-]{6,20}$/.test(trailer.key || '')) {
      $('#trailerUnavailable').classList.remove('hidden');
      return;
    }
    $('#trailerLanguage').textContent = trailer.language === 'fr' ? 'Version française' : 'Version originale';
    $('#trailerPlayer').src = `https://www.youtube-nocookie.com/embed/${trailer.key}?rel=0&modestbranding=1`;
    $('#trailerSection').classList.remove('hidden');
  } catch {
    $('#trailerUnavailable').classList.remove('hidden');
  }
}

function updateDetailFavorite() {
  const button = $('#favoriteDetail');
  if (!button || !state.selectedItem) return;
  const active = isFavorite(state.selectedItem.type, state.selectedItem.id);
  button.textContent = active ? '♥ Dans ma liste' : '♡ Ajouter à ma liste';
}

function vidzyUrl() {
  const selected = state.selected;
  if (!selected) return '';
  let url = `https://vidzy.org/${selected.type === 'movie' ? 'movie' : 'serie'}/${selected.id}`;
  if (selected.type !== 'movie') {
    url += `/${Math.max(0, Number($('#season').value) || 0)}/${Math.max(1, Number($('#episode').value) || 1)}`;
  }
  const params = new URLSearchParams({ autonext: '1', color: '765cff', info: 'title,year,rating,genres' });
  const language = $('#playLanguage').value;
  if (language) params.set('lang', language);
  return `${url}?${params}`;
}

function openPlayerPage() {
  if (!state.selected) return;
  const watchItem = state.selected.type === 'movie' ? state.selectedItem : {
    ...state.selectedItem,
    lastSeason: Math.max(0, Number($('#season').value) || 0),
    lastEpisode: Math.max(1, Number($('#episode').value) || 1)
  };
  rememberWatch(watchItem);
  const isMovie = state.selected.type === 'movie';
  const season = isMovie ? 0 : Math.max(0, Number($('#season').value) || 0);
  const episode = isMovie ? 0 : Math.max(1, Number($('#episode').value) || 1);
  const durationMinutes = isMovie ? Number(state.selectedItem?.runtime || 0) : selectedEpisodeRuntime;
  const source = vidzyUrl();
  $('#inlinePlayerTitle').textContent = $('#modalTitle').textContent || 'Lecture Vidzy';
  const language = $('#playLanguage').value.toUpperCase();
  $('#inlinePlayerMeta').textContent = `${isMovie ? 'Film' : `Saison ${season} · Épisode ${episode}`}${language ? ` · ${language}` : ''}`;
  $('#inlinePlayerExternal').href = source;
  $('#inlinePlayer').classList.remove('hidden', 'loaded');
  $('#inlinePlayerFrame').src = source;
  $('#modal').classList.add('hidden');
  $('#modal').setAttribute('aria-hidden', 'true');
  inlineProgressContext = {
    key: isMovie ? `movie:${state.selected.id}` : `series:${state.selected.id}:${season}:${episode}`,
    durationSeconds: Math.max(60, durationMinutes ? durationMinutes * 60 : 7200)
  };
  window.clearInterval(inlineProgressTimer);
  inlineProgressTimer = window.setInterval(saveInlineProgress, 5000);
  history.pushState({ vidzyPlayer: true }, '', location.href);
  $('#inlinePlayer').requestFullscreen?.().catch(() => {});
}

function saveInlineProgress(force = false) {
  if (!inlineProgressContext || (document.hidden && !force)) return;
  const current = watchProgress[inlineProgressContext.key] || { seconds: 0 };
  watchProgress[inlineProgressContext.key] = {
    seconds: Math.min(Number(current.seconds || 0) + 5, Math.round(inlineProgressContext.durationSeconds * .95)),
    durationSeconds: inlineProgressContext.durationSeconds,
    updatedAt: Date.now()
  };
  localStorage.setItem(progressKey, JSON.stringify(watchProgress));
}

function markCurrentEpisodeCompleted() {
  if (!inlineProgressContext && state.selected?.type === 'movie') return;
  const season = Math.max(0, Number($('#season').value) || 0);
  const episode = Math.max(1, Number($('#episode').value) || 1);
  const key = `series:${state.selected.id}:${season}:${episode}`;
  const durationSeconds = Math.max(60, selectedEpisodeRuntime ? selectedEpisodeRuntime * 60 : 2700);
  watchProgress[key] = { seconds: durationSeconds, durationSeconds, completed: true, updatedAt: Date.now() };
  localStorage.setItem(progressKey, JSON.stringify(watchProgress));
  const card = $(`#episodesList .episode-card[data-episode="${episode}"]`);
  card?.classList.add('completed');
  const title = card?.querySelector('h4');
  if (title && !title.querySelector('.episode-status')) title.insertAdjacentHTML('beforeend', ' <span class="episode-status">✓ Terminé</span>');
}

function restoreDetailAfterPlayer(updateHistory = true) {
  if ($('#inlinePlayer').classList.contains('hidden')) return;
  saveInlineProgress(true);
  window.clearInterval(inlineProgressTimer);
  inlineProgressTimer = 0;
  inlineProgressContext = null;
  $('#inlinePlayer').classList.add('hidden');
  $('#inlinePlayer').classList.remove('loaded');
  $('#inlinePlayerFrame').src = '';
  $('#modal').classList.remove('hidden');
  $('#modal').setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (updateHistory && history.state?.vidzyPlayer) history.back();
}

function closeInlinePlayer() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => restoreDetailAfterPlayer(true));
  } else {
    restoreDetailAfterPlayer(true);
  }
}

async function checkVidzy() {
  if (!state.selected) return;
  $('#availability').textContent = 'Vérification Vidzy…';
  try {
    const data = await json(`/api/vidzy/${state.selected.id}`);
    $('#availability').textContent = data.available
      ? `Disponible : ${(data.languages || []).map((language) => language.toUpperCase()).join(', ') || 'langue automatique'}`
      : 'Vidzy ne signale pas ce contenu comme disponible.';
  } catch (error) {
    $('#availability').textContent = `Vérification impossible : ${error.message}`;
  }
}

document.querySelectorAll('.tab[data-type]').forEach((button) => {
  button.addEventListener('click', async () => {
    showCatalogueView(false);
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.type = button.dataset.type;
    state.page = 1;
    state.query = '';
    state.favoritesOnly = false;
    $('#favoritesBtn').classList.remove('active');
    $('#filters').classList.remove('hidden');
    $('.pagination').classList.remove('hidden');
    $('#search').value = '';
    $('#genre').value = '';
    $('#year').value = '';
    $('#sort').innerHTML = state.type === 'movie'
      ? '<option value="popularity.desc">Les plus populaires</option><option value="vote_average.desc">Les mieux notés</option><option value="primary_release_date.desc">Les plus récents</option>'
      : '<option value="popularity.desc">Les plus populaires</option><option value="vote_average.desc">Les mieux notées</option><option value="first_air_date.desc">Les plus récentes</option>';
    await loadGenres();
    await load();
  });
});

$('#homeTab').onclick = async () => {
  showCatalogueView();
  document.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
  $('#homeTab').classList.add('active');
  $('#filters').classList.remove('hidden');
  $('.pagination').classList.remove('hidden');
  $('#sectionTitle').textContent = state.type === 'movie' ? 'Catalogue Films' : 'Catalogue Séries';
  await loadHome();
};

$('#filters').addEventListener('submit', (event) => { event.preventDefault(); state.query = $('#search').value.trim(); state.page = 1; load(); });
$('#clearBtn').addEventListener('click', () => {
  state.query = ''; state.page = 1; $('#search').value = ''; $('#genre').value = ''; $('#year').value = ''; load();
});
['#genre', '#sort', '#year'].forEach((selector) => $(selector).addEventListener('change', () => { state.query = ''; state.page = 1; load(); }));
function changePage(delta) { state.page = Math.min(state.totalPages, Math.max(1, state.page + delta)); load(); window.scrollTo({ top: 300, behavior: 'smooth' }); }
$('#prev').onclick = $('#prev2').onclick = () => changePage(-1);
$('#next').onclick = $('#next2').onclick = () => changePage(1);
function closeModal() {
  $('#trailerPlayer').src = '';
  $('#modal').classList.add('hidden');
  $('#modal').setAttribute('aria-hidden', 'true');
  $('#modalHero').classList.remove('hidden');
  document.body.classList.remove('no-scroll');
}
$('#close').onclick = closeModal;
$('#modal').onclick = (event) => { if (event.target === $('#modal')) $('#close').click(); };
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('#inlinePlayer').classList.contains('hidden')) {
    closeInlinePlayer();
  } else if (!$('#personPage').classList.contains('hidden')) {
    closePerson();
  } else if (!$('#profileMenu').classList.contains('hidden')) {
    $('#profileMenu').classList.add('hidden');
    $('#profileBtn').setAttribute('aria-expanded', 'false');
  } else if (!$('#globalSearch').classList.contains('hidden')) closeGlobalSearch();
  else if (!$('#modal').classList.contains('hidden')) $('#close').click();
});
$('#personClose').onclick = closePerson;
$('#personPage').onclick = event => { if (event.target === $('#personPage')) closePerson(); };
$('#personBioToggle').onclick = () => {
  const collapsed = $('#personBiography').classList.toggle('collapsed');
  $('#personBioToggle').textContent = collapsed ? 'Lire la biographie complète' : 'Réduire la biographie';
};
$('#play').onclick = openPlayerPage;
$('#nextEpisode').onclick = () => {
  const nextEpisode = $('#nextEpisode').dataset.episode;
  if (!nextEpisode) return;
  markCurrentEpisodeCompleted();
  const card = [...$('#episodesList').querySelectorAll('.episode-card')]
    .find(item => item.dataset.episode === nextEpisode);
  card?.click();
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
$('#playLanguage').addEventListener('change', () => localStorage.setItem(languageKey, $('#playLanguage').value));
$('#favoriteDetail').onclick = () => toggleFavorite(state.selectedItem);
$('#season').addEventListener('change', () => {
  if (state.selected?.type !== 'movie') loadSeason(state.selected.id, Number($('#season').value), 1);
});
$('#favoritesBtn').onclick = () => {
  state.favoritesOnly = !state.favoritesOnly;
  $('#favoritesBtn').classList.toggle('active', state.favoritesOnly);
  $('#sectionTitle').textContent = state.favoritesOnly ? 'Ma liste' : (state.type === 'movie' ? 'Catalogue Films' : 'Catalogue Séries');
  $('#count').textContent = state.favoritesOnly ? `${favorites.length} titre${favorites.length > 1 ? 's' : ''}` : '';
  $('#filters').classList.toggle('hidden', state.favoritesOnly);
  $('.pagination').classList.toggle('hidden', state.favoritesOnly);
  $('#clearListBtn').classList.toggle('hidden', !state.favoritesOnly || !favorites.length);
  render(state.favoritesOnly ? favorites : []);
  if (!state.favoritesOnly) load();
  document.querySelector('.catalogue').scrollIntoView({ behavior: 'smooth' });
};
$('#clearHistoryBtn').onclick = () => {
  if (!watchHistory.length || !confirm('Effacer tout l’historique et les contenus récemment consultés ?')) return;
  watchHistory = [];
  localStorage.setItem(historyKey, '[]');
  renderHistory();
};
$('#clearListBtn').onclick = () => {
  if (!favorites.length || !confirm('Vider entièrement Ma liste ?')) return;
  favorites = [];
  saveFavorites();
  render([]);
  $('#count').textContent = '0 titre';
  $('#clearListBtn').classList.add('hidden');
};
$('#liveTab').onclick = () => enterLive('', $('#liveTab'));
$('#liveSearch').addEventListener('input', () => { liveVisibleLimit = 60; renderLiveChannels(); });
['#liveCategory', '#liveCountry'].forEach(selector => $(selector).addEventListener('change', () => { liveVisibleLimit = 60; renderLiveChannels(); }));
$('#liveMore').onclick = () => { liveVisibleLimit += 60; renderLiveChannels(); };
$('#globalSearchBtn').onclick = openGlobalSearch;
$('#globalSearchClose').onclick = closeGlobalSearch;
$('#globalSearch').addEventListener('click', event => { if (event.target === $('#globalSearch')) closeGlobalSearch(); });
$('#globalSearchInput').addEventListener('input', () => {
  window.clearTimeout(globalSearchTimer);
  globalSearchTimer = window.setTimeout(runGlobalSearch, 320);
});
['#globalSearchType', '#globalSearchYear', '#globalSearchRating'].forEach(selector => {
  $(selector).addEventListener('change', () => {
    if ($('#globalSearchInput').value.trim().length >= 2) runGlobalSearch();
  });
});
$('#globalSearchClear').onclick = () => {
  globalSearchController?.abort();
  $('#globalSearchInput').value = '';
  $('#globalSearchType').value = '';
  $('#globalSearchYear').value = '';
  $('#globalSearchRating').value = '0';
  globalSearchItems = [];
  $('#globalSearchResults').innerHTML = '<p class="global-search-message">Commencez à écrire pour explorer tout le catalogue.</p>';
  $('#globalSearchInput').focus();
};
$('#heroPrev').onclick = () => { showFeatured(featuredIndex - 1); startHeroRotation(); };
$('#heroNext').onclick = () => { showFeatured(featuredIndex + 1); startHeroRotation(); };
$('#hero').addEventListener('mouseenter', () => window.clearInterval(heroRotationTimer));
$('#hero').addEventListener('mouseleave', startHeroRotation);
$('#inlinePlayerBack').onclick = closeInlinePlayer;
$('#inlinePlayerFrame').addEventListener('load', () => $('#inlinePlayer').classList.add('loaded'));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !$('#inlinePlayer').classList.contains('hidden')) {
    restoreDetailAfterPlayer(true);
  }
});
window.addEventListener('popstate', () => {
  if (!$('#inlinePlayer').classList.contains('hidden')) restoreDetailAfterPlayer(false);
});
window.addEventListener('pagehide', saveInlineProgress);
$('#profileBtn').onclick = () => {
  const opening = $('#profileMenu').classList.contains('hidden');
  $('#profileMenu').classList.toggle('hidden', !opening);
  $('#profileBtn').setAttribute('aria-expanded', String(opening));
};
document.addEventListener('click', event => {
  if (!event.target.closest('.profile-wrap')) {
    $('#profileMenu').classList.add('hidden');
    $('#profileBtn').setAttribute('aria-expanded', 'false');
  }
});
window.addEventListener('pageshow', () => {
  try { watchProgress = JSON.parse(localStorage.getItem(progressKey) || '{}') || {}; } catch { watchProgress = {}; }
  renderHistory();
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  $('#installApp').classList.remove('hidden');
});
$('#installApp').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#installApp').classList.add('hidden');
};
window.addEventListener('appinstalled', () => $('#installApp').classList.add('hidden'));
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
init();
