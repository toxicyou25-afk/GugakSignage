# Site Monitor Inventory Implementation Plan

> **For agentic workers:** Execute each task with TDD and keep file ownership disjoint when delegating.

**Goal:** Let a Manager inspect every Player PC's latest physical monitor report and current screen-assignment coverage for one site.

**Architecture:** Add an admin-only site-scoped read model over the existing device, monitor-report, display, group, and playlist tables. Reuse the current report and assignment validation path; show stale reports for inspection while keeping offline monitor IDs unavailable for new assignments. Extend the current topology editor.

**Tech Stack:** Node.js 24, TypeScript, Express, SQLite, vanilla JavaScript/CSS, Playwright.

**Spec:** docs/design/manager-player-api.md, section “v1.0 Site monitor inventory”; docs/design/ui-ux.md.

## Global Constraints

- No database migration, new dependency, or external service.
- Only PCs connected to the requested site may be returned.
- Assignments describe the saved draft, not the active publication.
- Offline snapshots remain visible with their age; existing server checks still reject new offline assignments.
- Escape server-provided strings and preserve existing topology and playback behavior.
- Physical monitor and separate-PC field checks remain NOT_RUN in issue #13.

## Review Focus

- Unauthorized or cross-site reads: verify the endpoint uses the existing admin middleware and site scope.
- Missing report versus a successful empty report: preserve the distinction.
- Offline device with a stale report: show last-known information but no selectable stale binding.
- Saved binding absent from the report: show the assignment and missing-monitor state separately.
- HTML metacharacters in PC, monitor, display, or playlist names: render as text.

---

### Task 1: Site-scoped monitor inventory API

**Files:** Create src/monitor-inventory.ts; modify src/routes/topology.ts; test test/multimonitor.test.ts.

**Interface:** monitorInventoryForSite(db: DB, siteId: string, heartbeatOnlineMs: number): SiteMonitorInventory | null.

The returned object is { siteId, generatedAt, devices }. Each device has { deviceId, name, localHost, online, lastSeen, publishedVersion, monitorReport, assignments, logicalDisplayCount, assignedDisplayCount, unassignedDisplayIds }. monitorReport is { reported, reportedAt, ageMs, monitors }. Each assignment is { displayId, displayName, groupId, groupName, playlistId, playlistName, nativeMonitorId, monitorDetected }. Devices are scoped by the site; assignments include enabled draft displays only. A missing report has reported=false, reportedAt=null, ageMs=null, monitors=[]; an empty successful report has reported=true and monitors=[].

- [ ] Add the API regression in the existing topology integration test, named “site monitor inventory keeps each Player report and assignment coverage separate”. Use its two Player devices: the first has no monitor report; the second reports MONITOR\\REMOTE-PRIMARY and an unbound monitor, has one enabled display assigned to the primary, and is then marked offline with an older report timestamp. Assert 2 devices for the requested site, the first report is absent, the second report retains both monitors and a positive age, second display coverage is 1 assigned of 1 with the display ID and monitorDetected=true, and an unknown site returns 404. A request without the admin cookie must return 401.
- [ ] Run the focused API test and confirm the route is absent.
- [ ] Implement the read model and admin route without changing assignment or publish behavior.
- [ ] Verify the focused test passes and unauthenticated requests remain rejected.

### Task 2: Per-PC inventory panel

**Files:** Modify public/admin/topology.js, public/admin/styles.css, and scripts/verify-multimonitor.mjs.

- [ ] Add a failing browser assertion to scripts/verify-multimonitor.mjs named “site monitor inventory shows each Player and last report”. Assert two device rows, the offline row's stale label, its two monitor rows, and the assigned/unassigned coverage text.
- [ ] Run the focused browser verifier and confirm the current UI does not yet expose the per-site inventory rows.
- [ ] Replace repeated per-device monitor reads with the site inventory response; render per-PC state and preserve local monitor-change history.
- [ ] Keep offline monitor IDs out of selectable options while showing their last-known state.
- [ ] Run the browser verifier at desktop and narrow viewport widths.

### Task 3: API and operations documentation

**Files:** Modify docs/design/manager-player-api.md and docs/design/multimonitor.md.

- [ ] Document the response contract, draft/live distinction, and stale-report policy.
- [ ] Run npm run typecheck, npm test, npm run build, and npm run verify:multimonitor.
