# Windows 설치·복구 검증 기록

- 기준 커밋: cfc8e739b370eae855c858e8066e94843e91b602
- 실행 일시: 2026-11-24 UTC
- 환경: Windows 26100, Windows PowerShell 5.1, Node.js v24.22.2, Microsoft Edge
- 설치 방식: installer\test-install.ps1가 installer\install.ps1을 별도 임시 경로에서 실행
- 테스트 범위: 앱, 데이터, 프로필, 바탕화면, 시작 메뉴를 모두 임시 폴더로 분리하고 고유한 작업 스케줄러 이름 사용

## 프로젝트 검증

| 명령 | 결과 |
|---|---|
| npm ci | 통과, 90 packages, 취약점 0 |
| npm run typecheck | 통과 |
| npm run build | 통과 |
| npm test | 12/12 통과 |
| installer\build-installer.ps1 -SkipInstall -SkipCompile | 이식용 ZIP 생성 성공 |

이식용 ZIP은 생성됐지만, 이 PC에 Inno Setup 6 ISCC.exe가 없어 GugakSignage.iss를 EXE로 컴파일하지 못했습니다. 따라서 Inno Setup 설치 EXE의 실행 검증은 **NOT_RUN**입니다.

생성된 GugakSignage-Portable-0.1.0.zip의 SHA-256은 4a3e44948a4c13e6f1b70203056609715b5d88e85169ddb05dd766b42606b86e입니다. 빌드 산출물은 .gitignore로 제외하고 PR에는 재생성 명령과 해시를 기록합니다.

## 실제 임시 설치

설치 스크립트가 정상 종료했고 다음 항목을 확인했습니다.

- Node.js 24 이상과 Edge 확인
- 서버 파일, 운영 스크립트, 프로덕션 의존성 복사
- 데이터 폴더와 .env 생성
- 암호학적 난수로 관리자 비밀번호와 세션 시크릿 생성
- 개발용 기본 비밀값 미사용
- .env ACL 상속 차단 및 현재 사용자/SYSTEM/Administrators 권한 적용
- 바탕화면과 시작 메뉴 바로가기 생성
- At log on 작업 스케줄러 등록
- 서버 상태 확인
- 설치 로그와 watchdog 로그 생성

## Watchdog 시험

| 시험 | 관찰 결과 |
|---|---|
| 서버 프로세스 강제 종료 | 2.6초 후 새 PID로 기동, HTTP health 정상 |
| 브라우저 프로세스 강제 종료 | 4.8초 후 새 PID로 기동, 플레이어 온라인 유지 |
| 자동 실행 끄기 | 작업 Disabled, 서버 프로세스 종료 |
| 자동 실행 다시 켜기 | 새 watchdog 기동, 서버 health 정상 |
| watchdog과 서버 종료 후 서버 단절 재생 | offline=true, 마지막 캐시에서 autumn → welcome으로 재생 위치 진행 |
| 서버 복구 | 기존 브라우저를 인수하고 video-bbb 재생 중 online=true로 복귀 |
| 기본 제거 | 앱 폴더·바로가기·작업 제거, .env와 SQLite 데이터 보존 |

Watchdog은 자식 프로세스를 detached로 실행해 자신이 비정상 종료되어도 서버와 재생기가 마지막 콘텐츠를 유지하게 했습니다. 새 watchdog은 기존 브라우저의 CDP 상태를 확인해 같은 프로세스를 인수합니다.

## 증적

- [설치 스크립트 실행 화면](evidence/installer-console.png)
- [설치 후 재생기](evidence/player-installed.png)
- [서버 단절 중 오프라인 재생기](evidence/player-offline-installed.png)
- [기계 판독 가능한 시험 결과](evidence/installer-verification.json)
- [전체 시험 transcript](evidence/verification-run.txt)
- [설치 로그](evidence/installer-run.txt)
- [Watchdog 로그](evidence/watchdog-run.txt)
- [제거 로그](evidence/uninstaller-run.txt)

증적 로그의 임시 경로와 사용자·장비 식별자는 공개 저장소를 위해 치환했습니다. 관리자 비밀번호와 세션 시크릿은 로그에 기록하지 않았습니다.

## 미검증 항목

- 실제 Windows 재부팅 후 자동 로그인과 At log on 실행: **NOT_RUN**
- 실제 현장 물리 장비와 모니터, 장시간 24시간 운영: **NOT_RUN**
- 방화벽 규칙 생성/삭제: 시스템 설정 변경을 피하기 위해 **NOT_RUN**
- Inno Setup EXE 컴파일과 마법사 설치: ISCC.exe 부재로 **NOT_RUN**
- 하드웨어 그래픽 드라이버별 영상 장시간 재생: **NOT_RUN**

이 로컬 결과는 설치·복구 기능의 구현 증거이며, 현장 무인 운영 승인을 대신하지 않습니다.
