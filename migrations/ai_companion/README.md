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
