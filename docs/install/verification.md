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

## 1차 마감 설치·실행 검증 (2026-11-25, a939443)

- 기준 main: a9394436c0485a5500789aa2c7c2d3ec3c299cd3 (PR #11 병합 후)
- 빌드: Inno Setup 6.7.3, EXE 5,049,349 bytes, SHA-256 a654e1925dd50c06798ce304358c7eb03d46a2aa5784e024557ce5eff1f11ff4 (2026-11-25 12:05:09 KST)
- 설치: 기존 per-user 설치 위에 /CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART 실행, setup exit 0
- 데이터 보존: SQLite 행 수와 contents/playlists/publications/sites/meta 해시 동일, uploads 4/4 SHA-256 동일, .env·데이터 폴더 ACL 동일, .env 값 보존(SEED_SAMPLES true→false, 개행 1바이트 감소)
- 실행: 예약 작업 수동 시작 뒤 health 200, watchdog/server 기동, 로그온 시 재생기 미실행, 관리자 화면의 실행 버튼으로만 재생기 기동
- watchdog 복구: server PID 33744 강제 종료 뒤 2초 backoff, PID 27796 재기동, 약 2.6초 내 health 200
- 관찰: watchdog-state.json의 lastServerHealthyAt는 성공 체크마다 갱신되지 않아 null/이전 값일 수 있음(비차단)
- 관리자: loopback 200, 같은 PC의 LAN IPv4 관리자 요청 403, defaultPasswordWarning=true
- NOT_RUN: 실제 재부팅·로그온, 물리 모니터/TV, 24시간 소크, 방화벽 변경, 별도 물리 PC LAN, CI, 제거
- 상세 증적: [final-install-20261125](evidence/final-install-20261125/README.md)

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

## 최신 main 배포물 저작권·라이선스 및 설치 검증 (2026-11-27 KST)

- 기준 SHA: `3dc3a2d4e3744937bb10084e4529940cc57261d9` (#31, #32 병합 후). 환경: Windows 11, Windows PowerShell 5.1, Node.js 24.22.2, npm 11.19.1, Microsoft Edge 158.0.4370.33, Inno Setup 6.7.3.
- 최신 main CI [run 45871294192](https://github.com/toxicyou25-afk/GugakSignage/actions/runs/45871294192): `npm test` 67/67, PoC 엔진 61/61, 전체 단계 성공. payload 검증은 Windows production 의존성 75개 전부의 원본 LICENSE/NOTICE 파일과 감사표 해시를 대조했고 프로젝트 LICENSE·NOTICE·의존성 목록도 확인했습니다.
- Inno Setup 설치본: 5,194,090 bytes, SHA-256 `d753f2ecd95c82f4e8e449765e3645521317edf946b8ca5dc2cf584423c1b4a7`. portable ZIP: 3,721,180 bytes, SHA-256 `8b8ae1324a731d891ef31ae5b512202aa9973ceea68f80ef33e8ed9edff09a58`. 앱 payload 867개 파일 중 별도 폰트 0, `.ico` 0, Node/Edge/Chrome 실행 파일 0이며 Node.js와 브라우저는 시스템 prerequisite입니다.
- `installer/test-inno.ps1`: 실제 Inno EXE로 설치·레거시 업그레이드·동일 버전 재업그레이드·충돌 경로 거부·제거와 데이터 보존을 확인했습니다. 결과 **38/38 PASS**, 실패 0. 운영 `%ProgramFiles%\\GugakSignage`, `%ProgramData%\\GugakSignage` 및 기존 `%LOCALAPPDATA%\\GugakSignage` 데이터 폴더는 시험 전후 변경되지 않았습니다.
- `installer/test-install.ps1`: 결과 **passed**, 실패 표시 0. legacy 데이터 경로·ACL, 설치·업그레이드·재생·오프라인 캐시·watchdog·제거 후 데이터 보존을 확인했습니다. 아래 다섯 항목은 현장/시스템 정책 때문에 **NOT_RUN**입니다.
  - 실제 현장 모니터, Windows 재부팅 및 자동 로그인, 24시간 연속 운영, 방화벽 규칙 변경, 프로세스는 살아 있으나 CDP renderer가 멈춘 장애 재현.
- Inno Setup 6.7.3 릴리스의 [LICENSE.TXT](https://github.com/jrsoftware/issrc/blob/is-6_7_3/license.txt)는 상업용 애플리케이션과 binary 재배포를 허용하며 기존 고지 보존을 요구합니다. 같은 릴리스의 [revision history](https://github.com/jrsoftware/issrc/blob/is-6_7_3/whatsnew.htm)는 상업 사용자의 라이선스 구매를 권하고, 이번 ISCC 실행 출력에는 `Non-commercial use only`가 표시됐습니다. 이 기관 배포의 상업성 분류와 별도 상용 라이선스 보유 여부는 저장소에서 확인할 수 없으므로 **상업 사용 적합성은 미확인**으로 남깁니다. 컴파일러 자체는 설치 payload에 포함되지 않습니다.
- `sample-video.mp4`의 Blender Foundation CC BY 3.0 저작권·귀속 조건은 [Test Videos](https://test-videos.co.uk/)와 [Blender 공식 안내](https://peach.blender.org/about/)로 확인했습니다. upstream이 체크섬을 제공하지 않아 저장소 파일과 게시 파일의 byte-for-byte 일치는 **NOT_VERIFIED**입니다. 기관 표장·명칭 공개 권한과 저장소 저작권 귀속 승인도 저장소만으로 확인되지 않았습니다. Docker image 및 base-image 라이선스 검사는 이번 Windows payload 범위에서 **NOT_RUN**입니다.

