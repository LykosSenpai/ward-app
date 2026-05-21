# Reports System Scope & Next Steps

## Current scope (implemented)
- In-app Reports tab with create/update/retest/reopen workflows.
- Addendum support to reduce duplicate reports.
- Suggestion vs Bug intent tagging.
- Match/card-linked report context.
- In-match "needs retest" indicators and shortcuts.
- Shared server-backed report listing/creation/update via:
  - `GET /api/reports`
  - `POST /api/reports`
  - `PATCH /api/reports/:ticketId`
- Local cache fallback for resilience.

## What remains for future hardening
- Add feature-flag visibility controls for reports (currently visible to all authenticated users).
- Add server integration tests for report metadata roundtrip (status/addendums/notes).
- Add optimistic-lock or conflict handling for concurrent edits.
- Add explicit UI indicator when a report is local-fallback (not synced).
- Optional: migrate naming/types from legacy `qa*` internals to neutral `report*` naming across code.

## Home test checklist
1. Sign in with User A, create a report in Reports tab.
2. Sign in with User B, confirm User A report is visible.
3. Update status to `Ready for Retest`, refresh, verify it persists.
4. Add addendum from Reports tab, refresh, verify it persists.
5. Open live match containing related card and verify:
   - report button highlight appears,
   - retest notice appears,
   - board report modal shows matching retest item.
6. Click `Add Addendum` from board report modal and verify it targets existing report.
7. Export single report JSON and all reports JSON and validate expected fields exist.

## Known behavior
- If backend call fails, client falls back to local cache update to avoid data loss.
