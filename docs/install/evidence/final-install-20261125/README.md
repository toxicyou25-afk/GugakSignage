# GUGAK 1차 마감 설치·실행 검증 (a939443)

- 실행 일시: 2026-11-25 12:04–12:13 KST
- 기준 main: a9394436c0485a5500789aa2c7c2d3ec3c299cd3 (PR #11 병합 후)
- 검증 브랜치: work/gugak-final-install-a939443
- 환경: Windows NT 10.0.26300.0, Windows PowerShell 5.1, Node.js v24.22.2, npm 11.19.1, Inno Setup 6.7.3
- 설치 방식: 기존 per-user 설치 위에 새 EXE를 /CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART로 실행

## 결과 요약

| 항목 | 결과 | 증거 |
|---|---|---|
| Inno Setup 6.7.3 EXE 빌드 | PASS | build.json |
| 기존 per-user 설치 업그레이드 | PASS, Setup exit 0 | install-result.json, inno-setup-key-lines.txt |
| 기존 데이터 보존 | PASS (주의 사항 있음) | data-preservation.json |
| 예약 작업 등록·수동 시작 | PASS, LastTaskResult 0 | runtime.json, task-after.xml |
| /api/health | 200 | runtime.json |
| 관리자 loopback | 200 | http-checks.json |
| LAN 관리자 차단 | 403 (같은 PC의 LAN IPv4로 요청) | http-checks.json |
| 기본 비밀번호 0000 경고 | defaultPasswordWarning=true, UI 배너 표시 | runtime.json, 01-admin-login.png, 02-admin-dashboard.png |
| 로그온 기본 화면 | watchdog admin startup decision opened=true | watchdog-log.txt, runtime.json |
| 재생기 온디맨드 실행 | PASS. 로그온 직후 미실행, 관리자 실행 버튼 뒤 기동 | 03-devices-player-running.png, 04-player-installed.png, player-cdp.json |
| 실제 재부팅·로그온 | NOT_RUN | - |
| 물리 모니터·TV, 24시간 소크 | NOT_RUN | - |
| CI | NOT_RUN | - |

## 빌드

- 명령: npm ci 후 powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\build-installer.ps1 -SkipInstall
- 빌드 시작: 2026-11-25T03:04:39.6566896Z (12:04:39 KST)
- 빌드 종료: 2026-11-25T03:05:09.5873631Z (12:05:09 KST)
- Inno Setup compile: 4.578초, exit 0
- EXE: installer/build/inno/GugakSignage-Setup-0.1.0.exe
- EXE 크기: **5,049,349 bytes**
- EXE SHA-256: a654e1925dd50c06798ce304358c7eb03d46a2aa5784e024557ce5eff1f11ff4
- 이식용 ZIP SHA-256: f304a1e8a26c6089858337c941a708033e0341ddf6b1c4929e2e59597208e9f6
- 로컬 보조 검증: npm test 51/51 PASS, installer/test-guards.ps1 result=passed

## 설치와 업그레이드

- 기존 설치: %LOCALAPPDATA%\Programs\GugakSignage (2026-11-24T17:13:18Z 생성)
- 기존 데이터: %LOCALAPPDATA%\GugakSignage
- Setup 시작: 2026-11-25T03:06:03.2776605Z, 종료: 2026-11-25T03:06:15.6996265Z
- Setup exit code: **0**
- install.json: 기존 createdAt을 보존하고 updatedAt을 2026-11-25T03:06:13.5176389Z로 갱신
- 새 기본값: adminAutoOpen.enabled=true, browserHeadless=false, taskName=GugakSignage-Watchdog
- Inno 로그: 기존 unins000.dat에 append하고 새 HKCU uninstall key를 생성. 이전 per-user uninstall key는 실행 전에 이미 없었으므로 Inno의 “previous administrative install” 탐지는 No였지만, install.ps1이 기존 install.json을 읽어 같은 설치 폴더와 데이터 폴더를 업그레이드 방식으로 유지했다.
- 방화벽 규칙: 만들지 않음(무인 설치 기본값). 실제 방화벽 변경은 NOT_RUN.

## 데이터 보존

- 데이터 폴더 파일 13개를 설치 전후 SHA-256으로 기록했다.
- SQLite 행 수는 전후 동일: contents 5, devices 1, display_groups 1, displays 1, layouts 1, meta 5, playlist_items 5, playlists 1, publications 3, schedules 0, sites 1.
- contents, playlists, publications, sites, layouts, displays, meta의 테이블 해시가 동일하다. devices 한 행만 last_seen과 player_state가 재생 중 하트비트로 바뀌었고, 기기 ID·등록 코드·재생목록·게시 버전·사이트·화면 크기·생성/수정 시각은 그대로다. 관리자 비밀번호 해시와 세션 epoch도 동일하다.
- uploads 4개 파일의 크기와 SHA-256이 모두 동일하다.
- .env와 데이터 폴더 ACL SDDL이 동일하다.
- .env 값은 ADMIN_PASSWORD=0000, 64자 SESSION_SECRET, PORT=3000, HOST=0.0.0.0, 데이터/DB/uploads 경로, MAX_UPLOAD_MB=300을 유지했다. 기존 DB가 있어 SEED_SAMPLES=true를 문서화된 업그레이드 규칙으로 false로 바꾼 것이 유일한 의도된 변경이다.
- 주의: 그 SEED_SAMPLES 치환 정규식이 줄 끝 CRLF까지 소비해 .env가 410→409 bytes가 되고 마지막 개행이 사라졌다. 값에는 영향이 없고 설치·실행을 막지 않아 코드는 수정하지 않았다.

## 실행 확인

- 예약 작업 GugakSignage-Watchdog: At log on, 15초 지연, wscript.exe로 설치 폴더의 ops\watchdog-launch.vbs 실행. 상태 Ready.
- Setup이 작업을 시작한 뒤 GET /api/health 200. 이후 작업을 정상 중지하고 Start-ScheduledTask로 다시 시작해 watchdog PID 34904→46464, server PID 33744, health 200(약 1.4초)을 확인했다.
- 로그온에 해당하는 작업 시작 뒤 player-state.json은 desired=stopped, running=false, 재생기 Edge 프로세스 0개였다. watchdog 로그는 admin startup decision {"opened":true,...}를 두 번 기록했다.
- 관리자 headless Edge에서 기기 화면의 재생기 실행 버튼을 눌렀을 때만 재생기가 기동했다. CDP 페이지 제목은 국악원 사이니지 재생기, 상태는 playing, queueLength=5, offline=false였다. 중지 뒤 재생기 프로세스는 0개로 돌아갔다.
- loopback /admin/ 200, /api/auth/me 200. 같은 PC의 LAN IPv4로 /admin/과 /api/auth/me를 요청하면 403, /api/health는 200이었다. 별도 물리 PC에서는 시험하지 않았다.
- 로그인 뒤 {"authenticated":true,"defaultPasswordWarning":true}. 관리자 화면 상단 배너와 로그인 화면 안내 문구가 표시됐다.
- 관리자 바로가기는 wscript.exe로 ops\admin-launch.vbs를 실행하고, 재생기 바로가기는 admin-launch가 아니라 watchdog-launch.vbs를 실행한다. 두 바로가기 파일이 존재한다.

## 발견 사항

1. .env의 마지막 개행 1바이트가 SEED_SAMPLES 치환 때 사라진다. 값 보존에는 문제가 없고 설치·실행을 막지 않아 수정하지 않았다.
2. 업그레이드 전 per-user uninstall registry key가 이미 없었다. 이번 실행이 만든 결함은 아니며, Setup이 새 key를 만들었다. 기존 install.json 기반 업그레이드와 데이터 보존은 정상이다.
3. 설치·실행을 막는 결함은 발견하지 못해 코드 수정은 하지 않았다.

## 정리

- 이전 테스트가 남긴 headless Edge 8개 프로세스를 종료했고 잔여 프로세스는 0개다.
- 그 테스트 프로필 폴더(%TEMP%\GugakSignage-install-test-20261125-000414-ac74fdaa)의 재귀 삭제는 실행 정책에서 거부되어 폴더만 남아 있다.
- Playwright headless 세션은 종료했고, 추가 Gugak 테스트 작업은 없다.
- 검증용 콘텐츠·업로드·비밀번호 변경은 하지 않았다. DB에는 기존 seed 데이터만 남아 있다.
- 최종 상태: watchdog/server 실행 중, 재생기 stopped, health 200.

## NOT_RUN

- 실제 재부팅·로그오프·로그온·자동 로그인
- 물리 모니터/TV 전체 화면과 실제 현장 장비
- 24시간 연속 소크
- 실제 방화벽 규칙 생성·변경 (관리자 LAN 차단은 애플리케이션 응답으로만 확인)
- 별도 물리 PC에서의 LAN 접속
- GitHub Actions CI
- 제거(uninstall)와 재설치
- 비밀번호 변경 및 0000 해제 후 LAN 허용 전환

## 증적 파일

- build.json: 빌드 시각, EXE 크기·SHA-256, 도구 버전
- install-result.json: Setup exit code, 설치 경로, install.json
- data-preservation.json: DB/업로드/ACL/.env 비교
- db-before.json, db-after.json: 전후 테이블 행 수·해시
- runtime.json: 작업 시작, health, 관리자·재생기 상태
- http-checks.json: loopback/LAN HTTP 응답
- admin-ui.json, player-cdp.json: 관리자 UI와 실제 재생기 CDP 상태
- inno-setup-key-lines.txt: Inno Setup 주요 로그
- install-transcript.txt: 설치 스크립트 transcript
- watchdog-log.txt: 2026-11-25 설치·재시작 구간 watchdog 로그
- task-after.xml: 예약 작업 정의
- cleanup.json: 정리 결과
- 01-admin-login.png ~ 04-player-installed.png: 화면 증적