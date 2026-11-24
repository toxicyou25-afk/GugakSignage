<!-- SPDX-License-Identifier: Apache-2.0 -->
# 1차 MVP 로컬 실행·검증 기록

검증일 2026-11-24 (KST) / 검증자: Orca worker / 브랜치: `feat/signage-mvp-player`

## 1. 환경

| 항목 | 값 |
|---|---|
| OS | Windows (PowerShell 7), 실제 데스크톱 2560×1080 |
| Node.js | 24.22.2 |
| npm | 11.19.1 |
| 브라우저 | Microsoft Edge (Playwright `channel: msedge`로 제어) |
| DB | SQLite 단일 파일 (`node:sqlite`, WAL) |
| Docker | **이 PC에는 설치되어 있지 않음** |

## 2. 실행한 명령

```powershell
npm ci
npm run typecheck
npm run build
npm run verify:api
npm run verify:first-run
npm run verify:schedule
npm run verify:ui
```

### 타입 검사·빌드

- `npm run typecheck`: 통과, 출력 없음.
- `npm run build`: 통과, `dist/` 생성.

### API 테스트

- 명령: `npm run verify:api` (내부에서 `node --import tsx --test test/api.test.ts`)
- 결과: **10/10 통과, 0 실패**.
- 범위: 상태 확인·관리자 인증, 이미지·동영상 업로드, URL 추가, 잘못된 파일/URL 거부, 기기 코드 등록과 hardwareId 충돌, 재생목록 저장·기기 배정·게시·manifest, 시간표·하트비트, 기존 연결 인수와 이전 토큰 무효화, 사용 중 콘텐츠/재생목록 삭제 방지, 현재 게시 스냅샷이 참조하는 미디어 보호, 연결 해제 후 토큰 무효화.
- 원문: [api-test-output.txt](api-test-output.txt)

## 3. 첫 실행 통합 테스트

`npm run verify:first-run`은 새 임시 DB와 포트 3124에서 다음을 한 흐름으로 확인했다. 결과: **통과**.

1. 관리자 로그인 화면에서 개발/샘플 모드일 때만 표시되는 `gugak1234` 힌트 확인
2. 기본 비밀번호로 관리자 로그인
3. 기기 화면에서 샘플 기기 **로비 안내 화면**과 코드 **`GUGAK1`** 확인
4. 코드가 없는 `/player/` 첫 화면에서 관리 화면 링크·샘플 코드·원클릭 연결 버튼 확인
5. ‘샘플 코드 GUGAK1로 연결’ 클릭 → manifest v1, 5개 항목, 첫 이미지 재생 확인
6. 뷰포트를 720×1280 세로로 바꿔 가로 이미지가 비율을 유지한 채 레터박스로 표시되는지 확인
7. 두 번째 브라우저에서 같은 코드로 접속 → 기존 연결 충돌 안내와 **기존 연결 끊고 다시 연결** 버튼 확인
8. 관리자 로그인 없이 복구 버튼 클릭 → 새 토큰으로 연결되고 이미지 재생 확인

- 원문: [first-run.json](first-run.json), [first-run.txt](first-run.txt)
- 스크린샷: `14-first-run-admin-login.png` ~ `20-first-run-portrait.png`

## 4. 브라우저 종단 검증

`npm run verify:ui`는 임시 데이터 폴더와 포트 3123에서 새 서버를 띄우고 Edge를 자동 제어했다. 결과: **통과**.

수행한 흐름:

1. 관리 화면 로그인 화면 → 비밀번호 로그인
2. 콘텐츠 화면에서 PNG 1장(`poster-class.png`)과 MP4 1개(`sample-video.mp4`)를 실제 파일 입력으로 업로드 → 카드 7개(시드 5 + 업로드 2)
3. 재생목록을 새로 만들고 이미지·동영상·URL 3개 항목을 추가, 이미지 표시 시간을 3초로 바꾸고 저장
4. 기기 재생 설정에서 새 재생목록을 기본 목록으로 선택하고 `저장 후 게시` → 게시 버전 **v2**
5. 코드 없이 `/player/`를 열어 첫 화면의 관리 화면 링크·샘플 코드 `GUGAK1` 힌트·‘샘플 코드로 연결’ 버튼 확인
6. 잘못된 코드 `ABC123` 입력 → 404 안내에 관리 화면 경로와 `GUGAK1` 안내가 포함되는지 확인
7. ‘샘플 코드로 연결’ 버튼으로 등록, manifest v2·항목 3개 확인
8. 3초 뒤 동영상 항목으로 전환되어 `<video>` 재생 확인
9. 다음 항목인 URL이 iframe으로 열려 `오늘의 안내` 페이지가 표시되는지 확인
10. IndexedDB에 이미지·동영상 Blob **2건** 저장 확인
11. 서버 프로세스 종료 → 오프라인 배지 표시, 다음 이미지 재생 유지
12. 오프라인 상태에서 다음 동영상 항목으로 진행한 뒤 URL 항목에서는 브라우저 오류 페이지 대신 안내 카드를 표시
13. 서버가 꺼진 채 같은 `?code=GUGAK1` 주소로 다시 열어도 연결 화면으로 돌아가지 않고 캐시된 목록을 재생

### 상태 기록

| 시점 | manifest | 현재 index | 콘텐츠 | offline |
|---|---:|---:|---|---|
| 온라인, 재생 시작 | v2 | 0 | 업로드 이미지 | false |
| 동영상 전환 | v2 | 1 | 업로드 MP4 | false |
| URL 표시·서버 종료 직전 | v2 | 2 | 샘플 안내 URL (iframe) | false |
| 서버 종료 후 | v2 | 0 | 업로드 이미지 | **true** |
| 서버 종료 후 진행 | v2 | 1 | 업로드 MP4 | **true** |
| 이후 | v2 | 2 | 샘플 안내 URL 안내 카드 | **true** |

원문 JSON: [ui-run.json](ui-run.json), 전체 로그: [ui-run.txt](ui-run.txt).

검증 중 콘솔에는 잘못된 코드 테스트의 의도적 **404 1건**과, 서버를 종료한 뒤 재생·재실행 과정에서 발생한 **`ERR_CONNECTION_REFUSED` 7건**만 기록되었고, 페이지 예외(`pageerror`)는 0건이다.

## 5. 예약시간 경계 회귀 테스트

`npm run verify:schedule`은 기본 재생목록 없이 **09:00–10:00 시간표만 있는 기기**를 만들고 게시한 뒤, 재생기 시계를 08:00으로 고정해 검증했다. 결과: **통과**.

- 08:00: `예약 시간을 기다리는 중` 화면이 표시되고 콘텐츠는 시작하지 않음
- 09:01로 시계를 진행: 15초 폴링의 manifest 응답이 대기 상태에서도 재적용되어 5개 항목 목록의 첫 포스터가 재생됨
- manifest 버전이 바뀌지 않아도 재생 중인 항목/대기 상태를 함께 판단하도록 수정한 회귀 검증

- 원문: [schedule-run.json](schedule-run.json), [schedule-run.txt](schedule-run.txt)
- 스크린샷: `22-schedule-waiting.png`, `23-schedule-started.png`

## 6. 스크린샷

### 첫 실행 통합 테스트

개발 모드 로그인 힌트:

![첫 실행 관리자 로그인](evidence/14-first-run-admin-login.png)

기기 카드의 큰 등록 코드 `GUGAK1`:

![첫 실행 기기 코드](evidence/15-first-run-admin-device.png)

코드 없는 재생기 첫 화면:

![첫 실행 재생기 연결 화면](evidence/16-first-run-player-pair.png)

샘플 버튼으로 연결한 뒤 첫 이미지 재생:

![첫 실행 재생](evidence/17-first-run-player-playing.png)

세로 720×1280 화면에서 가로 이미지의 비율 유지(레터박스):

![첫 실행 세로 화면](evidence/20-first-run-portrait.png)

기존 연결 충돌과 복구 버튼:

![첫 실행 기존 연결 복구](evidence/18-first-run-recover.png)

복구 후 재생:

![첫 실행 복구 후 재생](evidence/19-first-run-recovered.png)

### 관리 화면

로그인:

![관리 화면 로그인](evidence/01-admin-login.png)

로그인 후 대시보드:

![관리 대시보드](evidence/02-admin-dashboard.png)

이미지·동영상 업로드 후 보관함:

![콘텐츠 보관함](evidence/03-admin-contents-uploaded.png)

재생목록 편집:

![재생목록 편집](evidence/04-admin-playlist-editor.png)

기기에 v2 게시:

![기기 게시](evidence/05-admin-device-published.png)

### 재생기

코드 없이 처음 연 재생기 연결 화면 — 관리 링크, 샘플 코드, 원클릭 버튼:

![재생기 첫 화면](evidence/11-player-pair-guide.png)

잘못된 코드 안내 — 관리 화면 경로와 샘플 코드를 함께 표시:

![재생기 잘못된 코드](evidence/12-player-pair-error.png)

온라인 재생:

![재생기 온라인](evidence/06-player-online.png)

동영상 재생:

![재생기 동영상](evidence/07-player-video.png)

온라인 URL iframe 재생:

![재생기 URL 콘텐츠](evidence/10-player-url.png)

서버 종료 후 마지막 이미지 재생 + 오프라인 배지:

![재생기 오프라인](evidence/08-player-offline.png)

서버가 꺼진 상태에서 다음 항목(URL 안내 카드)으로 순환:

![재생기 오프라인 다음 항목](evidence/09-player-offline-next.png)

서버가 꺼진 채 같은 코드 URL로 재실행 — 연결 화면 없이 캐시 재생:

![재생기 오프라인 재실행](evidence/21-player-offline-reopen.png)

예약 시간 전 대기:

![예약 시간 대기](evidence/22-schedule-waiting.png)

예약 시간 시작 후 재생:

![예약 시간 시작](evidence/23-schedule-started.png)

실제 `start-player.cmd`로 연 Edge 전체화면 앱 창 — 창 영역 0,0–2560,1080, 주소창 없음:

![start-player.cmd 전체화면](evidence/13-start-player-kiosk.jpg)

## 7. 수동 실행 확인

개발 서버는 `npm run serve`로도 띄워 확인했다. 시작 로그는 다음과 같다.

```text
[signage] 서버 시작 · 2026-11-24T07:58:06.960Z
[signage] 관리 화면: http://localhost:3000/admin/
[signage] 재생기: http://localhost:3000/player/
[signage] 데이터베이스: C:\...\data\signage.sqlite
[signage] 업로드 폴더: C:\...\data\uploads
[signage] 샘플 기기 등록 코드: GUGAK1
[signage] 개발/샘플 모드 초기 비밀번호: gugak1234 · 운영 전 ADMIN_PASSWORD를 바꾸세요.
```

- 관리 화면 로그인 후 대시보드·콘텐츠·기기·재생목록 화면이 렌더링됨을 Edge로 확인했다.
- 재생기 `http://localhost:3000/player/`에서 코드를 직접 입력해 등록·재생됨을 확인했다.
- 별도 `?code=GUGAK1` 자동 연결과 10초 간격 이미지 전환을 확인했다.
- `start-player.cmd`를 실제 Windows 데스크톱에서 실행해 Edge 창 영역이 화면 전체(0,0–2560,1080)와 일치하고 주소창 없이 동영상이 재생됨을 확인했다.
- `%LOCALAPPDATA%\GugakSignagePlayer` 프로필에서 Edge를 닫았다가 기본 인자(`start-player.cmd`)로 다시 열었을 때 기기 연결이 유지되고 하트비트가 다시 온라인으로 갱신됨을 확인했다. Edge `--kiosk`는 InPrivate로 열려 저장소가 지워지므로, 이 런처는 Edge 전체화면 앱 모드를 사용한다.
- `npm run build` 후 `node dist/server.js`를 빈 데이터 폴더·포트 3311에서 실행해 `/api/health` 200, `/admin/`·`/player/` 200, 샘플 코드 `GUGAK1`, 개발 모드 비밀번호 힌트를 확인했다. Docker 이미지의 런타임 진입점과 같은 경로다.

## 8. Docker

이 검증 PC에는 Docker CLI/데몬이 없어 `docker compose up --build`를 실행하지 못했다. 대신 다음을 정적으로 확인했다.

- `docker-compose.yml`을 PyYAML로 파싱해 문법 확인.
- Dockerfile은 Node 24 빌드 스테이지 + 런타임 스테이지, `npm ci --omit=dev`, `/data` 볼륨, 비루트 `node` 사용자, healthcheck를 사용한다. `LICENSE`·`NOTICE`도 런타임 이미지에 포함한다.
- 런타임 진입점 `node dist/server.js`는 `npm run build` 결과로 생성된다.
- 컴파일된 `dist/server.js`는 로컬에서 실제로 기동·응답을 확인했다. 남은 것은 Docker 이미지 빌드 자체다.
- 실제 Docker 실행 확인은 Docker가 있는 PC에서 `docker compose up --build`로 한 번 더 필요하다.

## 9. 남은 제한

- 실제 물리 모니터·PC 2대 이상, Wi-Fi 단절, 장시간 소크는 검증하지 않았다.
- 잘못된 코드의 404 1건과 서버 종료 후의 네트워크 오류 7건은 의도한 테스트에서 발생한 fetch 실패 기록이다.
- LAN IP의 HTTP에서는 서비스 워커가 등록되지 않는다. 이번 검증은 이미 열린 재생기 탭의 오프라인 지속 재생과 IndexedDB 캐시를 확인했다.
- 외부 URL이 iframe 삽입을 막는 경우 실제 사이트 콘텐츠가 보이지 않을 수 있다. 샘플 내부 안내 페이지로 정상 경로를 확인했다.
- 운영 전 `ADMIN_PASSWORD`·`SESSION_SECRET` 변경, HTTPS 적용, 방화벽·백업 정책이 필요하다.
