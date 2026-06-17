// 손물(SONMUL) — 코스피200 야간선물 실시간 시세 · 캔들차트 · 호가 대시보드
//
// 데이터 로딩(환경에 따라 자동):
//   1) 서버 프록시 /api/kospi-night, /api/kospi-night/candles (Node·Vercel 배포)
//   2) 정적 호스팅이면 CORS 프록시로 네이버 시세 직접 조회
//   3) 둘 다 막히면 데모 데이터 ("데모" 배지)
// 호가·체결은 현재가 기준으로 재구성한 모의 정보다.
(function () {
  const apiBase = (window.METASPACE_CONFIG && window.METASPACE_CONFIG.apiBase) || '';
  const $ = (id) => document.getElementById(id);
  const forceDemo = /[?&]demo=1\b/.test(location.search);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const TICK = 0.05; // 코스피200 선물 호가 단위
  const COLORS = { up: '#ff5c7c', down: '#35d0ff', flat: '#8a8fb5' };

  const NAVER_QUOTE_URLS = [
    'https://api.stock.naver.com/futures/KOSPI200F/basic',
    'https://m.stock.naver.com/api/index/KPI200/basic',
    'https://api.stock.naver.com/index/KPI200/basic',
  ];
  const NAVER_CANDLE_URLS = [
    'https://api.stock.naver.com/chart/domestic/index/KPI200?periodType=dayCandle&count=120',
  ];
  const CORS_PROXIES = [
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  ];

  const el = {
    session: $('sessionPill'), clock: $('clock'), card: $('quoteCard'),
    name: $('quoteName'), src: $('srcBadge'), value: $('quoteValue'), change: $('quoteChange'),
    open: $('mOpen'), high: $('mHigh'), low: $('mLow'), prev: $('mPrev'), time: $('mTime'), source: $('mSource'),
    chart: $('chart'), chartNote: $('chartNote'), tfGroup: $('tfGroup'),
    book: $('orderBook'), askSum: $('askSum'), bidSum: $('bidSum'), bookMode: $('bookMode'),
    trades: $('trades'), auto: $('autoToggle'), refresh: $('refreshBtn'), hint: $('hint'),
  };

  const state = {
    quote: null, prevClose: null,
    candlesDay: [],            // [{t,o,h,l,c}] 일봉 (서버/직접)
    ticks: [],                 // [{t,v}] 실시간 체결 누적
    trades: [],                // 체결 테이프
    realBook: null,            // 실거래 호가({asks,bids,...}) 또는 null(=모의)
    tf: 'day',
  };
  let timer = null, clockTimer = null;
  let directMode = forceDemo ? false : null;

  // ── 유틸 ──────────────────────────────────────────────
  const fmt = (n, d = 2) =>
    n == null || !Number.isFinite(n) ? '—'
      : n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtInt = (n) => n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('ko-KR');
  const ms = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };
  const shortTime = (v) => { const t = new Date(ms(v) ?? NaN); return isNaN(t) ? String(v || '—') : t.toLocaleTimeString('ko-KR', { hour12: false }); };
  const hhmm = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const mmdd = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
  function toNum(v) { if (v == null) return null; const n = Number(String(v).replace(/,/g, '').trim()); return Number.isFinite(n) ? n : null; }
  function toTime(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const s = String(v).trim(), d = s.replace(/\D/g, '');
    if (d.length >= 8) { const t = Date.parse(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(8,10)||'00'}:${d.slice(10,12)||'00'}:00+09:00`); if (Number.isFinite(t)) return t; }
    const t = Date.parse(s); return Number.isFinite(t) ? t : null;
  }
  const roundTick = (p) => Math.round(p / TICK) * TICK;

  // 야간선물 거래시간(평일 18:00 ~ 익일 06:00 KST)
  function nightSession() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const day = kst.getUTCDay(), h = kst.getUTCHours();
    const open = (h >= 18 && day >= 1 && day <= 5) || (h < 6 && day >= 2 && day <= 6);
    return { open, kstTime: kst.toISOString().slice(11, 19) };
  }

  // ── 파싱(직접 모드용) ─────────────────────────────────
  function parseQuote(obj) {
    const q = obj.result || (Array.isArray(obj.datas) && obj.datas[0]) || obj.stockInfo || obj;
    const value = toNum(q.closePrice ?? q.tradePrice ?? q.now ?? q.price);
    if (value == null) return null;
    const change = toNum(q.compareToPreviousClosePrice ?? q.change ?? q.changeValue);
    const prevClose = toNum(q.previousClose ?? q.prevClosePrice ?? q.basePrice);
    return {
      value, change: change != null ? change : (prevClose != null ? value - prevClose : null),
      changeRate: toNum(q.fluctuationsRatio ?? q.changeRate ?? q.rate), prevClose,
      openPrice: toNum(q.openPrice ?? q.open), highPrice: toNum(q.highPrice ?? q.high), lowPrice: toNum(q.lowPrice ?? q.low),
      time: q.localTradedAt || q.tradeTime || q.time || new Date().toISOString(),
      name: q.stockName || q.name || q.indexName || '코스피200 야간선물',
    };
  }
  function parseCandles(obj) {
    const arr = obj.priceInfos || (obj.result && obj.result.priceInfos) || obj.datas || (Array.isArray(obj) ? obj : null);
    if (!Array.isArray(arr)) return null;
    const out = [];
    for (const it of arr) {
      let t, o, h, l, c;
      if (Array.isArray(it)) { t = toTime(it[0]); o = toNum(it[1]); h = toNum(it[2]); l = toNum(it[3]); c = toNum(it[4]); }
      else if (it && typeof it === 'object') {
        t = toTime(it.localDateTime ?? it.localDate ?? it.time ?? it.dt ?? it.date);
        o = toNum(it.openPrice ?? it.open); h = toNum(it.highPrice ?? it.high);
        l = toNum(it.lowPrice ?? it.low); c = toNum(it.closePrice ?? it.close ?? it.tradePrice ?? it.price);
      }
      if (t != null && c != null) out.push({ t, o: o ?? c, h: h ?? c, l: l ?? c, c });
    }
    out.sort((a, b) => a.t - b.t);
    return out.length ? out : null;
  }
  async function proxyJson(url) {
    for (const wrap of CORS_PROXIES) {
      try { const r = await fetch(wrap(url), { cache: 'no-store' }); if (!r.ok) continue; const t = await r.text(); try { return JSON.parse(t); } catch (_) {} } catch (_) {}
    }
    return null;
  }

  // ── 데모 ──────────────────────────────────────────────
  function demoQuote() {
    const base = 345.0, change = +(Math.sin(Date.now() / 60000) * 3).toFixed(2), v = +(base + change).toFixed(2);
    return { status: 'ok', source: 'demo', name: '코스피200 야간선물 (데모)', value: v, change,
      changeRate: +((change / base) * 100).toFixed(2), prevClose: base,
      openPrice: base, highPrice: +(v + 1.2).toFixed(2), lowPrice: +(v - 1.4).toFixed(2),
      time: new Date().toISOString(), fetchedAt: new Date().toISOString(), session: nightSession() };
  }
  function demoCandles(points = 80) {
    const base = 345.0, now = Date.now(), out = []; let prev = base;
    for (let i = points - 1; i >= 0; i--) {
      const o = prev, c = +(o + (Math.random() - 0.5) * 1.2).toFixed(2);
      out.push({ t: now - i * 86400000, o: +o.toFixed(2), h: +(Math.max(o, c) + Math.random() * .6).toFixed(2), l: +(Math.min(o, c) - Math.random() * .6).toFixed(2), c });
      prev = c;
    }
    return out;
  }

  // ── SVG ───────────────────────────────────────────────
  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  // ── 차트 렌더 ─────────────────────────────────────────
  function drawChart() {
    el.chart.replaceChildren();
    const W = 760, H = 360, P = { l: 56, r: 14, t: 14, b: 26 }, pw = W - P.l - P.r, ph = H - P.t - P.b;

    if (state.tf === 'tick') return drawLine(W, H, P, pw, ph);

    const cs = state.candlesDay;
    if (!cs || cs.length < 2) {
      el.chart.appendChild(svg('text', { x: W / 2, y: H / 2, fill: COLORS.flat, 'font-size': 13, 'text-anchor': 'middle' }, '차트 데이터를 불러오는 중…'));
      return;
    }
    const view = cs.slice(-90);
    let vMin = Math.min(...view.map((c) => c.l)), vMax = Math.max(...view.map((c) => c.h));
    const pad = (vMax - vMin) * 0.08 || 1; vMin -= pad; vMax += pad; const vSpan = vMax - vMin || 1;
    const Y = (v) => P.t + (1 - (v - vMin) / vSpan) * ph;
    const n = view.length, slot = pw / n, bw = Math.max(2, Math.min(11, slot * 0.62));

    for (let i = 0; i <= 4; i++) {
      const v = vMin + (vSpan * i) / 4, y = Y(v);
      el.chart.appendChild(svg('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#1c2142', 'stroke-width': 1 }));
      el.chart.appendChild(svg('text', { x: P.l - 8, y: y + 4, fill: '#8a8fb5', 'font-size': 11, 'text-anchor': 'end' }, fmt(v)));
    }
    [0, Math.floor(n / 2), n - 1].forEach((idx, k) => {
      const x = P.l + (idx + 0.5) * slot;
      el.chart.appendChild(svg('text', { x, y: H - 8, fill: '#8a8fb5', 'font-size': 11, 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle' }, mmdd(view[idx].t)));
    });
    if (state.prevClose != null && state.prevClose >= vMin && state.prevClose <= vMax) {
      const y = Y(state.prevClose);
      el.chart.appendChild(svg('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#8a8fb5', 'stroke-width': 1, 'stroke-dasharray': '4 4', 'stroke-opacity': .6 }));
    }
    view.forEach((c, i) => {
      const x = P.l + (i + 0.5) * slot, color = c.c >= c.o ? COLORS.up : COLORS.down;
      el.chart.appendChild(svg('line', { x1: x, y1: Y(c.h), x2: x, y2: Y(c.l), stroke: color, 'stroke-width': 1 }));
      const yo = Y(c.o), yc = Y(c.c), top = Math.min(yo, yc), h = Math.max(1, Math.abs(yc - yo));
      el.chart.appendChild(svg('rect', { x: x - bw / 2, y: top, width: bw, height: h, fill: color, rx: 1 }));
    });
  }

  function drawLine(W, H, P, pw, ph) {
    const s = state.ticks;
    if (s.length < 2) {
      el.chart.appendChild(svg('text', { x: W / 2, y: H / 2, fill: COLORS.flat, 'font-size': 13, 'text-anchor': 'middle' }, '실시간 체결을 수집 중…'));
      return;
    }
    const tMin = s[0].t, tMax = s[s.length - 1].t, tSpan = tMax - tMin || 1;
    let vMin = Math.min(...s.map((p) => p.v)), vMax = Math.max(...s.map((p) => p.v));
    if (state.prevClose != null) { vMin = Math.min(vMin, state.prevClose); vMax = Math.max(vMax, state.prevClose); }
    const pad = (vMax - vMin) * 0.12 || 1; vMin -= pad; vMax += pad; const vSpan = vMax - vMin || 1;
    const X = (t) => P.l + ((t - tMin) / tSpan) * pw, Y = (v) => P.t + (1 - (v - vMin) / vSpan) * ph;
    const ref = state.prevClose != null ? state.prevClose : s[0].v;
    const color = s[s.length - 1].v > ref ? COLORS.up : s[s.length - 1].v < ref ? COLORS.down : COLORS.flat;
    for (let i = 0; i <= 4; i++) {
      const v = vMin + (vSpan * i) / 4, y = Y(v);
      el.chart.appendChild(svg('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#1c2142', 'stroke-width': 1 }));
      el.chart.appendChild(svg('text', { x: P.l - 8, y: y + 4, fill: '#8a8fb5', 'font-size': 11, 'text-anchor': 'end' }, fmt(v)));
    }
    [0, Math.floor(s.length / 2), s.length - 1].forEach((idx, k) => {
      const p = s[idx];
      el.chart.appendChild(svg('text', { x: X(p.t), y: H - 8, fill: '#8a8fb5', 'font-size': 11, 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle' }, hhmm(p.t)));
    });
    if (state.prevClose != null) {
      const y = Y(state.prevClose);
      el.chart.appendChild(svg('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#8a8fb5', 'stroke-width': 1, 'stroke-dasharray': '4 4', 'stroke-opacity': .6 }));
    }
    const line = s.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${X(tMax).toFixed(1)},${Y(vMin).toFixed(1)} L${X(tMin).toFixed(1)},${Y(vMin).toFixed(1)} Z`;
    el.chart.appendChild(svg('path', { d: area, fill: color, 'fill-opacity': .12 }));
    el.chart.appendChild(svg('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    const last = s[s.length - 1];
    el.chart.appendChild(svg('circle', { cx: X(last.t), cy: Y(last.v), r: 3.5, fill: color }));
  }

  // ── 호가창(현재가 기준 재구성) ───────────────────────
  // 잔량은 가격을 시드로 한 의사난수 → 같은 시세면 같은 호가가 나와 깜빡임이 적다.
  function seededQty(seed) {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return 1 + Math.floor((x - Math.floor(x)) * 480);
  }
  // 실거래 호가(state.realBook)가 있으면 그대로, 없으면 현재가 기준 모의 호가.
  function buildSyntheticBook() {
    const q = state.quote; if (!q || !Number.isFinite(q.value)) return null;
    const cur = roundTick(q.value), asks = [], bids = [];
    for (let i = 1; i <= 10; i++) asks.push({ px: cur + i * TICK, qty: seededQty(Math.round((cur + i * TICK) * 100)) });
    for (let i = 1; i <= 10; i++) bids.push({ px: cur - i * TICK, qty: seededQty(Math.round((cur - i * TICK) * 100)) });
    return { asks, bids, askSum: asks.reduce((s, a) => s + a.qty, 0), bidSum: bids.reduce((s, b) => s + b.qty, 0) };
  }
  function renderBook() {
    const q = state.quote; if (!q || !Number.isFinite(q.value)) { el.book.replaceChildren(); return; }
    const real = state.realBook;
    const book = real || buildSyntheticBook();
    if (!book) { el.book.replaceChildren(); return; }
    el.bookMode.textContent = real ? '실시간 · 10호가' : '모의 · 10호가';
    el.bookMode.style.color = real ? 'var(--ok)' : '';

    // 매도호가는 높은 가격이 위로 오도록 내림차순 표시
    const asks = book.asks.slice().sort((a, b) => b.px - a.px);
    const bids = book.bids.slice().sort((a, b) => b.px - a.px);
    const maxQty = Math.max(...asks.map((a) => a.qty || 0), ...bids.map((b) => b.qty || 0), 1);
    const cur = real
      ? (bids[0] && asks[asks.length - 1] ? (bids[0].px + asks[asks.length - 1].px) / 2 : q.value)
      : roundTick(q.value);

    const frag = document.createDocumentFragment();
    const mkRow = (cls, px, qty) => {
      const r = document.createElement('div'); r.className = 'sm-book-row ' + cls;
      const w = ((((qty || 0) / maxQty) * 100)).toFixed(1) + '%';
      // 가격(좌) / 잔량(우)로 통일
      r.innerHTML = `<div class="px">${fmt(px)}</div><div class="qty"><span class="bar" style="width:${w}"></span><span>${fmtInt(qty || 0)}</span></div>`;
      return r;
    };
    asks.forEach((a) => frag.appendChild(mkRow('ask', a.px, a.qty)));
    const c = document.createElement('div'); c.className = 'sm-book-row cur';
    const tone = q.change > 0 ? 'var(--up)' : q.change < 0 ? 'var(--down)' : 'var(--flat)';
    c.innerHTML = `<div class="px" style="color:${tone}">${fmt(cur)}</div><div class="qty"><span>현재가</span></div>`;
    frag.appendChild(c);
    bids.forEach((b) => frag.appendChild(mkRow('bid', b.px, b.qty)));

    el.book.replaceChildren(frag);
    el.askSum.textContent = fmtInt(book.askSum);
    el.bidSum.textContent = fmtInt(book.bidSum);
  }

  // 실거래 호가 로딩(서버 프록시 전용 — CORS로 직접 호출 불가).
  async function loadOrderbook() {
    if (forceDemo) {
      try { const r = await fetch(apiBase + '/api/kospi-night/orderbook?demo=1', { cache: 'no-store' }); if (r.ok) { const d = await r.json(); if (d.status === 'ok' && d.asks) { state.realBook = null; /* 데모는 모의로 취급 */ } } } catch (_) {}
      renderBook(); return;
    }
    try {
      const r = await fetch(apiBase + '/api/kospi-night/orderbook', { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        if ((d.status === 'ok' || d.status === 'stale') && Array.isArray(d.asks) && Array.isArray(d.bids) && d.asks.length && d.bids.length) {
          state.realBook = { asks: d.asks, bids: d.bids, askSum: d.askSum, bidSum: d.bidSum };
          renderBook(); return;
        }
      }
    } catch (_) {}
    state.realBook = null; // 실거래 호가 미설정/실패 → 모의 호가로 폴백
    renderBook();
  }

  // ── 체결 테이프 ───────────────────────────────────────
  function pushTrade(price, prevPrice) {
    const dir = prevPrice == null ? 'flat' : price > prevPrice ? 'up' : price < prevPrice ? 'down' : 'flat';
    state.trades.unshift({ t: Date.now(), p: price, q: 1 + Math.floor(Math.random() * 40), dir });
    state.trades = state.trades.slice(0, 18);
  }
  function renderTrades() {
    const frag = document.createDocumentFragment();
    state.trades.forEach((tr) => {
      const li = document.createElement('li'); li.className = tr.dir;
      li.innerHTML = `<span class="t">${new Date(tr.t).toLocaleTimeString('ko-KR', { hour12: false })}</span><span class="p">${fmt(tr.p)}</span><span class="q">${tr.q}</span>`;
      frag.appendChild(li);
    });
    el.trades.replaceChildren(frag);
  }

  // ── 시세 렌더 ─────────────────────────────────────────
  function renderSession(s) {
    if (!s) return;
    el.session.textContent = s.open ? `장중 · ${s.kstTime} KST` : `장마감 · ${s.kstTime} KST`;
    el.session.classList.toggle('on', !!s.open);
    el.session.classList.toggle('off', !s.open);
  }
  function render(d) {
    renderSession(d.session || nightSession());
    if (d.status === 'unavailable' || d.status === 'error') {
      el.value.textContent = '시세 없음'; el.change.textContent = '데이터 소스에 연결하지 못했습니다';
      el.card.classList.add('flat');
      el.hint.textContent = '시세 소스에 접근하지 못했습니다. 잠시 후 다시 시도하거나 ?demo=1 로 동작을 확인하세요.';
      return;
    }
    const prevVal = state.quote ? state.quote.value : null;
    state.quote = d;
    el.name.textContent = d.name || '코스피200 야간선물';
    el.value.textContent = fmt(d.value);
    el.card.classList.remove('up', 'down', 'flat');
    el.card.classList.add(d.change == null || d.change === 0 ? 'flat' : d.change > 0 ? 'up' : 'down');
    const sign = d.change > 0 ? '▲' : d.change < 0 ? '▼' : '–';
    const rate = d.changeRate != null ? ` (${d.changeRate > 0 ? '+' : ''}${fmt(d.changeRate)}%)` : '';
    el.change.textContent = `${sign} ${fmt(Math.abs(d.change ?? 0))}${rate}`;
    el.open.textContent = fmt(d.openPrice); el.high.textContent = fmt(d.highPrice); el.low.textContent = fmt(d.lowPrice);
    el.prev.textContent = fmt(d.prevClose);
    el.time.textContent = shortTime(d.time);
    el.source.textContent = d.source || '—';
    if (d.source === 'demo') { el.src.hidden = false; el.src.textContent = '데모'; }
    else if (d.status === 'stale') { el.src.hidden = false; el.src.textContent = '지연(stale)'; }
    else el.src.hidden = true;
    el.hint.textContent = d.status === 'stale' ? '최신 시세를 가져오지 못해 직전 값을 표시 중입니다.' : '';
    if (d.prevClose != null) state.prevClose = d.prevClose;

    // 실시간 시계열·체결 누적
    const t = ms(d.time) ?? Date.now(), last = state.ticks[state.ticks.length - 1];
    if (last && t <= last.t) last.v = d.value;
    else { state.ticks.push({ t, v: d.value }); if (state.ticks.length > 600) state.ticks.shift(); }
    if (prevVal == null || d.value !== prevVal) pushTrade(d.value, prevVal);

    renderBook(); renderTrades();
    if (state.tf === 'tick') drawChart();
  }

  // ── 로딩 ──────────────────────────────────────────────
  async function fetchServerQuote() {
    try { const r = await fetch(apiBase + '/api/kospi-night' + location.search, { cache: 'no-store' }); if (!r.ok) return null; const d = await r.json(); return d && d.status ? d : null; } catch (_) { return null; }
  }
  async function fetchDirectQuote() {
    for (const u of NAVER_QUOTE_URLS) { const o = await proxyJson(u); if (o) { const q = parseQuote(o); if (q) return { status: 'ok', source: '네이버(직접)', fetchedAt: new Date().toISOString(), session: nightSession(), ...q }; } }
    return null;
  }
  async function loadQuote() {
    if (forceDemo) return render(demoQuote());
    if (directMode !== true) {
      const d = await fetchServerQuote();
      if (d && (d.status === 'ok' || d.status === 'stale')) { directMode = false; return render(d); }
      if (d && d.status === 'unavailable') directMode = false;
      else if (d === null) directMode = true;
    }
    const direct = await fetchDirectQuote();
    if (direct) return render(direct);
    return render(demoQuote());
  }
  async function loadCandles() {
    if (forceDemo) return applyCandles(demoCandles(), 'demo');
    try {
      const r = await fetch(apiBase + '/api/kospi-night/candles' + location.search, { cache: 'no-store' });
      if (r.ok) { const d = await r.json(); if ((d.status === 'ok' || d.status === 'stale') && Array.isArray(d.candles) && d.candles.length) return applyCandles(d.candles, d.source); }
    } catch (_) {}
    for (const u of NAVER_CANDLE_URLS) { const o = await proxyJson(u); if (o) { const c = parseCandles(o); if (c) return applyCandles(c, '네이버(직접)'); } }
    applyCandles(demoCandles(), 'demo');
  }
  function applyCandles(candles, source) {
    state.candlesDay = (candles || []).filter((c) => Number.isFinite(c.c));
    el.chartNote.textContent = (source === 'demo' ? '데모 일봉 · ' : `${source || ''} · `) + `${state.candlesDay.length}개 캔들`;
    if (state.tf === 'day') drawChart();
  }

  // ── 컨트롤 ────────────────────────────────────────────
  el.tfGroup.addEventListener('click', (e) => {
    const b = e.target.closest('.tf-btn'); if (!b) return;
    state.tf = b.dataset.tf;
    [...el.tfGroup.children].forEach((c) => c.classList.toggle('active', c === b));
    el.chartNote.textContent = state.tf === 'tick' ? '실시간 체결 추이 (이번 세션 누적)' : el.chartNote.textContent;
    drawChart();
  });
  function tick() { loadQuote(); loadOrderbook(); }
  function schedule() { if (timer) clearInterval(timer); if (el.auto.checked) timer = setInterval(tick, 5000); }
  el.refresh.addEventListener('click', tick);
  el.auto.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && el.auto.checked) tick(); });

  function tickClock() {
    const s = nightSession();
    el.clock.textContent = s.kstTime + ' KST';
  }
  clockTimer = setInterval(tickClock, 1000); tickClock();

  drawChart();
  loadCandles();
  loadQuote();
  loadOrderbook();
  schedule();
})();
