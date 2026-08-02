(() => {
  const params = new URLSearchParams(location.search);
  const channelId = params.get('ch') || '';
  const name = params.get('name') || 'Chaîne en direct';
  const valid = /^[a-zA-Z0-9_-]{1,80}$/.test(channelId);
  const player = document.querySelector('#livePlayer');
  const fullscreenButton = document.querySelector('#fullscreenBtn');
  const startFullscreen = document.querySelector('#startFullscreen');
  const adShield = document.querySelector('#adShield');
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
    startFullscreen.classList.add('hidden');
    adShield.classList.add('hidden');
    return;
  }
  const source = `https://hesgoaler.com/madra.php?ch=${encodeURIComponent(channelId)}`;
  player.src = source;
  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      startFullscreen.classList.add('hidden');
    } catch { startFullscreen.classList.remove('hidden'); }
  };
  fullscreenButton.addEventListener('click', enterFullscreen);
  startFullscreen.addEventListener('click', enterFullscreen);
  player.addEventListener('load', () => {
    startFullscreen.classList.remove('hidden');
    enterFullscreen();
  }, { once: true });
  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    fullscreenButton.textContent = active ? '× Quitter le plein écran' : '⛶ Plein écran';
    startFullscreen.classList.toggle('hidden', active);
  });
  adShield.addEventListener('contextmenu', event => event.preventDefault());
})();
