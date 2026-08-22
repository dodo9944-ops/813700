// 실시간 시세 대시보드 — 여러 종목/지수/환율 카드를 한 번에 폴링해 렌더링한다.
// 개별 카드의 데이터 로딩·표시 로직은 kospi.js/overnight.js와 같은 원칙
// (서버 프록시 → 데모 폴백, 가짜 시세 금지)을 따른다.
(function () {
  const apiBase = (window.METASPACE_CONFIG && window.METASPACE_CONFIG.apiBase) || '';
  const forceDemo = /[?&]demo=1\b/.test(location.search);

  // 서버의 QUOTE_SYMBOLS 레지스트리와 대응하는 카드 목록.
  // kospi_night 는 기존 코스피200 야간선물 API(/api/kospi-night)를 그대로 사용한다.
  const SYMBOLS = [
    { id: 'kospi_night', name: 'KOSPI200 야간선물', ticker: 'KOSPI200_NIGHT', category: 'futures', endpoint: '/api/kospi-night', href: 'kospi.html' },
    { id: 'kospi200_fut', name: 'KOSPI200 선물', category: 'futures' },
    { id: 'kosdaq150_fut', name: 'KOSDAQ150 선물', category: 'futures' },
    { id: 'ewy_perp', name: '한국 ETF 무기한', ticker: 'EWYUSDT', category: 'perp' },
    { id: 'samsung_perp', name: '삼성전자 무기한', ticker: 'SAMSUNGUSDT', category: 'perp' },
    { id: 'hynix_perp', name: 'SK하이닉스 무기한', ticker: 'SKHYNIXUSDT', category: 'perp' },
    { id: 'nasdaq_fut', name: '나스닥 선물', category: 'global' },
    { id: 'wti_fut', name: 'WTI 원유 선물', category: 'global' },
    { id: 'usdkrw', name: '원/달러 환율', category: 'global' },
    { id: 'stock_005930', name: '삼성전자', ticker: '005930', category: 'stock', href: 'overnight-samsung.html' },
    { id: 'stock_000660', name: 'SK하이닉스', ticker: '000660', category: 'stock', href: 'overnight-hynix.html' },
    { id: 'stock_009150', name: '삼성전기', ticker: '009150', category: 'stock' },
    { id: 'stock_005380', name: '현대자동차', ticker: '005380', category: 'stock' },
    { id: 'stock_402340', name: 'SK스퀘어', ticker: '402340', category: 'stock' },
    { id: 'stock_011070', name: 'LG이노텍', ticker: '011070', category: 'stock' },
  ];

  const GRID = {
    futures: document.getElementById('grid-futures'),
    perp: document.getElementById('grid-perp'),
    global: document.getElementById('grid-global'),
    stock: document.getElementById('grid-stock'),
  };
  const sessionPill = document.getElementById('sessionPill');
  const clockEl = document.getElementById('clock');

  const fmt = (n, d = 2) =>
    n == null || !Number.isFinite(n) ? '—'
      : n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });

  function nightSession() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const day = kst.getUTCDay(), h = kst.getUTCHours();
    const open = (h >= 18 && day >= 1 && day <= 5) || (h < 6 && day >= 2 && day <= 6);
    return { open, kstTime: kst.toISOString().slice(11, 19) };
  }

  function tickClock() {
    const s = nightSession();
    if (clockEl) clockEl.textContent = `${s.kstTime} KST`;
    if (sessionPill) {
      sessionPill.textContent = s.open ? `장중 · ${s.kstTime} KST` : `장외 · ${s.kstTime} KST`;
      sessionPill.classList.toggle('on', s.open);
      sessionPill.classList.toggle('off', !s.open);
    }
  }

  // ── 카드 DOM 생성 ────────────────────────────────────────────────
  const cards = {}; // id -> { el, valueEl, changeEl, volEl }
  SYMBOLS.forEach((sym) => {
    const grid = GRID[sym.category];
    if (!grid) return;
    const tag = sym.href ? 'a' : 'div';
    const el = document.createElement(tag);
    el.className = 'ticker-card flat';
    el.id = `card-${sym.id}`;
    if (sym.href) el.href = sym.href;
    el.innerHTML = `
      <div class="tk-head">
        <span class="tk-name">${sym.name}</span>
        <span class="tk-ticker">${sym.ticker || ''}</span>
      </div>
      <div class="tk-value">—</div>
      <div class="tk-change">불러오는 중…</div>
      <div class="tk-vol"></div>
    `;
    grid.appendChild(el);
    cards[sym.id] = {
      el,
      value: el.querySelector('.tk-value'),
      change: el.querySelector('.tk-change'),
      vol: el.querySelector('.tk-vol'),
    };
  });

  // ── 데모 값 ──────────────────────────────────────────────────────
  function demoFor(sym) {
    const base = { kospi_night: 349.85, kospi200_fut: 349.85, kosdaq150_fut: 1395.6,
      ewy_perp: 178.57, samsung_perp: 194.35, hynix_perp: 1247.92,
      nasdaq_fut: 29374.0, wti_fut: 86.64, usdkrw: 1385.0,
      stock_005930: 281500, stock_000660: 1730000, stock_009150: 1316000,
      stock_005380: 415000, stock_402340: 1123000, stock_011070: 550000 }[sym.id] || 100;
    const change = +(Math.sin(Date.now() / 60000 + sym.id.length) * base * 0.012).toFixed(2);
    return {
      status: 'ok', source: 'demo', value: +(base + change).toFixed(2), change,
      changeRate: +((change / base) * 100).toFixed(2),
    };
  }

  function render(sym, d) {
    const c = cards[sym.id];
    if (!c) return;
    const decimals = sym.category === 'stock' ? 0 : 2;
    if (!d || d.status === 'unavailable' || d.status === 'error') {
      c.value.textContent = '시세 없음';
      c.change.textContent = '데이터 소스 없음';
      c.el.classList.remove('up', 'down');
      c.el.classList.add('flat');
      return;
    }
    c.value.textContent = fmt(d.value, decimals);
    const sign = d.change > 0 ? '+' : '';
    const rate = d.changeRate != null ? ` (${d.changeRate > 0 ? '+' : ''}${fmt(d.changeRate)}%)` : '';
    c.change.textContent = `${sign}${fmt(d.change ?? 0, decimals)}${rate}`;
    c.el.classList.remove('up', 'down', 'flat');
    c.el.classList.add(d.change > 0 ? 'up' : d.change < 0 ? 'down' : 'flat');
    if (d.source === 'demo') c.vol.textContent = '데모 시세';
    else if (d.status === 'stale') c.vol.textContent = '지연(stale)';
    else c.vol.textContent = '';
  }

  async function loadSymbol(sym) {
    if (forceDemo) return render(sym, demoFor(sym));
    const endpoint = sym.endpoint || `/api/quote/${sym.id}`;
    try {
      const res = await fetch(apiBase + endpoint + location.search, { cache: 'no-store' });
      if (!res.ok) return render(sym, demoFor(sym));
      const d = await res.json();
      if (d && (d.status === 'ok' || d.status === 'stale')) return render(sym, d);
      return render(sym, demoFor(sym)); // 소스 미설정/실패 시 최종 폴백(다른 페이지와 동일한 정책)
    } catch (_) {
      return render(sym, demoFor(sym));
    }
  }

  function loadAll() { SYMBOLS.forEach(loadSymbol); }

  tickClock();
  setInterval(tickClock, 1000);
  loadAll();
  setInterval(loadAll, 15000);
})();
