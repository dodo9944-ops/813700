/**
 * 서울시 열린데이터 API 실행 파일
 *
 * 사용법:
 *   1. .env 파일에 SEOUL_API_KEY 를 설정
 *   2. npm install
 *   3. npm start
 */

require('dotenv').config();
const { createClient } = require('./api/seoulApi');

const client = createClient(process.env.SEOUL_API_KEY);

async function main() {
  try {
    // ── 1. 프리셋 서비스 사용 예시 ──
    console.log('=== 공동주택 공시가격 조회 ===');
    const landData = await client.landPrice({ start: 1, end: 3 });
    console.log(JSON.stringify(landData, null, 2));

    // ── 2. 범용 호출 예시 ──
    console.log('\n=== 서울시 인구 통계 조회 ===');
    const popData = await client.population({ start: 1, end: 3 });
    console.log(JSON.stringify(popData, null, 2));

    // ── 3. 동적 서비스 생성 예시 ──
    console.log('\n=== 동적 서비스 호출 ===');
    const customService = client.createService('GlobalWarningStatus');
    const customData = await customService({ start: 1, end: 5 });
    console.log(JSON.stringify(customData, null, 2));

  } catch (err) {
    console.error('API 호출 실패:', err.message);
    process.exitCode = 1;
  }
}

main();
