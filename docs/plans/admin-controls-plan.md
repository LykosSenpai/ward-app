# WARD Admin Controls Plan

## Purpose

Build a dedicated Admin Controls system for the WARD website so owner/admin accounts can safely manage rollout, visibility, moderation, and operational controls without changing code for every launch step.

The first priority is feature rollout control:

- Keep Card Library, Deck Builder, and Marketplace ready for public use.
- Keep Lobby, Online Gameplay, Play Table, and unfinished systems hidden until ready.
- Let admins preview hidden pages while regular users cannot access them.

This plan is intentionally scoped to admin controls first. Marketplace implementation should be planned separately after the feature rollout controls exist.

---

## Goals

1. Add a central Admin Controls page.
2. Add server-backed feature toggles for public tab/page visibility.
3. Let admins preview/test hidden pages.
4. Hide disabled tabs from regular users.
5. Block disabled feature actions on the server.
6. Make it easy to roll out new pages without code changes.
7. Keep admin-only development tools hidden from regular users permanently.

---

## Non-Goals For This Phase

Do not implement these in the first admin-controls pass:

- Marketplace post management.
- Payment or sale handling.
- Lobby matchmaking logic.
- Full user moderation tools.
- Analytics dashboards.
- Database migration to production auth if the app is still local-first.

This phase should only create the admin-control foundation and feature rollout toggles.

---

## Recommended Admin Sections

The Admin Controls page should eventually include these sections:

```text
Feature Rollout
User Management
Marketplace Moderation
Card Data Tools
Effect Dev Tools
System Status
Audit Log
```

For the first pass, implement only:

```text
Feature Rollout
System Status preview/basic info
```

---

## Feature Rollout Requirements

Admins need to toggle public access to major tabs/pages.

Recommended first feature keys:

```ts
export type FeatureKey =
  | "card-library"
  | "deck-builder"
  | "marketplace"
  | "saved-matches"
  | "play-table"
  | "match-lobby"
  | "online-gameplay"
  | "effect-tools"
  | "admin-tools";
```

Recommended feature flag shape:

```ts
export type ServerFeatureFlag = {
  key: FeatureKey;
  label: string;
  description: string;
  enabledForPlayers: boolean;
  adminCanPreview: boolean;
  adminOnly: boolean;
  sortOrder: number;
  updatedAt: string;
};
```

---

## Recommended Default Flags

```text
card-library
- Enabled for players: true
- Admin only: false
- Admin can preview: true

 deck-builder
- Enabled for players: true
- Admin only: false
- Admin can preview: true

marketplace
- Enabled for players: false until the page is ready, then true
- Admin only: false
- Admin can preview: true

saved-matches
- Enabled for players: false
- Admin only: false
- Admin can preview: true

play-table
- Enabled for players: false
- Admin only: false
- Admin can preview: true

match-lobby
- Enabled for players: false
- Admin only: false
- Admin can preview: true

online-gameplay
- Enabled for players: false
- Admin only: false
- Admin can preview: true

effect-tools
- Enabled for players: false
- Admin only: true
- Admin can preview: true

admin-tools
- Enabled for players: false
- Admin only: true
- Admin can preview: true
```

---

## Storage Plan

### Option A — Local JSON First

Use this if the project is still primarily local JSON-backed.

Create:

```text
data/admin/feature-flags.json
```

Example:

```json
{
  "features": [
    {
      "key": "card-library",
      "label": "Card Library",
      "description": "Browse the WARD card library.",
      "enabledForPlayers": true,
      "adminCanPreview": true,
      "adminOnly": false,
      "sortOrder": 10,
      "updatedAt": "2026-05-13T00:00:00.000Z"
    },
    {
      "key": "deck-builder",
      "label": "Deck Builder",
      "description": "Build and manage decks.",
      "enabledForPlayers": true,
      "adminCanPreview": true,
      "adminOnly": false,
      "sortOrder": 20,
      "updatedAt": "2026-05-13T00:00:00.000Z"
    },
    {
      "key": "marketplace",
      "label": "Marketplace",
      "description": "Trade and want-list marketplace.",
      "enabledForPlayers": false,
      "adminCanPreview": true,
      "adminOnly": false,
      "sortOrder": 30,
      "updatedAt": "2026-05-13T00:00:00.000Z"
    }
  ]
}
```

### Option B — Database Later

When the hosted version moves to a database, migrate the same model into a table.

Suggested migration:

```text
apps/server/src/db/migrations/0005_admin_feature_flags.sql
```

```sql
create table if not exists admin_feature_flags (
  key text primary key,
  label text not null,
  description text not null default '',
  enabled_for_players boolean not null default false,
  admin_can_preview boolean not null default true,
  admin_only boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## Server Implementation Plan

### Files To Add

```text
apps/server/src/admin/adminFeatureFlags.ts
```

Responsibilities:

- Load all feature flags.
- Save updated feature flags.
- Return feature visibility for the current user.
- Validate admin-only behavior.
- Provide guard helpers for server routes and socket actions.

Suggested helper functions:

```ts
export function isAdminUser(user?: { role?: string } | null): boolean {
  return user?.role === "ADMIN" || user?.role === "OWNER";
}

export async function listFeatureFlagsForUser(
  user: { role?: string } | null
): Promise<ServerFeatureFlag[]> {
  const flags = await loadFeatureFlags();
  const isAdmin = isAdminUser(user);

  if (isAdmin) return flags;

  return flags.filter(flag => !flag.adminOnly && flag.enabledForPlayers);
}

export async function canAccessFeature(
  user: { role?: string } | null,
  featureKey: FeatureKey
): Promise<boolean> {
  const flag = await getFeatureFlag(featureKey);
  const isAdmin = isAdminUser(user);

  if (!flag) return false;
  if (isAdmin) return flag.adminCanPreview || flag.adminOnly;
  if (flag.adminOnly) return false;

  return flag.enabledForPlayers;
}

export async function requireFeatureAccess(
  user: { role?: string } | null,
  featureKey: FeatureKey
): Promise<void> {
  const allowed = await canAccessFeature(user, featureKey);

  if (!allowed) {
    throw new Error("This feature is not available yet.");
  }
}
```

---

## Server API / Socket Plan

Add API routes or socket events depending on current architecture.

### Read Feature Flags

```text
GET /api/admin/features
```

Admin response:

```ts
{
  features: ServerFeatureFlag[];
}
```

Regular user response can use a separate route:

```text
GET /api/features
```

Return only features the user can see.

---

### Update Feature Flag

```text
PATCH /api/admin/features/:key
```

Body:

```ts
{
  enabledForPlayers: boolean;
}
```

Rules:

- Admin only.
- Validate the feature key.
- Do not allow `adminOnly` features to be publicly enabled unless the implementation explicitly allows it.
- Update `updatedAt`.
- Broadcast visibility changes to connected clients.

Socket broadcast after update:

```ts
io.emit("features:visibilityChanged");
```

Clients should reload feature visibility when this event fires.

---

## Server Guards

The feature rollout system must block server actions too.

Guard Marketplace actions with:

```text
marketplace
```

Guard Lobby actions with:

```text
match-lobby
```

Guard Online Gameplay actions with:

```text
online-gameplay
```

Guard public Play Table actions with:

```text
play-table
```

Admin bypass is allowed for preview/testing.

Example:

```ts
socket.on("lobby:create", async (payload, ack) => {
  try {
    await requireFeatureAccess(socket.data.user, "match-lobby");
    // existing lobby create logic
  } catch (error) {
    ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
  }
});
```

---

## Client Implementation Plan

### Files To Update

```text
apps/client/src/clientTypes.ts
apps/client/src/App.tsx
apps/client/src/socket.ts
apps/client/src/App.css
```

### Files To Add

```text
apps/client/src/components/AdminControlsPage.tsx
apps/client/src/components/admin/AdminFeatureRolloutPanel.tsx
```

---

## Client App State

Add app state for feature flags:

```ts
const [featureFlags, setFeatureFlags] = useState<ServerFeatureFlag[]>([]);
```

Derived lookup:

```ts
const featureFlagsByKey = useMemo(() => {
  return Object.fromEntries(featureFlags.map(flag => [flag.key, flag]));
}, [featureFlags]);
```

On mount / socket connect:

```ts
socket.emit("features:list", response => {
  if (response.ok) setFeatureFlags(response.features);
});
```

On broadcast:

```ts
socket.on("features:visibilityChanged", () => {
  socket.emit("features:list", response => {
    if (response.ok) setFeatureFlags(response.features);
  });
});
```

---

## Client Navigation Registry

Replace scattered tab visibility checks with a central page registry.

Example:

```ts
const PAGE_FEATURES: Array<{
  page: AppPage;
  label: string;
  featureKey?: FeatureKey;
  alwaysVisible?: boolean;
  adminOnly?: boolean;
}> = [
  { page: "card-library", label: "Card Library", featureKey: "card-library" },
  { page: "deck-builder", label: "Deck Builder", featureKey: "deck-builder" },
  { page: "marketplace", label: "Marketplace", featureKey: "marketplace" },
  { page: "play-table", label: "Play Table", featureKey: "play-table" },
  { page: "match-lobby", label: "Lobby", featureKey: "match-lobby" },
  { page: "profile", label: "Profile", alwaysVisible: true },
  { page: "effect-tools", label: "Effect Tools", featureKey: "effect-tools", adminOnly: true },
  { page: "admin-controls", label: "Admin Controls", featureKey: "admin-tools", adminOnly: true }
];
```

Visibility helper:

```ts
function canSeePage(page: AppPage): boolean {
  const entry = PAGE_FEATURES.find(item => item.page === page);
  if (!entry) return false;

  const isAdmin = authUser?.role === "ADMIN" || authUser?.role === "OWNER";

  if (entry.alwaysVisible) return true;
  if (entry.adminOnly) return isAdmin;
  if (isAdmin) return true;
  if (!entry.featureKey) return false;

  return featureFlagsByKey[entry.featureKey]?.enabledForPlayers === true;
}
```

Auto-redirect if the current page becomes hidden:

```ts
useEffect(() => {
  if (!canSeePage(activePage)) {
    setActivePage(getFirstVisiblePage());
  }
}, [activePage, featureFlagsByKey, authUser]);
```

---

## Admin Controls UI

Create:

```text
apps/client/src/components/AdminControlsPage.tsx
```

First version sections:

```text
Feature Rollout
System Status
```

Create:

```text
apps/client/src/components/admin/AdminFeatureRolloutPanel.tsx
```

Each feature row should show:

```text
Feature label
Description
Current public status
Admin-only status
Toggle enabled for players
Last updated
```

Status badges:

```text
Enabled for players
Hidden from players
Admin only
```

Admin-only features should have the public toggle disabled unless intentionally unlocked later.

---

## Admin Controls UI Behavior

When admin toggles a feature:

1. Optimistically disable the row controls.
2. Send update to server.
3. Server saves the change.
4. Server broadcasts `features:visibilityChanged`.
5. Client reloads feature flags.
6. Display success/failure message.

Error handling:

- Show clear error if save fails.
- Restore previous toggle state if update fails.
- Do not leave UI in a half-updated state.

---

## Permission Rules

Recommended role behavior:

```text
OWNER
- Can view all admin controls.
- Can toggle all non-admin-only public features.
- Can manage admin roles later.

ADMIN
- Can view admin controls.
- Can toggle rollout flags.
- Cannot expose admin-only tools unless specifically allowed.

PLAYER / USER
- Cannot access admin controls.
- Cannot call admin feature update routes.
- Only sees enabled public features.
```

---

## Audit Log Plan

Add later, not required for first pass.

Future audit log entry shape:

```ts
type AdminAuditLogEntry = {
  id: string;
  actorUserId: string;
  action: string;
  targetType: "FEATURE_FLAG" | "USER" | "MARKETPLACE_POST" | "SYSTEM";
  targetId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};
```

Useful actions:

```text
FEATURE_ENABLED_FOR_PLAYERS
FEATURE_DISABLED_FOR_PLAYERS
ADMIN_ONLY_FEATURE_UPDATE_BLOCKED
USER_ROLE_CHANGED
MARKETPLACE_POST_HIDDEN
```

---

## Implementation Order

### Step 1 — Add Types

- Add `FeatureKey` and `ServerFeatureFlag` to shared/client/server types as appropriate.

### Step 2 — Add Storage

- Add `data/admin/feature-flags.json` for local-first storage.
- Add loader/saver functions.

### Step 3 — Add Server Helpers

- Add `adminFeatureFlags.ts`.
- Add `canAccessFeature` and `requireFeatureAccess`.

### Step 4 — Add Feature List/Update Events

- Add `features:list` for all users.
- Add `admin:features:list` for admins if separate admin data is needed.
- Add `admin:features:update` for admin toggles.
- Broadcast `features:visibilityChanged` after updates.

### Step 5 — Add Client Feature State

- Fetch flags on app load.
- Refetch on socket reconnect.
- Refetch on `features:visibilityChanged`.

### Step 6 — Centralize Navigation Visibility

- Replace hardcoded page/tab visibility with `PAGE_FEATURES` registry.
- Add redirect if active page becomes hidden.

### Step 7 — Add Admin Controls Page

- Add `AdminControlsPage.tsx`.
- Add `AdminFeatureRolloutPanel.tsx`.
- Add basic styling.

### Step 8 — Add Server Guards

- Guard unfinished marketplace/lobby/play actions.
- Return clear error for regular users.
- Allow admin preview/testing.

---

## Smoke Test

Run:

```powershell
cd C:\Users\brjar\Documents\ward-app
pnpm.cmd check
pnpm.cmd --filter @ward/server dev
pnpm.cmd --filter @ward/client dev
```

Test admin behavior:

1. Log in as admin.
2. Confirm Admin Controls tab appears.
3. Open Feature Rollout section.
4. Disable Card Library for players.
5. Confirm admin still sees Card Library with hidden/disabled status.
6. Re-enable Card Library.
7. Confirm status updates without a full server restart.

Test regular user behavior:

1. Log in as regular user.
2. Confirm Admin Controls tab does not appear.
3. Confirm disabled tabs do not appear.
4. Try to directly open a disabled page route if routes exist.
5. Confirm the app redirects to the first visible page.
6. Try a disabled socket/server action.
7. Confirm the server rejects it.

Test reconnect behavior:

1. Open app as regular user.
2. Toggle a feature as admin from another browser/session.
3. Confirm regular user UI updates after broadcast or refresh.
4. Restart server and client.
5. Confirm feature flag state persists.

---

## Done Criteria

This phase is complete when:

- Admin Controls page exists.
- Admin can toggle public feature visibility.
- Feature visibility persists.
- Regular users only see enabled public tabs.
- Admin users can preview hidden features.
- Admin-only tools stay admin-only.
- Server guards block disabled feature actions.
- Disabled active pages redirect safely.
- `pnpm.cmd check` passes.

---

## Notes For Future Marketplace Work

Marketplace should be behind the `marketplace` feature key from day one.

Before public marketplace launch:

- Enable `marketplace` for admins only during development.
- Build manual post creation first.
- Add matching/cross-linking second.
- Add pending trade confirmation third.
- Only then enable `marketplace` for players.

Do not expose Lobby or Online Gameplay publicly until player-specific hand visibility, reconnect handling, seat assignment, and server-side action validation are ready.
