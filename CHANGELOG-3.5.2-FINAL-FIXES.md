# Maleficent Chat 3.5.2 — Final Community & Bot Fixes

## Games
- RPS and Dice are resolved server-side.
- Results explicitly show the player's result, Diaval's result, and win/loss/draw.
- Wins, losses, draws, total games, and recent game history are persisted.

## Clubs
- Clubs now have an actual community area with membership and chat.
- Club owners can edit name, icon, banner, description, privacy and announcement.
- Owners/authorized staff can promote/demote club moderators, remove members, and delete clubs.

## Community Hub / Feature Lab
- Feature Lab has a real Save Changes flow.
- Saved switches persist and now control the corresponding Community Hub sections.
- More Platform Tools are gated by their Feature Lab settings.

## Bots
- Mal keeps only the protected `@Mal Time` built-in command.
- A one-time 3.5.2 migration clears legacy Mal commands without clearing future custom commands.
- Diaval has independent custom command management.
- Aurora has independent enable/disable and Truth/Dare prompt management.
- Bot management panels are wired to the Owner Space buttons.
