; SPDX-License-Identifier: Apache-2.0
; Build installer\build\payload with build-installer.ps1 before compiling.

#define MyAppName "열린안내판"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "GugakSignage contributors"

[Setup]
AppId={{8E862C71-0C8D-4F00-9AA4-75C6A03E5F18}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\GugakSignage
DefaultGroupName={#MyAppName}
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
Source: "ops\install-common.ps1"; DestName: "resolver-common.ps1"; Flags: dontcopy
Source: "ops\resolve-data-dir.ps1"; DestName: "resolve-data-dir.ps1"; Flags: dontcopy
Source: "install.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "uninstall.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "set-autostart.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "..\docs\install\README.md"; DestDir: "{app}\docs"; Flags: ignoreversion

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\uninstall.ps1"" -InnoUninstall"; Flags: runhidden waituntilterminated; RunOnceId: "GugakSignageCleanup"

[UninstallDelete]
Type: files; Name: "{app}\install.json"
Type: files; Name: "{app}\ops\watchdog-launch.vbs"

[Code]
var
  DataDirPage: TInputDirWizardPage;
  PortPage: TInputQueryWizardPage;
  RolePage: TInputOptionWizardPage;
  ModePage: TInputOptionWizardPage;
  TlsPage: TInputQueryWizardPage;
  PlayerLanPage: TInputQueryWizardPage;
  PreviousDataDir: String;
  DataDirChangeConfirmed: Boolean;
  DataDirWasSpecified: Boolean;
  DataDirResolutionIsExisting: Boolean;
  SetupFailed: Boolean;

function ReadExistingDataDir(AppDir: String): String;
  forward;

function GetDefaultDataDir(): String;
begin
  if IsAdminInstallMode then
    Result := ExpandConstant('{commonappdata}\GugakSignage')
  else
    Result := ExpandConstant('{localappdata}\GugakSignage');
end;

function ExistingRoleIndex(): Integer;
var
  Content: AnsiString;
begin
  Result := 0;
  if LoadStringFromFile(ExpandConstant('{app}\install.json'), Content) then
  begin
    if Pos('"player-host"', String(Content)) > 0 then Result := 2
    else if Pos('"manager"', String(Content)) > 0 then Result := 1;
  end;
end;

function ExistingLanMode(): Boolean;
var
  Content: AnsiString;
begin
  Result := False;
  if LoadStringFromFile(ExpandConstant('{app}\install.json'), Content) then
    Result := (Pos('"mode"', String(Content)) > 0) and (Pos('"lan"', String(Content)) > 0);
end;

function ExistingManagerBaseUrl(): String;
var
  Content: AnsiString;
  JsonText, Marker: String;
  StartAt, EndAt: Integer;
begin
  Result := '';
  if LoadStringFromFile(ExpandConstant('{app}\install.json'), Content) then
  begin
    JsonText := String(Content);
    Marker := '"managerBaseUrl"';
    StartAt := Pos(Marker, JsonText);
    if StartAt > 0 then
    begin
      StartAt := StartAt + Length(Marker);
      while (StartAt <= Length(JsonText)) and ((JsonText[StartAt] = ' ') or (JsonText[StartAt] = #9) or (JsonText[StartAt] = ':')) do StartAt := StartAt + 1;
      if (StartAt <= Length(JsonText)) and (JsonText[StartAt] = '"') then StartAt := StartAt + 1;
      EndAt := StartAt;
      while (EndAt <= Length(JsonText)) and (JsonText[EndAt] <> '"') do EndAt := EndAt + 1;
      Result := Copy(JsonText, StartAt, EndAt - StartAt);
    end;
  end;
end;

procedure InitializeWizard;
begin
  DataDirPage := CreateInputDirPage(
    wpSelectDir,
    'Data folder',
    'Where should {#MyAppName} keep its database, uploads, logs, and environment file?',
    'The data folder is preserved by default during uninstall.',
    False,
    ''
  );
  DataDirPage.Add('Data folder:');
  DataDirWasSpecified := ExpandConstant('{param:DATADIR|}') <> '';
  PreviousDataDir := '';
  DataDirResolutionIsExisting := False;
  if DataDirWasSpecified then
    DataDirPage.Values[0] := ExpandConstant('{param:DATADIR|}')
  else
    DataDirPage.Values[0] := GetDefaultDataDir;

  PortPage := CreateInputQueryPage(
    DataDirPage.ID,
    'Server port',
    'Which TCP port should the {#MyAppName} server listen on?',
    'The player and browser watchdog use this port on the local computer.'
  );
  PortPage.Add('Port:', False);
  PortPage.Values[0] := ExpandConstant('{param:PORT|3000}');

  RolePage := CreateInputOptionPage(PortPage.ID, 'Installation role', 'Choose services', 'Integrated mode preserves the legacy installation.', True, False);
  RolePage.Add('Integrated Manager and Player');
  RolePage.Add('Manager only');
  RolePage.Add('Player Host only');
  RolePage.SelectedValueIndex := ExistingRoleIndex;
  if ExpandConstant('{param:ROLE|}') = 'manager' then RolePage.SelectedValueIndex := 1;
  if ExpandConstant('{param:ROLE|}') = 'player' then RolePage.SelectedValueIndex := 2;

  ModePage := CreateInputOptionPage(RolePage.ID, 'Network mode', 'Choose network mode', 'LAN HTTP is not supported. LAN connections use HTTPS.', True, False);
  ModePage.Add('Standalone');
  ModePage.Add('LAN (HTTPS)');
  if ExistingLanMode then ModePage.SelectedValueIndex := 1 else ModePage.SelectedValueIndex := 0;
  if ExpandConstant('{param:MODE|}') = 'lan' then ModePage.SelectedValueIndex := 1;

  TlsPage := CreateInputQueryPage(ModePage.ID, 'Manager TLS files', 'Select existing TLS files', 'The installer requires existing certificate and key files.');
  TlsPage.Add('Certificate:', False);
  TlsPage.Add('Private key:', False);
  TlsPage.Values[0] := ExpandConstant('{param:TLSCERT|}');
  TlsPage.Values[1] := ExpandConstant('{param:TLSKEY|}');
  TlsPage.Add('Manager HTTPS base URL:', False);
  TlsPage.Values[2] := ExistingManagerBaseUrl;
  PlayerLanPage := CreateInputQueryPage(ModePage.ID, 'Player Host connection', 'Connect to HTTPS Manager', 'The CA file path is recorded for Player Host TLS trust.');
  PlayerLanPage.Add('HTTPS Manager URL:', False);
  PlayerLanPage.Add('CA certificate:', False);
  PlayerLanPage.Values[0] := ExpandConstant('{param:MANAGERURL|}');
  PlayerLanPage.Values[1] := ExpandConstant('{param:MANAGERCA|}');
end;

function DecodeUtf16Hex(Value: String): String;
var
  I, CodeUnit: Integer;
begin
  Result := '';
  if (Length(Value) mod 4) <> 0 then
    RaiseException('The data path resolver returned invalid Unicode data.');
  I := 1;
  while I <= Length(Value) do
  begin
    CodeUnit := StrToInt('$' + Copy(Value, I + 2, 2) + Copy(Value, I, 2));
    Result := Result + Chr(CodeUnit);
    I := I + 4;
  end;
end;

function ReadExistingDataDir(AppDir: String): String;
var
  ResolverScript, ResolverCommon, OutputFile, Parameters: String;
  Output: AnsiString;
  Content, Payload, PathHex, ExistingFlag: String;
  ResultCode, Separator: Integer;
begin
  ResolverScript := ExpandConstant('{tmp}\resolve-data-dir.ps1');
  ResolverCommon := ExpandConstant('{tmp}\resolver-common.ps1');
  OutputFile := ExpandConstant('{tmp}\gugak-data-dir-result.txt');
  if not FileExists(ResolverCommon) then ExtractTemporaryFile('resolver-common.ps1');
  if not FileExists(ResolverScript) then ExtractTemporaryFile('resolve-data-dir.ps1');
  if FileExists(OutputFile) then DeleteFile(OutputFile);
  Parameters := '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + ResolverScript +
    '" -InstallDir "' + AppDir + '" -DefaultDataDir "' +
    GetDefaultDataDir + '" -OutputFile "' + OutputFile + '"';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters,
      ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Could not start the shared GugakSignage data path resolver.');
  if not LoadStringFromFile(OutputFile, Output) then
    RaiseException('The shared GugakSignage data path resolver did not return a result.');
  Content := String(Output);
  if Copy(Content, 1, 4) = 'ERR|' then
    RaiseException(DecodeUtf16Hex(Copy(Content, 5, Length(Content))));
  if Copy(Content, 1, 3) <> 'OK|' then
    RaiseException('The shared GugakSignage data path resolver returned an invalid result.');
  Payload := Copy(Content, 4, Length(Content));
  Separator := Pos('|', Payload);
  if Separator = 0 then
    RaiseException('The shared GugakSignage data path resolver returned an incomplete result.');
  PathHex := Copy(Payload, 1, Separator - 1);
  ExistingFlag := Copy(Payload, Separator + 1, Length(Payload));
  DataDirResolutionIsExisting := ExistingFlag = '1';
  Result := DecodeUtf16Hex(PathHex);
end;

function NormalizePathForCompare(Path: String): String;
begin
  Result := UpperCase(RemoveBackslashUnlessRoot(ExpandFileName(Path)));
end;

function GetDataDir(Param: String): String;
begin
  if DataDirWasSpecified then
    Result := ExpandConstant('{param:DATADIR|}')
  else if DataDirChangeConfirmed and Assigned(DataDirPage) then
    Result := DataDirPage.Values[0]
  else
    Result := '';
end;

function GetPort(Param: String): String;
begin
  Result := PortPage.Values[0];
end;

function GetRoleArg(Param: String): String;
begin
  if RolePage.SelectedValueIndex = 1 then Result := 'manager'
  else if RolePage.SelectedValueIndex = 2 then Result := 'player'
  else Result := 'all';
end;

function GetModeArg(Param: String): String;
begin
  if ModePage.SelectedValueIndex = 1 then Result := 'lan' else Result := 'standalone';
end;

function ManagerBaseUrlMatchesPort(Value, PortValue: String): Boolean;
var
  Normalized, Authority, Scheme: String;
  AuthorityEnd, SuffixLength: Integer;
begin
  Normalized := Lowercase(Trim(Value));
  Scheme := 'https://';
  Result := False;
  if Copy(Normalized, 1, Length(Scheme)) <> Scheme then exit;
  Authority := Copy(Normalized, Length(Scheme) + 1, Length(Normalized));
  AuthorityEnd := Pos('/', Authority);
  if AuthorityEnd > 0 then
  begin
    if Copy(Authority, AuthorityEnd, Length(Authority)) <> '/' then exit;
    Authority := Copy(Authority, 1, AuthorityEnd - 1);
  end;
  SuffixLength := Length(PortValue) + 1;
  if Length(Authority) <= SuffixLength then exit;
  Result := Copy(Authority, Length(Authority) - SuffixLength + 1, SuffixLength) = ':' + PortValue;
end;

function RoleSelectionChanged(): Boolean;
begin
  Result := (ExpandConstant('{param:ROLE|}') <> '') or (RolePage.SelectedValueIndex <> ExistingRoleIndex);
end;

function ModeSelectionChanged(): Boolean;
begin
  Result := (ExpandConstant('{param:MODE|}') <> '') or
    ((ModePage.SelectedValueIndex = 1) <> ExistingLanMode);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (PageID = TlsPage.ID) and ((GetRoleArg('') <> 'manager') or (GetModeArg('') <> 'lan')) then Result := True;
  if (PageID = PlayerLanPage.ID) and ((GetRoleArg('') <> 'player') or (GetModeArg('') <> 'lan')) then Result := True;
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

function PathEqualsOrInside(Path, Parent: String): Boolean;
var
  Candidate, Container, Prefix: String;
begin
  Candidate := NormalizePathForCompare(Path);
  Container := NormalizePathForCompare(Parent);
  if (Container <> '') and (Copy(Container, Length(Container), 1) = '\') then
    Prefix := Container
  else
    Prefix := Container + '\';
  Result := (Candidate = Container) or (Copy(Candidate, 1, Length(Prefix)) = Prefix);
end;

function GetSelectedDataDirForValidation(): String;
var
  ExistingDataDir: String;
begin
  if DataDirWasSpecified then
    Result := ExpandConstant('{param:DATADIR|}')
  else if DataDirChangeConfirmed and Assigned(DataDirPage) then
    Result := DataDirPage.Values[0]
  else
  begin
    ExistingDataDir := ReadExistingDataDir(ExpandConstant('{app}'));
    if DataDirResolutionIsExisting then
      Result := ExistingDataDir
    else
      Result := GetDefaultDataDir;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExistingDataDir, SelectedDataDir, InstallDir: String;
begin
  Result := '';
  ExistingDataDir := ReadExistingDataDir(ExpandConstant('{app}'));
  if DataDirResolutionIsExisting then
  begin
    PreviousDataDir := ExistingDataDir;
    if (not DataDirWasSpecified) and (not DataDirChangeConfirmed) then
      DataDirPage.Values[0] := ExistingDataDir;
  end;
  SelectedDataDir := GetSelectedDataDirForValidation();
  InstallDir := ExpandConstant('{app}');
  if DataDirResolutionIsExisting and (PreviousDataDir <> '') and
     (SelectedDataDir <> '') and
     (NormalizePathForCompare(SelectedDataDir) <> NormalizePathForCompare(PreviousDataDir)) and
     (not DataDirChangeConfirmed) then
    RaiseException('The data folder cannot be changed without explicit confirmation. Existing: ' + PreviousDataDir + ', selected: ' + SelectedDataDir);
  if (SelectedDataDir <> '') and
     (PathEqualsOrInside(SelectedDataDir, InstallDir) or
      PathEqualsOrInside(InstallDir, SelectedDataDir)) then
    RaiseException('The data folder and install folder cannot be the same or contain each other. Install: ' + InstallDir + ', data: ' + SelectedDataDir);
end;

function GetCustomSetupExitCode(): Integer;
begin
  if SetupFailed then
    Result := 1
  else
    Result := 0;
end;

procedure RunInstallScript;
var
  Parameters: String;
  ResultCode: Integer;
begin
  Parameters := '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\tools\install.ps1') +
    '" -ConfigureOnly -InstallDir "' + ExpandConstant('{app}') +
    '" -DataDir "' + GetDataDir('') +
    '" -Port ' + GetPort('') +
    ' -TaskName "' + GetTaskName('') +
    '" -DesktopDir "' + GetDesktopDir('') +
    '" -StartMenuDir "' + GetStartMenuDir('') +
    '" -ProfileDir "' + GetProfileDir('') + '"' +
    GetDataDirChangeFlag('') + GetNoStartFlag('') + GetHeadlessFlag('');
  if RoleSelectionChanged or ModeSelectionChanged then
    Parameters := Parameters + ' -Role "' + GetRoleArg('') + '" -Mode "' + GetModeArg('') + '"';
  if (GetRoleArg('') = 'manager') and (GetModeArg('') = 'lan') then
    Parameters := Parameters + ' -TlsCertFile "' + TlsPage.Values[0] + '" -TlsKeyFile "' + TlsPage.Values[1] + '" -ManagerBaseUrl "' + TlsPage.Values[2] + '"';
  if (GetRoleArg('') = 'player') and (GetModeArg('') = 'lan') then
    Parameters := Parameters + ' -ManagerUrl "' + PlayerLanPage.Values[0] + '" -ManagerCaFile "' + PlayerLanPage.Values[1] + '"';
  if WizardIsTaskSelected('firewall') then
    Parameters := Parameters + ' -OpenFirewall';
  if (not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters,
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
  begin
    SetupFailed := True;
    Abort;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResolvedDataDir: String;
begin
  if CurStep = ssInstall then
  begin
    ResolvedDataDir := ReadExistingDataDir(ExpandConstant('{app}'));
    if DataDirResolutionIsExisting and not DataDirWasSpecified then
    begin
      PreviousDataDir := ResolvedDataDir;
      if Assigned(DataDirPage) then
        DataDirPage.Values[0] := ResolvedDataDir;
    end;
  end;
  if CurStep = ssPostInstall then
    RunInstallScript;
  if CurStep = ssDone then
    if not FileExists(ExpandConstant('{app}\install.json')) then
    begin
      SetupFailed := True;
      Abort;
    end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PortNumber: Integer;
  ManagerUrlText: String;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    if not DataDirWasSpecified then
      PreviousDataDir := ReadExistingDataDir(WizardDirValue);
    DataDirChangeConfirmed := False;
    if DataDirResolutionIsExisting then
      DataDirPage.Values[0] := PreviousDataDir
    else if not DataDirWasSpecified then
      DataDirPage.Values[0] := GetDefaultDataDir;
  end;
  if (CurPageID = wpSelectDir) and (not WizardSilent) then
  begin
    if ExpandConstant('{param:ROLE|}') = 'manager' then RolePage.SelectedValueIndex := 1
    else if ExpandConstant('{param:ROLE|}') = 'player' then RolePage.SelectedValueIndex := 2;
    if ExpandConstant('{param:MODE|}') = 'lan' then ModePage.SelectedValueIndex := 1;
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
  if (CurPageID = RolePage.ID) and (RolePage.SelectedValueIndex = 0) and (ModePage.SelectedValueIndex = 1) then
  begin
    MsgBox('Integrated mode supports Standalone only.', mbError, MB_OK);
    Result := False;
  end;
  if (CurPageID = ModePage.ID) and (RolePage.SelectedValueIndex = 2) and (ModePage.SelectedValueIndex = 0) then
  begin
    MsgBox('Player Host installs require LAN mode and an HTTPS Manager URL.', mbError, MB_OK);
    Result := False;
  end;
  if (CurPageID = TlsPage.ID) and (RolePage.SelectedValueIndex = 1) and (ModePage.SelectedValueIndex = 1) then
  begin
    ManagerUrlText := Lowercase(Trim(TlsPage.Values[2]));
    if (not FileExists(TlsPage.Values[0])) or (not FileExists(TlsPage.Values[1])) or
       (not ManagerBaseUrlMatchesPort(TlsPage.Values[2], GetPort(''))) then
    begin
      MsgBox('Select existing TLS certificate and key files, and an HTTPS base URL using the Manager listener port.', mbError, MB_OK);
      Result := False;
    end;
  end;
  if (CurPageID = PlayerLanPage.ID) and (RolePage.SelectedValueIndex = 2) and (ModePage.SelectedValueIndex = 1) then
  begin
    ManagerUrlText := Lowercase(Trim(PlayerLanPage.Values[0]));
    if (Copy(ManagerUrlText, 1, 8) <> 'https://') or (not FileExists(PlayerLanPage.Values[1])) then
    begin
      MsgBox('Enter an HTTPS Manager URL and select an existing CA certificate file.', mbError, MB_OK);
      Result := False;
    end;
  end;
  if (CurPageID = DataDirPage.ID) and (Trim(DataDirPage.Values[0]) = '') then
  begin
    MsgBox('Enter a data folder.', mbError, MB_OK);
    Result := False;
  end;
  if (CurPageID = DataDirPage.ID) and Result and (not WizardSilent) and
     (NormalizePathForCompare(DataDirPage.Values[0]) <> NormalizePathForCompare(GetDefaultDataDir)) then
    DataDirChangeConfirmed := True;
  if (CurPageID = DataDirPage.ID) and Result and DataDirResolutionIsExisting and (PreviousDataDir <> '') and
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
