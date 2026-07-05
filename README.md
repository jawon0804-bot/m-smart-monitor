# m-smart-monitor

`m-smart-90148` 프로젝트 안에 있는 서비스 4개(M-SMART, m-event,
facility-dashboard, m-engine)를 한 화면에서 모니터링하는 도구입니다.

10분마다 각 서비스의 트래픽/에러/스케줄 상태를 자동 수집해서 Firestore에
캐시로 저장하고, 브라우저 대시보드가 그 캐시를 읽어 보여줍니다.

몇 달 뒤에 다시 봐도 헷갈리지 않도록, "왜 이렇게 만들었는지"와 "만들면서
실제로 부딪혔던 문제들"까지 최대한 자세히 적어뒀습니다.

---

## 1. 이게 왜 필요했나

M-SMART 생태계는 프로젝트 1개 안에 성격이 다른 서비스 4개가 같이 돌아가고
있어서, 뭔가 안 될 때 "어디서부터 봐야 하는지"가 한눈에 안 보이는
문제가 있었습니다. 이 도구는 그 4개를 한 화면에 모아서, README들에 적혀
있던 "알려진 위험 신호"까지 자동으로 점검해주는 용도로 만들었습니다.

## 2. 모니터링 대상 (m-smart-90148 프로젝트)

| 서비스 | 종류 | 리전 | 이 도구가 수집하는 것 |
|---|---|---|---|
| **M-SMART** | Firebase Hosting (사이트 ID: `m-smart-90148`) | 글로벌 | 트래픽, 에러 (⚠️ 트래픽 지표는 현재 조회 안 됨, 8번 참고) |
| **m-event** | Firebase Hosting (사이트 ID: `m-smart-0804`) + Firebase Functions | Functions는 `asia-northeast3` | 트래픽, 함수 호출/에러, 1st Gen 여부 |
| **facility-dashboard** | Cloud Run | `asia-northeast3` | 요청 수, 평균 지연시간, 에러 |
| **m-engine (FIRA)** | Cloud Run | `asia-northeast3` | 요청 수, 평균 지연시간, 에러 |
| (공통) | Cloud Scheduler | `us-central1` ⚠️ | 전체 잡 목록 + 최근 실행 성공/실패 |
| (공통) | Cloud Tasks | `us-central1` ⚠️ | `m-engine-schedule-queue` 상태/적체 여부 |
| (공통) | Cloud Logging | - | 메일 발송 실패 로그 별도 집계 |

⚠️ 표시된 두 개(Scheduler, Tasks)는 **다른 서비스들이 `asia-northeast3`에
있는데도 왜인지 `us-central1`**입니다. 이유는 8번 항목 참고.

같은 프로젝트 안에 다 있어서, 서비스 계정도 1개, Secret Manager 시크릿도
API 키 하나면 충분합니다. (프로젝트가 여러 개로 나뉜 구조였다면 서비스
계정도 여러 개 필요했을 텐데, 그게 아니라서 훨씬 단순합니다.)

## 3. 전체 흐름

```
Cloud Scheduler (10분마다)
      ↓
collectMetrics 함수 (Cloud Functions 2nd Gen)
      ↓ Cloud Monitoring / Logging / Scheduler / Tasks API 조회
      ↓
Firestore: _monitor/latest 문서에 통째로 덮어쓰기
      ↓
getDashboardData 함수 (HTTP API, x-api-key 헤더로 보호)
      ↓
브라우저 대시보드 (public/index.html) — API 키 입력 후 fetch
```

**중요**: 지금은 최신 스냅샷 1개만 덮어쓰는 구조라, "14일 추이" 같은
과거 이력 그래프는 없습니다. 지금 이 순간의 현황판입니다. 나중에 이력을
쌓고 싶으면 9번 항목 참고.

## 4. 파일 구조

Firebase 프로젝트의 `functions/` 폴더 밑에 이렇게 들어갑니다.

```
functions/
├── package.json
├── index.js                 collectMetrics(스케줄) + getDashboardData(HTTP API)
├── config/
│   └── services.js          호스팅 사이트 / Cloud Run 서비스 / 함수 / 큐 이름·리전 정의
├── lib/
│   ├── monitoring.js         Hosting·Cloud Run·Functions 사용량 (Cloud Monitoring API)
│   ├── scheduler.js          Cloud Scheduler 잡 상태
│   ├── tasks.js               Cloud Tasks 큐 상태
│   ├── logging.js             에러 로그 + 메일 발송 실패 검색
│   └── knownIssues.js         1st Gen 함수 감지, Cloud Run 헬스체크
└── public/
    ├── index.html             대시보드 화면 (차트 + 카드)
    └── dashboard-auth.js      API 키 인증 + fetch 로직

IAM_SETUP.md                  권한/시크릿 설정 절차
SETUP_GUIDE.md                처음부터 끝까지 순서대로 따라하는 설치 설명서
```

## 5. 인증 방식 — 왜 Firebase Auth가 아니라 API 키인가

M-SMART/m-event는 Firebase Authentication을 아예 안 쓰고, Firestore의
`UserDB`를 직접 조회하는 커스텀 로그인 방식(이름+전화번호 대조)입니다.
그래서 대시보드 보호에 재사용할 "Firebase 로그인 토큰" 자체가
시스템에 없습니다.

대신 **Secret Manager에 등록한 API 키 하나**로 `getDashboardData`를
보호합니다. 대시보드를 처음 열면 브라우저가 키를 물어보고,
`localStorage`에 저장해서 다음부터는 자동으로 붙습니다.

관리자 혼자/소수만 쓰는 내부 도구 기준으로는 충분하지만, 여러 명이
쓰게 되거나 외부에 노출해야 하는 상황이 오면 IAP(Identity-Aware
Proxy)나 별도 관리자 로그인으로 업그레이드를 권장합니다.

## 6. 자동으로 감지하는 "알려진 위험 신호" (knownIssues.js)

각 서비스 README에 "확인 필요"라고 적혀 있던 것들 중, API로 자동
확인 가능한 항목만 넣었습니다.

- **함수가 1st Gen인지** — Cloud Functions v1 API로 조회가 되면 1st Gen.
  `onInspectionLog`, `onIssueUpdate`, `issueReminderScheduler` 세
  함수 전부에 대해 체크합니다.
- **Cloud Run 서비스 헬스체크** — `healthUrl`을 설정한 서비스만 동작
  (지금은 둘 다 전용 헬스 엔드포인트가 없어서 비활성 상태. 나중에
  `/healthz` 같은 게 생기면 `config/services.js`에 URL만 추가하면 켜짐)

API로 자동 확인하기 어려워서(코드 정적분석 또는 Firestore 데이터 조회가
더 필요) 아직 안 넣은 것들:
- `schedule_groups`에 전체 센터가 빠짐없이 등록됐는지
- `facility_id` vs `facilityId` 필드명 불일치

## 7. 실제로 배포하면서 발견한 문제들 (2026-07-05 기준)

배포 과정에서 나온 실제 결과입니다. 나중에 다시 볼 때를 위해 그대로
남겨둡니다.

### 🔴 발견 당시 심각 — Firestore 복합 인덱스 누락 (해결됨)
`issueReminderScheduler`가 매일 09:00마다 아래 에러로 조용히 실패하고
있었습니다.
```
Error: 9 FAILED_PRECONDITION: The query requires an index.
```
에러 메시지에 포함된 링크로 콘솔에서 인덱스를 생성해서 해결했습니다.
(`status` + `last_notified_at` 복합 인덱스)

### 🟡 예상보다 범위가 넓었던 것 — 3개 함수 전부 1st Gen
README에는 `issueReminderScheduler`만 1st Gen이라고 되어 있었는데,
실제로 점검해보니 **`onInspectionLog`, `onIssueUpdate`까지 m-event의
Functions 3개가 전부 1st Gen**이었습니다. Node 22 환경에서 계속 쓸
경우 호환성 위험이 이슈 트래커 전체에 걸쳐 있다는 뜻입니다. 아직
재배포는 안 한 상태 — 다음 작업 후보.

### 🟡 Cloud Tasks 큐는 존재하지만 미사용 중
`m-engine-schedule-queue`가 실제로 존재하긴 하지만(대기 작업 0건),
m-engine이 지금 "병렬 처리용 환경변수 4개"가 설정 안 되어 있어서
**큐를 아예 안 쓰고 순차 처리(sequential_fallback) 모드로 돌고
있습니다.** 센터 수가 적을 땐 문제없지만, 늘어나면 타임아웃 위험이
커질 수 있습니다.

### 🟠 미해결 — Firebase Hosting 트래픽 지표 조회 불가
`getHostingStats()`가 아래 에러로 계속 실패합니다.
```
INVALID_ARGUMENT: The supplied filter does not specify a valid
combination of metric and monitored resource descriptors.
```
`firebasehosting.googleapis.com/network/request_count` 같은 지표
이름 자체가 이 프로젝트에서 Cloud Monitoring에 노출 안 되고 있는
것으로 추정됩니다 (Firebase Hosting은 Cloud Run/Functions와 달리
Cloud Monitoring 연동이 기본으로 안 될 수 있음). Metrics Explorer에서
"hosting" 검색해도 안 나오면, 이 방식으론 Hosting 트래픽을 못 가져오는
것이 맞고, Firebase 콘솔의 Hosting 사용량 탭을 직접 보는 수밖에
없습니다. **아직 확실한 결론은 못 내린 상태 — 확인 필요.**

### ⚪ 개발 환경에서 겪은 삽질 (다음에 또 안 겪기 위한 기록)
- **Node 24는 호환 안 됨** — `firebase-functions/v2/*` 관련
  `ERR_PACKAGE_PATH_NOT_EXPORTED` 에러가 남. **Node 22**로 다운그레이드
  해야 함.
- **Cloud Scheduler와 Cloud Tasks는 `us-central1`** — Cloud Run/Functions는
  전부 `asia-northeast3`인데, Scheduler·Tasks만 `us-central1`인 이유는
  **프로젝트의 App Engine 위치가 애초에 `us-central1`로 설정**되어 있어서.
  Cloud Scheduler/Tasks는 리전을 자유롭게 못 고르고 이 App Engine
  위치를 따라감. `config/services.js`에 `SCHEDULER_REGION`을 별도로
  분리해둔 이유가 이것.
- **Cloud Monitoring 필터 문법** — `resource.label.xxx`가 아니라
  `resource.labels.xxx`(복수형), `metric.label.xxx`가 아니라
  `metric.labels.xxx`. 단수형으로 쓰면 필터가 무효 처리되면서
  `INVALID_ARGUMENT` 에러가 남 (지표가 없는 게 아니라 문법 오류였음).
- **`firebase init`을 `functions` 폴더 안에서 실행하면** `functions/functions/`
  처럼 폴더가 중첩됨. 실제 배포 대상은 `firebase.json`의 `source` 값이
  가리키는 안쪽 폴더 — 바깥쪽에 코드를 두고 헷갈리지 않도록 주의.
- **함수 리전을 코드에서 지정 안 하면 기본값(`us-central1`)으로 배포됨**
  — `collectMetrics`/`getDashboardData`가 지금 `us-central1`에 있는
  이유. 나머지 서비스(`asia-northeast3`)와 안 맞아서 대시보드 URL
  헷갈리기 쉬움. 나중에 `setGlobalOptions({ region: 'asia-northeast3' })`
  추가해서 재배포하면 통일 가능 (급하진 않음).

## 8. 알아두면 좋은 GCP 특이사항 요약

프로젝트의 **App Engine 위치**가 한 번 정해지면 바꿀 수 없고, Cloud
Scheduler와 Cloud Tasks는 리전 선택권 없이 이 위치를 그대로 씁니다.
이 프로젝트는 App Engine 위치가 `us-central1`이라서, Cloud Run/Functions
(자유롭게 리전 선택 가능해서 `asia-northeast3`로 되어 있음)와 Scheduler/
Tasks(무조건 `us-central1`)의 리전이 서로 다른 상태로 굳어져 있습니다.
버그가 아니라 GCP 구조상 원래 이렇습니다.

## 9. 앞으로 개선하면 좋을 것들

- **이력 데이터 쌓기**: 지금은 매번 덮어쓰기라 추이를 못 봄.
  `_monitor/history/{timestamp}` 서브컬렉션에 매 실행마다 스냅샷을
  추가하고, 오래된 건 주기적으로 정리(TTL)하면 실제 14일 추이 그래프도
  가능해짐.
- **Hosting 트래픽 대체 수단 확보**: Cloud Monitoring이 안 되면, Firebase
  Hosting REST API의 사용량 관련 엔드포인트가 있는지 별도 조사 필요.
- **다중 사용자 인증 업그레이드**: 여러 명이 쓰게 되면 API 키 방식에서
  IAP나 관리자 전용 로그인으로 전환.
- **m-event 3개 함수 2nd Gen 마이그레이션**: Node 22 지원 종료 시점
  전에 처리 필요.
- **m-engine 병렬 처리 활성화 여부 결정**: 환경변수 4개 설정해서 큐
  기반 병렬 처리로 전환할지, 지금처럼 순차 처리로 유지할지 판단 필요
  (센터 수 증가 추이 보면서 결정).

## 10. 설치/재배포 방법

처음 설치는 `SETUP_GUIDE.md`를 위에서부터 그대로 따라가면 됩니다.
코드를 수정한 뒤 재배포할 때는:

```bash
firebase deploy --only functions:collectMetrics,functions:getDashboardData
```

`public/` 폴더 안 파일(`index.html`, `dashboard-auth.js`)은 브라우저에서만
도는 정적 파일이라 배포 없이 저장 + 새로고침만으로 반영됩니다.

## 11. GitHub Actions 자동 배포 (CI/CD)

`main` 브랜치의 `functions/**` 경로가 바뀐 채로 push되면
`.github/workflows/deploy.yml`이 자동으로 `firebase deploy`를 실행합니다.

### 필요한 시크릿
- `FIREBASE_SERVICE_ACCOUNT` — 배포용 서비스 계정(`github-action-...`)의
  JSON 키 전체 내용. GitHub 리포 Settings → Secrets and variables →
  Actions에 등록.

### ⚠️ 배포용 서비스 계정에 추가로 필요했던 권한 4가지

로컬 CLI로 배포할 때는 내 계정 권한으로 되지만, GitHub Actions는 별도
서비스 계정(`github-action-1252276223@m-smart-90148.iam.gserviceaccount.com`)을
쓰기 때문에, 처음 CI/CD를 연결했을 때 아래 권한들이 하나씩 없어서 배포가
막혔습니다. 나중에 새 배포용 계정을 또 만들게 되면 이 4개를 한 번에
부여하면 됩니다.

```bash
SA="github-action-1252276223@m-smart-90148.iam.gserviceaccount.com"

# 1) 함수 런타임 계정을 대신 사용할 권한
gcloud projects add-iam-policy-binding m-smart-90148 \
  --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountUser"

# 2) API 키 시크릿 값 읽기
gcloud secrets add-iam-policy-binding MONITOR_API_KEY \
  --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor"

# 3) API 키 시크릿 메타데이터 조회 (2번만으론 부족해서 추가로 필요했음)
gcloud secrets add-iam-policy-binding MONITOR_API_KEY \
  --member="serviceAccount:${SA}" --role="roles/secretmanager.viewer"

# 4) 스케줄 함수(collectMetrics) 배포 시 Cloud Scheduler 잡도 같이 갱신하는데 필요
gcloud projects add-iam-policy-binding m-smart-90148 \
  --member="serviceAccount:${SA}" --role="roles/cloudscheduler.admin"
```

권한 하나가 빠지면 배포 로그에 정확히 어떤 리소스(secret, scheduler job
등)에 대한 권한이 없는지 403 에러로 친절하게 나오니, 에러 메시지에 적힌
리소스 이름을 보고 그에 맞는 역할을 추가하면 됩니다.

### Cloud Run 콘솔에 서비스가 4개 뜨는 이유
`collectMetrics`, `getDashboardData`는 2nd Gen Cloud Functions인데, 2nd
Gen은 내부적으로 Cloud Run 위에서 실행되는 구조라 Cloud Run 콘솔에도
같이 나타납니다. `facility-dashboard`, `m-engine`과 합쳐서 총 4개가
보이는 게 정상이며, 중복 배포된 게 아닙니다.
