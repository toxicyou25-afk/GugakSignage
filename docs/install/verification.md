# Windows 설치·복구 검증 기록

- 리뷰 수정 기준 커밋: 218963ea4f01f0927f2638fa21c8e522c6409892
- 실행 일시: 2026-11-24 UTC
- 환경: Windows 26100, Windows PowerShell 5.1, Node.js v24.22.2, Microsoft Edge, Inno Setup 6.7.3
- 설치 방식: 모든 앱·데이터·프로필·바로가기 경로와 작업 이름을 임시 고유값으로 분리
- 기존 운영 위치: %ProgramFiles%\\GugakSignage와 %ProgramData%\\GugakSignage는 시험 전후 모두 없음

## 프로젝트 검증

| 명령 | 결과 |
|---|---|
| npm ci | PASS, 90 packages, 취약점 0 |
| npm run typecheck | PASS |
| npm run build | PASS |
| npm test | PASS, 15/15 |
| PowerShell Parser | 모든 installer .ps1 PASS |
| build-installer.ps1 -SkipInstall | PowerShell ZIP·Inno Setup EXE 생성 PASS |

## 안전 가드 회귀

installer/test-guards.ps1 결과:

- 설치 폴더와 데이터 폴더가 같은 경우: 중단 PASS
- 데이터 폴더가 설치 폴더 내부인 경우: 중단 PASS
- child\\.. 정규화 후 설치 폴더와 같아진 경우: 중단 PASS
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
| 신규 설치·CSPRNG 비밀값·ACL | PASS |
| 신규 설치 SEED_SAMPLES=true | PASS |
| 업그레이드 후 데이터 경로·DB 보존 | PASS |
| 업그레이드 후 SEED_SAMPLES=false | PASS |
| 업그레이드 후 바로가기·작업 이름 보존 | PASS |
| 명시 확인 없는 데이터 경로 변경 | 중단 PASS |
| 서버 강제 종료 후 재기동 | PASS, 2.6초 |
| 브라우저 강제 종료 후 재기동 | PASS, 4.5초 |
| 자동 실행 Disable/Enable | PASS |
| watchdog 강제 종료 시 서버 고아 없음 | PASS |
| 서버 단절 중 캐시 재생 진행 | PASS, autumn → welcome |
| 서버 복귀 후 online 전환 | PASS |
| set-autostart.ps1 -Restart 수동 복구 | PASS |
| 기본 제거 후 데이터 보존 | PASS |

## Inno Setup EXE

- 컴파일: Inno Setup 6.7.3 ISCC.exe, PASS
- EXE 크기: 4,994,664 bytes
- EXE SHA-256: 952ead2b0192119b8a9f9a76f560aecfd0b2679a9131b88aa7571ea6c5785981
- 설치 방식: /CURRENTUSER /VERYSILENT, 임시 App/Data/Desktop/Start Menu/Player Profile
- 최초 설치: 서버 health, 실제 재생기 화면, 바로가기, At log on 작업 PASS
- 업그레이드: /NOSTART와 /DATADIR 미지정으로 실행해 기존 install.json 경로 재사용 PASS
- 업그레이드 DB SHA-256 동일, SEED_SAMPLES=false PASS
- 기본 제거 관리자: 앱·바로가기·작업 제거 PASS
- 기본 제거 후 .env·SQLite 보존 PASS
- %ProgramFiles%\\GugakSignage와 %ProgramData%\\GugakSignage: 시험 전후 모두 없음, 미생성 PASS

PowerShell 이식용 ZIP SHA-256:

~~~text
9786815bf8bea1faddd00aac084181ae64ab4361ea2f9367a34557f1335770a3
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

증적 로그의 임시 경로와 사용자·장비 식별자는 공개 저장소를 위해 치환했습니다. 관리자 비밀번호와 세션 시크릿은 기록하지 않았습니다.

## 미검증 항목

- 실제 Windows 재부팅 후 자동 로그인과 At log on 실행: NOT_RUN
- 실제 현장 물리 장비와 모니터, 24시간 연속 운영: NOT_RUN
- 방화벽 규칙 생성·삭제: 시스템 설정 변경을 피해 NOT_RUN
- 프로세스는 살아 있으나 CDP renderer가 실제로 멈춘 상태의 재현: NOT_RUN

이 결과는 구현·설치·복구 기능의 로컬 증거이며 현장 무인 운영 승인을 대신하지 않습니다.
