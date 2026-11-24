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
| Job checkouts | `C:\actions-runners\GugakSignage\_work` |
| Temporary files | `C:\actions-runners\GugakSignage\_temp` |
| Tool cache | `C:\actions-runners\GugakSignage\_toolcache` |
| npm and Playwright caches | `C:\actions-runners\GugakSignage\_cache\npm` and `_cache\ms-playwright` |
| Runner profile | `C:\actions-runners\GugakSignage\home` |
| Installer and operational logs | `C:\actions-runners\GugakSignage\_download` and `_logs` |

The root ACL grants access only to the installing account, SYSTEM, Administrators, and `NT AUTHORITY\LOCAL SERVICE`; the runner service uses LocalService and starts automatically. Its service environment uses a synthetic profile and the isolated temp, tool, npm, and Playwright paths. Sensitive machine-level environment variable names are explicitly blanked. The installer downloads the official Actions runner v2.338.2 and checks its SHA-256 digest before extraction; the binary, token, credentials, and logs stay outside the repository.

The CI job also declares the isolated temp, profile, tool, npm, and Playwright paths at job scope. This keeps subprocesses inside the dedicated root even if the runner service was already online before an environment update; the installer now restarts the service after applying its registry environment. The first self-hosted step rejects any process identity other than `NT AUTHORITY\LOCAL SERVICE`. After checkout, the workflow verifies that the installed admission hook matches the reviewed repository hook while normalizing LF and CRLF line endings.

`InstallService` is safe to retry over a precreated dedicated root. It first resets stale DACLs across only `C:\actions-runners\GugakSignage`, preserving every file and directory, then reapplies the restricted root policy. Existing `_work`, `_toolcache`, runner binaries, and cache contents remain in place. It then repairs the `admission` directory and hook file before replacing the hook, so a protected empty DACL on an old `Assert-TrustedJob.ps1` cannot block the copy. It reuses an existing LocalService runner service and does not request a new registration token when the local runner is already configured.

The first elevated retry on this PC failed because the precreated root contained an old hook with a protected empty DACL. The failure was reproduced locally, the same ACL reset was applied, and validation then passed with the cached archive checksum and admission tests intact. Because no local runner configuration or service was created, retry the same bootstrap command; it will not duplicate registration.

One runner process handles one job at a time. Keep the home-PC total at no more than three concurrent jobs, with at most one runner for each of DBrainPlus, TossPaperLab, and GugakSignage. Do not register a second GugakSignage runner or launch another runner process for this registration.

## Elevated bootstrap

The installer requires Windows elevation and `gh` authenticated to GitHub as a repository administrator. It requests a short-lived runner registration token directly from GitHub in memory, configures the runner service as LocalService, applies the isolated environment, and verifies that the service is automatic and running. It does not write the registration token to a file or print it.

From the existing repo checkout, run this single command from a PowerShell window where the owner can approve the Windows UAC prompt:

```powershell
& 'C:\Users\SUA\orca\workspaces\GugakSignage\gugak-self-hosted-runner\scripts\runner\Install-GugakSignageRunner.ps1' -Mode InstallService -Elevate
```

Use `-Mode ValidateOnly` to verify the pinned runner package and directory layout without configuring a runner or service. If elevation is unavailable, stop before runner registration and record the branch and bootstrap command as the remaining operator action. Do not weaken the ACL, start a foreground runner as the interactive desktop user, or approve a fork pull request onto this runner. A temporary foreground runner is acceptable only from a dedicated noninteractive low-privilege identity with an isolated profile; creating that identity still requires administrator work and local-service login may not be usable for an interactive console.

## Validation evidence

| Evidence | Result |
| --- | --- |
| Runner | ID 2, `GugakSignage-CI-Win11`, labels `self-hosted,Windows,X64,gugaksignage-ci`, online |
| Windows service | `actions.runner.toxicyou25-afk-GugakSignage.GugakSignage-CI-Win11`, Running, Auto, `NT AUTHORITY\\LOCAL SERVICE` |
| Validated implementation SHA | `f944a5c29bae475836f3c8612515339a1822926c` |
| Actions run and job | Run `45509184450`, job `138852170420` |
| Conclusion and steps | Success; 20/20 steps succeeded, including identity, isolation, checkout, hook, Node setup, install, typecheck, build, tests, four UI verifications, artifact upload, and cleanup |
| Identity evidence | Job log: `Runner process identity: NT AUTHORITY\\LOCAL SERVICE` |
| Precreated-root ACL repair | `D:PAI` reproduced on the old hook and cached archive; dedicated-root reset preserved both; archive SHA-256 and admission tests passed |
| Required-check names | `CI / Validate on Windows` (workflow and job names unchanged) |
| Fork selection | Workflow routes fork PRs to `windows-latest`; runner admission hook denies them before steps; no fork PR was created or run |
| Service elevation | The owner already approved UAC for the bootstrap; retry the command above for GugakSignage after pulling this branch |
