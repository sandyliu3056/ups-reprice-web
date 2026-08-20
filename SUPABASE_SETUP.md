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

## 5. Site URL

In **Authentication > URL Configuration**, set **Site URL** to the production
website address and add any preview address under **Redirect URLs**.

## Security notes

- A private GitHub repository protects repository access, but browser-delivered
  HTML and JavaScript can still be inspected by a signed-in user.
- Uploaded invoices and rate files are processed locally in the browser by the
  current web edition.
- The old plaintext passwords remain in Git history. Rotate them before launch,
  then rewrite the public history or create a clean private repository.
