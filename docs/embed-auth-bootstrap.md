# Embed Auth Bootstrap Strategy (Draft)

This document defines a practical auth approach for iframe embedding.

## Goals

- Allow trusted host pages to embed the board without relying only on same-site cookie behavior.
- Keep server-side authority and avoid exposing long-lived credentials to the iframe.
- Support both local dev and production host scenarios.

## Recommended Model

Use a short-lived **embed session token** minted by the server for trusted origins.

### Flow

1. Host site authenticates user in host domain.
2. Host requests an embed token from server endpoint:
   - `POST /api/embed/session`
   - Payload: `{ matchId, view, expiresIn }`
3. Server validates host identity and user access.
4. Server returns short-lived token (JWT or opaque token).
5. Host loads iframe with token bootstrap query:
   - `...?embed=1&embedToken=<token>&parentOrigin=<host-origin>`
6. Client sends token to server on initial connect (or HTTP bootstrap) and upgrades to normal match flow.

## Security Requirements

- Server maintains **origin allowlist** for embed hosts.
- Token TTL should be short (suggestion: 2–5 minutes).
- Token must include:
  - subject/user id
  - allowed match id(s)
  - allowed view scope
  - issuing host origin
  - expiration
- Reject token use when `parentOrigin` mismatches token origin claim.
- Never store long-lived secrets in query params.

## Optional Improvements

- One-time token consumption with nonce replay protection.
- Host-to-child `postMessage` bootstrap instead of query param for token transfer.
- Separate scopes for spectator vs. interactive controls.

## Local Development

- Allow localhost origins (`http://localhost:*`) via explicit dev allowlist.
- Use lower-risk dev tokens with minimal scope and fast expiry.

## Open Implementation Tasks

- [x] Add server endpoint to mint embed session token.
- [x] Add server middleware for token validation on socket/session bootstrap.
- [x] Add client bootstrap path for `embedToken`.
- [ ] Add docs/examples for host-side token refresh before expiry.

## Host-side refresh example (pre-expiry)

1. Track `expiresAt` from `/api/embed/session`.
2. Refresh token before expiry (e.g. 60 seconds early).
3. Reload iframe URL with new `embedToken`.

Pseudo-flow:

```ts
const refreshMs = Math.max(0, new Date(expiresAt).getTime() - Date.now() - 60_000);
setTimeout(async () => {
  const next = await fetch("/api/embed/session", { method: "POST", credentials: "include" }).then(r => r.json());
  iframe.src = `${baseUrl}?embed=1&embedToken=${encodeURIComponent(next.token)}&parentOrigin=${encodeURIComponent(window.location.origin)}`;
}, refreshMs);
```
