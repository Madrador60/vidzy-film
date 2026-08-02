(() => {
  const params = new URLSearchParams(location.search);
  const rawType = params.get('type');
  const type = rawType === 'series' || rawType === 'serie' || rawType === 'tv' ? 'series' : 'movie';
  const id = Number.parseInt(params.get('id') || '', 10);
  const season = Math.max(1, Number.parseInt(params.get('season') || '1', 10) || 1);
  const episode = Math.max(1, Number.parseInt(params.get('episode') || '1', 10) || 1);
  const title = params.get('title') || 'Lecture Vidzy';
  const profile = /^[a-z0-9_-]{1,30}$/.test(params.get('profile') || '') ? params.get('profile') : 'madra';
  const durationMinutes = Math.max(0, Number.parseInt(params.get('duration') || '0', 10) || 0);
  const language = /^(vf|vostfr)$/.test(params.get('lang') || '') ? params.get('lang') : '';
  const progressStorageKey = `vidzy-progress-v1-${profile}`;
  const historyStorageKey = `vidzy-history-v2-${profile}`;
  const progressItemKey = type === 'movie' ? `movie:${id}` : `series:${id}:${season}:${episode}`;
  let progressItems = {};
  try { progressItems = JSON.parse(localStorage.getItem(progressStorageKey) || '{}') || {}; } catch { progressItems = {}; }
  let watchedSeconds = Number(progressItems[progressItemKey]?.seconds || 0);

  const player = document.querySelector('#watchPlayer');
  const errorBox = document.querySelector('#watchError');
  const loading = document.querySelector('#loading');
  const directLink = document.querySelector('#directLink');

  document.querySelector('#watchTitle').textContent = title;
  document.querySelector('#watchMeta').textContent = type === 'movie'
    ? `Film${language ? ` · ${language.toUpperCase()}` : ''}`
    : `Saison ${season} · Épisode ${episode}${language ? ` · ${language.toUpperCase()}` : ''}`;

  if (type === 'series') {
    try {
      const historyItems = JSON.parse(localStorage.getItem(historyStorageKey) || '[]');
      const updated = historyItems.map(item => String(item.id) === String(id)
        ? { ...item, lastSeason: season, lastEpisode: episode }
        : item);
      localStorage.setItem(historyStorageKey, JSON.stringify(updated));
    } catch {}
  }

  document.querySelector('#backBtn').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = '/';
  });

  if (!Number.isInteger(id) || id <= 0) {
    loading.classList.add('hidden');
    errorBox.querySelector('strong').textContent = 'Identifiant TMDB invalide.';
    errorBox.querySelector('span').textContent = 'Retourne au catalogue et sélectionne un contenu.';
    errorBox.classList.remove('hidden');
    directLink.classList.add('hidden');
    return;
  }

  const base = type === 'movie'
    ? `https://vidzy.org/movie/${id}`
    : `https://vidzy.org/serie/${id}/${season}/${episode}`;
  const options = new URLSearchParams({
    autoplay: '1',
    autonext: type === 'series' ? '1' : '0',
    color: '765cff',
    info: 'title,year,rating,genres,duration'
  });
  if (language) options.set('lang', language);
  const source = `${base}?${options.toString()}`;
  directLink.href = source;

  if (type === 'series') {
    const previousButton = document.querySelector('#previousEpisode');
    const nextButton = document.querySelector('#nextEpisode');
    previousButton.classList.toggle('hidden', episode <= 1);
    nextButton.classList.remove('hidden');
    previousButton.addEventListener('click', () => {
      const target = new URL(location.href);
      target.searchParams.set('episode', String(Math.max(1, episode - 1)));
      location.assign(target);
    });
    nextButton.addEventListener('click', () => {
      const target = new URL(location.href);
      target.searchParams.set('episode', String(episode + 1));
      location.assign(target);
    });
  }

  let loaded = false;
  const timeout = window.setTimeout(() => {
    if (!loaded) {
      loading.classList.add('hidden');
      errorBox.classList.remove('hidden');
    }
  }, 15000);

  player.addEventListener('load', () => {
    loaded = true;
    window.clearTimeout(timeout);
    loading.classList.add('hidden');
    errorBox.classList.add('hidden');
  }, { once: true });

  player.src = source;

  const saveProgress = () => {
    if (!loaded || document.hidden) return;
    watchedSeconds += 5;
    const durationSeconds = durationMinutes ? durationMinutes * 60 : 7200;
    progressItems[progressItemKey] = {
      seconds: Math.min(watchedSeconds, Math.round(durationSeconds * .95)),
      durationSeconds,
      updatedAt: Date.now()
    };
    localStorage.setItem(progressStorageKey, JSON.stringify(progressItems));
  };
  window.setInterval(saveProgress, 5000);
  window.addEventListener('pagehide', saveProgress);
})();
