// 개별 종목 야간(독일 GDR 연동) 시세 뷰어 — 서버 프록시 + 데모 폴백 공용 스크립트
// 페이지에서 window.OVERNIGHT_CONFIG = { symbol, name, apiQuote, apiHistory, demoBase }
// 를 먼저 정의한 뒤 이 스크립트를 로드한다. kospi.js와 같은 구조를 공유한다.
(function () {
  const cfg = window.OVERNIGHT_CONFIG || {};
  const apiBase = (window.METASPACE_CONFIG && window.METASPACE_CONFIG.apiBase) || '';
  const $ = (id) => document.getElementById(id);
  const forceDemo = /[?&]demo=1\b/.test(location.search);
  const demoBase = cfg.demoBase || 100;
  const defaultName = cfg.name || '야간 시세';

  const COLORS = { up: '#ff5c7c', down: '#35d0ff', flat: '#8a8fb5' }; // 상승=빨강/하락=파랑(한국식)
  const SVGNS = 'http://www.w3.org/2000/svg';

  const el = {
    session: $('sessionPill'), name: $('quoteName'), src: $('srcBadge'),
    value: $('quoteValue'), change: $('quoteChange'), chart: $('chart'),
    chartNote: $('chartNote'), prev: $('mPrev'), time: $('mTime'),
    fetched: $('mFetched'), source: $('mSource'), auto: $('autoToggle'),
    refresh: $('refreshBtn'), hint: $('hint'), card: $('quoteCard'),
  };

  const state = { series: [], prevClose: null };
  const MAX_POINTS = 800;
  let timer = null;

  // ── 공통 유틸 ────────────────────────────────────────────────────
  const fmt = (n, d = 2) =>
    n == null || !Number.isFinite(n) ? '—'
      : n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const ms = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };
  const shortTime = (v) => { const t = new Date(ms(v) ?? NaN); return isNaN(t) ? String(v || '—') : t.toLocaleTimeString('ko-KR', { hour12: false }); };
  const hhmm = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });

  // 한국시간 기준 야간선물/GDR 거래시간(평일 18:00~익일 05:00)
  function nightSession() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const day = kst.getUTCDay(), h = kst.getUTCHours();
    const open = (h >= 18 && day >= 1 && day <= 5) || (h < 6 && day >= 2 && day <= 6);
    return { open, kstTime: kst.toISOString().slice(11, 19), sessionLabel: '평일 18:00 ~ 익일 06:00 (KST · 독일거래소 연계)' };
  }

  // 데모 데이터
  function demoQuote() {
    const change = +(Math.sin(Date.now() / 60000) * demoBase * 0.01).toFixed(2);
    return {
      status: 'ok', source: 'demo', name: `${defaultName} (데모)`,
      value: +(demoBase + change).toFixed(2), change, changeRate: +((change / demoBase) * 100).toFixed(2),
      prevClose: demoBase, time: new Date().toISOString(), fetchedAt: new Date().toISOString(), session: nightSession(),
    };
  }
  function demoSeries(points = 120) {
    const now = Date.now(), out = []; let v = demoBase;
    for (let i = points - 1; i >= 0; i--) { v += (Math.random() - 0.5) * (demoBase * 0.006); out.push({ t: now - i * 60000, v: +v.toFixed(2) }); }
    out[out.length - 1].v = +(demoBase + Math.sin(now / 60000) * (demoBase * 0.01)).toFixed(2);
    return out;
  }

  // ── SVG 차트 ────────────────────────────────────────────────────
  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function dirColor() {
    const s = state.series; if (s.length < 1) return COLORS.flat;
    const ref = state.prevClose != null ? state.prevClose : s[0].v, last = s[s.length - 1].v;
    return last > ref ? COLORS.up : last < ref ? COLORS.down : COLORS.flat;
  }
  function drawChart() {
    const s = state.series; el.chart.replaceChildren();
    if (s.length < 2) {
      el.chart.appendChild(svg('text', { x: 360, y: 150, fill: COLORS.flat, 'font-size': 13, 'text-anchor': 'middle' }, '차트 데이터를 불러오는 중…'));
      return;
    }
    const W = 720, H = 300, P = { l: 54, r: 14, t: 14, b: 26 }, pw = W - P.l - P.r, ph = H - P.t - P.b, color = dirColor();
    const tMin = s[0].t, tMax = s[s.length - 1].t, tSpan = tMax - tMin || 1;
    let vMin = Math.min(...s.map((p) => p.v)), vMax = Math.max(...s.map((p) => p.v));
    if (state.prevClose != null) { vMin = Math.min(vMin, state.prevClose); vMax = Math.max(vMax, state.prevClose); }
    const pad = (vMax - vMin) * 0.08 || 1; vMin -= pad; vMax += pad; const vSpan = vMax - vMin || 1;
    const X = (t) => P.l + ((t - tMin) / tSpan) * pw, Y = (v) => P.t + (1 - (v - vMin) / vSpan) * ph;
    for (let i = 0; i <= 4; i++) {
      const v = vMin + (vSpan * i) / 4, y = Y(v);
      el.chart.appendChild(svg('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#252a4d', 'stroke-width': 1 }));
      el.chart.appendChild(svg('text', { x: P.l - 8, y: y + 4, fill: '#8a8fb5', 'font-size': 11, 'text-anchor': 'end' }, fmt(v)));
    }
    [0, Math.floor(s.length / 2), s.length - 1].forEach((idx, k) => {
      const p = s[idx];
      el.chart.appendChild(svg('text', { x: X(p.t), y: H - 8, fill: '#8a8fb5', 'font-size': 11, 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle' }, hhmm(p.t)));
    });
    if (state.prevClose != null) {
      const y = Y(state.prevClose);
      el.chart.appendChild(svg('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#8a8fb5', 'stroke-width': 1, 'stroke-dasharray': '4 4', 'stroke-opacity': 0.7 }));
      el.chart.appendChild(svg('text', { x: W - P.r, y: y - 4, fill: '#8a8fb5', 'font-size': 10, 'text-anchor': 'end' }, `전일 ${fmt(state.prevClose)}`));
    }
    const line = s.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${X(tMax).toFixed(1)},${Y(vMin).toFixed(1)} L${X(tMin).toFixed(1)},${Y(vMin).toFixed(1)} Z`;
    el.chart.appendChild(svg('path', { d: area, fill: color, 'fill-opacity': 0.12, stroke: 'none' }));
    el.chart.appendChild(svg('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    const last = s[s.length - 1];
    el.chart.appendChild(svg('circle', { cx: X(last.t), cy: Y(last.v), r: 3.5, fill: color }));
  }

  // ── 렌더 ────────────────────────────────────────────────────────
  function setTone(change) {
    el.card.classList.remove('up', 'down', 'flat');
    el.card.classList.add(change == null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down');
  }
  function pushPoint(time, value) {
    if (!Number.isFinite(value)) return;
    const t = ms(time) ?? Date.now(), s = state.series, last = s[s.length - 1];
    if (last && t <= last.t) last.v = value;
    else { s.push({ t, v: value }); if (s.length > MAX_POINTS) s.shift(); }
  }
  function renderSession(session) {
    if (!session) return;
    el.session.textContent = session.open ? `장중 · ${session.kstTime} KST` : `장마감 · ${session.kstTime} KST`;
    el.session.classList.toggle('on', !!session.open);
    el.session.classList.toggle('off', !session.open);
    el.session.title = session.sessionLabel || '';
  }
  function render(d) {
    renderSession(d.session || nightSession());
    if (d.status === 'unavailable' || d.status === 'error') {
      el.value.textContent = '시세 없음';
      el.change.textContent = '데이터 소스에 연결하지 못했습니다';
      el.card.classList.add('flat');
      el.hint.textContent = '시세 소스에 접근하지 못했습니다. 잠시 후 다시 시도하거나 ?demo=1 로 동작을 확인하세요.';
      return;
    }
    el.name.textContent = d.name || defaultName;
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

  // ── 로딩 (서버 프록시 → 데모 폴백) ─────────────────────────────────
  async function fetchServerQuote() {
    try {
      const res = await fetch(apiBase + (cfg.apiQuote || '') + location.search, { cache: 'no-store' });
      if (!res.ok) return null;
      const d = await res.json();
      return (d && d.status) ? d : null;
    } catch (_) { return null; }
  }
  async function loadQuote() {
    if (forceDemo) return render(demoQuote());
    const d = await fetchServerQuote();
    if (d && (d.status === 'ok' || d.status === 'stale')) return render(d);
    return render(demoQuote()); // 서버 API가 없거나 소스 실패 시 최종 폴백
  }

  async function loadHistory() {
    if (forceDemo) { applySeries(demoSeries(), 'demo'); return; }
    try {
      const res = await fetch(apiBase + (cfg.apiHistory || '') + location.search, { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        if ((d.status === 'ok' || d.status === 'stale') && Array.isArray(d.series) && d.series.length) {
          return applySeries(d.series, d.source);
        }
      }
    } catch (_) {}
    applySeries(demoSeries(), 'demo');
  }
  function applySeries(series, source) {
    series = (series || []).filter((p) => Number.isFinite(p.v));
    if (!series.length) { el.chartNote.textContent = '시계열 없음 — 실시간 수집으로 채웁니다'; return; }
    state.series = series.slice(-MAX_POINTS);
    el.chartNote.textContent = (source === 'demo' ? '데모 시계열 · ' : `${source || ''} · `) + `${series.length}개 포인트`;
    drawChart();
  }

  function schedule() { if (timer) clearInterval(timer); if (el.auto.checked) timer = setInterval(loadQuote, 10000); }
  el.refresh.addEventListener('click', loadQuote);
  el.auto.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && el.auto.checked) loadQuote(); });

  loadHistory();
  loadQuote();
  schedule();
})();
