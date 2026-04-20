(function () {
  const $ = (id) => document.getElementById(id);
  const cfg = window.METASPACE_CONFIG || { apiBase: '', environment: 'server' };
  const api = (path) => (cfg.apiBase || '') + path;
  const staticMode = cfg.environment === 'pages' && !cfg.apiBase;

  function renderStatus(s) {
    $('bState').textContent = s.online ? '온라인' : '오프라인';
    $('bStarted').textContent = new Date(s.startedAt).toLocaleString();
    $('bCount').textContent = s.messageCount;
    $('bSubs').textContent = s.subscribers;
    const badge = $('bridgeBadge');
    badge.textContent = s.online ? 'ONLINE' : 'OFFLINE';
    badge.className = 'badge ' + (s.online ? 'on' : 'off');
  }

  function renderStaticNotice() {
    renderStatus({
      online: false,
      startedAt: new Date().toISOString(),
      messageCount: 0,
      subscribers: 0,
    });
    const ul = $('logList');
    ul.innerHTML =
      '<li class="muted" style="display:block">정적 배포(GitHub Pages) 모드입니다. ' +
      'config.js의 apiBase를 Node 서버 주소로 설정하면 브릿지가 활성화됩니다.</li>';
  }

  async function refresh() {
    if (staticMode) {
      renderStaticNotice();
      return;
    }
    try {
      const [s, m] = await Promise.all([
        fetch(api('/api/bridge/status')).then((r) => r.json()),
        fetch(api('/api/bridge/messages')).then((r) => r.json()),
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
    if (staticMode) return;
    await fetch(api('/api/bridge/toggle'), { method: 'POST' });
    refresh();
  });

  $('sendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (staticMode) {
      alert('정적 모드에서는 전송할 수 없습니다. config.js의 apiBase를 설정하세요.');
      return;
    }
    const data = Object.fromEntries(new FormData(e.target).entries());
    const res = await fetch(api('/api/bridge/send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) e.target.reset();
    refresh();
  });

  refresh();
  if (!staticMode) setInterval(refresh, 3000);
})();
