# Site Monitor Inventory Implementation Plan

> **For agentic workers:** Execute each task with TDD and keep file ownership disjoint when delegating.

**Goal:** Let a Manager inspect every Player PC's latest physical monitor report and current screen-assignment coverage for one site.

**Architecture:** Add an admin-only site-scoped read model over the existing device, monitor-report, display, group, and playlist tables. Reuse the current report and assignment validation path; show stale reports for inspection while keeping offline monitor IDs unavailable for new assignments. Extend the current topology editor.

**Tech Stack:** Node.js 24, TypeScript, Express, SQLite, vanilla JavaScript/CSS, Playwright.

**Spec:** docs/design/manager-player-api.md, section “v1.0 Site monitor inventory”; docs/design/ui-ux.md.

## Global Constraints

- No database migration, new dependency, or external service.
- Return PCs attached to this site plus registered PCs with no site or display assignment, matching the existing selector pool; exclude PCs assigned elsewhere and mark candidates siteAssigned=false.
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

The returned object is { siteId, generatedAt, devices }. Each device has { deviceId, name, siteAssigned, localHost, status, online, lastSeen, publishedVersion, monitorReport, assignments, logicalDisplayCount, assignedDisplayCount, unassignedDisplayIds }. status preserves the existing online/offline/pending distinction, and online is true only for status online. monitorReport is { reported, reportedAt, ageMs, monitors }. Each assignment is { displayId, displayName, groupId, groupName, playlistId, playlistName, nativeMonitorId, monitorDetected }. Devices include site members and unassigned candidates (site_id NULL with no displays elsewhere); candidates are marked siteAssigned=false; devices attached to other sites are excluded. Assignments include enabled draft displays only. A missing report has reported=false, reportedAt=null, ageMs=null, monitors=[]; an empty successful report has reported=true and monitors=[].

- [ ] Extend the topology integration test “site monitor inventory keeps each Player report and assignment coverage separate”. Create an unassigned online PC with one monitor report and a PC on another site; assert the response includes the two site PCs plus the unassigned candidate with siteAssigned=false and excludes the other-site PC. Assert the first site PC has a missing report, the second has two reported monitors and 1/1 coverage, unknown-site returns 404, and unauthenticated requests return 401. Temporarily make the first PC pending with an empty successful report; assert status=pending, online=false, reported=true, monitors=[]. Restore the fixture.
- [ ] Run the focused API test and confirm the route is absent.
- [ ] Implement the read model and admin route without changing assignment or publish behavior.
- [ ] Verify the focused test passes and unauthenticated requests remain rejected.

### Task 2: Per-PC inventory panel

**Files:** Modify public/admin/topology.js, public/admin/styles.css, and scripts/verify-multimonitor.mjs.

- [ ] Add a failing browser assertion to scripts/verify-multimonitor.mjs named “site monitor inventory shows each Player and last report”. Assert site devices and an unassigned candidate, online/offline/pending text, the offline row's stale label, its two monitor rows, and the assigned/unassigned coverage text.
- [ ] Run the focused browser verifier and confirm the current UI does not yet expose the per-site inventory rows.
- [ ] Replace repeated per-device monitor reads with the site inventory response; render per-PC state and preserve local monitor-change history.
- [ ] Keep offline monitor IDs out of selectable options while showing their last-known state.
- [ ] Run the browser verifier at desktop and narrow viewport widths.

### Task 3: API and operations documentation

**Files:** Modify docs/design/manager-player-api.md and docs/design/multimonitor.md.

- [ ] Document the response contract, draft/live distinction, and stale-report policy.
- [ ] Run npm run typecheck, npm test, npm run build, and npm run verify:multimonitor.
