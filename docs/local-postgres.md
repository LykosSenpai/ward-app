# Local Postgres Setup

WARD uses `DATABASE_URL` for account, ownership, deck, and lobby data.

## 1. Install Postgres

On this Windows machine, `winget` is available. Install PostgreSQL with:

```powershell
winget install PostgreSQL.PostgreSQL.17
```

During installation, choose a password for the default `postgres` admin user and keep the default port `5432`.

After installation, restart PowerShell if `psql` is not found.

## 2. Create The Local Database

Open PowerShell and run:

```powershell
psql -U postgres
```

Then run these SQL commands:

```sql
create user ward_app with password 'ward_app_dev';
create database ward_app owner ward_app;
\q
```

## 3. Configure The App

Create `.env` in the repo root with:

```env
DATABASE_URL=postgres://ward_app:ward_app_dev@localhost:5432/ward_app
CLIENT_ORIGIN=http://localhost:5173
SESSION_SECRET=ward-local-dev-session-secret-change-before-hosting
ENABLE_DEV_TOOLS=true
SKIP_LOCAL_EMAIL_VERIFICATION=true
SKIP_LOCAL_EMAIL_LOGIN_CODE=true
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3001/api/auth/discord/callback
VITE_API_BASE_URL=http://localhost:3001
VITE_SKIP_LOCAL_EMAIL_VERIFICATION=true
VITE_ENABLE_DEV_TOOLS=true
```

`.env` is ignored by git. `.env.example` has the same local template without secrets that matter.

### Optional Discord OAuth

For local Discord sign-in or account linking, create a Discord application in the Discord Developer Portal and copy its OAuth2 client ID and client secret into `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.

Add this exact redirect URL to the application's OAuth2 redirect list:

```text
http://localhost:3001/api/auth/discord/callback
```

Restart the server after changing `.env`. The local client can stay on `http://localhost:5173`; Discord redirects back to the server on port `3001`, and the server redirects the browser back to the client after the callback completes.

## 4. Run Migrations

```powershell
pnpm db:migrate
pnpm db:check
```

If both commands pass, the local database is ready.

## 5. Later Railway Mapping

Railway will provide its own `DATABASE_URL`. The same migration command should run against Railway before the production app starts using account-backed data.
