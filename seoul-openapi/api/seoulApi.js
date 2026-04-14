/**
 * 서울시 열린데이터 광장 API 클라이언트 모듈
 *
 * 기본 요청 URL 구조:
 *   http://openapi.seoul.go.kr:8088/{KEY}/{TYPE}/{SERVICE}/{START}/{END}/{...params}
 *
 * - KEY       : 인증키 (.env 에서 로드)
 * - TYPE      : 응답 형식 (json | xml)
 * - SERVICE   : 서비스명 (예: LandPriceOpenService)
 * - START/END : 페이징 인덱스 (1-based)
 */

const fetch = require('node-fetch');

const BASE_URL = 'http://openapi.seoul.go.kr:8088';

/**
 * 서울 열린데이터 API 범용 호출 함수
 * @param {string} apiKey   - 인증키
 * @param {string} service  - 서비스명
 * @param {object} options
 * @param {number} [options.start=1]       - 시작 인덱스
 * @param {number} [options.end=5]         - 종료 인덱스
 * @param {string} [options.type='json']   - 응답 형식
 * @param {string[]} [options.params=[]]   - 추가 경로 파라미터
 * @returns {Promise<object>} 파싱된 응답 데이터
 */
async function callApi(apiKey, service, options = {}) {
  const { start = 1, end = 5, type = 'json', params = [] } = options;

  const pathSegments = [apiKey, type, service, start, end, ...params]
    .map(encodeURIComponent);
  const url = `${BASE_URL}/${pathSegments.join('/')}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();

  // 서울 API 공통 에러 응답 처리
  if (data.RESULT && data.RESULT.CODE !== 'INFO-000') {
    throw new Error(`[${data.RESULT.CODE}] ${data.RESULT.MESSAGE}`);
  }

  return data;
}

/**
 * 서비스별 래퍼 함수를 생성하는 팩토리
 * @param {string} apiKey   - 인증키
 * @param {string} service  - 서비스명
 * @returns {function} (options?) => Promise<object>
 */
function createService(apiKey, service) {
  return (options = {}) => callApi(apiKey, service, options);
}

/**
 * 서울 API 클라이언트 초기화
 * @param {string} apiKey - 인증키
 * @returns {object} 서비스별 메서드를 가진 클라이언트 객체
 */
function createClient(apiKey) {
  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    throw new Error('.env 파일에 유효한 SEOUL_API_KEY 를 설정하세요.');
  }

  return {
    /** 범용 API 호출 */
    call: (service, options) => callApi(apiKey, service, options),

    /** 서비스 래퍼 생성 */
    createService: (service) => createService(apiKey, service),

    // ── 자주 사용하는 서비스 프리셋 ──

    /** 공동주택 공시가격 */
    landPrice: createService(apiKey, 'LandPriceOpenService'),

    /** 서울시 건축물 대장 */
    building: createService(apiKey, 'getBuildingInfo'),

    /** 서울시 도시정비사업 현황 */
    urbanRenewal: createService(apiKey, 'tbLnOpendataRtmsRentV'),

    /** 서울시 인구 통계 */
    population: createService(apiKey, 'SPOP_LOCAL_RESD_DONG'),

    /** 서울시 부동산 실거래가 */
    realEstate: createService(apiKey, 'tbLnOpendataRtmsV'),
  };
}

module.exports = { createClient, callApi };
