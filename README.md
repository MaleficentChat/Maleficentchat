# Maleficent Chat 2.8

# Maleficent Chat

Maleficent Chat is a Node.js + Express + Socket.IO community chat site.

## Included

- First screen is Login / Register.
- Permanent `Maleficent` owner account.
- Default owner password: `Mal@123`.
- Main Room + additional rooms.
- Ranks: Member, VIP, Premium, Mod, Admin, Super Admin, Commissor, Coowner, Owner.
- Rank ordering and rank icons/colors.
- Online/offline presence and last-seen.
- Username mentions with notifications.
- Quote/reply, hide, report, edit, delete, reactions, pin, save/bookmark, copy and forward.
- Typing indicators, delivered/read receipts and timestamps.
- Image/audio upload and browser voice recording.
- User profiles: bio, pronouns, birthday, banner, themes, colors, profile style, badges, verification, creation date, last seen, status and privacy.
- Username change history, password management, account deletion and blocking/unblocking.
- Friends, friend requests, followers/following, profile likes and notifications.
- XP, levels, daily XP limits, XP history and leaderboards.
- Gold wallet, gifting, transaction history and owner gold editing.
- Public/private/password/rank-protected rooms, categories, descriptions, icons, banners, limits, slow mode, announcements, rules, FAQ, read-only mode, room favorites and invite links.
- Room creation/editing/deletion and `/clear` room command through the room controls.
- Moderation warning/mute/kick/ban and revoke actions, moderation history, auto-filtered words, link filtering, automatic escalation, reports and appeals.
- Staff dashboard with reports, appeals, moderation history, filter words, notes and audit logs.
- Owner Space with user/rank/password/verification/badge controls, gold controls, site settings, private-message inspection and owner audit logs.
- Advanced message search and saved-message view.
- Custom emoji upload foundation.
- Responsive desktop/tablet/mobile layout.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Render

The project includes `render.yaml`. Set a strong `SESSION_SECRET` in production. You can optionally set:

- `OWNER_USERNAME`
- `OWNER_PASSWORD`
- `OWNER_DISPLAY_NAME`

The requested defaults are `Maleficent` and `Mal@123`.

## Data

The current project keeps its lightweight application data in `data/db.json` and uploaded media in `uploads/`. For a larger production deployment, move sessions, users, messages and media to persistent services/database storage.


## Maleficent Chat V3 feature layer

This build adds a backwards-compatible feature registry for all 1000 requested feature slots, expanded account/profile settings, custom status, password change, security sessions/login history endpoints, notification preferences, user search/mute APIs, owner analytics, security headers, and a Feature Center UI. The registry is intentionally data-driven so the remaining feature implementations can be enabled incrementally without replacing the existing chat system.

## September 2026 functional/UI update
- Reference-style personal profile settings with working Edit info, relationship, username, About Me, mood, email and password actions.
- Working profile Like/Unlike, Friends, Block, Report and virtual gifts.
- Owner Space now includes a Feature Granting Panel with server-enforced minimum-rank permissions for implemented features.
- Room creation, room clearing and news publishing use configurable feature permissions.
- Improved mobile layout for the sidebar, chat composer, profiles, modals and owner controls.

The feature permission settings are stored in `data/db.json` under `featurePermissions` after the first owner change.


## Data persistence
The app now supports `PERSISTENT_DATA_DIR`/`DATA_FILE`. The supplied Render configuration mounts a persistent disk at `/opt/render/project/src/data` so accounts and site data are not reset when the service restarts or redeploys. If your Render plan does not support persistent disks, use an external database or upgrade to a plan that does.


## 2.5 update notes

- Feature Granting now exposes only the functional feature controls and enforces the selected minimum rank server-side, so lower ranks cannot use a feature assigned to a higher rank.
- Reported-message deletion now uses the same feature permission as normal message deletion.
- Mobile chat composer stays visible and has a compact More/Tools drawer for attachment and voice actions.
- Notification, report, and private-message indicators now show unread counts instead of only dots.
- Saved Messages no longer shows the redundant Open button.
- The permanent Owner can edit their own gold through Owner Space.
- Added Diaval, an AI chat bot. Mention `@Diaval` in a room to receive an AI response.
- Mention autocomplete now includes Aurora and Diaval.

### Diaval AI setup

For real AI responses, set these Render/server environment variables:

- `OPENAI_API_KEY` = your OpenAI API key
- `OPENAI_MODEL` = optional model name (defaults to `gpt-5-mini`)

The API key is used server-side and is never sent to browser JavaScript. Without the key, Diaval remains visible and responds with a configuration message instead of exposing a key or failing silently.


## Maleficent Chat 3.1 Ultimate Community Upgrade

Expanded the existing feature-rich build with a Community Hub, polls, poll voting, personal/site theme support, unified community search, room watch-together queues, daily number challenge, Tic-Tac-Toe, event RSVP, and a numeric mark-all-notifications API. Existing authentication, account settings, notifications, mentions, friends, profiles, gifts, reactions, XP/levels, achievements, daily rewards, rooms, games, staff moderation, owner controls, security/session tools, news, saved messages, advanced search and local Diaval functionality are preserved.
