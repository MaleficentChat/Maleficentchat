# Maleficent Chat 3.5 — Games, Clubs, Community Hub & Bot Management

## Games
- RPS now displays both choices and an explicit win/loss/draw result.
- Dice now displays both rolls and an explicit win/loss/draw result.
- Game score records now include total wins, losses, draws and games played.
- Recent game history stores the exact result summary for the player.
- Scores/leaderboard now displays the full record instead of only wins.

## Clubs
- Club entry opens a real club space with members and chat.
- Members can leave clubs (except the owner).
- Club owners can edit club name, icon, description and privacy.
- Public/private club state is shown in the club UI.
- Club membership and messages persist in db.json.

## Community Hub / Feature Lab
- Fixed Feature Lab persistence when older data contained featureLab as an array.
- Feature Lab now uses an object with explicit defaults for implemented systems.
- Save changes persists settings to the server.
- Community Hub reads those saved settings when rendering experimental panels.

## Bot Management
### Mal
- All legacy stored Mal commands are removed once during the 3.5 migration.
- `@Mal Time` remains as the only protected built-in command.
- All other Mal commands are owner-created through management.
- Commands can be added, disabled and deleted.

### Diaval
- Added independent enable/disable management.
- Added editable exact command → response rules.
- Custom rules are checked before the built-in local Diaval assistant.
- Commands can be added, disabled and deleted.

### Aurora
- Added independent enable/disable management.
- Truth and Dare prompt lists can be managed from Owner Space.
- Prompts can be added and deleted.
- Aurora uses the saved prompt lists when responding.

## Feature Granting
Added:
- Manage Aurora bot
- Manage Diaval bot

The bot management controls themselves remain owner-protected in Owner Space.
