# Railway Deployment Notes

These notes are for the first hosted WARD deployment once the local account/deck/lobby work is stable.

## Services

Create one Railway project with:

- A Postgres database service.
- A Node app service for the WARD server.
- One Node app service can serve both the WARD API/Socket.IO server and the built Vite client from `apps/client/dist`.

The current repo is still optimized for local split dev:

- Client: `apps/client`, Vite dev port `5173`
- Server: `apps/server`, Express/Socket.IO port from `PORT`

## Required Variables

Set these on Railway:

```env
DATABASE_URL=<Railway Postgres connection string>
SESSION_SECRET=<at least 32 random characters>
CLIENT_ORIGIN=https://your-client-domain.example
ENABLE_DEV_TOOLS=false
VITE_API_BASE_URL=
VITE_ENABLE_DEV_TOOLS=false
NODE_ENV=production
```

Generate a session secret locally with:

```powershell
node -e "console.log(crypto.randomBytes(48).toString('hex'))"
```

Do not reuse the local development `SESSION_SECRET`.

## Build And Start

Initial combined app service settings:

```text
Build command: pnpm run railway:build
Start command: pnpm start
```

These commands are also checked into `railway.json` so Railway deployments do not fall back to running TypeScript source files directly.

Before using account-backed production data, run migrations against Railway:

```powershell
pnpm db:migrate
```

For a production workflow, prefer a Railway one-off command or deploy step that runs:

```text
pnpm --filter @ward/server db:migrate
```

## Production Guards

The server refuses to start in production if `SESSION_SECRET` is shorter than 32 characters.

`CLIENT_ORIGIN` must match the hosted client origin so browser cookies and Socket.IO credentials work correctly.

Express sessions are stored in Postgres in the `user_sessions` table so logins survive server restarts.

Leave `VITE_API_BASE_URL` blank for a combined Railway deployment where the server serves the built client from the same origin. Set it only if the client is hosted on a different domain from the server.

Keep `ENABLE_DEV_TOOLS=false` and `VITE_ENABLE_DEV_TOOLS=false` for public player builds. Set both to `true` only for private development deployments that should expose effect authoring, coverage, LLM test, debug, and forced-roll controls.

## Before First Public Test

- Confirm `pnpm db:migrate` succeeds against Railway Postgres.
- Confirm `GET /health` returns `ok: true`.
- Register one account from the hosted client.
- Login, logout, and login again.
- Change profile email/display name.
- Change ownership count on one card and refresh to confirm it persists.
- Confirm another account does not see that ownership count.

## Later Hardening

- Add email verification and password reset through an email provider.
- Tune auth rate limits once real traffic patterns are known.
- Add admin roles before exposing any admin UI in production.
