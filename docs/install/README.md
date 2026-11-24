# Windows 설치·무인 운영 안내

이 문서는 현장 Windows PC에서 GugakSignage 서버와 전체 화면 재생기를 함께 설치하고, 로그인 후 자동 실행하며, 장애 시 복구하는 절차를 설명합니다.

## 준비 사항

- Windows 10/11 또는 Windows Server
- Node.js 24 이상
- Microsoft Edge 또는 Google Chrome
- 관리자 권한: Inno Setup 설치, %ProgramFiles% 설치, 방화벽 규칙 생성에 필요
- 무인 재부팅 운영: Windows 자동 로그인 또는 조직의 키오스크 로그인 정책

설치 프로그램은 Node.js를 자동 설치하지 않습니다. Node.js가 없거나 24 미만이면 명확한 오류를 기록하고 중단합니다.

## 설치 방법

### 1. PowerShell 설치 패키지

개발 저장소에서 패키지를 만들려면 저장소 루트에서 실행합니다.

~~~powershell
.\installer\build-installer.ps1
~~~

생성되는 주요 파일:

- installer\build\GugakSignage-Portable-0.1.0.zip
- installer\build\GugakSignage-Portable-0.1.0.zip.sha256
- Inno Setup이 설치되어 있으면 installer\build\inno\GugakSignage-Setup-0.1.0.exe

ZIP을 풀고 설치합니다.

~~~powershell
.\installer\install.ps1
~~~

관리자 PowerShell에서는 기본 설치 폴더가 %ProgramFiles%\GugakSignage, 데이터 폴더가 %ProgramData%\GugakSignage입니다. 일반 PowerShell에서는 현재 사용자 범위의 %LOCALAPPDATA%\Programs\GugakSignage와 %LOCALAPPDATA%\GugakSignage를 사용합니다.

설치 폴더와 데이터 폴더를 명시할 수 있습니다.

~~~powershell
.\installer\install.ps1 -InstallDir "D:\GugakSignage\app" -DataDir "D:\GugakSignage\data" -Port 3000
~~~

LAN의 다른 PC에서 접속하려면 관리자 PowerShell에서 방화벽 규칙을 선택적으로 추가합니다.

~~~powershell
.\installer\install.ps1 -OpenFirewall
~~~

방화벽 규칙은 TCP 서버 포트, 설치된 Node 실행 파일, Private/Domain 프로필로 제한됩니다. 기존에 같은 표시 이름의 다른 규칙이 있으면 덮어쓰지 않고 중단합니다.

### 2. Inno Setup 설치 프로그램

build-installer.ps1가 Inno Setup 6 ISCC.exe를 찾으면 다음 파일을 컴파일합니다.

- installer\GugakSignage.iss
- installer\build\inno\GugakSignage-Setup-0.1.0.exe

Inno Setup 화면에서 설치 폴더, 데이터 폴더, 포트를 선택할 수 있습니다. 방화벽 작업은 선택 사항이며 기본값은 꺼짐입니다. 설치 후 PowerShell 설치 스크립트를 구성 모드로 실행해 환경 파일, 바로가기, 자동 실행 작업을 만듭니다.

## 설치 결과

- 서버 파일: 설치 폴더의 dist, public, seed, node_modules
- 운영 도구: 설치 폴더의 ops, tools
- 데이터: 기본 %ProgramData%\GugakSignage
- SQLite 데이터베이스: 데이터 폴더의 signage.sqlite
- 업로드 파일: 데이터 폴더의 uploads
- 환경 파일: 데이터 폴더의 .env
- 바탕화면: GugakSignage.lnk
- 시작 메뉴: GugakSignage\GugakSignage.lnk

서버는 0.0.0.0에서 수신합니다. 같은 PC 관리자 화면은 http://127.0.0.1:<포트>/admin/, 재생기는 http://127.0.0.1:<포트>/player/입니다. 초기 재생 URL은 샘플 기기 코드 GUGAK1과 reconnect=1을 사용합니다. reconnect=1은 전용 재생기 프로필의 저장 정보가 브라우저 강제 종료 중 유실되면 15초 간격으로 같은 코드의 연결을 자동 복구하라는 설치 기본값입니다.

## 비밀번호와 세션 시크릿

새 설치에서 다음 값을 암호학적 난수로 생성합니다.

- ADMIN_PASSWORD: 관리자 로그인 비밀번호
- SESSION_SECRET: 세션 쿠키 서명 키

설치 로그에는 값을 출력하지 않습니다. 초기 비밀번호는 데이터 폴더의 .env에서 확인합니다.

~~~powershell
$envFile = Join-Path $env:ProgramData "GugakSignage\.env"
Get-Content $envFile | Select-String '^ADMIN_PASSWORD='
~~~

환경 파일은 설치 시 ACL을 상속 해제하고 현재 사용자, SYSTEM, Administrators에만 권한을 줍니다. 설치 후 관리자 화면에서 비밀번호를 바꾸면 .env 값도 운영 절차에 맞춰 갱신해야 합니다. .env, 로그, 데이터베이스, 업로드 파일은 Git에 커밋하지 않습니다.

기존 데이터 폴더의 .env가 있으면 재설치 시 덮어쓰지 않습니다. 기존 파일에 개발용 기본 비밀번호가 남아 있다면 운영 전에 반드시 교체합니다.

## 자동 실행 방식

자동 실행은 Windows 작업 스케줄러의 현재 사용자 **At log on** 작업으로 등록합니다. 작업 이름은 기본 GugakSignage-Watchdog입니다.

선택 근거:

- 시작프로그램 폴더보다 실행 실패 기록, 지연 시작, 중복 실행 제한, 수동 제어가 명확합니다.
- 작업 스케줄러는 숨김 실행과 시작 시각 지연을 지원합니다.
- 현재 사용자 대화형 토큰으로 실행하므로 Windows 비밀번호를 작업에 저장하지 않습니다.
- 관리자 권한은 최소화하고 재생기의 사용자 프로필과 브라우저 캐시를 그대로 사용합니다.

이 방식은 사용자 로그인 후 실행됩니다. 재부팅 뒤 로그인 화면에서 멈추지 않고 현장 화면까지 자동 진행하려면 Windows 자동 로그인 또는 키오스크 계정 정책을 별도로 설정해야 합니다. 자동 로그인 암호를 저장소나 설치 로그에 기록하지 마세요.

자동 실행 상태 확인:

~~~powershell
& "C:\Program Files\GugakSignage\tools\set-autostart.ps1" -Status
~~~

자동 실행 끄기와 현재 프로세스 중지:

~~~powershell
& "C:\Program Files\GugakSignage\tools\set-autostart.ps1" -Disable
~~~

다시 켜기:

~~~powershell
& "C:\Program Files\GugakSignage\tools\set-autostart.ps1" -Enable
~~~

바로가기를 직접 누르면 자동 실행이 꺼져 있어도 수동으로 시작할 수 있습니다.

## Watchdog과 장애 복구

watchdog은 Node 프로세스로 실행되며 서버와 브라우저를 자식 프로세스로 관리합니다.

### 서버

- 5초마다 http://127.0.0.1:<포트>/api/health를 확인합니다.
- 프로세스가 종료되면 자동 재시작합니다.
- 프로세스는 살아 있지만 상태 확인이 3회 연속 실패하면 해당 프로세스 트리를 종료하고 재시작합니다.
- 재시작 간격은 2초부터 지수 백오프로 늘어나 최대 60초입니다.
- 8회 연속 실패하면 5분 냉각 후 다시 시도합니다.
- 60초 동안 정상이면 실패 횟수를 초기화합니다.

### 재생기

- Edge는 앱 모드, Chrome은 키오스크 모드로 실행합니다.
- 고유 사용자 프로필을 유지하므로 기기 연결 정보, 서비스 워커, IndexedDB 캐시가 재시작 뒤에도 남습니다.
- 프로세스 종료를 감지하면 재실행합니다.
- 로컬 Chrome DevTools Protocol로 플레이어 페이지의 window.__signagePlayer.getState()에 질의합니다. 프로세스만 살아 있고 페이지가 응답하지 않으면 2회 연속 실패 후 해당 브라우저 프로세스 트리를 재시작합니다.
- 브라우저 재시작도 3초부터 지수 백오프를 사용하고, 8회 연속 실패 시 5분 냉각합니다.

### 서버 연결 단절

watchdog은 서버가 죽었다고 브라우저를 종료하지 않습니다. 플레이어는 기존 서비스 워커와 IndexedDB 캐시에서 마지막 정상 매니페스트와 미디어를 계속 재생합니다. 서버가 복구되면 기존 15초 폴링과 하트비트가 다시 연결되고 새 매니페스트를 적용합니다.

## 로그와 진단

기본 데이터 폴더 기준:

- 설치: %ProgramData%\GugakSignage\logs\install-YYYYMMDD-HHMMSS.log
- 제거: %ProgramData%\GugakSignage\logs\uninstall-YYYYMMDD-HHMMSS.log
- watchdog: %ProgramData%\GugakSignage\logs\watchdog.log
- 서버 표준 출력: %ProgramData%\GugakSignage\logs\server.stdout.log
- 서버 표준 오류: %ProgramData%\GugakSignage\logs\server.stderr.log
- 프로세스 상태: %ProgramData%\GugakSignage\logs\watchdog-state.json
- 로그 잠금: %ProgramData%\GugakSignage\logs\watchdog.lock
- Inno Setup 로그: 설치 관리자가 표시한 %TEMP%\Setup Log ...

로그는 시작 시 5 MiB를 넘으면 .1 파일로 한 번 회전합니다. 비밀번호, 세션 시크릿, 플레이어 토큰은 기록하지 않습니다.

기본 진단:

~~~powershell
$logs = Join-Path $env:ProgramData "GugakSignage\logs"
Get-Content (Join-Path $logs "watchdog.log") -Tail 80
Get-Content (Join-Path $logs "server.stderr.log") -Tail 80
Get-Content (Join-Path $logs "watchdog-state.json")
Invoke-RestMethod "http://127.0.0.1:3000/api/health"
~~~

작업 상태:

~~~powershell
Get-ScheduledTask -TaskName "GugakSignage-Watchdog"
Get-ScheduledTaskInfo -TaskName "GugakSignage-Watchdog"
~~~

## 복구 절차

1. 서버가 응답하지 않으면 watchdog.log와 server.stderr.log를 확인합니다.
2. 포트 충돌이면 .env의 PORT와 방화벽 규칙을 확인합니다.
3. Node.js가 제거되었거나 경로가 바뀌었으면 Node.js 24 이상을 복구하고 installer\install.ps1 -ConfigureOnly를 다시 실행합니다.
4. 재생기 화면이 검거나 멈추면 ops\stop.ps1 실행 후 바탕화면 바로가기를 누릅니다.
5. 기기 연결이 풀렸으면 관리자 화면의 기기 등록 코드로 다시 연결합니다. 오프라인 중에는 저장된 캐시 콘텐츠가 계속 재생됩니다.
6. 반복 장애로 5분 냉각에 들어가면 로그의 circuitBreaker 항목을 확인하고 원인을 먼저 고칩니다.

## 제거

기본 제거는 사용자 데이터를 보존합니다.

~~~powershell
& "C:\Program Files\GugakSignage\tools\uninstall.ps1"
~~~

제거 작업:

- 자동 실행 작업 제거
- 현재 watchdog, 서버, 재생기 프로세스 종료
- 설치 프로그램이 만든 정확한 바로가기만 제거
- 이 설치 프로그램이 만든 방화벽 규칙만 제거
- 설치 파일 제거
- 데이터 폴더 보존

데이터 폴더까지 지우려는 경우에만 명시적으로 실행합니다. 이 작업은 복구할 수 없습니다.

~~~powershell
& "C:\Program Files\GugakSignage\tools\uninstall.ps1" -RemoveData
~~~

Inno Setup 제거 관리자는 uninstall.ps1 -InnoUninstall을 호출해 작업과 서비스를 정리하고, 데이터 폴더는 삭제하지 않습니다.

## 검증 범위

로컬 설치, 바로가기, 작업 스케줄러, 서버 기동, watchdog 복구, 제거 보존 검증 결과는 [검증 기록](verification.md)에 기록합니다. 실제 현장 물리 장비, 실제 재부팅, 실제 무인 로그인, 장시간 24시간 시험은 별도 승인과 장비에서 수행해야 합니다.
