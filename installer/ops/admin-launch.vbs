' SPDX-License-Identifier: Apache-2.0
Option Explicit
Dim fileSystem, shell, opsDir, powerShell, scriptPath, command
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
opsDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShell = fileSystem.BuildPath(shell.ExpandEnvironmentStrings("%SystemRoot%"), "System32\WindowsPowerShell\v1.0\powershell.exe")
scriptPath = fileSystem.BuildPath(opsDir, "open-admin.ps1")
command = Chr(34) & powerShell & Chr(34) & " -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & scriptPath & Chr(34)
shell.Run command, 0, False
