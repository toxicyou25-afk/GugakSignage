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

## 현재 main 배포물 저작권·라이선스 점검 (2026-11-27)

- 기준 소스: `ed8e5ad05be158d1c50e1740c042b30774500b05` (#23 병합 후). 실행: `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File installer\build-installer.ps1 -SkipInstall`.
- Inno Setup 6.7.3 EXE 컴파일 성공. 이식용 ZIP 3,721,144 bytes, SHA-256 `ef7853d1dcee3ecf46e692cae5702a300e5cd61b5e790d9a0ce50a66db49c49b`; EXE 5,194,121 bytes, SHA-256 `8b31fe36db33f7764e2eebff27631cfa864e78d0e2b5d194d06578ea9bae5d66`.
- 빌드 중 payload 검증은 Windows production 패키지 75개 모두의 버전과 원본 LICENSE/NOTICE 해시를 감사표와 대조했습니다. payload에는 프로젝트 `LICENSE`, `NOTICE`, `docs/legal/dependency-licenses.md`도 들어 있습니다. 앱 파일 867개 중 별도 폰트 0, `.ico` 파일 0, Node/Edge/Chrome 실행 파일 0이며, seed의 포스터 PNG/SVG와 샘플 MP4는 포함됩니다.
- Node.js 24 이상과 Edge/Chrome은 시스템 설치 prerequisite이며 앱 payload에 번들되지 않습니다. 이번 테스트는 Node.js 24.22.2, Edge 158.0.4370.33을 사용했습니다.
- Inno Setup 6.7.3 공식 릴리스의 `license.txt`는 상업용 애플리케이션 생성과 binary 재배포를 허용하며, binary 내 기존 저작권·웹 주소 고지를 유지하도록 합니다. 설치 프로그램은 payload의 `NOTICE`를 `{app}`에 포함합니다. upstream은 상업 사용자의 구매를 권장하지만 license text는 이를 조건으로 요구하지 않습니다. 실제 조직의 상업 사용자 분류·구매 여부는 확인되지 않았습니다. [6.7.3 공식 license](https://github.com/jrsoftware/issrc/blob/is-6_7_3/license.txt), [commercial-use guidance](https://jrsoftware.org/inno-setup/purchase).
- `sample-video.mp4`는 991,017 bytes, SHA-256 `77145c94c11f3754207499158df22406e1fe7635553c1c86dc5e881dfeb32016`. [Test Videos](https://test-videos.co.uk/)는 이 Big Buck Bunny H.264 640×360/10초 자료를 FFmpeg transcode로 제공하고 원작과 같은 이용 조건이라고 하며 Blender 원작으로 연결합니다. [Blender 공식 라이선스/발췌물 귀속](https://peach.blender.org/about/)과 [CC BY 3.0 전문](https://creativecommons.org/licenses/by/3.0/legalcode.en)을 NOTICE와 seed/README에 연결했습니다. 원 배포자가 체크섬을 제공하지 않아 파일의 upstream bytes 일치는 검증되지 않았습니다.
- 실제 Inno `/CURRENTUSER` 설치는 서버 health와 player render까지 수행됐습니다. 전체 35개 설치·업그레이드·재설치·제거·데이터 보존 assertion은 테스트 사본에서만 shortcut 이름 기대값을 #19의 `열린안내판*.lnk`로 맞춘 뒤 통과했습니다. canonical `test-inno.ps1` 및 `test-install.ps1`의 stale shortcut 기대값 수정과 공식 harness 재실행은 #25에 남아 있습니다.
- Docker CLI가 이 실행 환경에 없어 이미지 빌드와 Debian base-image digest/고지 점검은 `NOT_RUN`입니다. 기관 공식 로고·표장 사용 승인, 저장소 자체 저작권 귀속 권한, 제품명 상표 검색은 이 저장소만으로 확인되지 않았습니다.
