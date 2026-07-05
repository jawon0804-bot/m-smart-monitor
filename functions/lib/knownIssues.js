const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const { PROJECT_ID, REGION } = require('../config/services');

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

// issueReminderScheduler가 아직 1st Gen인지 확인.
// Cloud Functions v1 API에서 조회가 되면 1st Gen(=Node 22 비호환 위험)입니다.
async function checkFunctionGeneration(functionName) {
  try {
    const authClient = await auth.getClient();
    const cf = google.cloudfunctions({ version: 'v1', auth: authClient });
    const name = `projects/${PROJECT_ID}/locations/${REGION}/functions/${functionName}`;
    await cf.projects.locations.functions.get({ name });
    return { functionName, generation: '1st Gen', warning: true };
  } catch (err) {
    // v1에 없으면 2nd Gen으로 간주 (정상)
    return { functionName, generation: '2nd Gen', warning: false };
  }
}

// Cloud Run 서비스가 healthUrl을 갖고 있으면 직접 핑 (없으면 스킵)
async function checkServiceHealth(healthUrl) {
  if (!healthUrl) return null;
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

module.exports = { checkFunctionGeneration, checkServiceHealth };
