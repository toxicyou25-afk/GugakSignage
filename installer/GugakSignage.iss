; SPDX-License-Identifier: Apache-2.0
; Build installer\build\payload with build-installer.ps1 before compiling.

#define MyAppName "GugakSignage"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "GugakSignage contributors"

[Setup]
AppId={{8E862C71-0C8D-4F00-9AA4-75C6A03E5F18}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\GugakSignage
DefaultGroupName=GugakSignage
DisableProgramGroupPage=yes
OutputDir=build\inno
OutputBaseFilename=GugakSignage-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
RestartApplications=no
SetupLogging=yes
Uninstallable=yes

[Tasks]
Name: "firewall"; Description: "Allow local network clients through Windows Firewall"; GroupDescription: "Network:"; Flags: unchecked

[Files]
Source: "build\payload\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "ops\*"; DestDir: "{app}\ops"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "install.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "uninstall.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "set-autostart.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "..\docs\install\README.md"; DestDir: "{app}\docs"; Flags: ignoreversion

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\install.ps1"" -ConfigureOnly -InstallDir ""{app}"" -DataDir ""{code:GetDataDir}"" -Port {code:GetPort} -TaskName ""GugakSignage-Watchdog"""; StatusMsg: "Configuring GugakSignage services..."; Flags: waituntilterminated; Tasks: not firewall
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\install.ps1"" -ConfigureOnly -InstallDir ""{app}"" -DataDir ""{code:GetDataDir}"" -Port {code:GetPort} -TaskName ""GugakSignage-Watchdog"" -OpenFirewall"; StatusMsg: "Configuring GugakSignage services and firewall..."; Flags: waituntilterminated; Tasks: firewall

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\uninstall.ps1"" -InnoUninstall"; Flags: runhidden waituntilterminated; RunOnceId: "GugakSignageCleanup"

[Code]
var
  DataDirPage: TInputDirWizardPage;
  PortPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  DataDirPage := CreateInputDirPage(
    wpSelectDir,
    'Data folder',
    'Where should GugakSignage keep its database, uploads, logs, and environment file?',
    'The data folder is preserved by default during uninstall.',
    False,
    ''
  );
  DataDirPage.Add('Data folder:');
  DataDirPage.Values[0] := ExpandConstant('{commonappdata}\GugakSignage');

  PortPage := CreateInputQueryPage(
    DataDirPage.ID,
    'Server port',
    'Which TCP port should the GugakSignage server listen on?',
    'The player and browser watchdog use this port on the local computer.'
  );
  PortPage.Add('Port:', False);
  PortPage.Values[0] := '3000';
end;

function GetDataDir(Param: String): String;
begin
  Result := DataDirPage.Values[0];
end;

function GetPort(Param: String): String;
begin
  Result := PortPage.Values[0];
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PortNumber: Integer;
begin
  Result := True;
  if CurPageID = PortPage.ID then
  begin
    PortNumber := StrToIntDef(PortPage.Values[0], 0);
    if (PortNumber < 1) or (PortNumber > 65535) then
    begin
      MsgBox('Enter a TCP port from 1 to 65535.', mbError, MB_OK);
      Result := False;
    end;
  end;
  if (CurPageID = DataDirPage.ID) and (Trim(DataDirPage.Values[0]) = '') then
  begin
    MsgBox('Enter a data folder.', mbError, MB_OK);
    Result := False;
  end;
end;

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if (not Exec(ExpandConstant('{cmd}'), '/C where node.exe >NUL 2>NUL', '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
  begin
    MsgBox('Node.js 24 or later was not found on PATH. Install Node.js, reopen this installer, and try again.', mbError, MB_OK);
    Result := False;
  end;
end;
