-- DESTRUCTIVE rollback for AI Companion migration 001.
-- Do not run unless companion data is intentionally being discarded and a verified backup exists.
BEGIN;
DROP TABLE IF EXISTS ai_group_messages;
DROP TABLE IF EXISTS ai_group_members;
DROP TABLE IF EXISTS ai_group_conversations;
DROP TABLE IF EXISTS ai_settings;
DROP TABLE IF EXISTS ai_companion_reports;
DROP TABLE IF EXISTS ai_usage_daily;
DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS ai_conversations;
DROP TABLE IF EXISTS ai_companion_relationships;
DROP TABLE IF EXISTS ai_companion_memories;
DROP TABLE IF EXISTS ai_companions;
DROP TABLE IF EXISTS ai_companion_schema_migrations;
COMMIT;
