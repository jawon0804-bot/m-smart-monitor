const admin = require('firebase-admin');

// Firestore Timestamp든 Date든 안전하게 밀리초로 변환
function toMillis(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis(); // Firestore Timestamp
  if (v instanceof Date) return v.getTime();
  return null;
}

// login_attempts: { app, at, blocked, input_name, input_phone, ip, matched_center, success, user_agent }
// 최근 windowMinutes 동안의 시도를 전체/성공/실패/차단, 앱별(m-smart/m-event)로 집계합니다.
async function getLoginStats(windowMinutes = 1440) {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - windowMinutes * 60 * 1000);

  const snap = await admin
    .firestore()
    .collection('login_attempts')
    .where('at', '>=', cutoff)
    .get();

  const stats = { total: 0, success: 0, fail: 0, blocked: 0, byApp: {} };

  snap.forEach((doc) => {
    const d = doc.data();
    stats.total += 1;
    if (d.success) stats.success += 1;
    else stats.fail += 1;
    if (d.blocked) stats.blocked += 1;

    const app = d.app || 'unknown';
    if (!stats.byApp[app]) stats.byApp[app] = { total: 0, success: 0, fail: 0 };
    stats.byApp[app].total += 1;
    if (d.success) stats.byApp[app].success += 1;
    else stats.byApp[app].fail += 1;
  });

  return stats;
}

// login_lockouts: 문서 ID = 사용자 이름, { failCount, lockedUntil, updated_at }
// lockedUntil이 미래인 것만 "지금 잠겨있는 계정"으로 골라냅니다.
async function getActiveLockouts() {
  const snap = await admin.firestore().collection('login_lockouts').get();
  const now = Date.now();
  const locked = [];

  snap.forEach((doc) => {
    const d = doc.data();
    const untilMs = toMillis(d.lockedUntil);
    if (untilMs && untilMs > now) {
      locked.push({
        name: doc.id,
        failCount: d.failCount || 0,
        lockedUntil: new Date(untilMs).toISOString(),
      });
    }
  });

  // 곧 풀리는 순서대로
  locked.sort((a, b) => new Date(a.lockedUntil) - new Date(b.lockedUntil));
  return locked;
}

module.exports = { getLoginStats, getActiveLockouts };
