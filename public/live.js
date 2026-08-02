(() => {
  const params = new URLSearchParams(location.search);
  let channelId = params.get('ch') || '';
  let name = params.get('name') || 'Chaîne en direct';
  const valid = /^[a-zA-Z0-9_-]{1,80}$/.test(channelId);
  const player = document.querySelector('#livePlayer');
  const fullscreenButton = document.querySelector('#fullscreenBtn');
  const adShield = document.querySelector('#adShield');
  const previousChannel = document.querySelector('#previousChannel');
  const nextChannel = document.querySelector('#nextChannel');
  const channelPosition = document.querySelector('#channelPosition');
  let channels = [];
  document.querySelector('#channelName').textContent = name;
  document.title = `${name} — Vidzy Direct`;
  document.querySelector('#backBtn').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = '/#direct';
  });
  if (!valid) {
    document.querySelector('#error').classList.remove('hidden');
    player.classList.add('hidden');
    fullscreenButton.classList.add('hidden');
    adShield.classList.add('hidden');
    return;
  }
  const tune = (channel, replace = false) => {
    if (!channel || !/^[a-zA-Z0-9_-]{1,80}$/.test(channel.id)) return;
    channelId = channel.id;
    name = channel.name || channel.id;
    document.querySelector('#channelName').textContent = name;
    document.title = `${name} — Vidzy Direct`;
    player.src = `https://hesgoaler.com/madra.php?ch=${encodeURIComponent(channelId)}`;
    const target = new URL(location.href);
    target.searchParams.set('ch', channelId);
    target.searchParams.set('name', name);
    history[replace ? 'replaceState' : 'pushState']({ channelId }, '', target);
    const index = channels.findIndex(item => item.id === channelId);
    channelPosition.textContent = index >= 0 ? `${index + 1} / ${channels.length}` : '';
  };
  const zap = delta => {
    if (!channels.length) return;
    const current = Math.max(0, channels.findIndex(channel => channel.id === channelId));
    tune(channels[(current + delta + channels.length) % channels.length]);
  };
  previousChannel.addEventListener('click', () => zap(-1));
  nextChannel.addEventListener('click', () => zap(1));
  document.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') zap(-1);
    if (event.key === 'ArrowRight') zap(1);
  });
  fetch('/api/live', { headers: { accept: 'application/json' } })
    .then(response => response.ok ? response.json() : Promise.reject(new Error('Direct indisponible')))
    .then(payload => {
      const data = payload.ok === true ? payload.data : payload;
      channels = Array.isArray(data.channels) ? data.channels : [];
      const current = channels.find(channel => channel.id === channelId);
      if (current) tune(current, true);
      else channelPosition.textContent = '';
    })
    .catch(() => { channelPosition.textContent = ''; });
  player.src = `https://hesgoaler.com/madra.php?ch=${encodeURIComponent(channelId)}`;
  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {}
  };
  fullscreenButton.addEventListener('click', enterFullscreen);
  player.addEventListener('load', () => {
    enterFullscreen();
  }, { once: true });
  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    fullscreenButton.textContent = active ? '× Quitter le plein écran' : '⛶ Plein écran';
  });
  adShield.addEventListener('contextmenu', event => event.preventDefault());
})();
