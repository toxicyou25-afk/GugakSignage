@echo off
setlocal EnableExtensions
REM SPDX-License-Identifier: Apache-2.0
REM Windows fullscreen launcher for the Gugak signage player.
REM Usage: start-player.cmd [player-url]
REM Example: start-player.cmd "http://192.168.0.20:3000/player/?code=GUGAK1"

REM Use the full argument string: it keeps query strings such as ?code=GUGAK1.
set "SIGNAGE_URL=%*"
if not defined SIGNAGE_URL set "SIGNAGE_URL=%SIGNAGE_PLAYER_URL%"
if not defined SIGNAGE_URL set "SIGNAGE_URL=http://localhost:3000/player/"

set "PROFILE_DIR=%LOCALAPPDATA%\GugakSignagePlayer"
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%" >nul 2>&1

set "BROWSER_EXE="
set "BROWSER_KIND="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER_EXE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER_EXE if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if not defined BROWSER_EXE (
  echo.
  echo Microsoft Edge or Google Chrome was not found.
  echo Install a browser and run this file again.
  echo.
  pause
  exit /b 1
)

set "BROWSER_KIND=edge"
echo "%BROWSER_EXE%" | findstr /i /c:"\Google\Chrome\" >nul
if not errorlevel 1 set "BROWSER_KIND=chrome"

echo Player URL: %SIGNAGE_URL%
echo Starting the fullscreen player. Make sure the signage server is running.

REM Edge --kiosk runs InPrivate and discards localStorage/IndexedDB on exit. Use fullscreen app mode
REM for Edge so pairing and offline cache survive reboots. Chrome kiosk keeps its normal profile.
if /i "%BROWSER_KIND%"=="edge" (
  start "" "%BROWSER_EXE%" --user-data-dir="%PROFILE_DIR%" --app="%SIGNAGE_URL%" --start-fullscreen --no-first-run --no-default-browser-check --disable-features=msEdgeFirstRunExperience --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --overscroll-behavior=none --disable-pinch --disable-infobars --noerrdialogs --hide-scrollbars
) else (
  start "" "%BROWSER_EXE%" --user-data-dir="%PROFILE_DIR%" --kiosk --start-fullscreen --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --overscroll-behavior=none --disable-pinch --disable-infobars --noerrdialogs --hide-scrollbars "%SIGNAGE_URL%"
)

exit /b 0
