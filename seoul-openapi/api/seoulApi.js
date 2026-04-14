/**
 * 서울시 열린데이터 광장 API 클라이언트 모듈
 *
 * 요청 URL 구조:
 *   http://openapi.seoul.go.kr:8088/{KEY}/{TYPE}/{SERVICE}/{START}/{END}/
 */

const BASE_URL = 'http://openapi.seoul.go.kr:8088';

/**
 * 서울 열린데이터 API 범용 호출
 */
async function callApi(apiKey, service, { start = 1, end = 5, type = 'json' } = {}) {
  const url = `${BASE_URL}/${apiKey}/${type}/${service}/${start}/${end}/`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();

  if (data.RESULT && data.RESULT.CODE !== 'INFO-000') {
    throw new Error(`[${data.RESULT.CODE}] ${data.RESULT.MESSAGE}`);
  }

  return data;
}

/**
 * 서비스별 래퍼 생성 팩토리
 */
function createService(apiKey, service) {
  return (options = {}) => callApi(apiKey, service, options);
}

/**
 * 서울 API 클라이언트 초기화
 */
function createClient(apiKey) {
  if (!apiKey) {
    throw new Error('.env 파일에 유효한 SEOUL_API_KEY 를 설정하세요.');
  }

  return {
    call: (service, options) => callApi(apiKey, service, options),
    createService: (service) => createService(apiKey, service),

    /** 서울시 공공와이파이 정보 */
    wifi: createService(apiKey, 'TbPublicWifiInfo'),

    /** 공동주택 공시가격 */
    landPrice: createService(apiKey, 'LandPriceOpenService'),

    /** 서울시 인구 통계 */
    population: createService(apiKey, 'SPOP_LOCAL_RESD_DONG'),

    /** 서울시 부동산 실거래가 */
    realEstate: createService(apiKey, 'tbLnOpendataRtmsV'),
  };
}

module.exports = { createClient, callApi };
