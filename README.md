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

## 라이브 배포

### A. GitHub Pages (정적 UI만)
`.github/workflows/deploy-pages.yml`이 `public/` 디렉터리를 Pages로 배포합니다.
브릿지·뉴스 API는 동작하지 않고 `config.js`의 `apiBase`를 외부 Node 서버 주소로
설정하면 UI가 해당 서버에 연결됩니다.

1. GitHub 저장소 → Settings → Pages → Source: **GitHub Actions**
2. 이 브랜치로 push 시 자동 배포

### B. 풀스택 호스팅 (권장)

| 플랫폼 | 파일 | 명령 |
|--------|------|------|
| Render | `render.yaml` | 대시보드에서 Blueprint 연결 |
| Fly.io | `fly.toml` | `flyctl launch --copy-config && flyctl deploy` |
| Heroku | `Procfile` | `heroku create && git push heroku` |
| Docker | `Dockerfile` | `docker build -t metaspace . && docker run -p 3000:3000 metaspace` |

배포 후 `config.js`의 `apiBase`를 배포 도메인으로 덮어써 Pages UI와 연결할 수
있습니다(CORS 허용 필요 시 서버 코드에 미들웨어 추가).

## 브랜치

`claude/build-metaspace-platform-APHlN`
