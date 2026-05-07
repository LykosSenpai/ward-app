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
