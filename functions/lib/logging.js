const { Logging } = require('@google-cloud/logging');
const { PROJECT_ID } = require('../config/services');

const logging = new Logging({ projectId: PROJECT_ID });

async function queryLogs(filter, maxResults) {
  const [entries] = await logging.getEntries({
    filter,
    orderBy: 'timestamp desc',
    pageSize: maxResults,
  });

  return entries.map((entry) => ({
    message:
      entry.data?.message ||
      entry.data?.textPayload ||
      JSON.stringify(entry.data).slice(0, 200),
    resource:
      entry.metadata.resource?.labels?.service_name ||
      entry.metadata.resource?.labels?.function_name ||
      entry.metadata.resource?.type,
    timestamp: entry.metadata.timestamp,
  }));
}

// 리소스 라벨(service_name / function_name)로 좁힌 최근 에러
async function getRecentErrors(resourceType, resourceName, maxResults = 5) {
  const labelKey = resourceType === 'cloud_run_revision' ? 'service_name' : 'function_name';
  const filter = [
    `resource.type="${resourceType}"`,
    `resource.labels.${labelKey}="${resourceName}"`,
    'severity>=ERROR',
    'timestamp>="' + new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() + '"',
  ].join(' AND ');

  return queryLogs(filter, maxResults);
}

// 메일 발송 실패만 별도로 모아보기 (Gmail SMTP / 앱 비밀번호 만료 등을 빠르게 캐치)
async function getMailFailures(maxResults = 5) {
  const filter = [
    'severity>=ERROR',
    'timestamp>="' + new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() + '"',
    '(textPayload=~"mail" OR textPayload=~"SMTP" OR textPayload=~"메일")',
  ].join(' AND ');

  return queryLogs(filter, maxResults);
}

// Firebase Hosting은 Cloud Monitoring에 지표를 안 내보내고, 대신 Cloud Logging으로
// 요청 로그(logName: webrequests, resource.type: firebase_domain)를 보냅니다.
// ⚠️ 사전 조건: Firebase 콘솔 > 프로젝트 설정 > 통합 > Cloud Logging에서
// 해당 호스팅 사이트의 로그 내보내기를 먼저 "연결"해야 데이터가 쌓입니다.
// (연결 전에는 로그 자체가 없어서 이 함수는 항상 0을 반환합니다.)
async function getHostingTraffic(hostname, windowMinutes = 1440) {
  const filter = [
    'resource.type="firebase_domain"',
    `jsonPayload.hostname="${hostname}"`,
    'timestamp>="' + new Date(Date.now() - windowMinutes * 60 * 1000).toISOString() + '"',
  ].join(' AND ');

  let requestCount = 0;
  let totalBytes = 0;

  let [entries, nextQuery] = await logging.getEntries({ filter, pageSize: 1000 });

  // 트래픽이 많으면 페이지가 여러 장 나올 수 있어 전부 순회합니다.
  // (내부 도구 규모 기준으로는 충분히 감당 가능한 수준입니다)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    requestCount += entries.length;
    for (const entry of entries) {
      const size = entry.metadata?.httpRequest?.responseSize;
      if (size) totalBytes += Number(size);
    }
    if (!nextQuery) break;
    [entries, nextQuery] = await logging.getEntries(nextQuery);
  }

  return { requestCount, sentBytesMB: +(totalBytes / (1024 * 1024)).toFixed(2) };
}

// Hosting은 리소스 라벨 구조가 달라서(firebase_domain + hostname) 별도 함수로 분리
async function getHostingErrors(hostname, maxResults = 5) {
  const filter = [
    'resource.type="firebase_domain"',
    `jsonPayload.hostname="${hostname}"`,
    'httpRequest.status>=500',
    'timestamp>="' + new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() + '"',
  ].join(' AND ');

  return queryLogs(filter, maxResults);
}

module.exports = { getRecentErrors, getMailFailures, getHostingTraffic, getHostingErrors };
