# Maleficent Chat 2.8

## Major upgrade
- Added dedicated local Diaval chat with persistent per-user history and clear conversation.
- Added Games Hub with RPS and Dice, persistent scores, XP rewards and achievements.
- Added achievement unlocking and achievement notifications for first message, message milestones, games, gifts and profile likes.
- Added notification center actions: mark individual read, delete individual, mark all read, clear all.
- Added daily reward: 25 Gold + 15 XP once per day.
- Added account data export to JSON.
- Completed profile privacy save handling for online/last-seen visibility.
- Improved mobile layouts for Diaval, Games and Notifications.
- Preserved existing rooms, moderation, Owner Space, feature granting, gifts, news, saved messages, search, settings and YouTube functionality.

## Verification
- `node --check server.js` passed.
- `node --check public/app.js` passed.
- `package.json` validated.
- Full dependency-installed server test was not run because node_modules is not included in the project archive.
