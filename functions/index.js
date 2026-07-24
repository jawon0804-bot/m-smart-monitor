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
const { getMonthToDateCost } = require('./lib/billing');
const { getLoginStats, getActiveLockouts } = require('./lib/loginActivity');

admin.initializeApp();

// 대시보드 API를 지킬 API 키. Secret Manager에 미리 등록해야 합니다 (SETUP_GUIDE 참고).
const MONITOR_API_KEY = defineSecret('MONITOR_API_KEY');

async function collectHosting(windowMinutes = 1440) {
  return Promise.all(
    HOSTING_SITES.map(async (site) => ({
      id: site.id,
      label: site.label,
      traffic: await getHostingTraffic(site.domain, windowMinutes).catch((e) => ({ error: String(e.message || e) })),
      errors: await getHostingErrors(site.domain, 5, windowMinutes).catch(() => []),
    }))
  );
}

async function collectCloudRun(windowMinutes = 1440) {
  return Promise.all(
    CLOUD_RUN_SERVICES.map(async (svc) => ({
      name: svc.name,
      label: svc.label,
      stats: await getCloudRunStats(svc.name, windowMinutes),
      health: await checkServiceHealth(svc.healthUrl),
      errors: await getRecentErrors('cloud_run_revision', svc.name, 5, windowMinutes).catch(() => []),
    }))
  );
}

async function collectFunctions(windowMinutes = 1440) {
  return Promise.all(
    FUNCTIONS.map(async (fn) => ({
      name: fn.name,
      label: fn.label,
      stats: await getFunctionStats(fn.name, windowMinutes).catch(() => null),
      errors: await getRecentErrors('cloud_function', fn.name, 5, windowMinutes).catch(() => []),
      generationCheck: await checkFunctionGeneration(fn.name).catch(() => null),
    }))
  );
}

// 10분마다 전체 수집해서 Firestore에 캐시로 저장
exports.collectMetrics = onSchedule(
  { schedule: 'every 10 minutes', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const [hosting, cloudRun, functions, schedulerJobs, taskQueue, mailFailures, billing, loginStats, activeLockouts] =
      await Promise.all([
        collectHosting(),
        collectCloudRun(),
        collectFunctions(),
        getSchedulerJobs().catch((e) => ({ error: String(e) })),
        getQueueStatus().catch((e) => ({ error: String(e) })),
        getMailFailures().catch(() => []),
        getMonthToDateCost().catch((e) => ({ available: false, reason: String(e) })),
        getLoginStats().catch((e) => ({ error: String(e) })),
        getActiveLockouts().catch(() => []),
      ]);

    await admin.firestore().doc(CACHE_DOC_PATH).set({
      updatedAt: Date.now(),
      hosting,
      cloudRun,
      functions,
      schedulerJobs,
      taskQueue,
      mailFailures,
      billing,
      loginStats,
      activeLockouts,
    });
  }
);

// range 필터 → 조회 기간(분). daily는 10분 캐시를 그대로 쓰고,
// weekly/monthly는 그 자리에서 Cloud Monitoring/Logging/Firestore를 라이브로 다시 조회한다.
const RANGE_WINDOW_MINUTES = { daily: 1440, weekly: 10080, monthly: 43200 };

// 대시보드가 호출하는 읽기 전용 API. x-api-key 헤더 필수.
// ?range=daily|weekly|monthly (기본 daily)
exports.getDashboardData = onRequest(
  { cors: true, secrets: [MONITOR_API_KEY] },
  async (req, res) => {
    const key = req.headers['x-api-key'];
    if (!key || key !== MONITOR_API_KEY.value()) {
      res.status(401).json({ error: '인증 실패 (API 키 확인)' });
      return;
    }

    const range = RANGE_WINDOW_MINUTES[req.query.range] ? req.query.range : 'daily';

    const snap = await admin.firestore().doc(CACHE_DOC_PATH).get();
    if (!snap.exists) {
      res.status(404).json({ error: '아직 수집된 데이터가 없습니다.' });
      return;
    }
    const cached = snap.data();

    if (range === 'daily') {
      res.status(200).json({ ...cached, range });
      return;
    }

    // weekly/monthly는 캐시에 없는 기간이라 그 자리에서 다시 조회한다.
    // (스케줄 잡/큐 상태/이번 달 요금/현재 잠긴 계정은 기간 개념이 없어 캐시 값을 그대로 씀)
    const windowMinutes = RANGE_WINDOW_MINUTES[range];
    const [hosting, cloudRun, functions, mailFailures, loginStats] = await Promise.all([
      collectHosting(windowMinutes),
      collectCloudRun(windowMinutes),
      collectFunctions(windowMinutes),
      getMailFailures(5, windowMinutes).catch(() => []),
      getLoginStats(windowMinutes).catch((e) => ({ error: String(e) })),
    ]);

    res.status(200).json({
      ...cached,
      updatedAt: Date.now(),
      range,
      hosting,
      cloudRun,
      functions,
      mailFailures,
      loginStats,
    });
  }
);
