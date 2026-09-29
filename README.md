# Maleficent Chat 3.6.6

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
- Gold-backed gift catalog, owner gift CRUD, and animated gift messages
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

## 3.6.6 Repair Integration
- Database startup no longer drops tables or deletes user-created rooms. The two age-banded default rooms remain permanent and additional rooms are loaded from PostgreSQL.
- Room creation is enabled for authorized ranks, default room edits/deletions are blocked, and room age limits are checked by HTTP and Socket.IO.
- Registration fingerprints are hashed and stored in PostgreSQL. Socket authentication validates the signed session token instead of trusting a client-supplied user ID.
- Added the Admin Logs modal and improved email editing and private-message inspection results.
- Existing PostgreSQL data is retained by migrations; use a database backup before deployment as with any schema migration.
