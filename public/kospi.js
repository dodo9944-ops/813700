// 코스피200 야간선물 실시간 뷰어
// 서버의 /api/kospi-night 프록시에서 정규화된 시세를 받아 표시한다.
(function () {
  const apiBase = (window.METASPACE_CONFIG && window.METASPACE_CONFIG.apiBase) || '';
  const $ = (id) => document.getElementById(id);

  const el = {
    session: $('sessionPill'),
    name: $('quoteName'),
    src: $('srcBadge'),
    value: $('quoteValue'),
    change: $('quoteChange'),
    sparkLine: $('sparkLine'),
    prev: $('mPrev'),
    time: $('mTime'),
    fetched: $('mFetched'),
    source: $('mSource'),
    auto: $('autoToggle'),
    refresh: $('refreshBtn'),
    hint: $('hint'),
    card: $('quoteCard'),
  };

  const samples = []; // 세션 동안 모은 시세로 스파크라인을 그린다
  const MAX_SAMPLES = 80;
  let timer = null;

  const fmt = (n, d = 2) =>
    n == null || !Number.isFinite(n)
      ? '—'
      : n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });

  function shortTime(iso) {
    const t = new Date(iso);
    if (isNaN(t)) return String(iso || '—');
    return t.toLocaleTimeString('ko-KR', { hour12: false });
  }

  function setTone(change) {
    el.card.classList.remove('up', 'down', 'flat');
    if (change == null || change === 0) el.card.classList.add('flat');
    else el.card.classList.add(change > 0 ? 'up' : 'down');
  }

  function drawSpark() {
    if (samples.length < 2) {
      el.sparkLine.setAttribute('points', '');
      return;
    }
    const W = 600,
      H = 120,
      pad = 6;
    const min = Math.min(...samples),
      max = Math.max(...samples);
    const span = max - min || 1;
    const pts = samples.map((v, i) => {
      const x = (i / (samples.length - 1)) * W;
      const y = H - pad - ((v - min) / span) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    el.sparkLine.setAttribute('points', pts.join(' '));
  }

  function renderSession(session) {
    if (!session) return;
    el.session.textContent = session.open
      ? `장중 · ${session.kstTime} KST`
      : `장마감 · ${session.kstTime} KST`;
    el.session.classList.toggle('on', !!session.open);
    el.session.classList.toggle('off', !session.open);
    el.session.title = session.sessionLabel || '';
  }

  function render(d) {
    renderSession(d.session);

    if (d.status === 'unavailable' || d.status === 'error') {
      el.value.textContent = '시세 없음';
      el.change.textContent = '데이터 소스에 연결하지 못했습니다';
      el.card.classList.add('flat');
      el.hint.textContent =
        '서버가 시세 소스에 접근하지 못했습니다. 배포 환경의 아웃바운드 접근 허용 또는 ' +
        'KOSPI_NIGHT_API_URL 환경변수 설정을 확인하세요. (테스트: ?demo=1)';
      return;
    }

    el.name.textContent = d.name || '코스피200 야간선물';
    el.value.textContent = fmt(d.value);
    setTone(d.change);

    const sign = d.change > 0 ? '▲' : d.change < 0 ? '▼' : '–';
    const rate = d.changeRate != null ? ` (${d.changeRate > 0 ? '+' : ''}${fmt(d.changeRate)}%)` : '';
    el.change.textContent = `${sign} ${fmt(Math.abs(d.change ?? 0))}${rate}`;

    el.prev.textContent = fmt(d.prevClose);
    el.time.textContent = shortTime(d.time);
    el.fetched.textContent = shortTime(d.fetchedAt);
    el.source.textContent = d.source || '—';

    if (d.source === 'demo') {
      el.src.hidden = false;
      el.src.textContent = '데모';
    } else if (d.status === 'stale') {
      el.src.hidden = false;
      el.src.textContent = '지연(stale)';
    } else {
      el.src.hidden = true;
    }

    el.hint.textContent =
      d.status === 'stale' ? '최신 시세를 가져오지 못해 직전 값을 표시 중입니다.' : '';

    if (Number.isFinite(d.value)) {
      samples.push(d.value);
      if (samples.length > MAX_SAMPLES) samples.shift();
      drawSpark();
    }
  }

  async function load() {
    try {
      const url = apiBase + '/api/kospi-night' + location.search;
      const res = await fetch(url, { cache: 'no-store' });
      render(await res.json());
    } catch (e) {
      render({ status: 'error' });
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    if (el.auto.checked) timer = setInterval(load, 10000);
  }

  el.refresh.addEventListener('click', load);
  el.auto.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && el.auto.checked) load();
  });

  load();
  schedule();
})();
