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
```

`.env` is ignored by git. `.env.example` has the same local template without secrets that matter.

## 4. Run Migrations

```powershell
pnpm db:migrate
pnpm db:check
```

If both commands pass, the local database is ready.

## 5. Later Railway Mapping

Railway will provide its own `DATABASE_URL`. The same migration command should run against Railway before the production app starts using account-backed data.
