(function () {
  const $ = (id) => document.getElementById(id);

  function renderStatus(s) {
    $('bState').textContent = s.online ? '온라인' : '오프라인';
    $('bStarted').textContent = new Date(s.startedAt).toLocaleString();
    $('bCount').textContent = s.messageCount;
    $('bSubs').textContent = s.subscribers;
    const badge = $('bridgeBadge');
    badge.textContent = s.online ? 'ONLINE' : 'OFFLINE';
    badge.className = 'badge ' + (s.online ? 'on' : 'off');
  }

  async function refresh() {
    try {
      const [s, m] = await Promise.all([
        fetch('/api/bridge/status').then(r => r.json()),
        fetch('/api/bridge/messages').then(r => r.json()),
      ]);
      renderStatus(s);
      renderLog(m);
    } catch (e) {
      $('bState').textContent = '연결 실패';
    }
  }

  function renderLog(messages) {
    const ul = $('logList');
    ul.innerHTML = '';
    if (!messages.length) {
      ul.innerHTML = '<li class="muted" style="display:block">아직 메시지가 없습니다.</li>';
      return;
    }
    messages.forEach((m) => {
      const li = document.createElement('li');
      const time = new Date(m.ts).toLocaleTimeString();
      const tag = m.inbound
        ? '<span class="in">IN</span>'
        : (m.delivered ? '<span class="ok">OK</span>' : '<span class="fail">FAIL</span>');
      li.innerHTML =
        `<span class="t">${time}</span>` +
        `<span><b>${m.chatId || 'local'}</b> ${escapeHtml(m.text || '')}${m.note ? ' <span class="muted">· ' + m.note + '</span>' : ''}</span>` +
        tag;
      ul.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  $('toggleBtn').addEventListener('click', async () => {
    await fetch('/api/bridge/toggle', { method: 'POST' });
    refresh();
  });

  $('sendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const res = await fetch('/api/bridge/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) e.target.reset();
    refresh();
  });

  refresh();
  setInterval(refresh, 3000);
})();
