# Maleficent Chat 2.6 — fixes

- Added working delete controls for room announcements.
- Added the missing `deleteNews()` client handler so the existing Delete News button actually removes news.
- Added persistent RPS and Dice scores plus a Game Scores leaderboard.
- Fixed the self-profile hamburger button by replacing the broken inline handler with a real event listener.
- Expanded profile data returned by the server and surfaced pronouns, mood, relationship, location and website on the profile.
- Expanded Edit Info to save location, website and interests as well.
- Kept server-side feature permission enforcement and refresh the client permission state after saving grants.
- Improved Diaval fallback behavior so it does not simply repeat the user's message when an AI API key is unavailable; when `OPENAI_API_KEY` is configured, Diaval continues to use the AI service.
- Added announcement-delete socket refresh handling.
- Added profile/game UI styling.
