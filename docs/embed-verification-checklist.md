# Embed Verification Checklist

Use this checklist before merging embed-related changes.

## Start local harness

1. Start the client:
   - `pnpm -C apps/client run dev:embed-harness`
2. Confirm the browser opens `/embed-host-harness.html`.

## Boot contract checks

- Verify iframe URL contains:
  - `embed=1`
  - `page=board-preview`
  - `view=board`
  - `parentOrigin=<local origin>`
- Verify app chrome is hidden in iframe (header/nav/socket-id).

## Messaging checks

- Wait for `ready` message in the harness log.
  - Must include `channel: "ward-embed"` and `version: 1`.
  - Must include `activePage`, `playViewMode`, `animationSpeed`, and `focusedCardId`.
- Click `request-state` and verify `state` message appears.
- Click `request-snapshot` and verify `snapshot` message appears.
- Click `request-capabilities` and verify `capabilities` message appears.
- Click each `set-view` button and verify state updates accordingly.
- Click each `set-page` button and verify page switches accordingly.
- Click `set-animation-speed` buttons and verify `eventApplied` + updated `animationSpeed` in next `state`.
- Click `focus-card` and verify `eventApplied` + updated `focusedCardId` in next `state`.

## Negative checks

- In browser devtools console, send message with wrong channel and verify no state changes.
- Send `ward-embed` message with unsupported `type` and verify `error` event (`INVALID_COMMAND`).
- If testing cross-origin host, omit `parentOrigin` and verify child only accepts same-origin/referrer-derived messages.

## Exit criteria

- All checks above pass without console errors.
- `pnpm -C apps/client run check` passes.
- `pnpm -C apps/client run build` passes.
