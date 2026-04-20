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

app.listen(PORT, () => {
  console.log(`메타공간 플랫폼 실행 중: http://localhost:${PORT}`);
});
