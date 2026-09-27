# Maleficent Chat 3.4 — Reliability & Community Fixes

## Fixed
- RPS and Dice now show the player's roll/choice, Diaval's roll/choice, the winner/draw state, and save the result before marking it saved.
- Game progress refreshes immediately after a recorded game.
- Default virtual gifts now load even when `data/db.json` contains an empty `gifts` array. Added six built-in gifts.
- Gift sending remains tied to the sender's gold and now has a usable catalog out of the box.
- Message expiry timestamps are attached before Socket.IO broadcasts the message, preventing clients from receiving an incomplete message object.
- Scheduled messages are processed with a persistent queue, emitted to the correct room, and notify the owner when their scheduled message is sent.
- Scheduled-message UI validates that the selected time is genuinely in the future.

## New
- Owner Space → **Mal AI Bot Management** for custom exact-match `@Mal <command>` responses, enable/disable control, editing, and deletion.
- Clubs now have a real **Enter Club** experience with membership, member list, club feed, and club messages instead of only a join action.
- Feature Lab now uses a real **Save changes** button and persists the complete selected configuration.
- Feature Lab settings are applied to supported Community Hub cards.
- Feature Granting now includes:
  - Manage Mal AI commands
  - Manage Feature Lab
  - Manage clubs
  - Enter private clubs
- Added visual polish for game results, club pages, and Mal AI management.

## Data additions
- `featurePermissions`
- `featureLab`
- `malAI`
- `scheduledMessages`
- `clubs`
- `clubMembers`
- `clubMessages`
