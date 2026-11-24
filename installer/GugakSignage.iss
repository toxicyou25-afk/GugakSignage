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
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
RestartApplications=no
SetupLogging=yes
Uninstallable=yes
UsePreviousAppDir=yes

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
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\install.ps1"" -ConfigureOnly -InstallDir ""{app}"" -DataDir ""{code:GetDataDir}"" -Port {code:GetPort} -TaskName ""{code:GetTaskName}"" -DesktopDir ""{code:GetDesktopDir}"" -StartMenuDir ""{code:GetStartMenuDir}"" -ProfileDir ""{code:GetProfileDir}""{code:GetDataDirChangeFlag}{code:GetNoStartFlag}{code:GetHeadlessFlag}"; StatusMsg: "Configuring GugakSignage services..."; Flags: waituntilterminated; Tasks: not firewall
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\install.ps1"" -ConfigureOnly -InstallDir ""{app}"" -DataDir ""{code:GetDataDir}"" -Port {code:GetPort} -TaskName ""{code:GetTaskName}"" -DesktopDir ""{code:GetDesktopDir}"" -StartMenuDir ""{code:GetStartMenuDir}"" -ProfileDir ""{code:GetProfileDir}"" -OpenFirewall{code:GetDataDirChangeFlag}{code:GetNoStartFlag}{code:GetHeadlessFlag}"; StatusMsg: "Configuring GugakSignage services and firewall..."; Flags: waituntilterminated; Tasks: firewall

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\uninstall.ps1"" -InnoUninstall"; Flags: runhidden waituntilterminated; RunOnceId: "GugakSignageCleanup"

[UninstallDelete]
Type: files; Name: "{app}\install.json"
Type: files; Name: "{app}\ops\watchdog-launch.vbs"

[Code]
var
  DataDirPage: TInputDirWizardPage;
  PortPage: TInputQueryWizardPage;
  PreviousDataDir: String;
  DataDirChangeConfirmed: Boolean;

function ReadExistingDataDir(AppDir: String): String;
  forward;

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
  DataDirPage.Values[0] := ExpandConstant('{param:DATADIR|{commonappdata}\GugakSignage}');

  PortPage := CreateInputQueryPage(
    DataDirPage.ID,
    'Server port',
    'Which TCP port should the GugakSignage server listen on?',
    'The player and browser watchdog use this port on the local computer.'
  );
  PortPage.Add('Port:', False);
  PortPage.Values[0] := ExpandConstant('{param:PORT|3000}');
end;

function ReadJsonStringField(Json, FieldName: String): String;
var
  Marker: String;
  StartPos, I: Integer;
  Character: Char;
begin
  Result := '';
  Marker := '"' + FieldName + '":';
  StartPos := Pos(Marker, Json);
  if StartPos = 0 then Exit;
  StartPos := StartPos + Length(Marker);
  while (StartPos <= Length(Json)) and (Json[StartPos] in [' ', #9, #13, #10]) do Inc(StartPos);
  if (StartPos > Length(Json)) or (Json[StartPos] <> '"') then Exit;
  StartPos := StartPos + 1;
  I := StartPos;
  while I <= Length(Json) do
  begin
    Character := Json[I];
    if Character = '"' then Break;
    if (Character = '\') and (I < Length(Json)) then
    begin
      I := I + 1;
      Result := Result + Json[I];
    end
    else
      Result := Result + Character;
    I := I + 1;
  end;
end;

function ReadExistingDataDir(AppDir: String): String;
var
  Json: AnsiString;
begin
  Result := '';
  if FileExists(AddBackslash(AppDir) + 'install.json') and
     LoadStringFromFile(AddBackslash(AppDir) + 'install.json', Json) then
    Result := ReadJsonStringField(Json, 'dataDir');
end;

function NormalizePathForCompare(Path: String): String;
begin
  Result := UpperCase(RemoveBackslashUnlessRoot(ExpandFileName(Path)));
end;

function GetDataDir(Param: String): String;
begin
  Result := DataDirPage.Values[0];
end;

function GetPort(Param: String): String;
begin
  Result := PortPage.Values[0];
end;

function GetTaskName(Param: String): String;
begin
  Result := ExpandConstant('{param:WATCHDOGTASK|GugakSignage-Watchdog}');
end;

function GetDesktopDir(Param: String): String;
begin
  Result := ExpandConstant('{param:DESKTOPDIR|{userdesktop}}');
end;

function GetStartMenuDir(Param: String): String;
begin
  Result := ExpandConstant('{param:STARTMENUDIR|{group}}');
end;

function GetProfileDir(Param: String): String;
begin
  Result := ExpandConstant('{param:PLAYERPROFILE|{localappdata}\GugakSignagePlayer}');
end;

function GetDataDirChangeFlag(Param: String): String;
begin
  if DataDirChangeConfirmed then
    Result := ' -AllowDataDirChange'
  else
    Result := '';
end;

function GetNoStartFlag(Param: String): String;
begin
  if ExpandConstant('{param:NOSTART|0}') = '1' then
    Result := ' -NoStart'
  else
    Result := '';
end;

function GetHeadlessFlag(Param: String): String;
begin
  if ExpandConstant('{param:HEADLESS|0}') = '1' then
    Result := ' -HeadlessBrowser'
  else
    Result := '';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExistingDataDir: String;
begin
  Result := '';
  ExistingDataDir := ReadExistingDataDir(ExpandConstant('{app}'));
  if ExistingDataDir <> '' then
  begin
    PreviousDataDir := ExistingDataDir;
    if not DataDirChangeConfirmed then
      DataDirPage.Values[0] := ExistingDataDir;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PortNumber: Integer;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    PreviousDataDir := ReadExistingDataDir(WizardDirValue);
    DataDirChangeConfirmed := False;
    if PreviousDataDir <> '' then
      DataDirPage.Values[0] := PreviousDataDir;
  end;
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
  if (CurPageID = DataDirPage.ID) and Result and (PreviousDataDir <> '') and
     (NormalizePathForCompare(DataDirPage.Values[0]) <> NormalizePathForCompare(PreviousDataDir)) then
  begin
    if MsgBox(
      'A different data folder was selected.' + #13#10#13#10 +
      'Existing installation: ' + PreviousDataDir + #13#10 +
      'Selected folder: ' + DataDirPage.Values[0] + #13#10#13#10 +
      'The original database will not be moved. Continue with the selected folder?',
      mbConfirmation, MB_YESNO) = IDYES then
    begin
      DataDirChangeConfirmed := True;
    end
    else
    begin
      DataDirChangeConfirmed := False;
      Result := False;
    end;
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
