const { CloudSchedulerClient } = require('@google-cloud/scheduler');
const { PROJECT_ID, SCHEDULER_REGION } = require('../config/services');

const client = new CloudSchedulerClient();

// 프로젝트 안의 모든 스케줄 잡을 가져옵니다.
// (m-engine의 그룹별 잡 5개 + m-event의 issueReminderScheduler + collectMetrics 포함)
async function getSchedulerJobs() {
  const parent = client.locationPath(PROJECT_ID, SCHEDULER_REGION);
  const [jobs] = await client.listJobs({ parent });

  return jobs.map((job) => ({
    name: job.name.split('/').pop(),
    schedule: job.schedule,
    state: job.state, // ENABLED / PAUSED / DISABLED
    lastAttemptOk: !job.status || job.status.code === 0,
    lastAttemptTime: job.lastAttemptTime
      ? new Date(Number(job.lastAttemptTime.seconds) * 1000).toISOString()
      : null,
    scheduleTime: job.scheduleTime
      ? new Date(Number(job.scheduleTime.seconds) * 1000).toISOString()
      : null,
  }));
}

module.exports = { getSchedulerJobs };
