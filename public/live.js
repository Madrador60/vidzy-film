(() => {
  const params = new URLSearchParams(location.search);
  const channelId = params.get('ch') || '';
  const name = params.get('name') || 'Chaîne en direct';
  const valid = /^[a-zA-Z0-9_-]{1,80}$/.test(channelId);
  const player = document.querySelector('#livePlayer');
  const external = document.querySelector('#externalLink');
  document.querySelector('#channelName').textContent = name;
  document.title = `${name} — Vidzy Direct`;
  document.querySelector('#backBtn').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = '/#direct';
  });
  if (!valid) {
    document.querySelector('#error').classList.remove('hidden');
    player.classList.add('hidden');
    external.classList.add('hidden');
    return;
  }
  const source = `https://hesgoaler.com/madra.php?ch=${encodeURIComponent(channelId)}`;
  player.src = source;
  external.href = source;
})();
