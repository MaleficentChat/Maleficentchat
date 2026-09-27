# Maleficent Chat 2.4 — merged rebuild

This build starts from the 2.2 full-request build so previously working features are retained.

## Restored/retained from 2.2
- Aurora Truth/Dare bot
- Active @mention suggestions and blue mentions
- Pinned messages room menu
- Saved-message open/jump
- Account Settings UI
- Staff username/email controls
- Staff rank controls
- System moderation notices
- Gold sharing and owner gold controls
- Custom gift creation/sending
- YouTube room integration
- Profile actions
- Mobile/user-list styling

## Fixes in this merge
- Settings view now actually calls `loadSettings()` instead of remaining blank.
- Feature granting is limited to 15 real permission controls; the large catalog is no longer shown.
- Owner management allows assigning OWNER to users (the permanent Maleficent account remains protected).
- Owner can edit their own gold through Owner Space.
- Rank controls are available directly from user profiles for authorized staff/owner.
- User cards are square and compact.
- Personalized nickname control is visible on accepted-friend profiles.
- Added private-message file/photo/audio/video attachment UI using the existing multipart DM backend.
- Added a direct YouTube button to the chat composer.
- Added a direct personalized-gift button to the chat composer.
- Notification indicator is green for unread notifications; report indicator remains red.


## 2.5.1 fixes
- Numeric notification bubbles.
- Owner self-gold editing no longer blocked by protected rank save.
- Personalized nicknames no longer require friendship.
- Account appearance settings now apply immediately.
- Registration requires email, date of birth and gender.
- Filtered words are masked in the sent message and trigger automatic mute.
- Kick/ban state separated from mute; kicked users are locked from rooms and banned users cannot log in.
- Warning popup shown immediately with reason.
- Games section added to Users view.
- Staff active moderation list with action and rank filters.
- User list rank filter.
- Diaval flow preserved.
