Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedRepository = 'toxicyou25-afk/GugakSignage'

function Deny-Execution {
    param([Parameter(Mandatory = $true)][string]$Reason)
    [Console]::Error.WriteLine("GugakSignage runner admission denied: $Reason")
    exit 1
}

if ([string]::IsNullOrWhiteSpace($env:GITHUB_EVENT_PATH) -or -not (Test-Path -LiteralPath $env:GITHUB_EVENT_PATH)) {
    Deny-Execution 'the GitHub event payload is unavailable'
}

if ($env:GITHUB_REPOSITORY -ne $expectedRepository) {
    Deny-Execution 'the runner repository context is unexpected'
}

try {
    $event = Get-Content -LiteralPath $env:GITHUB_EVENT_PATH -Raw | ConvertFrom-Json
} catch {
    Deny-Execution 'the GitHub event payload is invalid'
}

$eventRepository = [string]$event.repository.full_name
if ($eventRepository -ne $expectedRepository) {
    Deny-Execution 'the event repository is unexpected'
}

switch ([string]$env:GITHUB_EVENT_NAME) {
    'push' {
        Write-Output "GugakSignage runner admission allowed trusted push for $expectedRepository."
        exit 0
    }
    'pull_request' {
        $headRepository = [string]$event.pull_request.head.repo.full_name
        $baseRepository = [string]$event.pull_request.base.repo.full_name
        if ($headRepository -ne $expectedRepository) {
            Deny-Execution 'fork-origin pull requests must use GitHub-hosted Windows'
        }
        if ($baseRepository -ne $expectedRepository) {
            Deny-Execution 'the pull request base repository is unexpected'
        }
        Write-Output "GugakSignage runner admission allowed trusted same-repository pull request for $expectedRepository."
        exit 0
    }
    default {
        Deny-Execution 'the event is not an explicitly admitted push or pull_request'
    }
}
