# Local User Admin Tools

These commands operate on the local `DATABASE_URL` from `.env`.

## List Users

```powershell
pnpm user:list
```

## Set Email

```powershell
pnpm user:set-email brjaru8 brjaru8@gmail.com
```

## Grant Developer Or Admin Access

```powershell
pnpm user:set-role brjaru8 DEVELOPER
pnpm user:set-dev-tools brjaru8 on
```

Use `PLAYER`, `DEVELOPER`, or `ADMIN` for the role. Developer tools can only be enabled for `DEVELOPER` and `ADMIN` accounts. Eligible users can also turn the tools on or off from their Profile page.

## Reset Password

```powershell
pnpm user:reset-password brjaru8 NewTempPassword123
```

## Delete A Test User

```powershell
pnpm user:delete profile_temp_123
```

Delete cascades account-owned rows such as card ownership through database foreign keys.

## Show Help

```powershell
pnpm user:admin
```
