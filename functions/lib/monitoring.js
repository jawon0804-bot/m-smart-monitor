const monitoring = require('@google-cloud/monitoring');
const { PROJECT_ID } = require('../config/services');

// 같은 프로젝트 안에서 돌아가는 함수라서 별도 credentials 없이
// 기본 런타임 서비스 계정(ADC)을 그대로 씁니다.
const client = new monitoring.MetricServiceClient();

async function sumMetric(metricType, windowMinutes, filterExtra = '') {
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - windowMinutes * 60;

  const [timeSeries] = await client.listTimeSeries({
    name: client.projectPath(PROJECT_ID),
    filter: `metric.type="${metricType}"${filterExtra}`,
    interval: {
      startTime: { seconds: startTime },
      endTime: { seconds: now },
    },
    view: 'FULL',
  });

  let total = 0;
  for (const series of timeSeries) {
    for (const point of series.points) {
      total += Number(point.value.int64Value || point.value.doubleValue || 0);
    }
  }
  return total;
}

async function avgDistributionMetric(metricType, windowMinutes, filterExtra = '') {
  const now = Math.floor(Date.now() / 1000);
  const [timeSeries] = await client.listTimeSeries({
    name: client.projectPath(PROJECT_ID),
    filter: `metric.type="${metricType}"${filterExtra}`,
    interval: {
      startTime: { seconds: now - windowMinutes * 60 },
      endTime: { seconds: now },
    },
    view: 'FULL',
  });

  let sum = 0;
  let count = 0;
  for (const series of timeSeries) {
    for (const point of series.points) {
      const dist = point.value.distributionValue;
      if (dist) {
        sum += dist.mean * dist.count;
        count += Number(dist.count);
      }
    }
  }
  return count > 0 ? Math.round(sum / count) : 0;
}

// 지표 하나가 실패해도(잘못된 metric.type, 권한 부족 등) 전체 수집이
// 죽지 않도록 개별적으로 감싸고, 실패 사유는 로그에 남깁니다.
async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[monitoring] "${label}" 지표 조회 실패:`, err.message || err);
    return null;
  }
}

// Firebase Hosting 사이트별 트래픽. siteId로 필터링.
// ⚠️ Firebase Hosting은 Cloud Run/Functions와 달리 Cloud Monitoring에
// 트래픽 지표를 기본으로 내보내지 않을 수 있습니다. 계속 null이 나오면
// 이 지표 자체가 프로젝트에서 지원 안 되는 것일 수 있어요 (로그 메시지로 확인).
async function getHostingStats(siteId, windowMinutes = 1440) {
  const filterExtra = ` AND resource.labels.site="${siteId}"`;
  const requestCount = await safe(`hosting:${siteId}:requests`, () =>
    sumMetric('firebasehosting.googleapis.com/network/request_count', windowMinutes, filterExtra)
  );
  const sentBytes = await safe(`hosting:${siteId}:bytes`, () =>
    sumMetric('firebasehosting.googleapis.com/network/sent_bytes_count', windowMinutes, filterExtra)
  );
  return {
    requestCount,
    sentBytesMB: sentBytes != null ? +(sentBytes / (1024 * 1024)).toFixed(1) : null,
  };
}

// Cloud Run 서비스별 요청 수 + 평균 지연시간
async function getCloudRunStats(serviceName, windowMinutes = 1440) {
  const filterExtra = ` AND resource.labels.service_name="${serviceName}"`;
  const requestCount = await safe(`run:${serviceName}:requests`, () =>
    sumMetric('run.googleapis.com/request_count', windowMinutes, filterExtra)
  );
  const avgLatencyMs = await safe(`run:${serviceName}:latency`, () =>
    avgDistributionMetric('run.googleapis.com/request_latencies', windowMinutes, filterExtra)
  );
  return { requestCount, avgLatencyMs };
}

// Firebase Functions(2nd Gen 기준) 함수별 호출 수 + 에러 수
async function getFunctionStats(functionName, windowMinutes = 1440) {
  const filterExtra = ` AND resource.labels.function_name="${functionName}"`;
  const executions = await safe(`fn:${functionName}:executions`, () =>
    sumMetric(
      'cloudfunctions.googleapis.com/function/execution_count', windowMinutes, filterExtra
    )
  );
  const errors = await safe(`fn:${functionName}:errors`, () =>
    sumMetric(
      'cloudfunctions.googleapis.com/function/execution_count',
      windowMinutes,
      filterExtra + ' AND metric.labels.status!="ok"'
    )
  );
  return { executions, errors };
}

module.exports = { getHostingStats, getCloudRunStats, getFunctionStats };
