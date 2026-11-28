# Manager / Player API 계약 제안

작성일: 2026-11-24

최종 갱신: 2026-11-26 (PR #14 병합 반영)

기준: `main` `dec7c24576dfb29f6970813df720d4f24b447c4e` (PR #14 병합본). PR [#4](https://github.com/toxicyou25-afk/GugakSignage/pull/4), [#6](https://github.com/toxicyou25-afk/GugakSignage/pull/6), [#8](https://github.com/toxicyou25-afk/GugakSignage/pull/8), [#9](https://github.com/toxicyou25-afk/GugakSignage/pull/9), [#11](https://github.com/toxicyou25-afk/GugakSignage/pull/11), [#12](https://github.com/toxicyou25-afk/GugakSignage/pull/12), [#14](https://github.com/toxicyou25-afk/GugakSignage/pull/14)이 병합됐다.

동작 확인 기준: `a9394436c0485a5500789aa2c7c2d3ec3c299cd3`. 런타임 코드는 `7d802e1`과 같다. 이 문서의 `2. 기준 main의 API`는 현재 구현, `3. 목표 계약 표`는 아직 구현되지 않은 목표다.

상위 아키텍처: [Manager / Player 분리와 3가지 배포 모드](manager-player-architecture.md)

## 1. 원칙

- Manager가 canonical data와 게시 version을 소유한다. Player는 장비 범위가 제한된 API로만 접근한다.
- 기존 `/api/player/*`와 `/api/time`은 이전 Player와 독립 실행 호환을 위해 유지하고, 새 필드 추가는 기본적으로 하위 호환한다.
- 모든 시간은 UTC ISO-8601(`Z`)로 주고받는다. 재생 시계는 벽시계 시각을 반복 읽지 않고 Manager 기준 offset을 monotonic clock과 함께 적용한다.
- Player의 manifest pull·media GET·heartbeat는 동일 장비가 반복해도 부작용이 없어야 한다. 등록·게시처럼 상태를 바꾸는 요청은 `Idempotency-Key` 또는 재시도 가능한 명시 계약을 둔다.
- Player가 publication을 활성화하는 시점은 manifest와 필요한 첫 재생 자산이 검증된 뒤다. 부분 응답은 현재 콘텐츠를 바꾸지 않는다.
- TLS 중앙 모드의 Media URL은 Manager origin을 기준으로 절대 URL을 만들 수 있어야 한다. 인증 token을 query string 또는 URL fragment에 포함하지 않는다.

## 2. 기준 `main`의 API

확인 위치: [`src/app.ts`](../../src/app.ts), [`src/routes/player.ts`](../../src/routes/player.ts), [`src/routes/player-control.ts`](../../src/routes/player-control.ts), [`src/player-control.ts`](../../src/player-control.ts), [`src/routes/devices.ts`](../../src/routes/devices.ts), [`src/routes/topology.ts`](../../src/routes/topology.ts), [`src/publishing.ts`](../../src/publishing.ts), [`public/admin/app.js`](../../public/admin/app.js), [`public/player/player.js`](../../public/player/player.js), [`installer/ops/watchdog.mjs`](../../installer/ops/watchdog.mjs).

| 현재 경로 | 현재 용도 / 인증 | 현재 사실과 분리 시 주의 |
|---|---|---|
| `POST /api/player/register` | pair code + `hardwareId`로 연결, Player token 발급 | token은 현재 DB의 device row에 평문으로 저장된다(hash 아님). 화면 정보 일부를 보고하고, 동일 hardware면 기존 token을 반환할 수 있다. pair code는 현재 만료·1회 소비·실패 횟수 계약이 없다. 실패 응답은 잘못된 코드 404, 기기 충돌 409 등이다. |
| `GET /api/player/manifest` | Bearer device token 필요 | 현재 게시 snapshot 기반 manifest와 `serverTime`을 응답한다. 현재 `ETag`/304 계약은 없다. 조회 시 `last_seen`, `last_ip`, `last_manifest_at`을 갱신한다. `manifest_version`은 마지막으로 성공적으로 가져온 버전이 아니라 heartbeat에서 보고한 적용 버전이다. |
| `POST /api/player/heartbeat` | Bearer device token 필요 | `state`, `currentContentId`, `error`와 선택 필드 `playerVersion`, `manifestVersion`, `cacheReady`를 받는다. `last_seen`, `last_heartbeat_at` 등 장비 상태를 갱신하고 `{ ok, publishedVersion, serverTime, reconnected, reconnectCount }`를 반환한다. 선택 필드의 누락/잘못된 값은 기존 저장값을 유지한다. |
| `GET /api/devices` | 관리자 세션 | 기존 `status`/`lastSeen` 외에 `health`, `attention`, `playerVersion`, 적용 `manifestVersion`, `cacheReady`, `lastHeartbeatAt`, `reconnectCount`, `lastReconnectAt`, `lastManifestAt`, `offlineSince`, `heartbeatAgeMs`, `manifestBehind`를 반환한다. |
| `GET /api/dashboard` | 관리자 세션 | 기존 데이터에 `health` 요약과 `healthyDevices`, `offlineDevices`, `degradedDevices`, `staleDevices`, `behindDevices`, `attentionDevices`, `reconnectedDevices` 집계를 추가한다. 기존 `onlineDevices`는 호환성을 위해 연결 상태(`status=online`) 기준을 유지한다. |
| `GET /api/player/config` | 현재 공개 설정/샘플 정보 | 독립 설치 안내 등 공개 설정만 전달한다. 등록 비밀·관리자 세션을 전달하지 않는다. |
| `GET /api/time` | no-store 시각 조회 | 현재 Manager 서버 시각을 전달한다. 시간 offset protocol은 추가 정의가 필요하다. |
| `GET /api/player/state` | 관리자 session + loopback 제한(`0000` 테스트 기본값 동안) | `Cache-Control: no-store`로 `{ player: { schemaVersion, desired, running, pid, startedAt, deviceId, playerUrl, lastError, updatedAt } }`를 반환한다. `data/control/player-state.json`을 읽고, 파일이 없거나 깨졌으면 stopped 기본값을 반환한다. Player token용 API가 아니라 관리자 화면용 상태 조회다. |
| `POST /api/player/launch` | 관리자 session + loopback 제한 | body `{ deviceId }`. 빈 값 `400`, 없는 기기 `404`. 기기 존재를 확인한 뒤 `data/control/player-command.json`에 launch 명령을 원자적으로 쓰고 `202 { ok, accepted, commandId, playerUrl, player }`를 반환한다. 실제 Edge 기동은 로컬 watchdog이 수행하므로 API 응답은 접수까지만 보장한다. |
| `POST /api/player/stop` | 관리자 session + loopback 제한 | `data/control/player-command.json`에 stop 명령을 쓰고 `202 { ok, accepted, commandId, player }`를 반환한다. 실제 중지는 watchdog이 수행한다. |
| `POST /api/devices/:id/publish` | 관리자 세션 | 단일 장비 publication을 생성한다. 이미 생성된 요청을 구별하는 멱등 키나 `If-Match` 조건은 현재 계약에 없다. |
| `POST /api/groups/:id/publish` | 관리자 세션 | topology snapshot을 관련 장비별 publication으로 기록한다. |
| `GET/POST /api/contents`, `GET/PUT/POST /api/playlists`, `/api/sites`, `/api/groups`, `/api/displays` | 관리자 세션 | Manager CRUD·미리보기·배치 변경 경로다. Player token으로 호출할 수 없다. |
| 업로드 정적 경로 | 현재 Express `config.uploadDir` 제공 | 관리자와 Player가 같은 origin을 쓰는 전제다. 중앙 모드에서는 아래처럼 장비 인증·immutable URL·range 처리 계약을 별도로 정한다. |

기준 `main`의 API를 인용해 목표 기능이 이미 지원되는 것으로 표현하지 않는다. 특히 manifest ETag, per-device token hash, 1회용 등록 코드, 표준 오류 형식, 멱등 게시, media ACL은 목표다. 현재 Player JS는 발급받은 token을 브라우저 `localStorage`에 보관하며, 이는 [아키텍처 결정 2](manager-player-architecture.md#player-host-경계와-실행-방식-결정-2)의 Host + DPAPI로 대체할 대상이다.

### 현재 구현: 관리자 기본 화면과 재생기 온디맨드 (#11)

기준 `a939443`에서 확인한 흐름이다.

1. 로그온 예약 작업이 watchdog과 서버를 시작한다. watchdog은 서버 health가 준비되면 기본 브라우저로 `/admin/`을 최대 한 번 열고, 전체화면 재생기는 시작하지 않는다.
2. `GET /`는 `/admin/`으로 redirect한다. 로그인 뒤 관리자 대시보드가 기본 화면이다.
3. 대시보드나 기기 카드의 **재생기 실행**이 `POST /api/player/launch`에 `{ deviceId }`를 보낸다. 서버는 기기 존재와 관리자 session을 확인하고 `202`로 명령 접수 ID를 반환한다.
4. watchdog이 `data/control/player-command.json`을 읽어 Edge를 `http://127.0.0.1:<port>/player/?code=<pairing_code>&reconnect=1`로 실행한다. 실행 결과는 `data/control/player-state.json`에 기록되고, 관리자 UI는 `GET /api/player/state`를 약 6초까지 polling해 desired/running/PID/오류를 표시한다.
5. **중지**는 `POST /api/player/stop`으로 command를 쓰고, watchdog이 재생기를 종료한다. 사용자가 재생기 창을 닫으면 desired가 `stopped`로 바뀌며 자동 재실행하지 않는다. 비정상 종료만 마지막 desired가 `running`일 때 제한적으로 복구한다.
6. `/api/dashboard`는 `playerControl`과 기기별 현재 송출을 함께 반환한다. 재생 중 `playing:<contentId>`와 일치하는 항목을 **지금 화면**으로 표시한다.

현재 제한: player control API는 관리자 전용이며 Player token 인증이 아니다. `0000` 테스트 기본값 동안 loopback만 허용하고, 암호 변경 후에는 LAN 관리자도 서버 PC의 Edge 실행을 요청할 수 있다. TLS·token hash·회전 API·1회용 등록 코드·ETag는 아직 없다. 실제 재부팅·로그온, 별도 PC LAN, 물리 모니터, 24시간 soak, CI는 [1차 마감 검증](../install/verification.md)에서도 `NOT_RUN`이다.

### PR #14에서 추가된 플레이어 상태 계약

- `/api/player/config`가 보고하는 heartbeat 주기와 Player 기본 주기는 15초이며, 기본 온라인 판정 창은 `HEARTBEAT_ONLINE_SECONDS=45`초다.
- `status`는 기존 호환을 위해 `last_seen` 기준으로 `pending|online|offline`을 계산한다. `last_seen`은 등록, manifest 조회, heartbeat 때 갱신되므로 `status=online`만으로 heartbeat loop가 정상이라고 단정하지 않는다.
- 별도 `health`는 `status=online`인 연결 장비에서 `last_heartbeat_at`이 없거나 45초 초과면 `stale`, 보고된 `player_state`가 `offline`/`offline:<contentId>`, `cacheReady=false` 또는 `lastError`가 있으면 `degraded`로 표시한다. 현재 우선순위는 `degraded`를 `stale`보다 우선하며, `attention`은 offline/degraded/stale 또는 게시 적용 지연이면 참이다.
- `manifestVersion`은 Player가 현재 적용한 manifest 버전 보고다. manifest pull 시각은 별도 `lastManifestAt`이며, fetch 자체를 적용 완료로 간주하지 않는다. `manifestBehind`는 연결된 장비의 `publishedVersion > manifestVersion`일 때 참이며, 아직 적용 버전을 보고하지 않은 경우도 지연으로 취급한다.
- `cacheReady`는 플레이어가 활성 manifest에 필요한 자산을 IndexedDB에 준비했다고 보고한 상태다. 서버가 실제 미디어 바이트를 독립 검증하는 값은 아니다. `playerVersion`도 Player 자기 보고다.
- 재등록/연결 해제는 현재 연결에 종속된 heartbeat, cache, manifest 및 버전 telemetry를 초기화한다. `reconnectCount`는 기기 레코드의 누적 이력으로 보존한다.
- `reconnected`는 기존 heartbeat/접속 timestamp가 온라인 창을 넘어선 뒤 들어온 heartbeat를 나타낸다. 최초 페어링은 복구로 세지 않는다. heartbeat event ID/sequence 중복 제거는 아직 구현되지 않았고 아래 목표 계약에 남는다.

## 3. 목표 계약 표

| 동작 | 목표 HTTP 계약 | 인증 / 주요 필드 | 오류·재시도·멱등성 |
|---|---|---|---|
| 장비 생성·등록 코드 발급 | 관리자 `POST /api/devices`; 재발급 `POST /api/devices/:id/regenerate-code`; Player `POST /api/player/register` | 관리자 세션. Player 요청: `pairingCode`, `hardwareId`, `requestId`, `playerVersion`, `capabilities`, Host가 Windows DisplayConfig/Win32로 관측한 `displays[]`(논리 ID, width, height, orientation, rotation, refresh rate 가능 여부). browser 값은 보조 검증용이다. 성공 응답은 장비 ID, 단 한 번 보여 주는 token, Manager URL, polling 정책, server time. | Pairing code는 짧은 수명·1회 사용·시도 제한. 같은 `Idempotency-Key` 재요청은 연결 레코드를 중복 생성하지 않는다. token 응답 유실은 같은 키의 제한 시간 내 안전한 replay 또는 관리자 재발급 흐름으로 복구한다. 코드 소진/다른 hardware 연결은 `409`; 만료·폐기는 `410`. |
| token 확인 / 철회 / 회전 | 관리자 `POST /api/devices/:id/token/rotate`, `DELETE /api/devices/:id/token` (경로는 구현 시 확정) | 관리자 세션과 재인증. 장비 token은 Bearer, opaque random 값. 서버는 token hash, scope, 생성·회전·폐기 시각만 저장한다. | 회전은 한 트랜잭션에서 이전 token을 즉시 폐기하고 새 token을 한 번만 보여 준다. 분실 응답은 새 회전으로 복구. token 없는 요청 `401`, 비활성 장비 `403`. 로그에는 원문을 쓰지 않는다. |
| Manifest pull | `GET /api/player/manifest` | `Authorization: Bearer <device-token>`, `If-None-Match: "<sha256>"`. 성공 JSON: `schemaVersion`, `publicationVersion`, `etag`, `issuedAt`, `serverTime`, `minPlayerVersion`, `device`, `displays[]`, `playlists/schedules/wall`, immutable `assets[]`. | 변경 없음은 `304 Not Modified`; 변경은 `200`. 읽기 전용이므로 연결 실패·`5xx`는 exponential backoff+jitter로 재시도한다. `401/403`은 token 재시도 루프 대신 등록 대기/관리자 조치를 표시한다. 서버는 게시 전 상태를 노출하지 않는다. |
| Heartbeat / 상태 보고 | `POST /api/player/heartbeat` | Bearer token. 목표 필드: `eventId`, `sequence`, `playerVersion`, `publicationVersion`, `state`, `currentContentId`, `displayStates[]`, last successful pull, cache health, OS/Edge version, 제한된 오류 코드와 시각. 현재 PR #14 구현은 `playerVersion`, 적용 `manifestVersion`, `cacheReady`, `reconnected`, `reconnectCount`를 추가하며 `eventId`/`sequence`는 아직 없다. IP는 서버가 관측한다. | 목표는 `eventId`로 중복 제거하고 동일 heartbeat 재전송을 수렴시키는 것. 현재 구현은 이전 heartbeat 시각으로 reconnect 전이를 세며 sequence 기반 중복 제거는 없다. 현재 기본 15초 주기, ±3초 jitter와 단절 중 큐는 미구현이다. |
| 시간 동기 | 기존 `GET /api/time`, 목표 `GET /api/player/time` 또는 호환 응답 | token scope를 제한하거나 공개 서버 시각만 제공한다. 요청/응답에 `serverReceivedAt`, `serverSentAt`을 넣고 Player는 요청 시작·응답 수신 monotonic timestamp를 기록한다. | `Cache-Control: no-store`. 여러 샘플 중 RTT가 낮은 값을 선택해 offset을 추정한다. 네트워크 지연이 크면 재생 시간에 순간 jump를 적용하지 않고 천천히 보정한다. |
| 게시 / 버전 생성 | 기존 관리자 `POST /api/devices/:id/publish`, `POST /api/groups/:id/publish` | 관리자 session, `Idempotency-Key`, 편집 대상 `If-Match: "<draft revision>"`. 성공 시 immutable `publicationVersion`, content hash, ETag, `publishedAt`, 대상 장비 목록을 반환한다. | 같은 key 재요청은 같은 publication 결과를 돌려준다. `If-Match`가 오래되면 `412`; 대상 설정을 다시 불러오게 한다. 해당 version 응답은 `200`으로 반환되며 사전 staging에서 `5xx`가 나면 이전 version을 유지한다. |
| Media 다운로드 | 목표 `GET /api/media/:sha256` (기존 static uploads는 하위 호환) | Player Bearer token. Manifest에 `{sha256, url, mime, byteLength, width, height}`를 제공한다. URL은 same-origin standalone에서 상대 경로, central/LAN에서는 Manager base URL 기준 절대 URL이 가능하다. | hash가 URL/resource identity다. `ETag`는 강한 content hash, `Range` 요청을 지원한다. 자산은 checksum 일치 후에만 local cache에 활성화한다. 인증 실패 `401/403`, hash 불일치 `422`, 제한 초과 `413`; 일시 오류는 지수 backoff. |
| 관리자 조회·미리보기 | 기존 `/api/contents`, `/api/playlists`, `/api/sites`, `/api/groups/:id/preview`, `/api/devices` | 관리자 cookie/session + 역할 권한. 관리 API를 Player token으로 열지 않는다. | 오류는 공통 오류 envelope를 사용하되, 기존 `{error: string}` 응답을 소비하는 클라이언트가 있는 동안 호환한다. 읽기 GET은 안전 재시도 가능하다. |

### v1.0 사이트별 모니터 인벤토리

GET /api/sites/:id/monitor-inventory는 관리자 세션 전용이며 site에 연결된 PC와, 어느 site나 화면에도 아직 배정되지 않은 등록 PC 후보를 반환한다. 다른 site에 배정된 PC는 제외한다. 기존 player_monitor_reports snapshot과 devices, displays, display_groups, playlists 행을 조합한다. 새 테이블이나 외부 서비스는 추가하지 않는다.

응답은 siteId와 generatedAt, 그리고 PC별 deviceId/name/siteAssigned/localHost/status/online/lastSeen/publishedVersion, monitorReport(reported/reportedAt/ageMs/monitors), assignments(displayId/displayName/groupId/groupName/playlistId/playlistName/nativeMonitorId/monitorDetected), logicalDisplayCount, assignedDisplayCount, unassignedDisplayIds를 포함한다. status는 기존 deviceStatus의 online/offline/pending 구분을 보존하고 online은 status가 online인지 나타낸다.

Assignments는 저장된 초안 설정이며 활성 게시본을 바꾸지 않는다. monitorDetected는 저장된 binding ID가 최신 보고 목록에 있는지 나타낸다. offline PC의 마지막 report는 조사 목적으로 표시하지만 새 배정 선택지로 사용하지 않는다. 보고가 한 번도 없었던 상태(reported=false)와 성공한 빈 보고(reported=true, monitors=[])를 구분한다. 없는 site는 404를 반환한다.

### 목표 manifest 예시

아래는 계약 필드 예시이며 현재 응답 형식이 아니다. ID/필드는 실제 schema review 때 고정한다.

```json
{
  "schemaVersion": 1,
  "publicationVersion": 42,
  "etag": "sha256:7c...e1",
  "issuedAt": "2026-11-24T02:00:00Z",
  "serverTime": "2026-11-24T02:00:01Z",
  "minPlayerVersion": "0.2.0",
  "device": { "id": "device-123", "siteId": "site-1" },
  "displays": [
    { "id": "display-1", "width": 1920, "height": 1080, "orientation": "landscape", "rotation": 0 }
  ],
  "playlists": [],
  "schedules": [],
  "wall": null,
  "assets": [
    { "sha256": "...", "url": "https://manager.example.test/api/media/...", "mime": "image/webp", "byteLength": 845233 }
  ]
}
```

Manifest ETag는 canonical JSON의 hash 또는 정확히 같은 bytes의 hash여야 한다. 같은 `publicationVersion`에 다른 snapshot을 덮어쓰지 않는다. 구조적 변경은 `schemaVersion` major 증가와 이전 Player의 안전한 오류 표시를 사용한다.

## 4. 공통 응답과 상태 코드

신규 오류는 다음 형태를 제안한다. 기존 클라이언트 호환 기간에는 현재 오류 문자열을 같이 둘 수 있다.

```json
{
  "error": {
    "code": "PAIRING_CODE_EXPIRED",
    "message": "장비 등록 코드가 만료되었습니다.",
    "retryable": false,
    "correlationId": "req-..."
  }
}
```

| HTTP | 의미 | Player 동작 |
|---|---|---|
| `400` / `422` | 요청·manifest schema 또는 자산 검증 실패 | payload를 반복 재시도하지 말고 현재 정상 콘텐츠를 유지하며 진단 상태 보고. |
| `401` | token 없음/폐기/만료 | 연결을 멈추고 등록 대기. 관리자가 승인한 재등록만 진행. |
| `403` | 장비 비활성 또는 해당 리소스 권한 없음 | 요청 중단, Manager에 `disabled` 보고. |
| `404` | 없는 device/media/publication | manifest를 갱신한 뒤에도 지속하면 진단 이벤트 보고. |
| `409` | 등록 충돌·중복 hardware·정책상 conflict | 자동 takeover 금지. 현장 또는 관리자 승인 필요. |
| `410` | 등록 코드/token과 같은 자격 증명 철회·만료 | 새 코드/새 token이 발급될 때까지 연결 중지. |
| `412` | 관리자 `If-Match` 초안 revision 충돌 | 관리자 화면에 최신 revision 다시 불러오기를 요구. |
| `413` | 업로드 또는 media 요청 크기 제한 초과 | 재시도하지 않고 관리자에게 원인 표시. |
| `429` | 시도 제한 또는 요청 과다 | `Retry-After` 준수, 그동안 요청률을 낮춤. |
| `5xx` / network timeout | 일시 서버·네트워크 오류 | 5초부터 시작해 jitter를 더하고 최대 5분까지 backoff. 상태 변경 요청은 멱등 키를 유지. |

모든 동기화 요청에 `X-Request-ID`를 부여하거나 서버가 `correlationId`를 발급한다. 운영 로그에는 장비 ID·publication version·error code를 남기고 Authorization header, cookie, pairing code, password는 기록하지 않는다.

## 5. 멱등성 및 재시도 규칙

| 요청 | 안전한 반복 기준 |
|---|---|
| manifest, time, media `GET` | 본래 read-only. ETag/Range와 content hash로 같은 representation을 확인한다. |
| heartbeat | device ID + `eventId`/sequence를 저장해 재전송해도 상태 변화가 중복 적용되지 않게 한다. 서버 UTC 수신 시각은 재수신 시 갱신할 수 있다. |
| 최초 등록 | `Idempotency-Key`를 등록 코드·hardware ID와 함께 제한 시간 동안 기억한다. 동일 key에 새 device를 만들지 않는다. token 원문 재전달 방식은 안전한 제한 시간 replay 또는 운영자 재발급 중 하나로 구현 전 결정한다. |
| 토큰 회전 | rotation 요청에 idempotency key를 사용한다. 성공 여부가 불명확하면 같은 키를 확인하고 새 회전을 반복 생성하지 않는다. 이전 token은 회전 성공 즉시 폐기한다. |
| 게시 | 편집 revision의 `If-Match`와 `Idempotency-Key`를 함께 요구한다. 동일 key는 같은 immutable version으로 귀결한다. 새 의도만 새 key를 사용한다. |
| 오류 보고 backlog | 전송 순서 보장을 요구하지 않는 상태 snapshot은 최신값 우선. 등록/보안/게시 결과 같은 중요 이벤트에는 `eventId`를 부여하고 서버 중복 제거 후 ack한다. |

Player의 backoff는 요청 종류별로 분리한다. `401/403/409/410`에는 무한 재시도를 하지 않는다. `429`는 서버 지시를 우선한다. 상태 재전송 큐가 최대 크기에 도달하면 반복 heartbeat를 합치고, 가장 최근 장애 및 복구 결과를 보존한다.

## 6. 계약 구현 순서

1. 현재 manifest에 `schemaVersion`, `publicationVersion`, media hash 등 선택 필드를 추가하고 구버전 Player 소비 결과가 유지되는지 확인한다.
2. manifest ETag/304와 media checksum/range 동작을 추가하되, 기존 route와 same-origin installation을 유지한다.
3. 장비 token을 hash 저장으로 전환하고 pair code 만료·시도 제한·회전/철회 상태를 추가한다. 기존 token을 가진 장비의 무중단 전환/재등록 절차가 필요하다.
4. heartbeat를 event ID 기반으로 확장하고 실패 큐를 추가한다. privacy 보존 기간과 field allowlist를 정한다.
5. Manager/Player 역할을 배포해 LAN에서 여러 Player가 동일 계약으로 동작하는지 검증한다.
6. WAN TLS, reverse proxy, 업로드 상한, 사용자/장비 접근 정책을 확정한 이후 central 배포 준비를 진행한다.

계약 구현은 [아키텍처 로드맵](manager-player-architecture.md#12-단계별-로드맵과-게이트)의 gate를 따른다. LAN/central 배포는 PR #4/#6 PASS와 현장 검증 전에는 시작하지 않고, 관리자 암호 변경 전에는 네트워크 listen을 열지 않는다. 브라우저 Origin이 다른 배포에서는 CORS allowlist를 Manager URL 기준으로 고정하고 wildcard credential 허용을 하지 않는다. Player Host가 API/media 통신을 중개해 브라우저에 token을 노출하지 않는다.
