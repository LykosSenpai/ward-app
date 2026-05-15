# Railway Deployment Notes

These notes are for the first hosted WARD deployment once the local account/deck/lobby work is stable.

## Services

Create one Railway project with:

- A Postgres database service.
- A Node app service for `@ward/server`.
- A Node app service for `@ward/client`.

The current repo is split by package:

- Client: `apps/client`, Vite dev port `5173`
- Server: `apps/server`, Express/Socket.IO port from `PORT`

## Required Variables

Set these on the `@ward/server` service:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<at least 32 random characters>
CLIENT_ORIGIN=https://your-client-domain.up.railway.app
ENABLE_DEV_TOOLS=false
NODE_ENV=production
PORT=3001
```

Set these on the `@ward/client` service:

```env
VITE_API_BASE_URL=https://your-server-domain.up.railway.app
VITE_ENABLE_DEV_TOOLS=false
PORT=4173
```

Generate a session secret locally with:

```powershell
node -e "console.log(crypto.randomBytes(48).toString('hex'))"
```

Do not reuse the local development `SESSION_SECRET`.

## Build And Start

`railway.json` only defines the shared Railpack build. Keep start commands and
healthchecks in the Railway dashboard so the client and server can start
different packages.

`@ward/server` settings:

```text
Build command: pnpm run railway:build
Start command: pnpm --filter @ward/server start
Public networking port: 3001
Healthcheck path: /health
Pre-deploy command: pnpm --filter @ward/server db:migrate
```

`@ward/client` settings:

```text
Build command: pnpm run railway:build
Start command: pnpm --filter @ward/client exec vite preview --host 0.0.0.0 --port $PORT
Public networking port: 4173
Healthcheck path: leave blank
```

The client Vite preview config allows `wardclient-production.up.railway.app`
and `healthcheck.railway.app`. If the Railway client domain changes, add the
new client host to `apps/client/vite.config.ts` under `preview.allowedHosts`.

Do not configure a shared `deploy.startCommand` in `railway.json`; Railway
applies it to both services, which can make the client try to run the server.

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

Set `VITE_API_BASE_URL` on the client to the hosted server domain because the
client and server are deployed as separate Railway services.

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
