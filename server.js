const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
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

function httpGetText(url, timeoutMs = 7000) {
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

// ────────────────────────────────────────────────────────────────────────
// 개별 종목 야간(독일 GDR 연동) 시세 — 삼성전자 / SK하이닉스
//
// 코스피200 야간선물과 같은 방어적 파싱·캐시·"가짜 시세 금지" 원칙을 따른다.
// GDR 시세는 확인된 무료 JSON API가 없어 기본 소스 목록이 비어 있다.
// 실시간 연동이 필요하면 OVERNIGHT_<심볼>_API_URL / _CHART_URL 환경변수로
// 자체 데이터 소스(벤더 API, 스크레이퍼 등)를 지정한다. 미설정 시
// status:'unavailable' 을 반환하며, ?demo=1 로 동작을 확인할 수 있다.
// ────────────────────────────────────────────────────────────────────────

const OVERNIGHT_SYMBOLS = {
  SAMSUNG: {
    name: '삼성전자 야간선물 · 독일 GDR',
    quoteEnv: 'OVERNIGHT_SAMSUNG_API_URL',
    chartEnv: 'OVERNIGHT_SAMSUNG_CHART_URL',
    demoBase: 118.4, // 데모용 임의 기준가 (EUR)
  },
  HYNIX: {
    name: 'SK하이닉스 야간선물 · 독일 GDR',
    quoteEnv: 'OVERNIGHT_HYNIX_API_URL',
    chartEnv: 'OVERNIGHT_HYNIX_CHART_URL',
    demoBase: 96.2, // 데모용 임의 기준가 (EUR)
  },
};

const overnightCache = {};
const overnightChartCache = {};

async function fetchOvernightQuote(symbol) {
  const cfg = OVERNIGHT_SYMBOLS[symbol];
  const cache = (overnightCache[symbol] = overnightCache[symbol] || { at: 0, data: null });
  if (cache.data && Date.now() - cache.at < KOSPI_CACHE_MS) return cache.data;

  const url = process.env[cfg.quoteEnv];
  const errors = [];
  if (url) {
    try {
      const { status, body } = await httpGetText(url);
      if (status !== 200) {
        errors.push(`${url} → HTTP ${status}`);
      } else {
        const quote = parseQuote(body);
        if (quote) {
          const data = { status: 'ok', source: new URL(url).host, fetchedAt: new Date().toISOString(), ...quote };
          cache.at = Date.now();
          cache.data = data;
          return data;
        }
        errors.push(`${url} → 파싱 실패`);
      }
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  } else {
    errors.push(`${cfg.quoteEnv} 미설정 — 데이터 소스 없음`);
  }
  if (cache.data) return { ...cache.data, status: 'stale', errors };
  return { status: 'unavailable', errors, fetchedAt: new Date().toISOString() };
}

async function fetchOvernightHistory(symbol) {
  const cfg = OVERNIGHT_SYMBOLS[symbol];
  const cache = (overnightChartCache[symbol] = overnightChartCache[symbol] || { at: 0, data: null });
  if (cache.data && Date.now() - cache.at < CHART_CACHE_MS) return cache.data;

  const url = process.env[cfg.chartEnv];
  const errors = [];
  if (url) {
    try {
      const { status, body } = await httpGetText(url);
      if (status !== 200) {
        errors.push(`${url} → HTTP ${status}`);
      } else {
        const series = parseSeries(body);
        if (series) {
          const data = { status: 'ok', source: new URL(url).host, series };
          cache.at = Date.now();
          cache.data = data;
          return data;
        }
        errors.push(`${url} → 파싱 실패`);
      }
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  } else {
    errors.push(`${cfg.chartEnv} 미설정 — 데이터 소스 없음`);
  }
  if (cache.data) return { ...cache.data, status: 'stale', errors };
  return { status: 'unavailable', errors };
}

function overnightDemoSeries(base, points = 120) {
  const now = Date.now();
  const out = [];
  let v = base;
  for (let i = points - 1; i >= 0; i--) {
    v += (Math.random() - 0.5) * (base * 0.006);
    out.push({ t: now - i * 60000, v: +v.toFixed(2) });
  }
  out[out.length - 1].v = +(base + Math.sin(now / 60000) * (base * 0.01)).toFixed(2);
  return out;
}

app.get('/api/overnight/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase();
  const cfg = OVERNIGHT_SYMBOLS[symbol];
  if (!cfg) return res.status(404).json({ status: 'error', message: `알 수 없는 종목: ${symbol}` });

  if (process.env[`OVERNIGHT_${symbol}_DEMO`] === '1' || req.query.demo === '1') {
    const change = +(Math.sin(Date.now() / 60000) * cfg.demoBase * 0.01).toFixed(2);
    return res.json({
      status: 'ok',
      source: 'demo',
      name: `${cfg.name} (데모)`,
      value: +(cfg.demoBase + change).toFixed(2),
      change,
      changeRate: +((change / cfg.demoBase) * 100).toFixed(2),
      prevClose: cfg.demoBase,
      time: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      session: nightSessionStatus(),
    });
  }
  try {
    const data = await fetchOvernightQuote(symbol);
    res.json({ ...data, name: data.name || cfg.name, session: nightSessionStatus() });
  } catch (e) {
    res.status(502).json({ status: 'error', message: e.message });
  }
});

app.get('/api/overnight/:symbol/history', async (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase();
  const cfg = OVERNIGHT_SYMBOLS[symbol];
  if (!cfg) return res.status(404).json({ status: 'error', message: `알 수 없는 종목: ${symbol}` });

  if (process.env[`OVERNIGHT_${symbol}_DEMO`] === '1' || req.query.demo === '1') {
    return res.json({ status: 'ok', source: 'demo', series: overnightDemoSeries(cfg.demoBase) });
  }
  try {
    res.json(await fetchOvernightHistory(symbol));
  } catch (e) {
    res.status(502).json({ status: 'error', message: e.message });
  }
});

// sonmul.co.kr 식 경로(/overnight/SYMBOL)도 지원 — 대응하는 정적 페이지로 매핑
const OVERNIGHT_PAGES = { SAMSUNG: 'overnight-samsung.html', HYNIX: 'overnight-hynix.html' };
app.get('/overnight/:symbol', (req, res, next) => {
  const file = OVERNIGHT_PAGES[String(req.params.symbol || '').toUpperCase()];
  if (!file) return next();
  res.sendFile(path.join(__dirname, 'public', file));
});

// ────────────────────────────────────────────────────────────────────────
// 멀티 심볼 시세 레지스트리 — 대시보드(전체 종목 바로가기)용
//
// 코스피200 야간선물과 같은 원칙(방어적 파싱·캐시·가짜 시세 금지)을 여러
// 종목/지수/환율/무기한 계약에 공통 적용한다. 국내 개별 종목은 네이버 금융
// 모바일 API의 잘 알려진 URL 패턴을 기본값으로 시도하고, 그 외(선물/해외
// 지수/원자재/환율/24시간 무기한 계약)는 확인된 무료 API가 없어 소스가
// 비어 있다 — 필요하면 QUOTE_<ID>_API_URL 환경변수로 지정한다.
// ────────────────────────────────────────────────────────────────────────

function naverStockUrl(code) {
  return `https://m.stock.naver.com/api/stock/${code}/basic`;
}

const QUOTE_SYMBOLS = {
  kospi200_fut: { name: 'KOSPI200 선물', category: 'futures', demoBase: 349.85 },
  kosdaq150_fut: { name: 'KOSDAQ150 선물', category: 'futures', demoBase: 1395.6 },
  ewy_perp: { name: '한국 ETF 무기한', ticker: 'EWYUSDT', category: 'perp', demoBase: 178.57 },
  samsung_perp: { name: '삼성전자 무기한', ticker: 'SAMSUNGUSDT', category: 'perp', demoBase: 194.35 },
  hynix_perp: { name: 'SK하이닉스 무기한', ticker: 'SKHYNIXUSDT', category: 'perp', demoBase: 1247.92 },
  nasdaq_fut: { name: '나스닥 선물', category: 'global', demoBase: 29374.0 },
  wti_fut: { name: 'WTI 원유 선물', category: 'global', demoBase: 86.64 },
  usdkrw: { name: '원/달러 환율', category: 'global', demoBase: 1385.0 },
  stock_005930: { name: '삼성전자', code: '005930', category: 'stock', demoBase: 281500 },
  stock_000660: { name: 'SK하이닉스', code: '000660', category: 'stock', demoBase: 1730000 },
  stock_009150: { name: '삼성전기', code: '009150', category: 'stock', demoBase: 1316000 },
  stock_005380: { name: '현대자동차', code: '005380', category: 'stock', demoBase: 415000 },
  stock_402340: { name: 'SK스퀘어', code: '402340', category: 'stock', demoBase: 1123000 },
  stock_011070: { name: 'LG이노텍', code: '011070', category: 'stock', demoBase: 550000 },
};

const quoteCache = {};

function quoteSourceUrl(id) {
  const cfg = QUOTE_SYMBOLS[id];
  const envUrl = process.env[`QUOTE_${id.toUpperCase()}_API_URL`];
  if (envUrl) return envUrl;
  if (cfg.code) return naverStockUrl(cfg.code); // 국내 종목만 best-effort 기본 소스
  return null;
}

async function fetchQuoteSymbol(id) {
  const cfg = QUOTE_SYMBOLS[id];
  const cache = (quoteCache[id] = quoteCache[id] || { at: 0, data: null });
  if (cache.data && Date.now() - cache.at < KOSPI_CACHE_MS) return cache.data;

  const url = quoteSourceUrl(id);
  const errors = [];
  if (url) {
    try {
      const { status, body } = await httpGetText(url);
      if (status !== 200) {
        errors.push(`${url} → HTTP ${status}`);
      } else {
        const quote = parseQuote(body);
        if (quote) {
          const data = { status: 'ok', source: new URL(url).host, fetchedAt: new Date().toISOString(), ...quote };
          cache.at = Date.now();
          cache.data = data;
          return data;
        }
        errors.push(`${url} → 파싱 실패`);
      }
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  } else {
    errors.push(`QUOTE_${id.toUpperCase()}_API_URL 미설정 — 데이터 소스 없음`);
  }
  if (cache.data) return { ...cache.data, status: 'stale', errors };
  return { status: 'unavailable', errors, fetchedAt: new Date().toISOString() };
}

app.get('/api/quote/:id', async (req, res) => {
  const id = String(req.params.id || '');
  const cfg = QUOTE_SYMBOLS[id];
  if (!cfg) return res.status(404).json({ status: 'error', message: `알 수 없는 종목: ${id}` });

  if (process.env[`QUOTE_${id.toUpperCase()}_DEMO`] === '1' || req.query.demo === '1') {
    const change = +(Math.sin((Date.now() / 60000) + id.length) * cfg.demoBase * 0.012).toFixed(2);
    return res.json({
      status: 'ok',
      source: 'demo',
      name: `${cfg.name} (데모)`,
      value: +(cfg.demoBase + change).toFixed(2),
      change,
      changeRate: +((change / cfg.demoBase) * 100).toFixed(2),
      prevClose: cfg.demoBase,
      time: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    });
  }
  try {
    const data = await fetchQuoteSymbol(id);
    res.json({ ...data, name: data.name || cfg.name });
  } catch (e) {
    res.status(502).json({ status: 'error', message: e.message });
  }
});

app.get('/api/quote-symbols', (req, res) => {
  res.json(
    Object.entries(QUOTE_SYMBOLS).map(([id, cfg]) => ({
      id, name: cfg.name, category: cfg.category, ticker: cfg.ticker || cfg.code || null,
    }))
  );
});

// 직접 실행하면 서버를 띄우고, Vercel 등 서버리스 환경에서는 app 만 export 한다.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`메타공간 플랫폼 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
