// 코스피200 야간선물 실시간 뷰어 + 가격 추이 차트
// 서버 /api/kospi-night (현재 시세) 와 /api/kospi-night/history (시계열)에서
// 정규화된 데이터를 받아 표시한다.
(function () {
  const apiBase = (window.METASPACE_CONFIG && window.METASPACE_CONFIG.apiBase) || '';
  const $ = (id) => document.getElementById(id);

  const COLORS = { up: '#ff5c7c', down: '#35d0ff', flat: '#8a8fb5' }; // 상승=빨강/하락=파랑(한국식)
  const SVGNS = 'http://www.w3.org/2000/svg';

  const el = {
    session: $('sessionPill'),
    name: $('quoteName'),
    src: $('srcBadge'),
    value: $('quoteValue'),
    change: $('quoteChange'),
    chart: $('chart'),
    chartNote: $('chartNote'),
    prev: $('mPrev'),
    time: $('mTime'),
    fetched: $('mFetched'),
    source: $('mSource'),
    auto: $('autoToggle'),
    refresh: $('refreshBtn'),
    hint: $('hint'),
    card: $('quoteCard'),
  };

  const state = { series: [], prevClose: null };
  const MAX_POINTS = 800;
  let timer = null;

  const fmt = (n, d = 2) =>
    n == null || !Number.isFinite(n)
      ? '—'
      : n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });

  const ms = (v) => {
    const t = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  function shortTime(v) {
    const t = new Date(ms(v) ?? NaN);
    if (isNaN(t)) return String(v || '—');
    return t.toLocaleTimeString('ko-KR', { hour12: false });
  }
  const hhmm = (t) =>
    new Date(t).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });

  function dirColor() {
    const s = state.series;
    if (s.length < 1) return COLORS.flat;
    const ref = state.prevClose != null ? state.prevClose : s[0].v;
    const last = s[s.length - 1].v;
    if (last > ref) return COLORS.up;
    if (last < ref) return COLORS.down;
    return COLORS.flat;
  }

  // ── SVG 차트 그리기 ──────────────────────────────────────────────
  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function drawChart() {
    const s = state.series;
    el.chart.replaceChildren();
    if (s.length < 2) {
      el.chart.appendChild(
        svg('text', { x: 360, y: 150, fill: COLORS.flat, 'font-size': 13, 'text-anchor': 'middle' },
          '차트 데이터를 불러오는 중…')
      );
      return;
    }

    const W = 720, H = 300, P = { l: 54, r: 14, t: 14, b: 26 };
    const pw = W - P.l - P.r, ph = H - P.t - P.b;
    const color = dirColor();

    const tMin = s[0].t, tMax = s[s.length - 1].t, tSpan = tMax - tMin || 1;
    let vMin = Math.min(...s.map((p) => p.v));
    let vMax = Math.max(...s.map((p) => p.v));
    if (state.prevClose != null) { vMin = Math.min(vMin, state.prevClose); vMax = Math.max(vMax, state.prevClose); }
    const pad = (vMax - vMin) * 0.08 || 1;
    vMin -= pad; vMax += pad;
    const vSpan = vMax - vMin || 1;

    const X = (t) => P.l + ((t - tMin) / tSpan) * pw;
    const Y = (v) => P.t + (1 - (v - vMin) / vSpan) * ph;

    // 가로 격자 + y축 가격 라벨 (5단계)
    for (let i = 0; i <= 4; i++) {
      const v = vMin + (vSpan * i) / 4;
      const y = Y(v);
      el.chart.appendChild(svg('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#252a4d', 'stroke-width': 1 }));
      el.chart.appendChild(svg('text', { x: P.l - 8, y: y + 4, fill: '#8a8fb5', 'font-size': 11, 'text-anchor': 'end' }, fmt(v)));
    }

    // x축 시간 라벨 (시작/중간/끝)
    [0, Math.floor(s.length / 2), s.length - 1].forEach((idx, k) => {
      const p = s[idx];
      el.chart.appendChild(
        svg('text', { x: X(p.t), y: H - 8, fill: '#8a8fb5', 'font-size': 11, 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle' }, hhmm(p.t))
      );
    });

    // 전일종가 기준선
    if (state.prevClose != null) {
      const y = Y(state.prevClose);
      el.chart.appendChild(svg('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#8a8fb5', 'stroke-width': 1, 'stroke-dasharray': '4 4', 'stroke-opacity': 0.7 }));
      el.chart.appendChild(svg('text', { x: W - P.r, y: y - 4, fill: '#8a8fb5', 'font-size': 10, 'text-anchor': 'end' }, `전일 ${fmt(state.prevClose)}`));
    }

    // 영역 + 라인
    const line = s.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${X(tMax).toFixed(1)},${Y(vMin).toFixed(1)} L${X(tMin).toFixed(1)},${Y(vMin).toFixed(1)} Z`;
    el.chart.appendChild(svg('path', { d: area, fill: color, 'fill-opacity': 0.12, stroke: 'none' }));
    el.chart.appendChild(svg('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));

    // 마지막 점 + 값
    const last = s[s.length - 1];
    el.chart.appendChild(svg('circle', { cx: X(last.t), cy: Y(last.v), r: 3.5, fill: color }));
  }

  // ── 데이터 반영 ─────────────────────────────────────────────────
  function setTone(change) {
    el.card.classList.remove('up', 'down', 'flat');
    if (change == null || change === 0) el.card.classList.add('flat');
    else el.card.classList.add(change > 0 ? 'up' : 'down');
  }

  function pushPoint(time, value) {
    if (!Number.isFinite(value)) return;
    const t = ms(time) ?? Date.now();
    const s = state.series;
    const last = s[s.length - 1];
    if (last && t <= last.t) {
      last.v = value; // 같은/이전 시각이면 마지막 값만 갱신
    } else {
      s.push({ t, v: value });
      if (s.length > MAX_POINTS) s.shift();
    }
  }

  function renderSession(session) {
    if (!session) return;
    el.session.textContent = session.open ? `장중 · ${session.kstTime} KST` : `장마감 · ${session.kstTime} KST`;
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

    if (d.source === 'demo') { el.src.hidden = false; el.src.textContent = '데모'; }
    else if (d.status === 'stale') { el.src.hidden = false; el.src.textContent = '지연(stale)'; }
    else el.src.hidden = true;

    el.hint.textContent = d.status === 'stale' ? '최신 시세를 가져오지 못해 직전 값을 표시 중입니다.' : '';

    if (d.prevClose != null) state.prevClose = d.prevClose;
    pushPoint(d.time, d.value);
    drawChart();
  }

  // ── 로딩 ────────────────────────────────────────────────────────
  async function loadQuote() {
    try {
      const res = await fetch(apiBase + '/api/kospi-night' + location.search, { cache: 'no-store' });
      render(await res.json());
    } catch (_) {
      render({ status: 'error' });
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch(apiBase + '/api/kospi-night/history' + location.search, { cache: 'no-store' });
      const d = await res.json();
      if (d.status === 'ok' || d.status === 'stale') {
        const series = (d.series || []).filter((p) => Number.isFinite(p.v));
        if (series.length) {
          state.series = series.slice(-MAX_POINTS);
          el.chartNote.textContent =
            (d.source === 'demo' ? '데모 시계열 · ' : `${d.source || ''} · `) + `${series.length}개 포인트`;
          drawChart();
          return;
        }
      }
      el.chartNote.textContent = '시계열 없음 — 실시간 수집으로 채웁니다';
    } catch (_) {
      el.chartNote.textContent = '시계열 로드 실패 — 실시간 수집으로 채웁니다';
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    if (el.auto.checked) timer = setInterval(loadQuote, 10000);
  }

  el.refresh.addEventListener('click', loadQuote);
  el.auto.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && el.auto.checked) loadQuote();
  });

  loadHistory();
  loadQuote();
  schedule();
})();
