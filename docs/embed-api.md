# Embed API (v1)

This app supports a lightweight iframe embed contract on the `ward-embed` channel.

## Boot parameters

- `embed=1` or `embed=true`: enable embed shell mode (reduced app chrome).
- `page=board-preview`: boot directly into board preview.
- `view=board`: boot play view in board mode.
- `parentOrigin=https://host.example`: strongly recommended for cross-origin embeds.

Example:

`https://your-app.example/?embed=1&page=board-preview&view=board&parentOrigin=https%3A%2F%2Fhost.example`

## Message envelope

All messages use this envelope:

```json
{
  "channel": "ward-embed",
  "version": 1,
  "type": "..."
}
```

## Child -> Parent events

- `ready`
  - Sent when embed mode initializes.
  - Includes: `embed`, `activePage`, `playViewMode`, `animationSpeed`, `focusedCardId`.
- `state`
  - Sent in response to parent `request-state`.
  - Includes: `embed`, `activePage`, `playViewMode`, `animationSpeed`, `focusedCardId`.
- `heightChanged`
  - Sent when embedded content height changes (via `ResizeObserver`).
  - Includes: `embed`, `height`.
- `snapshot`
  - Sent in response to parent `request-snapshot`.
  - Includes: `embed`, `activePage`, `playViewMode`, `animationSpeed`, `focusedCardId`, `timestamp`.
- `error`
  - Sent when a host message is rejected (origin mismatch or invalid command).
  - Includes: `embed`, `code`, `message`.
- `eventApplied`
  - Sent when host command is accepted and applied (`set-page`, `set-view`, `set-animation-speed`, `focus-card`).
  - Includes: `embed`, `command`, `timestamp`.
- `capabilities`
  - Sent in response to parent `request-capabilities`.
  - Includes: `embed`, `commands[]`, `events[]`.

## Parent -> Child commands

- `set-page`
  - Payload: `{ "type": "set-page", "page": "play" | "board-preview" }`
- `set-view`
  - Payload: `{ "type": "set-view", "view": "board" | "split" | "text" }`
- `set-animation-speed`
  - Payload: `{ "type": "set-animation-speed", "speed": number }`
  - Current bridge normalizes to the range `0.25` to `4`.
- `focus-card`
  - Payload: `{ "type": "focus-card", "cardId": string }`
  - Current bridge stores `focusedCardId` for state/snapshot responses.
- `request-state`
  - Payload: `{ "type": "request-state" }`
- `request-snapshot`
  - Payload: `{ "type": "request-snapshot" }`
- `request-capabilities`
  - Payload: `{ "type": "request-capabilities" }`

## Origin checks

- If `parentOrigin` is provided, inbound messages must match that origin.
- Otherwise, the app falls back to `document.referrer` origin when available.
- If neither is available, only same-origin messages are accepted.

## Auth bootstrap

- For production embedding strategy, see: `docs/embed-auth-bootstrap.md`.

## Host example

```html
<iframe
  id="ward"
  src="https://your-app.example/?embed=1&page=board-preview&view=board&parentOrigin=https%3A%2F%2Fhost.example"
></iframe>
<script>
  const frame = document.getElementById('ward');
  window.addEventListener('message', (event) => {
    if (event.origin !== 'https://your-app.example') return;
    if (!event.data || event.data.channel !== 'ward-embed') return;
    console.log('embed message', event.data);
  });

  function setBoardView() {
    frame.contentWindow.postMessage(
      { channel: 'ward-embed', version: 1, type: 'set-view', view: 'board' },
      'https://your-app.example'
    );
  }
</script>
```

## Local test harness

- While running the client locally, open:
  - `/embed-host-harness.html`
- The harness loads an embedded frame with:
  - `?embed=1&page=board-preview&view=board&parentOrigin=<current-origin>`
- Use the control buttons to send `set-page`, `set-view`, and `request-state` messages and inspect the message log.
- Full validation flow: `docs/embed-verification-checklist.md`.
