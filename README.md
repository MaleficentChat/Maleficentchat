# Maleficent Chat 3.6.1

A cleaned deployment build of Maleficent Chat.

## Included
- `server.js` — Express/Socket.IO backend
- `public/` — frontend
- `data/db.json` — persistent application data store
- `render.yaml` — Render deployment configuration with a persistent disk
- `package.json` — production dependencies and start command

## 3.6.1 changes
- Message actions are hidden behind a compact `⋯` menu.
- Mobile user list is a toggleable drawer that can be opened/closed.
- Added the Stefan utility bot: type `@stefan options` in a room to open an in-chat tools box.
- Stefan exposes room tools such as clearing, YouTube, announcements, pinned messages, invites, Aurora, scheduling, expiry, and owner room controls according to permissions.
- Expiring messages use persisted `expiresAt`, server-side cleanup, exact client cleanup, and expired messages are excluded from reloads.
- Expanded owner Feature Granting with messaging, reporting, reactions, pins, saving, scheduling, expiry, YouTube, announcements, staff dashboard, filters and bot/community controls.
- Added atomic database writes to reduce the chance of account/settings loss during a write.
- Added Owner Space `Save & Backup site`, creating a timestamped backup on the persistent data disk.
- Owner save also commits the visible site-settings form before creating the backup.

## Render persistence
`render.yaml` mounts `/opt/render/project/src/data` as a persistent Render disk and points `PERSISTENT_DATA_DIR` there. Accounts and database changes therefore survive normal deploys/restarts while that persistent disk remains attached.

For the Owner account, set `OWNER_PASSWORD` as a Render environment variable.

## Start locally
```bash
npm install
npm start
```
