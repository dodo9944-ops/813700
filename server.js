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

app.listen(PORT, () => {
  console.log(`메타공간 플랫폼 실행 중: http://localhost:${PORT}`);
});
