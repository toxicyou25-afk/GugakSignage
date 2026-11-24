<!-- SPDX-License-Identifier: Apache-2.0 -->
# 1차 MVP 실행 구조 — 관리 서버와 윈도우 재생기

작성 2026-11-24 / owner 확정 범위: 윈도우 PC 재생기 + 관리 서버

## 1. 범위

이 문서는 실제 운영 흐름을 확인하기 위한 1차 동작본의 구현 경계를 정리한다.

포함:

- 한글 관리 화면(1단계 로그인)
- 이미지·동영상 업로드 보관함과 URL 콘텐츠
- 기기 수동 생성, 6자리 등록 코드 페어링, 이름·위치·방향·해상도, 접속 상태
- 기기별 기본 재생목록과 요일·시간대 시간표
- 게시 버전과 불변 스냅샷, 재생기 manifest 조회·하트비트
- 이미지·동영상·URL 전체화면 순환 재생
- IndexedDB 파일 캐시와 localStorage manifest 캐시를 이용한 서버 단절 재생
- `start-player.cmd`의 Edge/Chrome 키오스크 실행
- SQLite 단일 파일, Docker Compose, 샘플 시드, API·브라우저 검증

제외:

- 다중 관리자·권한 분리·감사 로그
- 사이트/그룹/다중 모니터 배치·베젤·가상 미리보기·모니터 간 동기화
- 승인 워크플로, 복잡한 반복 일정, 통계·증명 재생
- 네이티브 재생기, 원격 셸, 자동 업데이트

## 2. 실행 구성

```text
[관리자 브라우저]
      │  로그인 쿠키, 업로드, 기기·재생목록·게시 API
      ▼
[Node.js + TypeScript 관리 서버] ── SQLite(WAL) ── data/signage.sqlite
      │                                  └─ uploads/ 미디어 파일
      │  register / manifest / heartbeat
      ▼
[윈도우 PC 웹 재생기 · Edge/Chrome 키오스크]
      ├─ localStorage: 기기 토큰, 마지막 manifest
      └─ IndexedDB: 이미지·동영상 Blob 캐시
```

- 관리 화면: `public/admin/`의 정적 HTML/CSS/JS. 빌드 없이 서버가 제공한다.
- 재생기: `public/player/`의 정적 HTML/CSS/JS. 서버가 같은 출처로 제공한다.
- 재생기 연결 화면: `/admin/#/devices` 링크, 코드가 없을 때의 관리 화면 안내, 시드 모드에서 `GUGAK1` 힌트와 원클릭 연결 버튼을 제공한다. `GET /api/player/config`가 샘플 모드와 코드를 알려 준다.
- 윈도우 실행: `start-player.cmd`는 Edge에서는 전체화면 앱 모드(`--app`/`--start-fullscreen`), Chrome에서는 `--kiosk`를 사용한다. Edge `--kiosk`는 InPrivate 세션으로 열려 localStorage/IndexedDB가 종료 시 사라지므로 캐시 유지를 위해 앱 모드를 선택했다.
- 서버: `src/`의 Express 4 + TypeScript. Node 24 내장 `node:sqlite`를 쓴다.
- 파일: 업로드는 `UPLOAD_DIR`, DB는 `DB_PATH`에 둔다. Docker에서는 `/data` 볼륨 하나에 함께 보관한다.
- 로그인: 단일 관리자 비밀번호(`ADMIN_PASSWORD`)와 HMAC 서명 세션 쿠키. 기본 12시간.

## 3. 데이터 모델

| 테이블 | 책임 |
|---|---|
| `contents` | 파일 콘텐츠(이미지·동영상), URL 콘텐츠. 형식·크기·해상도 메타데이터 |
| `playlists` | 이름·설명, 수정 시각 |
| `playlist_items` | 순서, 표시 시간(초), 맞춤(`contain`/`cover`/`stretch`), 전환(ms), 사용 여부 |
| `devices` | 이름·위치·방향·해상도, 등록 코드, 하드웨어 ID·재생기 토큰, 기본 재생목록, 게시 버전, 마지막 접속·오류 |
| `schedules` | 기기별 요일 집합, 시작·종료 시각, 재생목록 |
| `publications` | 기기별 게시 버전과 불변 JSON 스냅샷 |
| `meta` | 샘플 시드 여부 등 서버 메타데이터 |

`playlist_items.content_id`는 사용 중 콘텐츠 삭제를 막고, `schedules.playlist_id`는 사용 중 재생목록 삭제를 막는다. `publications`는 기기 삭제 시 함께 삭제된다. `devices.playlist_id`는 재생목록 삭제 시 `NULL`이 되지만, 재생목록 삭제 API가 기기·시간표 사용 여부를 먼저 검사한다.

파일 콘텐츠는 최신 게시 스냅샷이 참조하는 동안에도 삭제할 수 없으며, 재생목록에서 빼고 다시 게시해야 파일이 지워진다.

### 게시 스냅샷

게시할 때 기본 재생목록과 시간표별 재생목록의 항목·콘텐츠 주소를 JSON으로 복사해 `publications.snapshot`에 저장한다. 이후 재생목록을 편집해도 이미 게시된 버전은 바뀌지 않는다. 새로 게시해야 재생기에 반영된다.

재생기는 `GET /api/player/manifest`에서 가장 높은 게시 버전을 받는다. 현재 재생 중인 항목이 끝나는 경계에서 새 버전으로 바꾼다. 현재 재생 중인 URL 항목이 있으면 해당 표시 시간이 끝난 뒤 전환한다.

## 4. API

관리자 API는 모두 서명 세션 쿠키가 필요하다. 재생기 API는 기기 등록 시 발급한 Bearer 토큰을 사용한다.

| 구분 | 메서드·경로 | 설명 |
|---|---|---|
| 인증 | `POST /api/auth/login` | 비밀번호 확인, HttpOnly 쿠키 발급 |
| 인증 | `GET /api/auth/me` | 로그인 상태 |
| 콘텐츠 | `GET /api/contents` | 보관함(종류 필터) |
| 콘텐츠 | `POST /api/contents` | multipart `files` 업로드(최대 20개) |
| 콘텐츠 | `POST /api/contents/url` | URL 콘텐츠 추가 |
| 콘텐츠 | `PATCH/DELETE /api/contents/:id` | 이름 변경·삭제 |
| 재생목록 | `GET/POST /api/playlists` | 목록·생성 |
| 재생목록 | `GET/PUT/DELETE /api/playlists/:id` | 상세·항목 전체 저장·삭제 |
| 기기 | `GET/POST /api/devices` | 목록·수동 생성(등록 코드 발급) |
| 기기 | `GET/PATCH/DELETE /api/devices/:id` | 상세·이름/해상도/방향·삭제 |
| 기기 | `PUT /api/devices/:id/assignment` | 기본 재생목록과 시간표 저장 |
| 기기 | `POST /api/devices/:id/publish` | 새 게시 버전 생성 |
| 기기 | `POST /api/devices/:id/regenerate-code` | 연결 해제 + 새 등록 코드 |
| 기기 | `POST /api/devices/:id/unpair` | 기존 등록 코드 유지 + 연결 해제 |
| 재생기 | `GET /api/player/config` | 관리 화면 링크, 샘플 모드·코드, 개발 모드 비밀번호 여부 |
| 재생기 | `POST /api/player/register` | 코드 + hardwareId로 등록, 토큰 발급. `takeover: true`면 기존 연결 인수 |
| 재생기 | `GET /api/player/manifest` | 게시 스냅샷·현재 서버 시각 |
| 재생기 | `POST /api/player/heartbeat` | 15초 상태 갱신, 현재 콘텐츠·오류 |
| 공통 | `GET /api/health` | 상태 확인 |

### 등록과 접속 상태

1. 관리자가 기기를 만들면 6자리 코드와 무작위 재생기 토큰 자리의 기기 행이 생긴다.
2. 재생기는 `hardwareId`(브라우저 UUID)를 localStorage에 만들고 코드와 함께 등록한다.
3. 이미 다른 hardwareId가 연결된 기기는 `409`로 거절한다. 관리자가 연결을 해제한 뒤 다시 시도해야 한다.
4. 마지막 하트비트가 45초 이내면 관리 화면은 `온라인`, 그 외 `오프라인`, 하드웨어 ID가 없으면 `연결 대기`로 표시한다.
5. 상태는 별도 폴링 없이 관리 화면에서 새로고침할 때 계산한다.

### 시간표

- 요일은 0(일)~6(토), 시각은 재생기 PC의 로컬 시각 `HH:MM`이다.
- 시작이 종료보다 늦으면 자정을 넘는 구간으로 처리한다. 이때 다음 날 새벽 구간은 시작 요일 기준으로 판정한다.
- 겹치는 시간표는 시작 시각이 빠른 항목이 우선한다. 현재 MVP UI는 겹침 경고를 별도로 표시하지 않는다.
- 해당 시간표가 없으면 기본 재생목록을 쓴다. 기본도 비어 있으면 재생기는 “게시 대기” 또는 “콘텐츠 없음” 상태를 보여준다.
- 기본 목록 없이 시간표만 있으면 예약 전에는 `예약 시간을 기다리는 중`을 표시하고, 15초 폴링에서 manifest 버전이 같아도 유휴 상태이면 다시 적용해 예약 시작 시 자동 재생한다.

## 5. 재생기 캐시와 오프라인

1. 성공한 manifest 응답을 `localStorage`에 저장한다.
2. manifest에 포함된 이미지·동영상(기본 목록 + 시간표 목록)을 `fetch`해 IndexedDB `gugak-signage-media`의 `media` 스토어에 Blob으로 저장한다.
3. 재생 시 IndexedDB Blob을 `URL.createObjectURL`로 재생한다. 캐시가 없으면 서버 URL로 대체한다.
4. 15초마다 manifest와 하트비트를 보낸다. 실패하면 오프라인 배지가 나오고 마지막 manifest·Blob으로 계속 순환한다.
5. URL 콘텐츠는 네트워크가 필요하다. 오프라인에서는 콘텐츠 이름·안내 문구가 있는 카드로 표시하고 표시 시간 뒤 다음 항목으로 넘어간다(브라우저 오류 페이지를 노출하지 않음).
6. 서버가 돌아오면 다음 성공 응답에서 오프라인 배지가 사라지고 새 게시 버전을 적용한다.
7. 같은 `?code=` 주소로 재실행할 때 저장된 기기 토큰이 있으면 재등록을 강제하지 않고 캐시된 목록으로 먼저 시작한다. 서버가 없으면 오프라인 재생을 유지하고, 서버가 돌아오면 manifest 폴링으로 복구한다.
8. 새 게시본이 현재·대기 재생에 쓰지 않는 미디어를 제거하면 IndexedDB 키와 object URL도 함께 정리한다.

연결 화면의 샘플 힌트는 관리 DB에 `dev-sample-lobby`가 있을 때만 노출한다. 샘플 기기를 삭제한 운영 환경에서는 코드 입력과 관리 화면 링크만 보인다. 잘못된 코드 응답에는 6자리 코드의 위치와, 샘플 기기가 있으면 그 코드를 함께 안내한다. 이미 다른 재생기가 연결된 기기라면 409 응답 뒤 **기존 연결 끊고 다시 연결** 버튼을 보여 주며, 같은 6자리 코드로 서버의 기존 hardwareId·토큰을 교체한다. 이때 이전 토큰은 즉시 무효화된다.

`public/player/sw.js`는 secure context(localhost/HTTPS)에서 재생기 셸을 캐시하는 보조 수단이다. LAN IP의 HTTP에서는 서비스 워커를 쓸 수 없지만, 이미 열린 탭과 IndexedDB 캐시는 동작한다. 재부팅 직후 오프라인 시작을 보장하려면 HTTPS나 별도 로컬 셸이 필요하다.

## 6. PoC 엔진·RenderPlan과의 비교

`poc/packages/engine`은 이미지·동영상·URL 항목을 받는 순수 엔진이며, `Site → DisplayGroup → Display/Layout → Playlist` 스냅샷을 입력으로 `buildRenderPlan(snapshot, displayId, atMs)`를 만든다. 반환값에는 콘텐츠 종류, `sourceRect`, `destinationRect`, `rotation`, `fit`, `nextChangeAt`, `warnings`가 있어 다중 모니터·통합 캔버스·동기화 송출에 적합하다.

이번 MVP는 이미지·동영상·URL을 섞은 순차 재생, 요일·시간표, 오프라인 미디어 캐시를 유지하면서 다중 모니터 wall 입력을 같은 엔진으로 계산한다. URL은 `kind: "url"`과 `contentUrl`을 보존하고 화면별 `iframe`으로 그린다. 네트워크가 없으면 이름과 복구 안내가 있는 대체 카드를 표시한다.

대신 다음 계약을 맞췄다.

- 맞춤 용어를 `contain`/`cover`/`stretch`로 통일했다. CSS 렌더링에서만 `stretch`를 `object-fit: fill`로 매핑한다.
- 표시 시간은 초 단위 API·DB, 화면 전환은 ms 단위(`transitionMs`)로 유지한다.
- 게시 스냅샷·버전·epoch에 준하는 재생 경계 개념을 사용한다.
- 재생기는 manifest를 받아 현재 항목과 다음 전환 시점을 계산하며, 다중 모니터 wall은 서버 미리보기와 같은 `buildRenderPlan` 호출을 사용한다.

다중 모니터 단계에서는 MVP의 기기별 manifest를 `Site/DisplayGroup/Layout/Display/Playlist` 스냅샷으로 확장하고, `buildRenderPlan`의 `sourceRect`·`destinationRect`를 캔버스 또는 CSS로 그리고 URL 계획은 슬롯 안의 `iframe`으로 그린다. 관리 서버의 콘텐츠·기기·게시 테이블은 유지한다.

## 7. SQLite → PostgreSQL 전환

MVP는 외부 DB 설치 없이 실행되도록 SQLite 단일 파일을 쓴다. 전환 지점은 의도적으로 `src/db.ts`와 라우트의 SQL 호출에 모아 두었다.

1. **연결·트랜잭션**: `DatabaseSync`를 `pg.Pool`로 바꾸고 `all/get/run/transaction` 헬퍼를 async로 만든다. 모든 라우트의 호출에 `await`를 붙인다. 현재 `transaction()`은 `BEGIN IMMEDIATE`로 동기 콜백을 감싸므로 `pool.connect()`와 `try/finally`로 바꾼다.
2. **타입**: `TEXT id`는 `uuid`, `INTEGER` 0/1 `enabled`는 `boolean`, ISO 문자열 시각은 `timestamptz`, `publications.snapshot`은 `jsonb`로 매핑한다.
3. **제약**: 외래 키, `UNIQUE(device_id, version)`, `ON DELETE CASCADE/RESTRICT`를 PostgreSQL에도 동일하게 둔다. SQLite `PRAGMA`는 제거한다.
4. **UPSERT**: `meta`의 `ON CONFLICT(key) DO UPDATE`는 PostgreSQL에서도 동작하지만, `node:sqlite`의 바인딩 방식은 `$1` 위치 파라미터로 바꾼다.
5. **설정**: `DB_PATH` 대신 `DATABASE_URL`을 쓰고, Compose에 `postgres` 서비스·볼륨·healthcheck를 추가한다. 업로드 미디어는 계속 `/data/uploads` 볼륨에 둔다.
6. **이관**: 별도 마이그레이션 도구를 도입할 때 현재 `CREATE TABLE IF NOT EXISTS` 스키마를 초기 SQL로 옮기고, `meta.samples_seeded`와 콘텐츠 경로를 보존한다.

## 8. 보안·운영 경계

- 관리자 비밀번호는 환경 변수로만 받고, 비교는 SHA-256 다이제스트의 상수 시간 비교를 쓴다.
- 세션 쿠키는 HttpOnly·SameSite=Lax. HTTPS 배포 시 `Secure`를 켜야 한다.
- 업로드는 MIME·확장자·파일 시그니처·이미지 차원을 검사하고, 정적 파일은 nosniff와 CSP로 제공한다. SVG 업로드는 저장형 스크립트 위험 때문에 허용하지 않는다.
- 재생기 토큰은 등록 응답과 재생기 API에만 쓰고 관리 화면에는 표시하지 않는다. 등록 코드는 관리자 화면에서만 확인한다. 미디어 파일 자체는 LAN 운영을 전제로 공개 URL이다.
- 등록 코드는 기기 인수 권한을 포함한다. `takeover` 등록은 같은 코드로 기존 hardwareId와 토큰을 교체하며, 이전 재생기의 토큰은 즉시 무효화된다. 코드 유출은 곧 화면 탈취이므로 운영 환경에서는 코드 공유 범위를 제한하고 필요 시 재발급한다.
- CSRF 토큰, 로그인 시도 제한, 다중 사용자 감사 로그는 MVP 범위 밖이다. 외부 인터넷에 직접 노출하지 않는다.
- SQLite WAL 파일과 업로드 폴더를 함께 백업해야 한다. Docker에서는 `/data` 볼륨을 백업한다.

## 9. 관련 파일

- 서버 진입점: `src/server.ts`, `src/app.ts`
- DB·게시: `src/db.ts`, `src/publishing.ts`, `src/routes/*.ts`
- 관리 화면: `public/admin/`
- 재생기: `public/player/`, `start-player.cmd`
- 샘플: `seed/`
- 테스트·검증: `test/api.test.ts`, `scripts/verify-api.mjs`, `scripts/verify-ui.mjs`
