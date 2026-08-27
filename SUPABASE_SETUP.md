# Supabase login setup

The web app now uses Supabase Auth. It no longer stores accounts, passwords, or
fake sessions in `index.html` or `localStorage`.

## 1. Create the project

1. Create a Supabase project.
2. Open **Project Settings > API**.
3. Copy the **Project URL** and the browser-safe **anon/publishable key**.
4. Paste them into `auth-config.js`.

Never put a `service_role` or secret key in this repository.

## 2. Lock down registration

In **Authentication > Providers > Email**, disable public user sign-ups. This
keeps the login page public while only accounts created by the owner can enter.

## 3. Create users

In **Authentication > Users**, create each approved user with an email address
and a temporary password. Users should change any password that was previously
stored in the public repository.

Optional display names can be stored in user metadata as:

```json
{"display_name":"Sandy"}
```

## 4. Admin role

Roles are read only from protected `app_metadata`; they are never trusted from
editable user metadata. Set an administrator through the SQL editor with the
user's UUID:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"role":"admin"}'::jsonb
where id = 'USER_UUID';
```

All other users default to the `user` role.

## 5. Administrator login history

Run `supabase/login_history.sql` once in the Supabase SQL Editor. It creates:

- a login history table protected by Row Level Security;
- a server-side function that records the signed-in user's verified ID, email,
  login time, and browser information;
- an administrator-only read policy based on protected `app_metadata.role`.

The browser never receives a `service_role` key. The in-app history records
successful sign-ins after this setup is installed. Supabase **Authentication >
Logs** remains the source for failed attempts and IP addresses.

## 6. Site URL

In **Authentication > URL Configuration**, set **Site URL** to the production
website address and add any preview address under **Redirect URLs**.

## Security notes

- A private GitHub repository protects repository access, but browser-delivered
  HTML and JavaScript can still be inspected by a signed-in user.
- Uploaded invoices and rate files are processed locally in the browser by the
  current web edition.
- The old plaintext passwords remain in Git history. Rotate them before launch,
  then rewrite the public history or create a clean private repository.

## 7. Settings sync for local-account mode（本機帳號模式的設定同步）

While the site runs in local-account mode (`LOCAL_MODE = true` in
`index.html`), sign-in does not go through Supabase Auth, but saved settings
can still follow the account across computers.

Run `supabase/local_settings.sql` once in the Supabase SQL Editor. It creates:

- a `local_settings` table with Row Level Security enabled and **no**
  policies, so the anon key can never read or list it directly;
- two `security definer` functions (`local_settings_get` /
  `local_settings_put`) that require the caller to present the full sync key.

The sync key is computed in the browser at sign-in time as
`PBKDF2(password, salt = "ups-reprice::" + username, 600000 rounds, SHA-256)`,
rendered as 64 hex characters. It cannot be derived from the login hashes
stored in the repository. The iteration count is what makes guessing expensive:
a single unsalted SHA-256 can be tried hundreds of millions of times a second,
and nothing rate-limits the RPC. Salting with the username stops one
precomputed table from covering every account. Data stored under the previous
sha256-derived key is moved across automatically at sign-in (`syncMigrate` in
index.html). Pressing **Save settings** uploads
the settings under that key; signing in on any other computer with the same
account and password downloads them again.

The same SQL also creates `local_history` (plus its RPCs), which syncs stored
invoice history the same way: every invoice period filed on one computer is
compressed (gzip) in the browser and uploaded under the account's sync key,
and signing in elsewhere downloads any periods that computer does not have
yet (or that were re-imported more recently). Periods are only added or
replaced — deleting local browser data on one computer does not delete the
account's cloud copy.

Changing a password changes the key — settings saved under the old password
stay behind, so save once more after a password change.

If this SQL has not been run yet, the app keeps working exactly as before:
settings are saved in the browser only, and each save shows a "cloud sync
failed" notice.
