const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const {
  HOSTING_SITES,
  CLOUD_RUN_SERVICES,
  FUNCTIONS,
  CACHE_DOC_PATH,
} = require('./config/services');

const { getCloudRunStats, getFunctionStats } = require('./lib/monitoring');
const { getRecentErrors, getMailFailures, getHostingTraffic, getHostingErrors } = require('./lib/logging');
const { getSchedulerJobs } = require('./lib/scheduler');
const { getQueueStatus } = require('./lib/tasks');
const { checkFunctionGeneration, checkServiceHealth } = require('./lib/knownIssues');

admin.initializeApp();

// 대시보드 API를 지킬 API 키. Secret Manager에 미리 등록해야 합니다 (SETUP_GUIDE 참고).
const MONITOR_API_KEY = defineSecret('MONITOR_API_KEY');

async function collectHosting() {
  return Promise.all(
    HOSTING_SITES.map(async (site) => ({
      id: site.id,
      label: site.label,
      traffic: await getHostingTraffic(site.domain).catch((e) => ({ error: String(e.message || e) })),
      errors: await getHostingErrors(site.domain).catch(() => []),
    }))
  );
}

async function collectCloudRun() {
  return Promise.all(
    CLOUD_RUN_SERVICES.map(async (svc) => ({
      name: svc.name,
      label: svc.label,
      stats: await getCloudRunStats(svc.name),
      health: await checkServiceHealth(svc.healthUrl),
      errors: await getRecentErrors('cloud_run_revision', svc.name, 5).catch(() => []),
    }))
  );
}

async function collectFunctions() {
  return Promise.all(
    FUNCTIONS.map(async (fn) => ({
      name: fn.name,
      label: fn.label,
      stats: await getFunctionStats(fn.name).catch(() => null),
      errors: await getRecentErrors('cloud_function', fn.name, 5).catch(() => []),
      generationCheck: await checkFunctionGeneration(fn.name).catch(() => null),
    }))
  );
}

// 10분마다 전체 수집해서 Firestore에 캐시로 저장
exports.collectMetrics = onSchedule(
  { schedule: 'every 10 minutes', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const [hosting, cloudRun, functions, schedulerJobs, taskQueue, mailFailures] =
      await Promise.all([
        collectHosting(),
        collectCloudRun(),
        collectFunctions(),
        getSchedulerJobs().catch((e) => ({ error: String(e) })),
        getQueueStatus().catch((e) => ({ error: String(e) })),
        getMailFailures().catch(() => []),
      ]);

    await admin.firestore().doc(CACHE_DOC_PATH).set({
      updatedAt: Date.now(),
      hosting,
      cloudRun,
      functions,
      schedulerJobs,
      taskQueue,
      mailFailures,
    });
  }
);

// 대시보드가 호출하는 읽기 전용 API. x-api-key 헤더 필수.
exports.getDashboardData = onRequest(
  { cors: true, secrets: [MONITOR_API_KEY] },
  async (req, res) => {
    const key = req.headers['x-api-key'];
    if (!key || key !== MONITOR_API_KEY.value()) {
      res.status(401).json({ error: '인증 실패 (API 키 확인)' });
      return;
    }

    const snap = await admin.firestore().doc(CACHE_DOC_PATH).get();
    if (!snap.exists) {
      res.status(404).json({ error: '아직 수집된 데이터가 없습니다.' });
      return;
    }

    res.status(200).json(snap.data());
  }
);
