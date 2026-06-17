const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// 루트(/)는 코스피200 야간선물 대시보드(손물 클론)를 제공한다.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sonmul.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

const bridgeState = {
  online: true,
  startedAt: new Date().toISOString(),
  messages: [],
  subscribers: new Set(),
};

app.get('/api/bridge/status', (req, res) => {
  res.json({
    online: bridgeState.online,
    startedAt: bridgeState.startedAt,
    messageCount: bridgeState.messages.length,
    subscribers: bridgeState.subscribers.size,
  });
});

app.post('/api/bridge/toggle', (req, res) => {
  bridgeState.online = !bridgeState.online;
  res.json({ online: bridgeState.online });
});

app.post('/api/bridge/send', (req, res) => {
  if (!bridgeState.online) {
    return res.status(503).json({ error: '브릿지가 오프라인 상태입니다' });
  }
  const { chatId, text, botToken } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text는 필수입니다' });

  const entry = {
    id: Date.now(),
    chatId: chatId || 'local',
    text,
    ts: new Date().toISOString(),
    delivered: false,
  };
  bridgeState.messages.unshift(entry);
  bridgeState.messages = bridgeState.messages.slice(0, 100);

  if (botToken && chatId) {
    const payload = JSON.stringify({ chat_id: chatId, text });
    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const tgReq = https.request(opts, (tgRes) => {
      let data = '';
      tgRes.on('data', (c) => (data += c));
      tgRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          entry.delivered = !!parsed.ok;
          entry.telegram = parsed;
        } catch (e) {
          entry.telegram = { raw: data };
        }
        res.json(entry);
      });
    });
    tgReq.on('error', (err) => {
      entry.error = err.message;
      res.status(502).json(entry);
    });
    tgReq.write(payload);
    tgReq.end();
    return;
  }

  entry.delivered = true;
  entry.note = 'botToken 미설정 — 로컬 에코 모드';
  res.json(entry);
});

app.post('/api/bridge/webhook', (req, res) => {
  const update = req.body;
  const msg = update?.message;
  if (msg) {
    bridgeState.messages.unshift({
      id: msg.message_id,
      chatId: msg.chat?.id,
      from: msg.from?.username || msg.from?.first_name,
      text: msg.text,
      ts: new Date(msg.date * 1000).toISOString(),
      inbound: true,
    });
    bridgeState.messages = bridgeState.messages.slice(0, 100);
  }
  res.json({ ok: true });
});

app.get('/api/bridge/messages', (req, res) => {
  res.json(bridgeState.messages.slice(0, 30));
});

app.get('/api/coop/info', (req, res) => {
  res.json({
    name: '메타공간 협동조합',
    slogan: '가상과 현실을 잇는 공동체',
    founded: '2024-03-01',
    members: 128,
    mission: '누구나 소유하고 함께 운영하는 메타버스 공공재',
    address: '서울특별시 메타구 공간동 8137-00',
  });
});

const news = [
  {
    id: 1,
    title: '메타공간 플랫폼 오픈',
    tag: '공지',
    author: '운영팀',
    body: '메타스페이스, 조합 홈페이지, 텔레봇 브릿지를 하나로 묶은 플랫폼이 정식 오픈했습니다.',
    ts: '2026-04-20T09:00:00.000Z',
  },
  {
    id: 2,
    title: '텔레봇 브릿지 온라인 전환',
    tag: '브릿지',
    author: '운영팀',
    body: '텔레그램 ↔ 메타공간 실시간 메시지 릴레이가 활성화되었습니다.',
    ts: '2026-04-20T12:00:00.000Z',
  },
  {
    id: 3,
    title: '2026년 1분기 조합원 총회 결과',
    tag: '조합',
    author: '조합장',
    body: '정족수 120명 참여. 운영 수익을 공공 메타버스 서버 증설에 재투자하기로 의결.',
    ts: '2026-04-19T16:30:00.000Z',
  },
];
let nextNewsId = news.length + 1;

app.get('/api/news', (req, res) => {
  const { tag } = req.query;
  const list = tag ? news.filter((n) => n.tag === tag) : news;
  res.json(list.slice().sort((a, b) => b.ts.localeCompare(a.ts)));
});

app.post('/api/news', (req, res) => {
  const { title, body, tag, author } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ error: 'title과 body는 필수입니다' });
  }
  const entry = {
    id: nextNewsId++,
    title: String(title).slice(0, 120),
    body: String(body).slice(0, 4000),
    tag: (tag && String(tag).slice(0, 20)) || '일반',
    author: (author && String(author).slice(0, 40)) || '익명',
    ts: new Date().toISOString(),
  };
  news.push(entry);
  res.status(201).json(entry);
});

app.get('/api/news/:id', (req, res) => {
  const item = news.find((n) => n.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

// ────────────────────────────────────────────────────────────────────────
// 코스피200 야간선물 (EUREX 연계) 실시간 시세 프록시
//
// 클라이언트는 CORS 때문에 외부 시세 서버를 직접 호출할 수 없으므로 서버가
// 대신 가져와 정규화한다. 데이터 소스는 환경변수로 바꿀 수 있고, 응답 형식이
// 조금씩 달라도 견디도록 방어적으로 파싱한다. 어떤 소스도 응답하지 않으면
// 가짜 시세를 만들지 않고 status:'unavailable' 을 돌려준다.
// ────────────────────────────────────────────────────────────────────────

// 우선순위대로 시도할 시세 소스 목록. KOSPI_NIGHT_API_URL 이 있으면 그것만 쓴다.
// 기본값은 네이버 금융 모바일 API(코스피200 야간선물, EUREX 연계).
const KOSPI_NIGHT_SOURCES = (process.env.KOSPI_NIGHT_API_URL
  ? [process.env.KOSPI_NIGHT_API_URL]
  : [
      // KRX 야간시장 코스피200 선물(있으면) → 없으면 코스피200 지수로 폴백
      'https://api.stock.naver.com/futures/KOSPI200F/basic',
      'https://m.stock.naver.com/api/index/KPI200/basic',
      'https://api.stock.naver.com/index/KPI200/basic',
      'https://m.stock.naver.com/api/index/KOSPI200/basic',
    ]);

const kospiCache = { at: 0, data: null };
const KOSPI_CACHE_MS = 5000; // 시세 서버 과호출 방지

function httpGetText(url, timeoutMs = 7000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Referer': 'https://m.stock.naver.com/',
          ...extraHeaders,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

// 문자열/숫자 어떤 형태든 숫자로. "1,390.85" → 1390.85
function toNum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

// 네이버 시세 JSON에서 자주 쓰이는 필드명을 너그럽게 추출한다.
function parseQuote(body) {
  let obj;
  try {
    obj = JSON.parse(body);
  } catch (_) {
    return null;
  }
  // result/datas/stockInfo 등으로 한 번 감싸진 경우 풀어준다.
  const q =
    obj.result || (Array.isArray(obj.datas) && obj.datas[0]) || obj.stockInfo || obj;

  const value = toNum(q.closePrice ?? q.tradePrice ?? q.now ?? q.price);
  if (value == null) return null;

  const change = toNum(
    q.compareToPreviousClosePrice ?? q.change ?? q.changeValue ?? q.compareToPreviousPrice
  );
  const changeRate = toNum(q.fluctuationsRatio ?? q.changeRate ?? q.rate);
  const prevClose = toNum(q.previousClose ?? q.prevClosePrice ?? q.basePrice);
  const time =
    q.localTradedAt || q.tradeTime || q.time || q.updatedAt || new Date().toISOString();
  const name = q.stockName || q.name || q.indexName || '코스피200 야간선물';

  return {
    value,
    change: change != null ? change : prevClose != null ? value - prevClose : null,
    changeRate,
    prevClose,
    time,
    name,
  };
}

async function fetchKospiNight() {
  if (kospiCache.data && Date.now() - kospiCache.at < KOSPI_CACHE_MS) {
    return kospiCache.data;
  }
  const errors = [];
  for (const url of KOSPI_NIGHT_SOURCES) {
    try {
      const { status, body } = await httpGetText(url);
      if (status !== 200) {
        errors.push(`${url} → HTTP ${status}`);
        continue;
      }
      const quote = parseQuote(body);
      if (quote) {
        const data = {
          status: 'ok',
          source: new URL(url).host,
          fetchedAt: new Date().toISOString(),
          ...quote,
        };
        kospiCache.at = Date.now();
        kospiCache.data = data;
        return data;
      }
      errors.push(`${url} → 파싱 실패`);
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  }
  // 어떤 소스도 실패. 직전 성공값이 있으면 stale로 표시해 보여준다.
  if (kospiCache.data) {
    return { ...kospiCache.data, status: 'stale', errors };
  }
  return { status: 'unavailable', errors, fetchedAt: new Date().toISOString() };
}

// 한국시간 기준 야간선물 거래시간(평일 18:00 ~ 익일 05:00) 여부
function nightSessionStatus(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const day = kst.getUTCDay(); // 0=일 .. 6=토
  const h = kst.getUTCHours();
  // KRX 파생 야간시장: 월~금 18시 개장(day 1~5), 다음날 06시 마감(이튿날 day 2~6)
  const open = (h >= 18 && day >= 1 && day <= 5) || (h < 6 && day >= 2 && day <= 6);
  return {
    open,
    kstTime: kst.toISOString().slice(11, 19),
    sessionLabel: '평일 18:00 ~ 익일 06:00 (KST · KRX 야간시장)',
  };
}

// ── 야간선물 시계열(차트용) ────────────────────────────────────────────
// 차트를 그릴 가격 추이. KOSPI_NIGHT_CHART_URL 로 소스를 바꿀 수 있다.
const KOSPI_CHART_SOURCES = process.env.KOSPI_NIGHT_CHART_URL
  ? [process.env.KOSPI_NIGHT_CHART_URL]
  : [
      'https://api.stock.naver.com/chart/domestic/index/KPI200?periodType=dayCandle&count=240',
      'https://api.stock.naver.com/chart/futures/KOSPI200F?periodType=dayCandle&count=240',
    ];

const chartCache = { at: 0, data: null };
const CHART_CACHE_MS = 30000;

// 시각을 ms 타임스탬프로. "20260616223000" / "2026-06-16T22:30" / ISO 모두 허용.
function toTime(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const s = String(v).trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 8) {
    const y = digits.slice(0, 4), mo = digits.slice(4, 6), d = digits.slice(6, 8);
    const hh = digits.slice(8, 10) || '00', mm = digits.slice(10, 12) || '00';
    const t = Date.parse(`${y}-${mo}-${d}T${hh}:${mm}:00+09:00`);
    if (Number.isFinite(t)) return t;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// 다양한 차트 응답 형태에서 [{t, v}] 시계열을 너그럽게 뽑아낸다.
function parseSeries(body) {
  let obj;
  try {
    obj = JSON.parse(body);
  } catch (_) {
    return null;
  }
  const arr =
    obj.priceInfos ||
    (obj.result && obj.result.priceInfos) ||
    obj.datas ||
    (Array.isArray(obj) ? obj : null);
  if (!Array.isArray(arr)) return null;

  const out = [];
  for (const it of arr) {
    let t, v;
    if (Array.isArray(it)) {
      t = toTime(it[0]);
      v = toNum(it[4] ?? it[1]); // [날짜,시,고,저,종,...] → 종가
    } else if (it && typeof it === 'object') {
      t = toTime(it.localDateTime ?? it.localDate ?? it.time ?? it.dt ?? it.date);
      v = toNum(it.closePrice ?? it.currentPrice ?? it.close ?? it.tradePrice ?? it.price);
    }
    if (t != null && v != null) out.push({ t, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out.length ? out : null;
}

function demoSeries(points = 120) {
  const base = 345.0;
  const now = Date.now();
  const out = [];
  let v = base;
  for (let i = points - 1; i >= 0; i--) {
    v += (Math.random() - 0.5) * 0.9;
    out.push({ t: now - i * 60000, v: +v.toFixed(2) });
  }
  // 마지막 값을 현재 데모 시세와 맞춘다
  out[out.length - 1].v = +(base + Math.sin(now / 60000) * 3).toFixed(2);
  return out;
}

async function fetchKospiHistory() {
  if (chartCache.data && Date.now() - chartCache.at < CHART_CACHE_MS) {
    return chartCache.data;
  }
  const errors = [];
  for (const url of KOSPI_CHART_SOURCES) {
    try {
      const { status, body } = await httpGetText(url);
      if (status !== 200) {
        errors.push(`${url} → HTTP ${status}`);
        continue;
      }
      const series = parseSeries(body);
      if (series) {
        const data = { status: 'ok', source: new URL(url).host, series };
        chartCache.at = Date.now();
        chartCache.data = data;
        return data;
      }
      errors.push(`${url} → 파싱 실패`);
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  }
  if (chartCache.data) return { ...chartCache.data, status: 'stale', errors };
  return { status: 'unavailable', errors };
}

// ── 야간선물 캔들(OHLC) ────────────────────────────────────────────────
// 캔들차트용 시고저종. 네이버 차트 응답의 시/고/저/종을 그대로 추출한다.
function parseCandles(body) {
  let obj;
  try {
    obj = JSON.parse(body);
  } catch (_) {
    return null;
  }
  const arr =
    obj.priceInfos ||
    (obj.result && obj.result.priceInfos) ||
    obj.datas ||
    (Array.isArray(obj) ? obj : null);
  if (!Array.isArray(arr)) return null;

  const out = [];
  for (const it of arr) {
    let t, o, h, l, c;
    if (Array.isArray(it)) {
      // [날짜, 시, 고, 저, 종, ...]
      t = toTime(it[0]);
      o = toNum(it[1]); h = toNum(it[2]); l = toNum(it[3]); c = toNum(it[4]);
    } else if (it && typeof it === 'object') {
      t = toTime(it.localDateTime ?? it.localDate ?? it.time ?? it.dt ?? it.date);
      o = toNum(it.openPrice ?? it.open ?? it.startPrice);
      h = toNum(it.highPrice ?? it.high);
      l = toNum(it.lowPrice ?? it.low);
      c = toNum(it.closePrice ?? it.close ?? it.currentPrice ?? it.tradePrice ?? it.price);
    }
    if (t != null && c != null) {
      // 일부 필드가 비면 종가로 메운다(라인 폴백용)
      out.push({ t, o: o ?? c, h: h ?? c, l: l ?? c, c });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out.length ? out : null;
}

const candleCache = { at: 0, data: null };

function demoCandles(points = 80, stepMs = 60000) {
  const base = 345.0, now = Date.now(), out = [];
  let prev = base;
  for (let i = points - 1; i >= 0; i--) {
    const o = prev;
    const drift = (Math.random() - 0.5) * 1.2;
    const c = +(o + drift).toFixed(2);
    const h = +(Math.max(o, c) + Math.random() * 0.6).toFixed(2);
    const l = +(Math.min(o, c) - Math.random() * 0.6).toFixed(2);
    out.push({ t: now - i * stepMs, o: +o.toFixed(2), h, l, c });
    prev = c;
  }
  return out;
}

async function fetchKospiCandles() {
  if (candleCache.data && Date.now() - candleCache.at < CHART_CACHE_MS) {
    return candleCache.data;
  }
  const errors = [];
  for (const url of KOSPI_CHART_SOURCES) {
    try {
      const { status, body } = await httpGetText(url);
      if (status !== 200) {
        errors.push(`${url} → HTTP ${status}`);
        continue;
      }
      const candles = parseCandles(body);
      if (candles) {
        const data = { status: 'ok', source: new URL(url).host, candles };
        candleCache.at = Date.now();
        candleCache.data = data;
        return data;
      }
      errors.push(`${url} → 파싱 실패`);
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  }
  if (candleCache.data) return { ...candleCache.data, status: 'stale', errors };
  return { status: 'unavailable', errors };
}

app.get('/api/kospi-night/candles', async (req, res) => {
  if (process.env.KOSPI_NIGHT_DEMO === '1' || req.query.demo === '1') {
    return res.json({ status: 'ok', source: 'demo', candles: demoCandles() });
  }
  try {
    res.json(await fetchKospiCandles());
  } catch (e) {
    res.status(502).json({ status: 'error', message: e.message });
  }
});

// ── 야간선물 실시간 호가(order book) ──────────────────────────────────
// 지수(KPI200)에는 호가가 없고, 실거래 선물 종목에만 호가가 있다. 무료 공개
// 소스로는 KOSPI200 야간선물 호가를 안정적으로 받기 어려우므로, 어떤 실거래
// 피드든 꽂으면 동작하도록 업스트림을 환경변수로 지정한다.
//
//   KOSPI_NIGHT_ORDERBOOK_URL     호가 JSON 엔드포인트(설정 시 이 URL만 사용)
//   KOSPI_NIGHT_ORDERBOOK_HEADERS 인증 헤더 JSON 문자열
//                                 예) {"authorization":"Bearer ...","appkey":"..."}
//   KOSPI_NIGHT_FUTURES_CODE      네이버 best-effort용 야간선물 종목코드
//
// 응답 형식이 제각각이어도 견디도록 방어적으로 파싱한다(증권사 OpenAPI의
// askp1..10 / bidp1..10 / askp_rsqn1..10 평면 필드, asks/bids 배열, 네이버
// 호가 배열 등). 어떤 소스도 응답하지 않으면 status:'unavailable' 을 돌려준다.
function buildOrderbookSources() {
  if (process.env.KOSPI_NIGHT_ORDERBOOK_URL) return [process.env.KOSPI_NIGHT_ORDERBOOK_URL];
  const code = process.env.KOSPI_NIGHT_FUTURES_CODE; // 예: 101W12, 165...
  if (!code) return []; // 종목코드가 없으면 best-effort 후보도 없음 → unavailable
  return [
    `https://api.stock.naver.com/futures/${code}/askingPrice`,
    `https://m.stock.naver.com/api/stock/${code}/askingPrice`,
    `https://api.stock.naver.com/stock/${code}/askingPrice`,
  ];
}

function orderbookHeaders() {
  if (!process.env.KOSPI_NIGHT_ORDERBOOK_HEADERS) return {};
  try { return JSON.parse(process.env.KOSPI_NIGHT_ORDERBOOK_HEADERS); } catch (_) { return {}; }
}

// 다양한 호가 응답에서 {asks:[{px,qty}], bids:[{px,qty}]} 를 뽑아낸다.
function parseOrderbook(body) {
  let root;
  try { root = JSON.parse(body); } catch (_) { return null; }
  // 한 번 감싸진 흔한 컨테이너들을 풀어준다.
  const o = root.result || root.output || root.output1 || root.datas ||
    (root.stockInfo && root.stockInfo.askingPrice) || root.askingPrice || root;

  const toLevel = (px, qty) => { const p = toNum(px), q = toNum(qty); return p != null ? { px: p, qty: q != null ? q : 0 } : null; };

  // 1) 명시적 배열 형태: asks/bids, askingPrices, hogaList ...
  const arrAsk = o.asks || o.askingPriceAsk || o.sellHoga;
  const arrBid = o.bids || o.askingPriceBid || o.buyHoga;
  if (Array.isArray(arrAsk) && Array.isArray(arrBid)) {
    const asks = arrAsk.map((x) => toLevel(x.px ?? x.price ?? x.priceValue ?? x.value, x.qty ?? x.quantity ?? x.remainQuantity ?? x.volume)).filter(Boolean);
    const bids = arrBid.map((x) => toLevel(x.px ?? x.price ?? x.priceValue ?? x.value, x.qty ?? x.quantity ?? x.remainQuantity ?? x.volume)).filter(Boolean);
    if (asks.length && bids.length) return normalizeBook(asks, bids);
  }

  // 2) 호가 레벨이 객체 배열로 한 곳에: [{askPrice,askQty,bidPrice,bidQty}, ...]
  const levels = o.askingPrices || o.hogaList || o.priceList || (Array.isArray(o) ? o : null);
  if (Array.isArray(levels) && levels.length) {
    const asks = [], bids = [];
    for (const it of levels) {
      const a = toLevel(it.askPrice ?? it.sellAskpUnit ?? it.sellPrice ?? it.askp, it.askRemainQuantity ?? it.sellAskpRemnVol ?? it.sellRemain ?? it.askVolume);
      const b = toLevel(it.bidPrice ?? it.buyAskpUnit ?? it.buyPrice ?? it.bidp, it.bidRemainQuantity ?? it.buyAskpRemnVol ?? it.buyRemain ?? it.bidVolume);
      if (a) asks.push(a); if (b) bids.push(b);
    }
    if (asks.length && bids.length) return normalizeBook(asks, bids);
  }

  // 3) 평면 필드(증권사 OpenAPI 스타일): askp1..10 / bidp1..10 / askp_rsqn / bidp_rsqn
  //    futs_ 접두사(KIS 선물)도 함께 시도한다.
  for (const pre of ['', 'futs_']) {
    const asks = [], bids = [];
    for (let i = 1; i <= 10; i++) {
      const ap = toNum(o[`${pre}askp${i}`]), aq = toNum(o[`${pre}askp_rsqn${i}`] ?? o[`${pre}askp_csnu${i}`]);
      const bp = toNum(o[`${pre}bidp${i}`]), bq = toNum(o[`${pre}bidp_rsqn${i}`] ?? o[`${pre}bidp_csnu${i}`]);
      if (ap != null) asks.push({ px: ap, qty: aq != null ? aq : 0 });
      if (bp != null) bids.push({ px: bp, qty: bq != null ? bq : 0 });
    }
    if (asks.length && bids.length) return normalizeBook(asks, bids);
  }

  return null;
}

// 매도호가 오름차순 → 표시용으로 정렬·절단하고 잔량 합계를 붙인다.
function normalizeBook(asks, bids) {
  asks = asks.filter((a) => a.px != null).sort((a, b) => a.px - b.px).slice(0, 10);
  bids = bids.filter((b) => b.px != null).sort((a, b) => b.px - a.px).slice(0, 10);
  if (!asks.length || !bids.length) return null;
  const askSum = asks.reduce((s, a) => s + (a.qty || 0), 0);
  const bidSum = bids.reduce((s, b) => s + (b.qty || 0), 0);
  return { asks, bids, askSum, bidSum };
}

const obCache = { at: 0, data: null };
const OB_CACHE_MS = 2000;

function demoOrderbook() {
  const base = 345.0, change = +(Math.sin(Date.now() / 60000) * 3).toFixed(2);
  const cur = Math.round((base + change) / 0.05) * 0.05;
  const qty = (seed) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return 1 + Math.floor((x - Math.floor(x)) * 480); };
  const asks = [], bids = [];
  for (let i = 1; i <= 10; i++) { const p = +(cur + i * 0.05).toFixed(2); asks.push({ px: p, qty: qty(Math.round(p * 100)) }); }
  for (let i = 1; i <= 10; i++) { const p = +(cur - i * 0.05).toFixed(2); bids.push({ px: p, qty: qty(Math.round(p * 100)) }); }
  return { status: 'ok', source: 'demo', ...normalizeBook(asks, bids) };
}

async function fetchOrderbook() {
  if (obCache.data && Date.now() - obCache.at < OB_CACHE_MS) return obCache.data;
  const sources = buildOrderbookSources();
  if (!sources.length) {
    return { status: 'unavailable', reason: '실거래 호가 소스가 설정되지 않았습니다 (KOSPI_NIGHT_ORDERBOOK_URL 또는 KOSPI_NIGHT_FUTURES_CODE).' };
  }
  const headers = orderbookHeaders();
  const errors = [];
  for (const url of sources) {
    try {
      const { status, body } = await httpGetText(url, 7000, headers);
      if (status !== 200) { errors.push(`${url} → HTTP ${status}`); continue; }
      const book = parseOrderbook(body);
      if (book) {
        const data = { status: 'ok', source: new URL(url).host, fetchedAt: new Date().toISOString(), ...book };
        obCache.at = Date.now(); obCache.data = data;
        return data;
      }
      errors.push(`${url} → 파싱 실패`);
    } catch (e) { errors.push(`${url} → ${e.message}`); }
  }
  if (obCache.data) return { ...obCache.data, status: 'stale', errors };
  return { status: 'unavailable', errors };
}

app.get('/api/kospi-night/orderbook', async (req, res) => {
  if (process.env.KOSPI_NIGHT_DEMO === '1' || req.query.demo === '1') {
    return res.json(demoOrderbook());
  }
  try {
    res.json(await fetchOrderbook());
  } catch (e) {
    res.status(502).json({ status: 'error', message: e.message });
  }
});

app.get('/api/kospi-night/history', async (req, res) => {
  if (process.env.KOSPI_NIGHT_DEMO === '1' || req.query.demo === '1') {
    return res.json({ status: 'ok', source: 'demo', series: demoSeries() });
  }
  try {
    res.json(await fetchKospiHistory());
  } catch (e) {
    res.status(502).json({ status: 'error', message: e.message });
  }
});

app.get('/api/kospi-night', async (req, res) => {
  if (process.env.KOSPI_NIGHT_DEMO === '1' || req.query.demo === '1') {
    const base = 345.0;
    const change = +(Math.sin(Date.now() / 60000) * 3).toFixed(2);
    return res.json({
      status: 'ok',
      source: 'demo',
      name: '코스피200 야간선물 (데모)',
      value: +(base + change).toFixed(2),
      change,
      changeRate: +((change / base) * 100).toFixed(2),
      prevClose: base,
      time: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      session: nightSessionStatus(),
    });
  }
  try {
    const data = await fetchKospiNight();
    res.json({ ...data, session: nightSessionStatus() });
  } catch (e) {
    res.status(502).json({ status: 'error', message: e.message });
  }
});

// 직접 실행하면 서버를 띄우고, Vercel 등 서버리스 환경에서는 app 만 export 한다.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`메타공간 플랫폼 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
