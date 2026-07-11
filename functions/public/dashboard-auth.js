// 대시보드 HTML의 <script> 태그로 붙는 클라이언트 코드입니다.
// Firebase 로그인은 안 쓰는 시스템에 있으므로(이름+전화번호 커스텀 인증만 존재),
// 여기서는 간단한 API 키 방식으로 대시보드를 보호합니다.

const API_URL = 'https://us-central1-m-smart-90148.cloudfunctions.net/getDashboardData';
const STORAGE_KEY = 'monitor_api_key';

function getStoredKey() {
  return localStorage.getItem(STORAGE_KEY);
}

function promptForKey() {
  const key = window.prompt('모니터링 API 키를 입력하세요.');
  if (key) localStorage.setItem(STORAGE_KEY, key);
  return key;
}

async function fetchDashboardData(isRetry) {
  let key = getStoredKey();
  if (!key) key = promptForKey();
  if (!key) throw new Error('API 키가 필요합니다');

  const res = await fetch(API_URL, {
    headers: { 'x-api-key': key },
  });

  if (res.status === 401) {
    // 저장된 키가 틀렸으면 지우고 그 자리에서 바로 다시 물어봄
    localStorage.removeItem(STORAGE_KEY);
    if (isRetry) throw new Error('API 키가 올바르지 않습니다.');
    const retryKey = promptForKey();
    if (!retryKey) throw new Error('API 키가 필요합니다');
    return fetchDashboardData(true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `요청 실패 (${res.status})`);
  }

  return res.json();
}

// 대시보드 HTML에서: loadDashboard((data) => renderDashboard(data));
async function loadDashboard(callback) {
  try {
    const data = await fetchDashboardData();
    callback(data);
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}
