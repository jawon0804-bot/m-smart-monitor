// m-smart-90148 프로젝트 안에 있는 서비스 4개를 정의합니다.
// 전부 같은 프로젝트라서 서비스 계정도 1개면 충분합니다 (Secret Manager 불필요).

const PROJECT_ID = 'm-smart-90148';
const REGION = 'asia-northeast3'; // Cloud Run / Functions 리전

// Cloud Scheduler 잡은 프로젝트의 App Engine 위치를 따라가서 별도입니다.
// (콘솔에서 확인한 실제 값: us-central1)
const SCHEDULER_REGION = 'us-central1';

const HOSTING_SITES = [
  { id: 'm-smart-90148', domain: 'm-smart-90148.web.app', label: 'M-SMART (점검 앱)' },
  { id: 'm-smart-0804', domain: 'm-smart-0804.web.app', label: 'm-event (이벤트 트래커)' },
];

const CLOUD_RUN_SERVICES = [
  { name: 'facility-dashboard', label: 'Dashboard', healthUrl: null },
  {
    name: 'm-engine',
    label: 'M-Engine (FIRA)',
    // README 기준 /healthz가 따로 없어서, 대신 스케줄 안전확인용으로 빈 상태 체크만.
    healthUrl: null,
  },
];

// m-event의 Firebase Functions (Firestore 트리거 2개 + 스케줄 1개)
const FUNCTIONS = [
  { name: 'onInspectionLog', label: '점검기록 → 이슈 자동생성' },
  { name: 'onIssueUpdate', label: '이슈 상태변경 → 메일발송' },
  { name: 'issueReminderScheduler', label: '3일 경과 재알림 (⚠️ 1st Gen 알려진 이슈)' },
];

// Cloud Scheduler 잡 (m-engine 그룹 분산 + m-event 리마인더)
// 실제로는 listJobs로 전체를 가져오지만, 알려진 이름을 참고용으로 남겨둡니다.
const KNOWN_SCHEDULER_JOB_PREFIXES = ['schedule-run-group', 'issueReminderScheduler'];

const TASKS_QUEUE = {
  name: 'm-engine-schedule-queue',
  region: SCHEDULER_REGION, // us-central1 (App Engine 위치 따라감, Scheduler와 동일)
};

// 대시보드 캐시 저장 위치. 업무 컬렉션과 겹치지 않도록 언더스코어 접두사 사용.
// ⚠️ Firestore 보안 규칙에 이 경로는 클라이언트 접근 금지를 명시해야 함 (SETUP_GUIDE 참고).
const CACHE_DOC_PATH = '_monitor/latest';

// 이번 달 사용 요금 조회용 BigQuery 결제 내보내기 테이블.
// GCP 콘솔 > 결제 > 결제 내보내기에서 BigQuery 내보내기를 켠 뒤,
// 거기서 알려주는 실제 테이블 이름으로 바꿔주세요.
// 설정 전이거나 아직 데이터가 안 쌓였으면 costWidget은 자동으로 "N/A"를 반환합니다.
const BILLING_EXPORT_TABLE =
  'm-smart-90148.billing_export.gcp_billing_export_v1_019845_A12266_E9FE4D';

module.exports = {
  PROJECT_ID,
  REGION,
  SCHEDULER_REGION,
  HOSTING_SITES,
  CLOUD_RUN_SERVICES,
  FUNCTIONS,
  KNOWN_SCHEDULER_JOB_PREFIXES,
  TASKS_QUEUE,
  CACHE_DOC_PATH,
  BILLING_EXPORT_TABLE,
};
