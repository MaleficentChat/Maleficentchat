# Maleficent Chat 3.6.7

Render-ready Node.js + Express + Socket.IO build.

## Persistence
- PostgreSQL via `pg` and `process.env.DATABASE_URL`
- TLS uses `ssl: { rejectUnauthorized: false }`
- No `data/db.json` or filesystem JSON database
- `db.js` creates the requested `users`, `settings`, `gifts`, `wall_posts`, `history`, and `filter_words` tables, plus `wall_comments`
- Only `Maleficent` is seeded as the permanent owner

## Render
Set these environment variables:
- `DATABASE_URL` — your Render PostgreSQL connection string
- `SESSION_SECRET`
- `OWNER_PASSWORD`
- Optional `OWNER_USERNAME` / `OWNER_DISPLAY_NAME`

The included `render.yaml` is configured for these values and keeps the existing persistent disk for uploaded media only.

## Included upgrades
- Gold-backed gift catalog with owner gift management, private delivery, and a received-gift history
- Friend Wall with rank-controlled posting, likes, comments, reports, and owner pinning
- Premium request workflow and gold-funded temporary VIP
- VIP expiration check at login
- Bulk filter-word entry using newline/ENTER only, with live search/counts
- Owner password Show/Hide view and account details
- Configurable wall-post and history-clear rank lists
- Mobile Online Users drawer and overflow fixes
- PWA manifest + service worker
- RPS and Dice removed


## 3.6.4 Render Fix Pack
- PostgreSQL `Pool` uses `DATABASE_URL` with `ssl: { rejectUnauthorized: false }`.
- `Maleficent` is permanently protected as `Developer` and is not assignable from rank controls.
- Registration/login return a 7-day signed token; the browser stores it as `mc_token` and sends it as `X-Auth-Token`.
- Rooms and room messages are persisted in PostgreSQL.
- Private messages and private-message reports are persisted in PostgreSQL.
- Owner/Developer Site Settings and uniform feature grants are persisted in the `settings` JSONB table.
- Gift creation supports URL strings or uploaded files.
- Desktop CSS is preserved; only the final mobile height override changes the chat viewport.

## 3.6.7 Repair Integration
- Database startup preserves user-created rooms. The two default community rooms are open, and My Rooms lists rooms you own or have joined.
- Room creation is enabled for authorized ranks, default room edits/deletions are blocked, and room entry has no age-verification step.
- Registration fingerprints are hashed and stored in PostgreSQL. Socket authentication validates the signed session token instead of trusting a client-supplied user ID.
- Main-room and private-message sends include the required session and room access tokens.
- Private-message lists show names and usernames without exposing message previews. Conversation inspection is restricted to Owner Space.
- Staff dashboards include Admin Logs and account modifications; duplicate owner logs and staff private-message inspection controls were removed.
- Gifts use a catalog-backed, gold-funded transaction flow with private recipient delivery and persistent gift history.
- Feature grants cover every rank-gated feature exposed by the Owner Space panel.
- Existing PostgreSQL data is retained by migrations; use a database backup before deployment as with any schema migration.
