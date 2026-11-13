# Maleficent Chat AI Companion foundation

Status: proposed implementation branch; migration is intentionally not applied.

## Scope
- Adds a separate companion, memory, relationship, conversation, usage, report, settings, and group-chat schema.
- References the existing `users(id)` key as INTEGER.
- Enforces one companion per MC account.
- Enforces conversation ownership with a composite foreign key.
- Does not modify existing messages, sessions, wallets, accounts, or media tables.

## Required before production activation
1. Take a verified logical backup of the current production database.
2. Restore it into an isolated PostgreSQL instance and validate existing records and sequences.
3. Review the migration against the restored schema.
4. Apply the migration to the isolated instance and run integration/security tests.
5. Obtain approval for production database continuity and the production migration.
6. Deploy code with the feature disabled; enable only after migration and smoke tests.

## Security requirements for application integration
- Derive the authenticated owner ID from the server session, never request body parameters.
- Check MC eligibility server-side (Premium or higher) using the current approved rank mapping.
- Check staff permissions server-side; do not reuse the legacy rank order without a compatibility review.
- Only the exact Owner rank may change global limits and provider settings.
- Super Admin+ personality edits must not mutate memories or relationship state.
- Do not expose private memory or conversation contents to ordinary moderators.
- Keep provider API keys in environment secrets, never in this table.
- Enforce per-category quotas atomically in the database.

## Rollback
Prefer disabling the feature and preserving its data. Do not drop these tables during an application rollback. A destructive schema rollback requires a separate explicit approval and verified backup.


## Application foundation added on the feature branch

The branch now also contains ai-companion.js, public/ai-companion.js, and public/ai-companion.css. The authenticated API currently covers one companion per account, companion personality edits, private text conversations, owner-managed memories, separate memory/history clearing, and a server-side daily text quota. The client adds a dedicated navigation view and companion editor/chat.

The application integration deliberately remains fail-closed:
- AI_COMPANION_ENABLED must be exactly true.
- The migration must already exist in the target database.
- AI_COMPANION_API_KEY is a separate environment secret; existing translation credentials are not reused.
- Optional provider variables: AI_COMPANION_API_URL, AI_COMPANION_MODEL, and AI_COMPANION_DAILY_TEXT_LIMIT.
- Default model is gpt-4o-mini; default text allowance is 80 user messages/day. Configure provider limits and pricing before enabling the feature.

The current code is a foundation, not the complete approved blueprint. Voice, image generation, group/room participation, proactive greetings and quiet-hour scheduling, owner-created companion provisioning, staff management/report UI, cross-account personality management, and non-text usage counters are not yet implemented. Do not enable or describe these as available.

Before production use, run the branch checks and an isolated PostgreSQL restore test, review the rank adapter against the live rank data, apply the migration only after the separately approved database continuity process, configure the dedicated provider secret, and perform end-to-end privacy/quota/rollback tests.

Additional authenticated staff API endpoints now support Coowner+ report review and companion disable, Super Admin+ personality edits that preserve memories/relationship state, and Owner-only member companion provisioning plus global daily text quota configuration. Staff-facing management screens are still pending; these endpoints are not exposed as finished UI controls.
