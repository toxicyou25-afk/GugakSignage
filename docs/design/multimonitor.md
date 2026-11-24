# 장소·다중 모니터·배치 통합

작성 2026-11-24 / hotfix 기준 `origin/main` `3556b02822ff10b94ecc468f6432216abf2156aa`

## 1. 목적과 경계

외부에서 제작한 이미지·영상·URL을 장소, 화면 그룹, 모니터에 정확히 배정하고 서버 시각 기준으로 순환 송출한다. 이미지 제작·편집, 동영상 편집, AI 생성 기능은 넣지 않는다.

기존 MVP의 기기, 재생목록, 시간표, IndexedDB 캐시, 게시 테이블과 API는 유지한다. 새 흐름은 그 옆에 장소·모니터 토폴로지를 추가하고, 게시 시 기존 `publications`에 불변 확장 스냅샷을 저장한다.

용어는 다음과 같다.

- **기기(device)**: 등록 코드와 재생기 토큰을 가진 PC/브라우저 한 대
- **화면(display)**: 기기에 연결된 모니터 한 대와 해상도·회전·슬롯·화면별 재생목록
- **화면 그룹(display group)**: 같은 장소에서 시각과 재생 모드를 공유하는 모니터 묶음
- **배치(layout)**: 모니터 개수에 맞춰 정규화된 슬롯을 가진 가로·세로·격자·사용자 지정 레이아웃

## 2. 데이터 모델

```text
sites
  └─ display_groups ── layouts
       └─ displays ── devices
            └─ playlist / contents
```

| 테이블 | 역할 | 주요 관계·불변 조건 |
|---|---|---|
| `sites` | 물리 장소와 시간대 | 장소 삭제 시 그룹·모니터를 함께 정리 |
| `display_groups` | 동기화 단위, 재생 방식, epoch, dwell | `layout_id`, 기본 `playlist_id` |
| `layouts` | 정규화 슬롯과 캔버스 크기 | `slots_json`은 `poc/packages/engine` 형식 |
| `displays` | 모니터 해상도·방향·회전·슬롯·PC·화면별 재생목록 | `device_id`로 PC와 다대일 연결 |
| `devices.site_id` | 기존 PC 기기를 장소에 연결 | 기존 기기 행과 토큰·시간표는 변경하지 않음 |
| `publications.snapshot` | 게시 시점의 기존 재생 계약 + `wall` 확장 | 게시 후 DB 설정이 바뀌어도 기존 JSON은 바뀌지 않음 |

재생목록 항목의 `fit_mode_override`가 비어 있으면 화면별 `fit_mode`를 사용한다. 과거 DB 행은 기존에 선택한 값을 명시 설정으로 backfill해 동작을 보존한다.

한 모니터 수를 코드에 고정하지 않는다. API는 정수 모니터 수를 받아 엔진이 슬롯을 생성하며, 테스트는 1·2·4·8대와 0·1·3·10장 조합을 확인한다. 운영 안전 범위는 요청당 1~256개 모니터다.

## 3. 관리 API

| 메서드·경로 | 역할 |
|---|---|
| `GET /api/sites` | 장소별 그룹·모니터·연결 PC 수 |
| `POST /api/sites` | 장소와 기본 그룹·단일 모니터 생성 |
| `GET /api/sites/:id` | 그룹, 배치, 모니터, PC 선택지 조회 |
| `PUT /api/sites/:id` | 장소 이름·시간대·메모 변경 |
| `POST /api/sites/:id/groups` | 같은 장소의 추가 화면 그룹 |
| `PUT /api/groups/:id` | 그룹 기본 재생목록·재생 모드·dwell·epoch 변경 |
| `PUT /api/groups/:id/configuration` | 모니터 수·해상도·방향·회전·배치 일괄 저장. PC 선택은 새 화면·미연결 화면의 기본값이며 기존 연결은 보존 |
| `PUT /api/displays/:id` | 선택한 화면의 PC·재생목록·회전·맞춤·해상도 저장 |
| `GET /api/groups/:id/preview` | 현재 초안으로 서버가 계산한 화면별 RenderPlan |
| `POST /api/groups/:id/publish` | 연결된 PC별 새 불변 게시 버전 생성 |
| `GET /api/time` | 재생기의 서버 시각 오프셋 측정 |
| `GET /api/player/manifest` | 레거시 필드와 선택적 `wall` 스냅샷을 함께 반환 |

관리 API는 기존 관리자 세션 인증을 사용한다. 화면 게시는 배정된 PC가 없으면 400으로 중단한다.

화면별 PC 선택지는 해당 장소에서 이 그룹에 이미 연결됐거나 아직 어떤 화면에도 연결되지 않은 기기다. PC를 화면에 명시적으로 배정하면 그 기기는 다른 그룹의 화면에서만 해제되고, 같은 그룹의 여러 모니터에는 함께 연결할 수 있다. 그룹 저장 SQL은 기존 `displays.device_id`를 덮어쓰지 않으며 `NULL`인 화면에만 기본 PC를 채운다.

## 4. RenderPlan과 미리보기

서버는 `poc/packages/engine/src/layout.js`의 `buildLayout`, `render-plan.js`의 `buildRenderPlan`을 호출한다. 별도 배치·자르기 엔진은 만들지 않는다. 게시 wall에서 RenderPlan 입력을 만드는 변환은 `poc/packages/engine/src/wall-input.js`의 `wallScreenInput` 하나를 서버와 브라우저가 함께 사용한다.

- `contain`: 원본 전체를 유지하고 남는 영역은 레터박스
- `cover`: 표시 영역 비율에 맞춰 중앙 크롭
- `stretch`: 명시적으로 선택한 경우에만 전체 채우기
- `sourceRect`, `destinationRect`, `rotation`, `fit`, `nextChangeAtMs`를 미리보기·게시·재생이 같은 값으로 사용
- `playlist.items`의 `contentId`·`kind`·`contentUrl`과 `contents` 입력으로 이미지·동영상·URL 종류를 보존
- URL은 원본 픽셀이 없으므로 이미지 크기 필터에서 제외하고, `kind: "url"`, `requiresNetwork: true`, 전체 화면 `destinationRect`를 가진 RenderPlan으로 만든다

미리보기 응답은 현재 DB 초안에서 서버 시각으로 계산한 화면별 계획이다. 재생기는 게시된 `wall` 스냅샷과 서버 시간 보정값으로 같은 `buildRenderPlan`을 호출하고, 이미지·동영상은 `sourceRect`를 CSS 클립과 원본 픽셀 배율로 그린다. URL은 각 화면 슬롯 안의 별도 `iframe`에 표시한다. 캔버스 모드에서는 각 모니터가 공유 이미지의 자기 슬롯 크롭을 표시한다.

## 5. 동기화와 재생기 구성

- 게시 시 그룹 `epoch`, `dwell_ms`, `playback_mode`를 고정한다.
- 재생기는 `/api/time`을 5회 측정해 가장 짧은 왕복 절반의 평균 오프셋을 쓰고 30초마다 다시 맞춘다.
- 서버 단절 시 마지막 오프셋과 게시 epoch로 계속 계산하며 화면 간 공통 전환 시점을 유지한다.
- manifest 캐시에는 마지막 서버 오프셋과 캐시 시각을 함께 보존한다. 오프라인 재로드 때 낡은 `serverTime`을 현재 시각과 다시 빼지 않고 같은 offset으로 경과 시간을 계산한다.
- 한 PC가 여러 모니터를 구동할 때 기본 `/player/?code=...`는 모든 모니터를 한 캔버스에 배치한다.
- 모니터마다 브라우저 창을 쓰면 `/player/?code=...&display=<id>`로 한 화면만 연다.
- 모니터마다 PC가 다르면 각 PC가 같은 기기 그룹 스냅샷을 받되, `deviceId`가 일치하는 자기 모니터만 표시한다.
- 화면별 서로 다른 재생목록은 `synchronized-cycle` 또는 `individual`에서 사용한다. `mirror`·`canvas`는 같은 콘텐츠를 공유해야 하므로 그룹 기본 재생목록을 사용한다.
- URL 항목도 이미지·동영상과 같은 재생목록 위치, 표시 시간, 전환 시간, epoch를 쓴다. URL 단독 화면은 표시 시간 동안 고정되며, 혼합 화면은 다음 항목 경계에서 다른 미디어로 전환한다.
- `mirror`·`canvas`의 URL도 모니터별 슬롯 안에서 각각 전체 `iframe`으로 표시하며, 하나의 웹 문서를 픽셀 단위로 이어 붙이는 보장은 하지 않는다.
- 오프라인에서 현재 URL 항목은 콘텐츠 이름과 복구 안내가 있는 대체 카드로 표시한다. URL을 목록에서 조용히 제거하지 않으며, 연결이 돌아오면 다음 `renderWallFrame` 호출에서 `iframe`으로 복구한다.
- HTTPS/localhost 재생기 셸은 `gugak-signage-shell-v4`로 버전을 올리고 HTML·JS·CSS를 network-first로 제공한다. `registration.update()`로 새 워커가 설치·활성화되면 이전 셸 캐시가 있던 클라이언트를 한 번 갱신해 새 player와 engine 자산을 적용한다.

## 6. 불변 게시

`publishGroupSnapshot`은 한 번 만든 `wall` 객체를 그룹 내 연결 PC별 `publications`에 기록한다. `wall`에는 다음이 포함된다.

- 장소·그룹의 이름, 시간대, 재생 방식, epoch, dwell
- 배치 종류, 캔버스, 모든 정규화 슬롯
- 모니터 ID·PC ID·해상도·방향·회전·맞춤·슬롯·순서
- 화면별 재생목록의 이름·항목·콘텐츠 URL·원본 픽셀 크기

게시 후 모니터를 4대에서 2대로 바꿔도 기존 `snapshot` 문자열과 재생기 버전은 바뀌지 않는다. 다음 게시 때만 새 버전이 만들어진다. 현재 게시 스냅샷이 참조하는 미디어 삭제도 기존 기능과 같이 차단한다.

## 7. 기존 SQLite 마이그레이션

앱 시작 시 `migrateLegacyTopology`가 `meta.topology_schema_version`을 확인한다. 버전 표식이 없는 기존 DB는 한 트랜잭션에서 다음을 수행한다.

1. 장소가 없으면 `기본 장소`를 만든다.
2. 기본 화면 그룹과 엔진 기반 배치를 만든다.
3. 기존 `devices`마다 PC 포인터가 있는 모니터 1대를 만들고 기기의 해상도·방향·재생목록을 복사한다.
   기기 순서는 `created_at`과 SQLite `rowid`를 함께 써서 같은 입력의 삽입 순서를 안정적으로 보존한다.
4. `devices.site_id`만 연결하고 기기·재생목록·시간표·게시 JSON은 변경하지 않는다.
5. 마이그레이션 버전을 기록해 재실행 시 중복 생성하지 않는다.

`playlist_items.fit_mode_override` 컬럼 추가와 기존 행의 값 backfill은 하나의 SQLite 트랜잭션에서 수행한다.

자동 테스트는 레거시 테이블과 기기·게시 행을 먼저 만든 뒤 앱 DB를 두 번 열어 장소 1·모니터 1·기존 게시 JSON 보존을 확인한다.

## 8. 검증

```powershell
npm ci
npm run typecheck
npm run build
npm test
npm test --prefix poc
npm run verify:multimonitor
```

- 모니터 1·2·4·8대 × 이미지 0·1·3·10장 × 네 재생 모드
- 마지막 모니터를 세로 1080×1920/90°로 구성하고 모든 계획의 슬롯·원본·목적 사각형 검사
- 단일·가로·세로·격자 슬롯 범위 검사
- 게시 전 미리보기와 동일 wall 입력의 RenderPlan 깊은 비교
- 4모니터 API 저장 → 4번 화면 다른 재생목록 → 미리보기 → 게시 → 재생기 manifest
- 4화면을 두 PC로 나누고 각 manifest가 자기 화면 배정만 받는지 확인
- 화면별 PC 선택 UI에서 4번 화면만 다른 PC로 명시 재배정하고, 그룹 설정을 다시 저장해도 `[A,A,A,B]` 매핑이 유지되는지 확인
- 4→2모니터 변경 뒤 기존 게시 JSON과 버전 불변 확인
- 5기기 레거시 DB 20회 마이그레이션에서 장치→슬롯 매핑 동일성, 새 기기 추가 후 기존 slot/start index 보존
- 항목 fit 미지정 + 화면 fit `cover` → RenderPlan `cover`, 항목 fit `contain` → RenderPlan `contain`
- 샘플 이미지 3·동영상 1·URL 1이 공유 wall 입력에 모두 남고 URL이 40초 경계에서 `kind: "url"` RenderPlan이 되는지 확인
- Edge 실제 브라우저: 관리자 로그인, 장소, 4화면, 2×2, 1280×720, 화면별 PC·재생목록, URL 단독 `iframe`, 게시, 한 PC 4화면, 3초 전환, 오프라인 URL 대체 화면, 오프라인 재로드 offset, 한 화면 분리 창
- 같은 persistent Edge profile에서 기준 `3556b02`의 v3 셸을 먼저 캐시하고, 같은 origin에 HEAD를 배포한 뒤 `registration.update()`가 v4 캐시·새 player.js·URL 지원 engine을 적용하는지 확인

브라우저 스크린샷과 콘솔 로그는 `docs/verification/evidence/multimonitor-*.png`, `docs/verification/multimonitor-run.json`에 있다.

## 9. 미검증

- 물리 모니터 1·2·4·8대 동시 출력: `NOT_RUN`
- 실제 GPU·OS 디스플레이 배치·EDID·베젤 보정: `NOT_RUN`
- 여러 물리 PC와 실제 LAN 스위치에서 장시간 시계 오차·재연결: `NOT_RUN`
- 외부 사이트의 `X-Frame-Options`·CSP가 iframe 삽입을 거부하는 경우와 외부 인터넷 단절만 있고 LAN 서버는 연결된 혼합 상태: `NOT-VERIFIED`
- 4K/8K 장시간 재생과 브라우저 메모리 상한: `NOT_RUN`
- 프로젝터·TV의 overscan·색 프로파일 자동 보정: 범위 밖

## 10. 리뷰 회귀 보강

- fit 우선순위: `playlist_items.fit_mode_override`는 미지정을 NULL로 보존한다. 게시 변환은 명시값만 `fitMode`로 내보내므로 item → display → group → contain 순서의 엔진 선택이 실제로 동작한다. 기존 행은 최초 마이그레이션에서 `fit_mode` 값으로 backfill한다.
- 슬롯 결정성: 레거시 기기는 생성 시각과 SQLite 삽입 순서(`rowid`)로 정렬하고 `start_index`를 고정한다. 새 기기 등록은 기존 `slot_id`를 유지하고 비어 있는 슬롯만 배정한다.
- 오프라인 시각: manifest, 캐시 시각, 마지막 서버 offset을 함께 저장한다. 재로드 후 `Date.now() + offset`으로 경과 시간을 계산하며 낡은 manifest `serverTime`을 현재 시각과 다시 빼지 않는다.
- 공유 변환: `poc/packages/engine/src/wall-input.js`의 `wallScreenInput`을 서버 미리보기와 브라우저 재생기가 공통 사용한다.
- CI: `.github/workflows/ci.yml`의 Windows 검증 단계에 `npm run verify:multimonitor`를 추가했다.
