# 메타공간 플랫폼 (Metaspace Platform)

메타공간, 협동조합 홈페이지, 텔레봇 브릿지를 하나로 묶은 오픈 플랫폼입니다.

## 구성

- `/` — 메타스페이스 로비 (2D 캔버스 월드, WASD 이동)
- `/coop.html` — 메타공간 협동조합 소개 및 가입 신청
- `/bridge.html` — 텔레그램 ↔ 메타공간 브릿지 (온라인)

## 실행

```bash
npm install
npm start
# http://localhost:3000
```

## 텔레봇 브릿지 API

- `GET  /api/bridge/status` — 브릿지 상태
- `POST /api/bridge/toggle` — 온/오프 전환
- `POST /api/bridge/send` — 메시지 전송 (body: `{ chatId, text, botToken? }`)
- `POST /api/bridge/webhook` — 텔레그램 웹훅 수신
- `GET  /api/bridge/messages` — 최근 로그 30건

`botToken`과 `chatId`가 함께 전달되면 실제 텔레그램 API(`api.telegram.org`)로
릴레이하고, 비어 있으면 로컬 에코 모드로 동작합니다.

## 협동조합 API

- `GET /api/coop/info` — 조합 기본 정보

## 브랜치

`claude/build-metaspace-platform-APHlN`
