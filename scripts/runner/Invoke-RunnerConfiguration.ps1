[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PayloadBase64
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$registrationToken = [Console]::In.ReadLine()
if ([string]::IsNullOrWhiteSpace($registrationToken)) {
    throw 'No registration token was supplied on stdin.'
}
$registrationToken = $registrationToken.Trim()

try {
    $payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))
    $payload = $payloadJson | ConvertFrom-Json

    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class GugakHiddenRunnerConfig
{
    private const int STD_ERROR_HANDLE = -12;
    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint OPEN_EXISTING = 3;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const int STARTF_USESTDHANDLES = 0x00000100;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 0x00000102;
    private const int SW_HIDE = 0;
    private const ushort VK_RETURN = 13;
    private const ushort KEY_EVENT = 1;
    private const uint INFINITE = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public int bInheritHandle;
    }

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    private struct KEY_EVENT_RECORD
    {
        [FieldOffset(0)] public int bKeyDown;
        [FieldOffset(4)] public ushort wRepeatCount;
        [FieldOffset(6)] public ushort wVirtualKeyCode;
        [FieldOffset(8)] public ushort wVirtualScanCode;
        [FieldOffset(10)] public char UnicodeChar;
        [FieldOffset(12)] public uint dwControlKeyState;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUT_RECORD
    {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    }

    [DllImport("kernel32.dll")]
    private static extern bool FreeConsole();

    [DllImport("kernel32.dll")]
    private static extern bool AllocConsole();

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateFileW(string fileName, uint desiredAccess, uint shareMode, ref SECURITY_ATTRIBUTES securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(string applicationName, string commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteConsoleInputW(IntPtr consoleInput, INPUT_RECORD[] buffer, uint length, out uint written);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static string QuoteArgument(string argument)
    {
        if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
        {
            return argument;
        }

        var result = new StringBuilder();
        result.Append('"');
        int backslashes = 0;
        foreach (char character in argument)
        {
            if (character == '\\')
            {
                backslashes++;
            }
            else if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
            }
            else
            {
                result.Append('\\', backslashes);
                result.Append(character);
                backslashes = 0;
            }
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static string BuildCommandLine(string[] arguments)
    {
        var commandLine = new StringBuilder();
        foreach (string argument in arguments)
        {
            if (commandLine.Length > 0)
            {
                commandLine.Append(' ');
            }
            commandLine.Append(QuoteArgument(argument));
        }
        return commandLine.ToString();
    }

    private static INPUT_RECORD[] BuildInput(string secret)
    {
        var records = new List<INPUT_RECORD>();
        foreach (char character in secret)
        {
            records.Add(new INPUT_RECORD
            {
                EventType = KEY_EVENT,
                KeyEvent = new KEY_EVENT_RECORD
                {
                    bKeyDown = 1,
                    wRepeatCount = 1,
                    UnicodeChar = character
                }
            });
        }
        records.Add(new INPUT_RECORD
        {
            EventType = KEY_EVENT,
            KeyEvent = new KEY_EVENT_RECORD
            {
                bKeyDown = 1,
                wRepeatCount = 1,
                wVirtualKeyCode = VK_RETURN,
                wVirtualScanCode = 28,
                UnicodeChar = '\r'
            }
        });
        return records.ToArray();
    }

    public static int Run(string executable, string[] arguments, string workingDirectory, string secret)
    {
        FreeConsole();
        if (!AllocConsole())
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not allocate an isolated console.");
        }
        ShowWindow(GetConsoleWindow(), SW_HIDE);

        IntPtr consoleInput = IntPtr.Zero;
        IntPtr consoleOutput = IntPtr.Zero;
        PROCESS_INFORMATION processInformation = new PROCESS_INFORMATION();
        try
        {
            var security = new SECURITY_ATTRIBUTES
            {
                nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),
                bInheritHandle = 1
            };
            consoleInput = CreateFileW("CONIN$", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, ref security, OPEN_EXISTING, 0, IntPtr.Zero);
            if (consoleInput == new IntPtr(-1))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open the isolated console input.");
            }
            consoleOutput = CreateFileW("CONOUT$", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, ref security, OPEN_EXISTING, 0, IntPtr.Zero);
            if (consoleOutput == new IntPtr(-1))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open the isolated console output.");
            }

            var startupInfo = new STARTUPINFO
            {
                cb = Marshal.SizeOf(typeof(STARTUPINFO)),
                dwFlags = STARTF_USESTDHANDLES,
                hStdInput = consoleInput,
                hStdOutput = consoleOutput,
                hStdError = consoleOutput
            };
            string commandLine = QuoteArgument(executable) + " " + BuildCommandLine(arguments);
            if (!CreateProcessW(executable, commandLine, IntPtr.Zero, IntPtr.Zero, true, CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, workingDirectory, ref startupInfo, out processInformation))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not start the runner configuration process.");
            }

            uint written;
            var input = BuildInput(secret);
            if (!WriteConsoleInputW(consoleInput, input, (uint)input.Length, out written) || written != input.Length)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not supply the registration token to the console.");
            }

            uint waitResult = WaitForSingleObject(processInformation.hProcess, 300000);
            if (waitResult == WAIT_TIMEOUT)
            {
                TerminateProcess(processInformation.hProcess, 124);
                return 124;
            }
            if (waitResult != WAIT_OBJECT_0)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Waiting for runner configuration failed.");
            }

            uint exitCode;
            if (!GetExitCodeProcess(processInformation.hProcess, out exitCode))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not read the runner configuration exit code.");
            }
            return unchecked((int)exitCode);
        }
        finally
        {
            if (consoleInput != IntPtr.Zero && consoleInput != new IntPtr(-1))
            {
                CloseHandle(consoleInput);
            }
            if (consoleOutput != IntPtr.Zero && consoleOutput != new IntPtr(-1))
            {
                CloseHandle(consoleOutput);
            }
            CloseHandle(processInformation.hThread);
            CloseHandle(processInformation.hProcess);
            FreeConsole();
        }
    }
}
'@

    $arguments = @($payload.arguments | ForEach-Object { [string]$_ })
    $exitCode = [GugakHiddenRunnerConfig]::Run(
        [string]$payload.executable,
        $arguments,
        [string]$payload.workingDirectory,
        $registrationToken
    )
    if ($exitCode -ne 0) {
        [Console]::Error.WriteLine("Runner configuration failed with exit code $exitCode. Command output remains inside the isolated console.")
        exit $exitCode
    }
}
finally {
    $registrationToken = $null
    [GC]::Collect()
}

Write-Output 'PASS: runner configuration accepted the token through isolated console input.'
