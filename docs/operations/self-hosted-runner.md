# GugakSignage Windows self-hosted runner

## Workflow routing and permissions

The existing `CI` workflow and `validate` job remain named as before; the displayed job check is still `Validate on Windows`. Pushes and same-repository pull requests select the repository runner with labels `self-hosted`, `Windows`, `X64`, and `gugaksignage-ci`. Fork-origin pull requests select `windows-latest`. The workflow-dispatch path and any event not explicitly admitted to the runner also select `windows-latest`.

The fork check compares `github.event.pull_request.head.repo.full_name` with `github.repository`. A missing head repository fails closed to `windows-latest`. Keep this condition intact in `.github/workflows/ci.yml`. Fork PRs must not be approved to run on this PC's runner. Review changes to the CI workflow as part of the same-repository trust boundary.

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
| Runner name and label | Pending same-repository PR run |
| PR head SHA | Pending |
| Actions run and job IDs | Pending |
| Conclusion and executed steps | Pending |
| Required-check names | `CI / Validate on Windows` (workflow and job names unchanged) |
| Fork selection | Fork PRs use `windows-latest`; no fork PR was created or run |
| Service elevation | Not available in the current non-elevated session; the owner must run the elevated bootstrap above |
