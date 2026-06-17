# 메타공간 플랫폼 (Metaspace Platform)

메타공간, 협동조합 홈페이지, 텔레봇 브릿지를 하나로 묶은 오픈 플랫폼입니다.

## 구성

- `/` — **손물(SONMUL) 코스피200 야간선물 대시보드** (실시간 시세 · 캔들차트 · 호가창 · 체결)
- `/kospi.html` — 코스피200 야간선물 간단 뷰 (라인 차트)
- `/metaspace` 계열 — 메타스페이스 로비/협동조합/텔레봇 브릿지 (`index.html`, `coop.html`, `bridge.html`)

### 손물 대시보드 (`/` · `public/sonmul.html`)

[sonmul.co.kr](https://sonmul.co.kr/) 스타일의 코스피200 야간선물 실시간 대시보드:

- 현재가·등락·등락률·시고저·전일종가 실시간 티커 (한국식: 상승=빨강/하락=파랑)
- 캔들차트(일봉) + 실시간 체결 추이(라인) 전환
- 10호가 호가창(잔량 막대) · 체결 테이프
- 거래시간 평일 18:00 ~ 익일 06:00 (KST) 세션 상태 표시
- 시세 소스가 막힌 환경은 `?demo=1` 로 데모 동작 확인

> 호가·체결은 현재가를 기준으로 재구성한 모의 정보이며 실제 체결과 다릅니다.

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

## 코스피200 야간선물 뷰어

![코스피200 야간선물 페이지 미리보기](docs/preview-kospi.png)

> 위 미리보기는 데모 모드(`?demo=1`)로 캡처한 화면입니다.

`/kospi.html` 은 코스피200 야간선물(KRX 파생 야간시장, 평일 18:00~익일 06:00 KST)
실시간 지수를 보여줍니다. 현재가·등락·등락률·전일종가·세션 상태와 함께
가격 추이 차트(축·격자·전일종가 기준선)를 그리고 10초마다 자동 갱신합니다.
차트는 시계열을 먼저 불러온 뒤 실시간 시세를 이어 붙입니다.
(한국 관행대로 상승=빨강, 하락=파랑)

- `GET /api/kospi-night` — 정규화된 시세 JSON
  (`{ status, value, change, changeRate, prevClose, time, source, session }`)
- `GET /api/kospi-night/history` — 차트용 시계열 JSON (`{ status, source, series:[{t,v}] }`)
- `GET /api/kospi-night/candles` — 캔들차트용 OHLC JSON (`{ status, source, candles:[{t,o,h,l,c}] }`)
- `GET /api/kospi-night/orderbook` — 실시간 호가 JSON (`{ status, source, asks:[{px,qty}], bids:[{px,qty}], askSum, bidSum }`)

### 실시간 호가 피드 연결

지수(KPI200)에는 호가창이 없고 호가는 **실거래 선물 종목**에만 존재합니다. 무료
공개 소스로는 KOSPI200 야간선물 호가를 안정적으로 받기 어려워, 어떤 실거래
피드든 꽂으면 동작하도록 업스트림을 환경변수로 지정합니다. 응답 형식은
방어적으로 파싱합니다(증권사 OpenAPI의 `askp1..10`/`bidp1..10`/`askp_rsqn1..10`
평면 필드, `asks`/`bids` 배열, 호가 레벨 객체 배열 등). 어떤 소스도 응답하지
않으면 가짜 호가를 만들지 않고 `status:"unavailable"` 을 돌려주며, 화면은 현재가
기준 **모의 호가**(라벨로 명시)로 폴백합니다.

| 환경변수 | 설명 |
|----------|------|
| `KOSPI_NIGHT_ORDERBOOK_URL` | 호가 JSON 엔드포인트(설정 시 이 URL만 사용) |
| `KOSPI_NIGHT_ORDERBOOK_HEADERS` | 인증 헤더 JSON 문자열 (예: `{"authorization":"Bearer ...","appkey":"..."}`) |
| `KOSPI_NIGHT_FUTURES_CODE` | 네이버 best-effort용 야간선물 종목코드 |

> 예) 한국투자증권(KIS) 등 증권사 실시간 선물 호가 REST 응답을
> `KOSPI_NIGHT_ORDERBOOK_URL` 에 지정하고 토큰/앱키를
> `KOSPI_NIGHT_ORDERBOOK_HEADERS` 로 넘기면 화면 호가창에 "실시간" 라벨과 함께
> 실거래 호가가 표시됩니다. 배포 환경에서 해당 호스트로의 아웃바운드 접근이
> 허용돼야 합니다.
- `?demo=1` — 데이터 소스 없이 동작 확인용 데모 시세/시계열

### 데이터 소스 설정

서버가 외부 시세 소스를 대신 호출해 CORS 없이 정규화합니다. 응답 필드명이
조금 달라도 견디도록 방어적으로 파싱하며, 어떤 소스도 응답하지 않으면 가짜
시세를 만들지 않고 `status:"unavailable"` 을 반환합니다.

| 환경변수 | 설명 | 기본값 |
|----------|------|--------|
| `KOSPI_NIGHT_API_URL` | 현재 시세를 가져올 JSON 엔드포인트(설정 시 이 URL만 사용) | 네이버 금융 모바일 API |
| `KOSPI_NIGHT_CHART_URL` | 차트 시계열을 가져올 JSON 엔드포인트 | 네이버 금융 차트 API |
| `KOSPI_NIGHT_DEMO` | `1` 이면 항상 데모 시세/시계열 반환 | 미설정 |

> 라이브 시세를 받으려면 배포 환경에서 시세 소스 호스트로의 아웃바운드 접근이
> 허용돼야 합니다(예: `api.stock.naver.com`). 차단된 환경에서는 `?demo=1`
> 로 UI를 확인하거나 접근 가능한 소스를 `KOSPI_NIGHT_API_URL` 로 지정하세요.

## 협동조합 API

- `GET /api/coop/info` — 조합 기본 정보

## 라이브 배포

### A. GitHub Pages (정적 UI만)
`.github/workflows/deploy-pages.yml`이 `public/` 디렉터리를 Pages로 배포합니다.
브릿지·뉴스 API는 동작하지 않고 `config.js`의 `apiBase`를 외부 Node 서버 주소로
설정하면 UI가 해당 서버에 연결됩니다.

> **주의**: 이 저장소의 `github-pages` 환경은 기본 브랜치에만 배포를 허용합니다.
> 기능 브랜치에서 자동 실행하면 "environment protection rules" 오류로 실패하므로,
> 워크플로는 `workflow_dispatch`(수동 트리거) 전용으로 설정되어 있습니다.

1. 이 브랜치를 기본 브랜치로 병합
2. Settings → Pages → Source: **GitHub Actions**
3. Actions 탭 → "Deploy static UI to GitHub Pages" → **Run workflow**

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
