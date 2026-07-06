const { BigQuery } = require('@google-cloud/bigquery');
const { BILLING_EXPORT_TABLE } = require('../config/services');

const bigquery = new BigQuery();

// 이번 달(1일~오늘) 누적 사용 요금을 서비스별로 나눠서 반환합니다.
// ⚠️ BILLING_EXPORT_TABLE이 아직 실제 값으로 안 바뀌었거나, 결제 내보내기
// 활성화 직후라 데이터가 없으면 null을 반환합니다 (에러로 전체가 죽지 않게 처리).
async function getMonthToDateCost() {
  if (!BILLING_EXPORT_TABLE || BILLING_EXPORT_TABLE.includes('XXXXXX')) {
    return { available: false, reason: 'BILLING_EXPORT_TABLE 설정 전' };
  }

  const query = `
    SELECT
      service.description AS service,
      SUM(cost) AS total_cost,
      currency
    FROM \`${BILLING_EXPORT_TABLE}\`
    WHERE DATE(usage_start_time) >= DATE_TRUNC(CURRENT_DATE(), MONTH)
    GROUP BY service, currency
    ORDER BY total_cost DESC
  `;

  try {
    const [rows] = await bigquery.query({ query });
    if (!rows.length) {
      return { available: false, reason: '이번 달 결제 데이터 없음 (내보내기 시작 초기일 수 있음)' };
    }
    const totalCost = rows.reduce((sum, r) => sum + (r.total_cost || 0), 0);
    return {
      available: true,
      currency: rows[0].currency || 'USD',
      totalCost: +totalCost.toFixed(2),
      byService: rows.map((r) => ({
        service: r.service,
        cost: +Number(r.total_cost || 0).toFixed(2),
      })),
    };
  } catch (err) {
    return { available: false, reason: String(err.message || err) };
  }
}

module.exports = { getMonthToDateCost };
