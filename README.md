# m-smart-monitor

`m-smart-90148` 프로젝트 안에 있는 서비스들(M-SMART, m-event, facility-dashboard,
m-engine)을 한 화면에서 모니터링하는 도구입니다.

10분마다 각 서비스의 트래픽/에러/스케줄/로그인 현황을 자동 수집해서 Firestore에
캐시로 저장하고, 브라우저 대시보드가 그 캐시를 읽어 보여줍니다. push만 하면
GitHub Actions가 자동으로 배포합니다.

- **리포**: https://github.com/jawon0804-bot/m-smart-monitor
- **대시보드 주소**: https://m-smart-monitor.web.app

몇 달 뒤에 다시 봐도 헷갈리지 않도록, "왜 이렇게 만들었는지"와 "만들면서 실제로
부딪혔던 문제들"까지 최대한 자세히 적어뒀습니다.

---

## 1. 모니터링 대상

| 서비스 | 종류 | 리전 | 수집하는 것 |
|---|---|---|---|
| **M-SMART** | Firebase Hosting (`m-smart-90148.web.app`) | 글로벌 | 트래픽, 에러, 로그인 현황 |
| **m-event** | Firebase Hosting (`m-smart-0804.web.app`) + Functions | Functions는 `asia-northeast3` | 트래픽, 함수 호출/에러, 1st Gen 여부, 로그인 현황 |
| **facility-dashboard** | Cloud Run | `asia-northeast3` | 요청 수·지연시간, 에러, 로그인 현황 |
| **m-engine (FIRA)** | Cloud Run | `asia-northeast3` | 요청 수·지연시간, 에러 |
| (공통) | Cloud Scheduler | `us-central1` ⚠️ | 전체 잡 목록 + 성공/실패 |
| (공통) | Cloud Tasks | `us-central1` ⚠️ | `m-engine-schedule-queue` 상태 |
| (공통) | Cloud Logging | - | 메일 발송 실패 로그 |
| (공통) | Firestore `login_attempts`/`login_lockouts` | - | 앱별 로그인 성공/실패/차단, 현재 잠긴 계정 |
| (공통) | BigQuery 결제 내보내기 | - | 이번 달 서비스별 사용 요금 |

⚠️ Scheduler/Tasks가 `us-central1`인 이유는 8번 항목 참고.

## 2. 전체 흐름

```
Cloud Scheduler (10분마다)
      ↓
collectMetrics 함수 (Cloud Functions 2nd Gen)
      ↓ Cloud Monitoring / Logging / Scheduler / Tasks / Firestore / BigQuery 조회
      ↓
Firestore: _monitor/latest 문서에 통째로 덮어쓰기
      ↓
getDashboardData 함수 (HTTP API, x-api-key 헤더로 보호)
      ↓
브라우저 대시보드 (public/index.html)
```

지금은 최신 스냅샷 1개만 덮어쓰는 구조라 "며칠간 추이" 그래프는 없습니다.
지금 이 순간의 현황판입니다. 나중에 이력을 쌓고 싶으면 9번 항목 참고.

## 3. 파일 구조

```
functions/
├── package.json / package-lock.json
├── index.js                 collectMetrics(스케줄) + getDashboardData(HTTP API)
├── config/
│   └── services.js          호스팅/Cloud Run/함수/큐/BigQuery 테이블 설정
├── lib/
│   ├── monitoring.js         Cloud Run·Functions 사용량 (Cloud Monitoring API)
│   ├── logging.js            에러 로그, 메일 실패, Hosting 트래픽(Cloud Logging)
│   ├── scheduler.js          Cloud Scheduler 잡 상태
│   ├── tasks.js               Cloud Tasks 큐 상태
│   ├── knownIssues.js         1st Gen 함수 감지, Cloud Run 헬스체크
│   ├── billing.js             BigQuery 결제 내보내기로 이번 달 요금 조회
│   └── loginActivity.js       login_attempts/login_lockouts 집계 (신규)
└── public/
    ├── index.html             대시보드 화면
    └── dashboard-auth.js      API 키 인증 + fetch (GitHub Secret 자동 주입)

.github/workflows/deploy.yml   push 시 자동 배포 (Functions + Hosting)
IAM_SETUP.md                   권한/시크릿 설정
SETUP_GUIDE.md                 처음 설치 순서
```

## 4. 인증 방식

> ⚠️ **2026-07-11 정정**: 이 섹션은 예전에 "M-SMART/m-event/facility-dashboard가
> Firebase Auth를 안 쓴다"는 전제로 쓰여 있었는데, 이후 세 서비스 모두 m-event의
> `loginWithCredentials` Cloud Function을 통해 Firebase Auth Custom Token으로
> 로그인하는 방식으로 이미 전환되어 있었음(자세한 건 상위 폴더 `system_map.md` 참고).
> m-smart-monitor는 그 로그인 시스템을 재사용하지 않고 별도의 API 키 방식을 그대로 씀
> — 아래는 "왜 그런가"가 아니라 "지금 실제로 어떻게 동작하는가"만 정확히 기술.

- **`getDashboardData` API**: Secret Manager의 `MONITOR_API_KEY`로 보호
  (`x-api-key` 헤더)
- **키 입력 방식 (자동 주입 아님)**: `dashboard-auth.js`는 최초 접속 시
  `window.prompt()`로 관리자에게 키를 직접 물어보고, 입력받은 값을
  `localStorage`에 저장해서 이후 요청에 재사용합니다. **소스 코드/배포
  결과물 어디에도 키가 박혀있지 않아요** — view-source로는 안 보입니다.
  (예전엔 `__MONITOR_API_KEY__` 자리표시자를 CI가 치환하는 방식으로
  설계됐던 흔적이 `.github/workflows/deploy.yml`에 남아있었지만, 실제
  `dashboard-auth.js`는 그 자리표시자를 쓴 적이 없어 그 배포 단계는
  아무 동작도 안 하는 죽은 코드였음 — 지금은 정리함)
- 그래도 여전히 "키 하나를 관리자 전원이 공유"하는 구조라, 최초 키 값을
  누가 어떻게 안전하게 전달하는지는 별도 관리 필요(Secret Manager에서
  `gcloud secrets versions access latest --secret=MONITOR_API_KEY`로 조회 후
  구두/비밀번호 관리자 등으로 전달 권장). 여러 명이 쓰게 되면 IAP나
  Firebase Auth 기반 개별 관리자 로그인으로 업그레이드 권장.

## 5. 알려진 위험 신호 자동 감지 (`knownIssues.js`)

- **함수 1st Gen 여부** — `onInspectionLog`, `onIssueUpdate`,
  `issueReminderScheduler` 셋 다 체크. 1st Gen이면 노란 배지.
- **Cloud Run 헬스체크** — `healthUrl` 설정된 서비스만 (현재 둘 다 없어서 비활성).

## 6. 로그인 현황 모니터링 (신규)

M-SMART/m-event/facility-dashboard가 로그인 시도를 Firestore에 남기도록
만들어져 있어서(`login_attempts`, `login_lockouts` 컬렉션), 이걸 그대로 읽어
집계합니다.

- `login_attempts`: `{ app, at, blocked, input_name, input_phone, ip,
  matched_center, success, user_agent }` — 문서마다 시도 1건
- `login_lockouts`: 문서 ID가 사용자 이름, `{ failCount, lockedUntil,
  updated_at }` — 5회 실패 시 15분 잠금

`app` 필드 값 기준으로 자동으로 앱별 통계가 나뉘기 때문에, **facility-dashboard
쪽에 같은 컬렉션 이름으로 로그인 기록을 추가했을 때도 코드 수정 없이 자동으로
잡혔습니다.** 앱마다 다른 컬렉션을 쓰게 되면 그때는 `loginActivity.js` 수정
필요.

## 7. 이번 달 사용 요금 (BigQuery)

GCP는 "지금 얼마 나왔는지" 바로 꺼내는 간단한 API가 없어서, BigQuery 결제
내보내기를 거쳐야 합니다.

- 콘솔에서 결제 내보내기(표준 사용량 비용) → `billing_export` 데이터셋으로 설정
- 실제 생성된 테이블 이름을 `config/services.js`의 `BILLING_EXPORT_TABLE`에 반영
- **내보내기 활성화 후 테이블에 실제 데이터가 쌓이기까지 하루~이틀 걸릴 수
  있음** (활성화 직후엔 테이블은 생겨도 행 수 0)
- 통화는 하드코딩하지 않고 BigQuery 데이터의 `currency` 필드를 그대로 표시
  (이 결제 계정은 KRW 기준)

## 8. 실제로 배포하면서 발견한 문제들

### 🔴 해결됨 — Firestore 복합 인덱스 누락
`issueReminderScheduler`가 매일 09:00마다 `FAILED_PRECONDITION: The query
requires an index` 에러로 조용히 실패 중이었음. 에러 메시지 속 링크로 인덱스
생성해서 해결.

### 🟡 발견 — m-event 함수 3개 전부 1st Gen
README엔 `issueReminderScheduler`만 1st Gen이라 되어 있었는데, 실제로는
`onInspectionLog`, `onIssueUpdate`까지 전부 1st Gen. Node 22 지원 종료 전
재배포 필요 (m-event 쪽 별도 작업).

### 🟡 확인됨 — Cloud Tasks 큐 존재하지만 미사용
`m-engine-schedule-queue`는 실제로 있지만 대기 작업 0건 — m-engine이 병렬
처리용 환경변수 미설정으로 순차 처리(sequential_fallback) 모드로 동작 중.

### 🟢 해결됨 — Firebase Hosting 트래픽 (처음엔 미해결로 뒀던 것)
Firebase Hosting은 Cloud Monitoring에 지표를 안 내보냄. 대신 **Cloud
Logging 연동**(Firebase 콘솔 > 프로젝트 설정 > 통합 > Cloud Logging)을 켜야
`webrequests` 로그가 쌓이고, 그걸 `resource.type="firebase_domain"` +
`jsonPayload.hostname` 필터로 직접 집계하는 방식으로 해결. 연동 직후 최대
30분 정도 로그가 안 쌓일 수 있음.

## 9. GCP 특이사항 — 리전이 서로 다른 이유

프로젝트의 **App Engine 위치**가 한 번 정해지면 못 바꾸고, Cloud Scheduler와
Cloud Tasks는 리전 선택권 없이 이 위치를 그대로 씁니다. 이 프로젝트는 App
Engine 위치가 `us-central1`이라서, 자유롭게 리전을 고르는 Cloud Run/Functions
(`asia-northeast3`)와 무조건 `us-central1`인 Scheduler/Tasks가 서로 다른
리전에 있는 상태로 굳어져 있습니다. 버그 아니고 GCP 구조상 원래 이럼.

## 10. 개발 환경에서 겪은 삽질 (다음에 또 안 겪기 위한 기록)

- **Node 24는 호환 안 됨** — `firebase-functions/v2/*`에서
  `ERR_PACKAGE_PATH_NOT_EXPORTED` 발생. **Node 22**로 다운그레이드 필요.
- **`firebase init`을 `functions` 폴더 안에서 실행하면** `functions/functions/`
  처럼 중첩됨. 실제 배포 대상은 `firebase.json`의 `source`가 가리키는 폴더.
- **함수 리전 미지정 시 기본값(`us-central1`)으로 배포** — 나머지 서비스와
  안 맞아서 대시보드 URL 헷갈리기 쉬움.
- **Cloud Monitoring 필터 문법** — `resource.labels.xxx`,
  `metric.labels.xxx` (전부 복수형). 단수형으로 쓰면 `INVALID_ARGUMENT`.
- **개별 지표 실패가 전체를 죽임** — 지표 하나(예: 존재하지 않는 metric)가
  실패하면 전체 `collectMetrics`가 500으로 죽는 구조였음. 각 지표 호출을
  개별 try/catch(`safe()` 헬퍼)로 감싸서 하나 실패해도 나머지는 정상 수집
  되도록 수정.
- **`package.json`만 고치고 `package-lock.json`을 안 맞추면** `npm ci`가
  깨짐 — 의존성 추가할 때마다 `package-lock.json`도 같이 재생성
  (`rmdir node_modules`, `npm install`) 후 커밋.
- **GitHub Actions 짧은 시간에 연속 배포 → 409 충돌** — 같은 함수에 배포가
  겹치면 `unable to queue the operation` 에러. 워크플로에
  `concurrency: { group: firebase-deploy, cancel-in-progress: false }` 추가로
  해결 (동시 실행 방지, 순서대로 대기).
- **GitHub Actions "Re-run"은 그 커밋 기준으로만 재실행됨** — 최신 커밋으로
  다시 돌리고 싶으면 `workflow_dispatch` 트리거를 추가해서 "Run workflow"
  버튼으로 최신 main 기준 수동 실행.
- **ZIP 다운로드로 받은 폴더는 git 저장소가 아님** — `git clone`으로 받아야
  push/pull 가능. 집/회사처럼 컴퓨터가 여러 대면 항상 `git pull` 먼저 하는
  습관 필요 (안 그러면 "diverged" 에러).

## 11. GitHub Actions 자동 배포 (CI/CD)

`main`의 `functions/**`, `firebase.json`, `.firebaserc`가 바뀌면 자동으로
`firebase deploy`가 돕니다 (`.github/workflows/deploy.yml`).

### 필요한 시크릿
- `FIREBASE_SERVICE_ACCOUNT` — 배포용 서비스 계정(`github-action-...`) JSON 키
- `MONITOR_API_KEY` — 대시보드 API 키 (dashboard-auth.js에 자동 주입됨)

### 배포용 서비스 계정에 필요했던 권한 (하나씩 겪으면서 추가함)

```bash
SA="github-action-1252276223@m-smart-90148.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding m-smart-90148 --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountUser"
gcloud secrets add-iam-policy-binding MONITOR_API_KEY --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding MONITOR_API_KEY --member="serviceAccount:${SA}" --role="roles/secretmanager.viewer"
gcloud projects add-iam-policy-binding m-smart-90148 --member="serviceAccount:${SA}" --role="roles/cloudscheduler.admin"
```

### 런타임 서비스 계정(`267082158406-compute@...`)에 필요한 권한

```bash
RUNTIME_SA="267082158406-compute@developer.gserviceaccount.com"

for ROLE in monitoring.viewer logging.viewer cloudscheduler.viewer cloudtasks.viewer run.viewer cloudfunctions.viewer firebasehosting.viewer bigquery.dataViewer bigquery.jobUser
do
  gcloud projects add-iam-policy-binding m-smart-90148 --member="serviceAccount:${RUNTIME_SA}" --role="roles/${ROLE}"
done
```

### Cloud Run 콘솔에 서비스가 여러 개 뜨는 이유
`collectMetrics`, `getDashboardData`는 2nd Gen Functions인데, 내부적으로
Cloud Run 위에서 실행되는 구조라 Cloud Run 콘솔에도 같이 나타남. 중복 배포
아님.

## 12. 앞으로 할 것

1. **m-event 함수 3개 2nd Gen 마이그레이션** (Node 22 지원 종료 전, m-event
   원본 코드에서 작업)
2. **Cloud Tasks 병렬 처리 켤지 결정** (지금은 순차 처리로도 문제없음, 센터
   수 늘어나면 재검토)
3. **다중 사용자 인증 업그레이드** (지금은 API 키, 여러 명 쓰면 IAP 등으로)
4. **이력 데이터 쌓아서 진짜 추이 그래프 만들기** (`_monitor/history/{timestamp}`
   서브컬렉션에 매번 스냅샷 추가하는 방식 고려)
5. **facility-dashboard 3번 뷰(피봇 테이블) 개선 예정** (사용자가 별도로
   손볼 예정이라고 언급했던 부분)

## 13. 설치/재배포 방법

처음 설치는 `SETUP_GUIDE.md`를 위에서부터 그대로 따라가면 됩니다.
코드를 수정한 뒤 재배포할 때는 `main`에 push만 하면 GitHub Actions가
자동으로 처리합니다. 로컬에서 직접 하고 싶으면:

```bash
firebase deploy --only functions:collectMetrics,functions:getDashboardData,hosting:monitor
```

`public/` 폴더 안 파일은 Hosting이라 위 명령에 포함해야 반영되고, Functions
로직(`lib/`, `config/`, `index.js`)이 바뀌면 함수도 같이 배포해야 합니다.
