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

module.exports = { getRecentErrors, getMailFailures };
