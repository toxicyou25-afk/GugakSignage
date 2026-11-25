# Windows 설치·복구 검증 기록

- 리뷰 기준 커밋: 218963ea4f01f0927f2638fa21c8e522c6409892
- 병합한 main: 3556b02822ff10b94ecc468f6432216abf2156aa
- 실행 일시: 2026-11-24 UTC
- 환경: Windows 26100, Windows PowerShell 5.1, Node.js v24.22.2, Microsoft Edge, Inno Setup 6.7.3
- 설치 방식: 앱, 데이터, 프로필, 바로가기, 작업 이름을 모두 임시 고유값으로 분리
- 테스트 브라우저: 격리된 user-data-dir와 headless 모드
- 기존 운영 위치: %ProgramFiles%\GugakSignage와 %ProgramData%\GugakSignage는 시험 전후 모두 없음

## GUGAK-UX-001 재검증 (2026-11-25)

- 기준: main `966888e6f033f8cf9393b3d6ea725475e4d0199d`, Windows PowerShell 5.1, Node.js v24.22.2
- npm ci / typecheck / build: PASS
- npm test: PASS, 51/51
- npm test --prefix poc: PASS, 61/61
- verify:ui / verify:first-run / verify:schedule / verify:multimonitor / verify:sw-update: PASS
- installer/test-guards.ps1: PASS. 관리자 바로가기 대상·port fallback, fresh 기본 데이터 폴더와 이전 설치 증거 분리, fresh explicit DATADIR 허용, stale manifest fail-closed, equal/inside/reverse/dotdot 경로 guard 문구를 확인
- installer/test-install.ps1: PASS. 관리자·재생기 바로가기 생성, logon 시 재생기 미시작, 관리자 API 실행, 명시적 중지 후 미재시작, 사용자 창 닫기 후 미재시작, 재실행, 이전 서버 인스턴스/만료 명령 무시, 정상 Edge PID 검증 채택, 서버·재생기 복구, 제거 보존을 확인
- installer/test-inno.ps1: PASS (Inno Setup 6.7.3, ISCC.exe, setup SHA-256 `d65e707edce946260aca347e063aea988e4fda410b49af9c708b29713cbec270`). `/DATADIR` 명시와 임시 LOCALAPPDATA/Profile/Shortcut 경로를 사용했고 생산 `%LOCALAPPDATA%\GugakSignage`와 ProgramData 경로가 변경되지 않음을 확인
- 기본 브라우저로 관리자 페이지를 실제 여는 동작: NOT_RUN (시험 중 운영자 데스크톱에 창을 남기지 않기 위해 `-PrintOnly` 대상 판정과 바로가기 생성만 검증)

## 프로젝트 검증

| 명령 | 결과 |
|---|---|
| npm ci | PASS, 90 packages, 취약점 0 |
| npm run typecheck | PASS |
| npm run build | PASS |
| npm test | PASS, 20/20 |
| PowerShell Parser | 모든 installer .ps1 PASS |
| build-installer.ps1 -SkipInstall | PowerShell ZIP·Inno Setup EXE 생성 PASS |

## 안전 가드 회귀

installer/test-guards.ps1 결과:

- 설치 폴더와 데이터 폴더가 같은 경우: 중단 PASS
- 데이터 폴더가 설치 폴더 내부인 경우: 중단 PASS
- child\.. 정규화 후 설치 폴더와 같아진 경우: 중단 PASS
- 같은 설치·데이터 경로의 제거 요청: 중단, 기존 파일 보존 PASS
- Windows, Program Files, 사용자 문서, 사용자 홈의 -RemoveData: 중단 PASS
- 다른 프로그램 바로가기: 소유권 불일치로 변경 거부 PASS
- 다른 작업 스케줄러 항목: 소유권 불일치로 변경 거부 PASS
- PID 시작 시각 또는 실행 파일 불일치: 종료 거부 PASS

## Watchdog 회귀

- 재생 중: 현재 콘텐츠와 90초 이내 하트비트가 모두 있을 때만 정상
- 서버 단절 캐시: offline=true와 현재 콘텐츠가 있으면 정상
- 페어링·오류·대기: 프로세스 재시작 대상이 아닌 응답 상태로 분류
- 실제 재생 지연: stale heartbeat 또는 플레이어 미준비를 재시작 대상으로 분류
- 실패 한도: 3회로 줄인 시험에서 exit code 2, halted=true, 사유·구성 요소 기록
- 로그 회전: 작은 한도 시험에서 watchdog.log.1 생성 PASS
- 실패 한도 후 자동 재개: 없음, 수동 재시작만 가능 PASS

## PowerShell 설치 통합 시험

installer/test-install.ps1 결과:

| 항목 | 결과 |
|---|---|
| 신규 설치 세션 시크릿 CSPRNG·.env ACL | PASS |
| 신규 설치 테스트 관리자 비밀번호 0000 로그인 | PASS |
| 기존 .env 보존 | PASS |
| 신규 설치 SEED_SAMPLES=true | PASS |
| 업그레이드 후 데이터 경로·DB 보존 | PASS |
| 업그레이드 후 SEED_SAMPLES=false | PASS |
| 업그레이드 후 바로가기·작업 이름 보존 | PASS |
| 업그레이드 후 headless 설정 보존 | PASS |
| 명시 확인 없는 데이터 경로 변경 | 중단 PASS |
| 서버 강제 종료 후 재기동 | PASS, 3.1초 |
| 브라우저 강제 종료 후 재기동 | PASS, 4.5초 |
| 자동 실행 Disable/Enable | PASS |
| watchdog 강제 종료 시 서버 고아 없음 | PASS |
| 서버 단절 중 캐시 재생 진행 | PASS, autumn → welcome |
| 서버 복귀 후 online 전환 | PASS |
| set-autostart.ps1 -Restart 수동 복구 | PASS |
| 기본 제거 후 데이터 보존 | PASS |

## Inno Setup EXE

- 컴파일: Inno Setup 6.7.3 ISCC.exe, PASS
- EXE 크기: 5,027,769 bytes
- EXE SHA-256: 315a853422f22f54847bcf00bfb05071909ca09fd1b7e0f6ad580ca66613199b
- 설치 방식: /CURRENTUSER /VERYSILENT /HEADLESS=1, 임시 App/Data/Desktop/Start Menu/Player Profile
- 최초 설치: 테스트 비밀번호 0000 로그인, 서버 health, 실제 재생기, 바로가기, At log on 작업 PASS
- 업그레이드: /NOSTART와 /DATADIR 미지정으로 실행해 기존 install.json 경로 재사용 PASS
- 업그레이드 DB SHA-256 동일, SEED_SAMPLES=false PASS
- 기본 제거 관리자: 앱·바로가기·작업 제거 PASS
- 기본 제거 후 .env·SQLite 보존 PASS
- %ProgramFiles%\GugakSignage와 %ProgramData%\GugakSignage: 시험 전후 모두 없음, 미생성 PASS

PowerShell 이식용 ZIP SHA-256:

~~~text
09bdd25f03f4e18aa2b77797ecffbdabf6f8f135b16150eca20e71a56e167b76
~~~

## 증적

- [PowerShell 설치 시험 결과](evidence/installer-verification.json)
- [Inno Setup 설치·업그레이드·제거 결과](evidence/inno-install-verification.json)
- [PowerShell 설치 화면](evidence/installer-console.png)
- [PowerShell 설치 후 재생기](evidence/player-installed.png)
- [서버 단절 중 캐시 재생기](evidence/player-offline-installed.png)
- [Inno EXE 설치 후 재생기](evidence/player-inno-installed.png)
- [Inno 설치 로그](evidence/inno-setup-log.txt)
- [Inno 업그레이드 로그](evidence/inno-upgrade-log.txt)
- [Inno 제거 로그](evidence/inno-uninstall-log.txt)
- [Watchdog 로그](evidence/watchdog-run.txt)

증적 JSON·로그의 임시 localhost URL은 <test-url>로 치환했으며 실제 영구 설치 주소가 아닙니다. 사용자·장비 식별자도 치환했습니다. 세션 시크릿은 기록하지 않았습니다.

테스트 기간 신규 설치의 관리자 비밀번호는 0000입니다. 이는 실제 비밀값으로 취급하지 말고 설정에서 즉시 변경해야 합니다.

## 미검증 항목

- 실제 Windows 재부팅 후 자동 로그인과 At log on 실행: NOT_RUN
- 운영 기본 브라우저로 관리자 페이지를 실제 여는 동작: NOT_RUN
- 실제 현장 물리 장비와 모니터, 24시간 연속 운영: NOT_RUN
- 방화벽 규칙 생성·삭제: 시스템 설정 변경을 피해 NOT_RUN
- 프로세스는 살아 있으나 CDP renderer가 실제로 멈춘 상태의 재현: NOT_RUN

이 결과는 구현·설치·복구 기능의 로컬 증거이며 현장 무인 운영 승인을 대신하지 않습니다.
