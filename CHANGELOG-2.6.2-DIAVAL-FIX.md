# Maleficent Chat 2.6.2 — Diaval AI Fix

- Reworked Diaval mention parsing to support `@Diaval question`, `Diaval, question`, and `Diaval: question`.
- Removed the repetitive generic fallback.
- Added explicit diagnostics when OPENAI_API_KEY is missing or the Responses API returns an error.
- Uses `OPENAI_MODEL` from Render, defaulting to `gpt-5.6-luna`.
- Preserves recent room context while sending the actual question to the model.
- Does not expose the API key to the browser.
