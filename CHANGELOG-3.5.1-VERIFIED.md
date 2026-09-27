# Maleficent Chat 3.5.1 — Verified Repair Pass

- Repaired Owner Space bot-management UI that referenced a missing client function.
- Added working Mal, Diaval and Aurora management panels.
- Mal now retains only protected `@Mal Time`; custom commands are owner-managed.
- Diaval custom commands are owner-managed and take priority over local fallback replies.
- Aurora Truth/Dare lists are initialized correctly and are owner-managed.
- RPS and Dice now execute on the server and return the actual player/opponent result.
- Game scores record wins, losses, draws and recent game details.
- Added server-side scheduler worker for scheduled messages.
- Added server-side expiry worker that removes expired messages from connected rooms.
- Normalized Community Hub Feature Lab persistence.
- Normalized bot database schemas so empty objects cannot disable functionality accidentally.
