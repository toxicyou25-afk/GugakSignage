# Windows 설치·무인 운영 안내

이 문서는 현장 Windows PC에서 열린안내판 서버를 설치하고, 로그인 후 관리자 페이지를 기본으로 열며, 관리자 버튼으로 재생기를 실행·중지하고 장애 시 복구하는 절차를 설명합니다.

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

데이터 폴더는 정규화 후 설치 폴더와 같거나 설치 폴더 안에 있을 수 없습니다. 경로의 대소문자, 후행 구분자, ..를 해석한 뒤 비교하며 위반 시 파일 복사 전에 중단합니다.

기존 설치의 데이터 경로는 install.json 또는 레거시 설치 폴더의 .env에서 먼저 읽습니다. 기존 경로와 다른 데이터 폴더를 명시하면 새 빈 데이터베이스가 생길 수 있으므로 기본적으로 중단합니다. 운영자가 기존 데이터를 옮기지 않은 상태에서 새 경로를 의도한 경우에만 다음처럼 명시합니다.

install.json도 InstallDir\.env도 없는 새 설치에서는 기본 데이터 폴더에 기존 파일이 있더라도 이를 이전 설치 증거로 간주하지 않습니다. 이때 `/DATADIR` 또는 `-DataDir`로 새 경로를 명시하면 기존 기본 데이터를 변경하지 않고 새 데이터 폴더에 설치하며, 새 데이터 폴더에는 신규 설치 샘플 시드 규칙을 적용합니다. 반대로 install.json이 있으나 기록된 데이터 경로가 사라진 경우와 InstallDir\.env의 경로가 없는 경우는 계속 fail-closed로 중단합니다.

~~~powershell
.\installer\install.ps1 -DataDir "E:\새로운\데이터" -AllowDataDirChange
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

Inno Setup 화면에서 설치 폴더, 데이터 폴더, 포트를 선택할 수 있습니다. 업그레이드에서는 기존 install.json의 데이터 경로를 다시 읽어 기본값으로 채우며, 데이터 폴더를 바꾸려면 기존 데이터가 자동 이전되지 않는다는 확인 대화상자를 통과해야 합니다. 방화벽 작업은 선택 사항이며 기본값은 꺼짐입니다. 설치 후 PowerShell 설치 스크립트를 구성 모드로 실행해 환경 파일, 바로가기, 자동 실행 작업을 만듭니다.

## 설치 결과

- 서버 파일: 설치 폴더의 dist, public, poc\packages\engine, seed, node_modules
- 운영 도구: 설치 폴더의 ops, tools
- 데이터: 기본 %ProgramData%\GugakSignage
- SQLite 데이터베이스: 데이터 폴더의 signage.sqlite
- 업로드 파일: 데이터 폴더의 uploads
- 환경 파일: 데이터 폴더의 .env
- 바탕화면: 열린안내판.lnk
- 시작 메뉴: 열린안내판\열린안내판.lnk (기존 설치의 그룹 경로는 유지될 수 있음)
- 바탕화면·시작 메뉴: 열린안내판 관리자.lnk
- 관리자 실행 도구: 설치 폴더의 ops\open-admin.ps1, ops\admin-launch.vbs

신규 설치만 SEED_SAMPLES=true로 시작합니다. 기존 데이터베이스나 설치 정보가 감지되면 SEED_SAMPLES=false로 생성하거나 기존 .env의 해당 값을 비활성화합니다.

서버는 0.0.0.0에서 수신합니다. 같은 PC 관리자 화면은 http://127.0.0.1:<포트>/admin/, 재생기 미리보기·직접 URL은 http://127.0.0.1:<포트>/player/입니다. 샘플 기기의 직접 재생 URL은 GUGAK1과 reconnect=1을 사용합니다. reconnect=1은 전용 재생기 프로필의 저장 정보가 브라우저 강제 종료 중 유실되면 15초 간격으로 같은 코드의 연결을 자동 복구하라는 플레이어 기본값입니다. 설치본의 일반 실행은 관리자 화면의 **재생기 실행** 버튼을 사용합니다.

**열린안내판 관리자** 바로가기는 기본 브라우저로 관리자 페이지를 엽니다. 포트는 설치 폴더의 `install.json`에서 읽고, 파일이 없거나 포트가 잘못되었으면 3000을 사용합니다. 바로가기 아이콘은 설치 시 찾은 Edge/Chrome 아이콘을 사용합니다. 바로가기는 `wscript.exe`로 `ops\admin-launch.vbs`를 실행하고, 그 스크립트가 `ops\open-admin.ps1`에 URL 열기를 맡깁니다. 관리자 권한 상승은 요청하지 않습니다. `install.json`에는 기존 재생기용 `shortcuts`와 별도로 `adminShortcuts`가 기록되며, 업그레이드와 제거도 이 경로를 보존·정리합니다.

## 관리자 기본 창과 재생기 실행

관리자 페이지가 프로그램의 기본 화면입니다. 로그온 자동 실행에서 watchdog은 서버가 준비되면 기본 브라우저의 일반 창으로 관리자 페이지를 엽니다. 전체화면 재생기는 자동으로 시작하지 않습니다. 관리자 자동 열기는 watchdog 프로세스마다 최대 한 번이며 서버 상태 확인 주기마다 반복하지 않습니다.

`install.json`의 `adminAutoOpen.enabled`가 관리자 자동 열기 설정입니다. 기본값은 켜짐이며 headless 설치(`/HEADLESS=1` 또는 `-HeadlessBrowser`)와 CI는 자동으로 끕니다. 무인 설치에서 끄려면 설치 스크립트에 `-NoAdminAutoOpen`을 추가하고, 다시 켜려면 `-OpenAdminOnStartup`을 사용합니다. 이 설정은 서버와 자동 실행 작업을 그대로 유지합니다.

재생기는 관리자 대시보드나 **기기** 카드의 **재생기 실행** 버튼을 눌렀을 때만 새 Edge 앱 창/전체화면으로 시작합니다. 버튼은 관리자 전용 `POST /api/player/launch`에 기기 ID를 보내고, 서버는 `data\control\player-command.json`에 로컬 제어 요청을 기록합니다. watchdog이 그 요청을 받아 설치된 Edge, 전용 프로필, 디버그 포트와 기기 코드로 재생기를 실행하고 `data\control\player-state.json`에 desired/running/PID/시작 시각/기기 정보를 기록합니다. 서버는 `GET /api/player/state`로 같은 상태를 관리자 화면에 제공합니다. **중지**는 `POST /api/player/stop`으로 처리합니다.

재생기 창을 사용자가 닫으면 watchdog은 실행 의도를 `stopped`로 바꾸고 자동 재실행하지 않습니다. 예기치 않은 비정상 종료만, 마지막 실행 의도가 `running`일 때 제한적으로 복구합니다. watchdog 재시작이나 로그온은 재생기를 새로 띄우지 않습니다. 이미 살아 있는 재생기 프로세스는 상태와 PID를 확인해 이어서 감시할 수 있습니다. 원격 관리자의 실행 버튼도 서버 PC의 Edge 창을 제어하며, 0000 테스트 비밀번호 상태에서는 기존 loopback 관리 제한을 그대로 적용합니다.

관리자 대시보드의 **현재 송출** 카드는 재생기가 꺼져 있어도 각 기기의 배정 재생목록과 마지막 게시본을 기준으로 표시할 활성 항목을 보여 줍니다. 각 항목에는 썸네일, 이름, 표시 시간, fit, 순서가 표시되고 재생 중일 때 `playerState`의 `playing:<contentId>`와 일치하는 항목은 **지금 화면**으로 강조됩니다. 게시 버전·시각, 마지막 오류, **재생기 실행**과 **미리보기** 버튼도 같은 카드에서 확인합니다. 샘플 콘텐츠만 있거나 아직 사용자 게시가 없으면 **지금은 샘플 콘텐츠가 표시 중입니다. 내 이미지를 올리고 재생목록을 게시하세요.** 배너와 콘텐츠·재생목록·기기 버튼이 나타납니다. 대시보드의 4단계 안내는 콘텐츠, 기기, 재생목록, 게시 화면으로 이동하는 링크입니다.

## 비밀번호와 세션 시크릿

테스트 기간 새 설치에서 다음 값을 설정합니다.

- ADMIN_PASSWORD: 테스트 기본 비밀번호 0000 — 실제 비밀값으로 취급하지 말고 설정에서 즉시 변경
- SESSION_SECRET: 암호학적 난수로 생성하는 세션 쿠키 서명 키

설치 로그에는 세션 시크릿을 출력하지 않습니다. 관리자 비밀번호가 0000이면 설치 로그에 경고를 남깁니다. 초기 값은 데이터 폴더의 .env에서 확인할 수 있습니다.

~~~powershell
$envFile = Join-Path $env:ProgramData "GugakSignage\.env"
Get-Content $envFile | Select-String '^ADMIN_PASSWORD='
~~~

환경 파일은 설치 시 ACL을 상속 해제하고 현재 사용자, SYSTEM, Administrators에만 권한을 줍니다. 설치 후 관리자 화면에서 비밀번호를 바꾸면 .env 값도 운영 절차에 맞춰 갱신해야 합니다. .env, 로그, 데이터베이스, 업로드 파일은 Git에 커밋하지 않습니다.

기존 데이터 폴더의 .env가 있으면 재설치 시 덮어쓰지 않습니다. 기존 파일에 gugak1234 같은 개발용 기본 비밀번호가 남아 있다면 운영 전에 반드시 교체합니다. 새 설치의 0000도 현장 사용 전에 반드시 변경해야 합니다.

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

실패 한도로 watchdog 자동 재시작이 멈췄거나 운영자가 프로세스를 새로 시작하려면 수동 재시작을 사용합니다.

~~~powershell
& "C:\Program Files\GugakSignage\tools\set-autostart.ps1" -Restart
~~~

재생기 바로가기를 직접 누르면 자동 실행이 꺼져 있어도 watchdog과 관리자 페이지를 수동으로 시작할 수 있습니다. 재생기 창은 관리자 페이지의 **재생기 실행**으로 시작합니다.

## Watchdog과 장애 복구

watchdog은 Node 프로세스로 실행되며 서버를 관리하고, 관리자 실행 요청이 있을 때만 재생기 브라우저를 자식 프로세스로 관리합니다.

### 서버

- 5초마다 http://127.0.0.1:<포트>/api/health를 확인합니다.
- 프로세스가 종료되면 자동 재시작합니다.
- 시작 후 120초 동안은 느린 기동을 허용합니다. 그 뒤 상태 확인이 5회 연속 실패하면 해당 프로세스 트리를 종료하고 재시작합니다.
- 재시작 간격은 2초부터 지수 백오프로 늘어나 최대 60초입니다.
- 8회 연속 실패하면 자동 재시작을 완전히 중단하고 halted=true, 사유, 구성 요소를 상태 파일과 CRITICAL 로그에 남깁니다. 이후에는 set-autostart.ps1 -Restart 또는 바로가기로 수동 재시작해야 합니다.
- 60초 동안 정상이면 실패 횟수를 초기화합니다.

### 재생기

- 로그온과 watchdog 시작만으로는 브라우저를 시작하지 않습니다. 관리자 실행 요청을 받은 뒤에만 시작합니다.
- Edge는 앱 모드, Chrome은 키오스크 모드로 실행합니다.
- 고유 사용자 프로필을 유지하므로 기기 연결 정보, 서비스 워커, IndexedDB 캐시가 재시작 뒤에도 남습니다.
- 사용자가 창을 닫아 프로세스가 정상 종료되면 실행 의도를 stopped로 바꾸고 재실행하지 않습니다. 비정상 종료이고 마지막 의도가 running일 때만 제한적으로 복구합니다.
- 로컬 Chrome DevTools Protocol로 플레이어 페이지의 window.__signagePlayer.getState()에 질의합니다. 재생 중에는 현재 콘텐츠 ID와 최근 90초 이내 하트비트가 모두 있어야 정상으로 봅니다. 서버 단절 중에는 offline=true와 현재 콘텐츠가 있는 캐시 재생을 정상으로 봅니다.
- 페어링 대기, 연결 대기, 오류 화면은 CDP 응답 상태로는 기록하지만 정상 재생으로 판정하지 않습니다. 이런 화면 때문에 프로세스를 반복 재시작하지 않습니다.
- 시작 후 120초 동안은 페이지 로딩을 허용합니다. 그 뒤 플레이어 페이지가 사라졌으면 사용자 종료로 보고 실행 의도를 stopped로 바꿉니다. CDP 응답 또는 실제 재생 상태가 3회 연속 실패하면 실행 의도가 running인 경우에만 브라우저 프로세스 트리를 재시작합니다.
- 브라우저 재시작도 3초부터 지수 백오프를 사용하고, 8회 연속 실패 시 서버와 같은 방식으로 수동 복구 상태가 됩니다.

### 서버 연결 단절

watchdog은 서버가 죽었다고 브라우저를 종료하지 않습니다. 플레이어는 기존 서비스 워커와 IndexedDB 캐시에서 마지막 정상 매니페스트와 미디어를 계속 재생합니다. 서버가 복구되면 기존 15초 폴링과 하트비트가 다시 연결되고 새 매니페스트를 적용합니다.

watchdog 자신은 강제 종료될 수 있으므로 브라우저는 detached로 유지하지만 서버는 watchdog과 같은 프로세스 수명으로 실행합니다. 새 watchdog은 살아 있는 재생기 PID와 상태를 확인해 이어서 감시할 수 있지만, 죽어 있는 재생기를 로그온 시 자동으로 다시 열지는 않습니다. 정상 중지와 실패 한도 중단은 자식 프로세스를 검증 후 정리하며, watchdog 강제 종료 뒤 남은 서버 고아 프로세스가 생기지 않게 합니다.

## 로그와 진단

기본 데이터 폴더 기준:

- 설치: %ProgramData%\GugakSignage\logs\install-YYYYMMDD-HHMMSS.log
- 제거: %ProgramData%\GugakSignage\logs\uninstall-YYYYMMDD-HHMMSS.log
- watchdog: %ProgramData%\GugakSignage\logs\watchdog.log
- 서버 표준 출력: %ProgramData%\GugakSignage\logs\server.stdout.log
- 서버 표준 오류: %ProgramData%\GugakSignage\logs\server.stderr.log
- 프로세스 상태: %ProgramData%\GugakSignage\logs\watchdog-state.json
- 재생기 제어 상태: %ProgramData%\GugakSignage\control\player-state.json
- 재생기 실행 요청: %ProgramData%\GugakSignage\control\player-command.json
- 로그 잠금: %ProgramData%\GugakSignage\logs\watchdog.lock
- Inno Setup 로그: 설치 관리자가 표시한 %TEMP%\Setup Log ...

각 로그는 장기 실행 중에도 5 MiB를 넘을 때 즉시 .1로 회전합니다. 회전 파일은 하나만 유지합니다. 비밀번호, 세션 시크릿, 플레이어 토큰은 기록하지 않습니다.

기본 진단:

~~~powershell
$logs = Join-Path $env:ProgramData "GugakSignage\logs"
Get-Content (Join-Path $logs "watchdog.log") -Tail 80
Get-Content (Join-Path $logs "server.stderr.log") -Tail 80
Get-Content (Join-Path $logs "watchdog-state.json")
Get-Content (Join-Path $env:ProgramData "GugakSignage\control\player-state.json")
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
4. 재생기 화면이 검거나 멈추면 관리자 페이지의 **중지**를 누른 뒤 다시 **재생기 실행**을 누릅니다. watchdog 복구가 필요하면 set-autostart.ps1 -Restart를 실행하며, 재시작 뒤에는 관리자 페이지가 열리고 재생기는 버튼을 기다립니다.
5. 기기 연결이 풀렸으면 관리자 화면의 기기 등록 코드로 다시 연결합니다. 오프라인 중에는 저장된 캐시 콘텐츠가 계속 재생됩니다.
6. watchdog-state.json의 halted=true이면 haltedReason과 CRITICAL 로그를 확인하고 원인을 고친 뒤 set-autostart.ps1 -Restart를 실행합니다.

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

제거 도구는 PID만 보고 프로세스를 종료하지 않습니다. 상태 파일의 실행 파일 경로, 시작 시각, 명령행, 설치 경로를 모두 확인한 프로세스만 종료하며 taskkill 실패는 오류로 처리합니다. 기존 작업 스케줄러 항목과 바로가기도 GugakSignage 소유 표식이 맞을 때만 제거합니다.

데이터 폴더까지 지우려는 경우에만 명시적으로 실행합니다. 이 작업은 복구할 수 없습니다.

~~~powershell
& "C:\Program Files\GugakSignage\tools\uninstall.ps1" -RemoveData
~~~

-RemoveData는 드라이브 루트, Windows/Program Files, 사용자 문서·홈, AppData 기준 폴더, 임시 폴더, 너무 얕은 경로를 거부합니다. 설치 폴더 또는 재생기 프로필과 겹치는 데이터 경로도 삭제하지 않습니다.

Inno Setup 제거 관리자는 uninstall.ps1 -InnoUninstall을 호출해 작업과 서비스를 정리하고, 데이터 폴더는 삭제하지 않습니다.

## 검증 범위

로컬 설치, 바로가기, 작업 스케줄러, 서버 기동, watchdog 복구, 제거 보존 검증 결과는 [검증 기록](verification.md)에 기록합니다. 실제 현장 물리 장비, 실제 재부팅, 실제 무인 로그인, 장시간 24시간 시험은 별도 승인과 장비에서 수행해야 합니다.

자동 검증은 격리된 브라우저 프로필을 사용하고, 테스트 중에는 headless 모드를 선택해 운영자 데스크톱에 재생기 창을 남기지 않습니다. 운영 설치의 기본값은 실제 전체 화면 재생을 위해 headless가 아닙니다. 증적의 임시 localhost URL은 test-url 표식으로 치환합니다.
