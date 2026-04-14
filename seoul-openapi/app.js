/**
 * 서울시 열린데이터 API 실행 파일
 *
 * 사용법:
 *   1. .env 파일에 SEOUL_API_KEY 설정
 *   2. npm install
 *   3. npm start
 */

require('dotenv').config();

const { createClient } = require('./api/seoulApi');

const client = createClient(process.env.SEOUL_API_KEY);

async function main() {
  try {
    // 공공와이파이 정보 조회
    console.log('=== 서울시 공공와이파이 정보 ===');
    const wifiData = await client.wifi({ start: 1, end: 5 });
    console.log(JSON.stringify(wifiData, null, 2));

    // 동적 서비스 호출 예시
    console.log('\n=== 동적 서비스 호출 ===');
    const customService = client.createService('ListOnePMISBizInfo');
    const customData = await customService({ start: 1, end: 3 });
    console.log(JSON.stringify(customData, null, 2));

  } catch (err) {
    console.error('API 호출 실패:', err.message);
    process.exitCode = 1;
  }
}

main();
