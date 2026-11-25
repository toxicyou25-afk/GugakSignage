# GugakSignage Windows self-hosted runner

## Workflow routing and permissions

The existing `CI` workflow and `validate` job remain named as before; the displayed job check is still `Validate on Windows`. Pushes and same-repository pull requests select the repository runner with labels `self-hosted`, `Windows`, `X64`, and `gugaksignage-ci`. Fork-origin pull requests select `windows-latest`. The workflow-dispatch path and any event not explicitly admitted to the runner also select `windows-latest`.

The workflow compares `github.event.pull_request.head.repo.full_name` with `github.repository`. A missing head repository selects `windows-latest`. This expression routes ordinary fork PRs to hosted Windows, but it is not the security boundary because a fork can edit the workflow definition used by its `pull_request` event.

The runner therefore installs an immutable job-started hook at `C:\actions-runners\GugakSignage\admission\Assert-TrustedJob.ps1` and sets `ACTIONS_RUNNER_HOOK_JOB_STARTED` in the Windows service environment. The hook reads `GITHUB_EVENT_PATH` before workflow steps. It allows only a push to this repository or a pull request whose head and base are both `toxicyou25-afk/GugakSignage`; every other event, repository, malformed payload, or missing payload exits nonzero and fails the job in `Set up runner`. A fork PR cannot remove or alter this local hook by changing the workflow file. Do not register the runner until the hook is installed and its fixture tests pass.

CI keeps workflow-level `permissions: contents: read`, and checkout uses `persist-credentials: false`. The workflow does not reference repository secrets. The Pages deployment stays on `ubuntu-latest` with its existing `github-pages` environment and `pages: write` / `id-token: write` permissions.

## Home-PC runner layout

| Purpose | Path |
| --- | --- |
| Runner root | `C:\actions-runners\GugakSignage` |
| Runner application and diagnostics | `C:\actions-runners\GugakSignage\runner` and `runner\_diag` |
| Job checkouts | `C:\actions-runners\GugakSignage\runner\_work` (and the reserved root `_work`) |
| Temporary files | `C:\actions-runners\GugakSignage\_temp` |
| Tool cache | `C:\actions-runners\GugakSignage\_toolcache` |
| npm and Playwright caches | `C:\actions-runners\GugakSignage\_cache\npm` and `_cache\ms-playwright` |
| Runner profile | `C:\actions-runners\GugakSignage\home` |
| Installer and operational logs | `C:\actions-runners\GugakSignage\_download` and `_logs` |

The root ACL grants the installing account, SYSTEM, and Administrators full access. `NT AUTHORITY\LOCAL SERVICE` and its dedicated `GITHUB_ActionsRunner_*` group have read-and-execute access to the runner application and controls, but no write access to `config.cmd`, `.service`, `.runner`, `.credentials`, `.credentials_rsaparams`, the `admission` directory, or its hook. Modify access is granted only to runtime data paths: `_work`, `runner\_work`, `_temp`, `_toolcache`, `_cache`, `runner\_diag`, `_logs`, and `home`. `runner\_work` and the other runtime paths reject write ACLs for Authenticated Users, Builtin Users, and Everyone. The workflow checks this separation on each self-hosted run. The service environment uses a synthetic profile and isolated temp, tool, npm, and Playwright paths. Sensitive machine-level environment variable names are explicitly blanked.

The installer downloads the official Actions runner v2.338.2, checks the GitHub release SHA-256 digest before extraction, and configures `--disableupdate`. It also enforces `disableUpdate: true` in the local runner settings for the already configured runner, so a locally pinned installation does not accept runner auto-update messages. Changing runner versions is an explicit reinstall action.

The installer configures and asserts Windows service failure recovery using `sc.exe failure`: three restart actions delayed by 60 seconds, with the failure count reset after 86400 seconds. The self-hosted workflow queries the same policy before running application tests.

Only the self-hosted branch writes the isolated temp, profile, tool, npm, and Playwright paths to `GITHUB_ENV`. Hosted fork and `workflow_dispatch` runs keep their GitHub-hosted environment. The first self-hosted step rejects any process identity other than `NT AUTHORITY\LOCAL SERVICE`. After checkout, the workflow verifies the installed hook and its ACLs.

`InstallService` is safe to retry over a precreated dedicated root. It first resets stale DACLs across only `C:\actions-runners\GugakSignage`, preserving every file and directory, then reapplies the restricted root policy. Existing `_work`, `_toolcache`, runner binaries, and cache contents remain in place. It then repairs the `admission` directory and hook file before replacing the hook, so a protected empty DACL on an old `Assert-TrustedJob.ps1` cannot block the copy. It reuses an existing LocalService runner service and does not request a new registration token when the local runner is already configured.

`InstallService` runs the admission allow/deny fixture suite before it reads a registration token, writes service environment, stops a service, or starts a service. A failed hook test therefore cannot change the installed service.

One runner process handles one job at a time. Keep the home-PC total at no more than three concurrent jobs, with at most one runner for each of DBrainPlus, TossPaperLab, and GugakSignage. Do not register a second GugakSignage runner or launch another runner process for this registration.

## Elevated bootstrap

The installer requires Windows elevation and `gh` authenticated to GitHub as a repository administrator. It requests a short-lived runner registration token directly from GitHub in memory, then sends the token to a hidden-console runner configuration process over stdin. The token never appears in a process command line, repository file, command log, or script argument. The installer configures the service as LocalService, applies the isolated environment, and verifies automatic startup and identity.

From the existing repo checkout, run this single command from a PowerShell window where the owner can approve the Windows UAC prompt:

```powershell
& 'C:\Users\SUA\orca\workspaces\GugakSignage\gugak-self-hosted-runner\scripts\runner\Install-GugakSignageRunner.ps1' -Mode InstallService -Elevate
```

Use `-Mode ValidateOnly` to verify the pinned runner package and directory layout without configuring a runner or service. If elevation is unavailable, stop before runner registration and record the branch and bootstrap command as the remaining operator action. Do not weaken the ACL, start a foreground runner as the interactive desktop user, or approve a fork pull request onto this runner. A temporary foreground runner is acceptable only from a dedicated noninteractive low-privilege identity with an isolated profile; creating that identity still requires administrator work and local-service login may not be usable for an interactive console.

## Emergency stop, start, and reinstall

Run service-control commands from an elevated PowerShell. Before stopping, verify the runner is idle with `gh api repos/toxicyou25-afk/GugakSignage/actions/runners/2 --jq '{status,busy}'`. A forced stop can terminate an active job; queued jobs remain queued for a later start.

Stop and verify:

```powershell
$svc = 'actions.runner.toxicyou25-afk-GugakSignage.GugakSignage-CI-Win11'
Stop-Service -Name $svc -Force
Get-CimInstance Win32_Service -Filter "Name='$svc'" | Select-Object Name,State,StartMode,StartName
```

For a prolonged emergency stop, also run `Set-Service -Name $svc -StartupType Disabled`. Restore `Automatic` before starting. Confirm the result with both `sc.exe qc $svc` and the GitHub runner API; local listener state and GitHub online state are separate evidence.

Start and verify:

```powershell
$svc = 'actions.runner.toxicyou25-afk-GugakSignage.GugakSignage-CI-Win11'
Set-Service -Name $svc -StartupType Automatic
Start-Service -Name $svc
Get-CimInstance Win32_Service -Filter "Name='$svc'" | Select-Object Name,State,StartMode,StartName
gh api repos/toxicyou25-afk/GugakSignage/actions/runners/2 --jq '{id,name,status,labels:[.labels[].name]}'
```

Starting without the admission hook, runner identity check, or ACL policy is unsafe. Re-run `InstallService` first if any of those controls changed.

Full reinstall is exceptional and changes runner registration state:

1. Wait for `busy:false`, stop the service, and set it to Disabled. A full reinstall interrupts queued or active work.
2. Record the current runner ID and any queued work. Remove the GitHub registration with `gh api --method DELETE repos/toxicyou25-afk/GugakSignage/actions/runners/2` only for the confirmed repository runner.
3. In elevated PowerShell, confirm the service name and delete the Windows service with `sc.exe delete $svc`. Verify that `sc.exe qc $svc` no longer finds it.
4. Resolve the runner-specific `GITHUB_ActionsRunner_*` local group from the ACL before removing it. Confirm the group contains `NT AUTHORITY\LOCAL SERVICE`, then remove only that exact group with `Remove-LocalGroup`.
5. Verify every resolved path remains under `C:\actions-runners\GugakSignage`, then remove the stale `.runner`, `.credentials`, `.credentials_rsaparams`, and `.service` files. Preserve `_work`, `_toolcache`, `_cache`, `home`, and `_logs` unless their contents have been reviewed and explicitly archived or discarded.
6. Preserve the extracted runner directory only when its pinned archive and binary version remain the approved version. Otherwise remove the verified runner directory so the installer extracts and checks the pinned release again.
7. Run the elevated bootstrap command above. It creates a new registration token only in memory, performs admission tests before service changes, registers once, applies ACL and recovery checks, and restores automatic LocalService startup.
8. Verify `State=Running`, `StartMode=Auto`, `StartName=NT AUTHORITY\LOCAL SERVICE`, runner ID/status/labels, `disableUpdate:true`, the ACL policy, and `sc.exe qfailure` before allowing another job.

Do not add `--token` to a command manually. The installer's hidden-console launcher is the supported token transport.

## Post-restart self-hosted verification

After the controlled restart or reboot, verify local and GitHub state first, then trigger exactly one same-repository pull request run without changing application code:

```powershell
git fetch origin
git switch ci/use-isolated-windows-self-hosted-runner
git pull --ff-only
git commit --allow-empty -m "ci: verify post-restart self-hosted runner"
git push origin HEAD:ci/use-isolated-windows-self-hosted-runner
gh run list --repo toxicyou25-afk/GugakSignage --branch ci/use-isolated-windows-self-hosted-runner --limit 1 --json databaseId,headSha,status,conclusion,url
```

Use the returned run ID with `gh run watch <run-id> --repo toxicyou25-afk/GugakSignage --exit-status`, then inspect its single job. Expected evidence is a `pull_request` run on runner ID 2 `GugakSignage-CI-Win11`, job name `Validate on Windows`, conclusion success, no skipped or failed steps, and successful logs for `Verify runner process identity and isolate environment`, `Verify runner control ACLs`, and `Verify runner service recovery`. The post-Node cleanup must not contain a gzip/cache-save warning. A skipped, hosted-runner, or failed result is not acceptance.

## Validation evidence

| Evidence | Result |
| --- | --- |
| Runner | ID 2, `GugakSignage-CI-Win11`, labels `self-hosted,Windows,X64,gugaksignage-ci`, online |
| Windows service | `actions.runner.toxicyou25-afk-GugakSignage.GugakSignage-CI-Win11`, Running, Auto, `NT AUTHORITY\\LOCAL SERVICE` |
| Review-hardening SHA | `c143ec20c87b8554429959628643ca5377ea16e2` |
| Actions run and job | Run `45513841103`, job `138868073638` |
| Conclusion and steps | Success; 21/21 steps succeeded, including identity, isolation, checkout, hook and ACL checks, Node setup, install, typecheck, build, tests, four UI verifications, artifact upload, and cleanup |
| Identity evidence | Job log: `Runner process identity: NT AUTHORITY\\LOCAL SERVICE` |
| Precreated-root ACL repair | `D:PAI` reproduced on the old hook and cached archive; dedicated-root reset preserved both; archive SHA-256 and admission tests passed |
| Control ACLs | Self-hosted job confirmed read-only LocalService access to controls/credentials and Modify access only on runtime data paths |
| Token transport | Launcher probe confirmed the registration token reaches hidden console stdin and is absent from child process argv |
| setup-node cache | The automatic npm-cache input was removed; npm still uses the isolated `_cache\npm`, and the final run has no gzip/cache save warning |
| Verification artifact | `windows-verification-1`, ID `14976882400`, 10,413,838 bytes |
| Required-check names | `CI / Validate on Windows` (workflow and job names unchanged) |
| Fork selection | Workflow routes fork PRs to `windows-latest`; runner admission hook denies them before steps; no fork PR was created or run |
| Service elevation | LocalService automatic service is installed; rerun the elevated bootstrap after pulling review-hardening changes to reload the service environment and auto-update setting |
