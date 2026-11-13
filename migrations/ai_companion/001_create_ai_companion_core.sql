-- AI Companion foundation for Maleficent Chat.
-- Additive only: does not alter existing chat, account, wallet, session, or media tables.
-- Apply only after a verified production backup and restore test.
BEGIN;

CREATE TABLE ai_companion_schema_migrations (
  version VARCHAR(32) PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_companions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  avatar_url TEXT,
  bio TEXT NOT NULL DEFAULT '',
  personality_type VARCHAR(20) NOT NULL DEFAULT 'preset'
    CHECK (personality_type IN ('preset', 'custom')),
  personality_preset VARCHAR(80),
  backstory TEXT NOT NULL DEFAULT '',
  speaking_style TEXT NOT NULL DEFAULT '',
  likes JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(likes) = 'array'),
  dislikes JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(dislikes) = 'array'),
  behaviour_config JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(behaviour_config) = 'object'),
  status VARCHAR(12) NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'offline', 'busy', 'away')),
  proactive_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(quiet_hours) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, owner_id)
);

CREATE TABLE ai_companion_memories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  companion_id BIGINT NOT NULL REFERENCES ai_companions(id) ON DELETE CASCADE,
  memory_type VARCHAR(40) NOT NULL DEFAULT 'general',
  memory_content TEXT NOT NULL,
  importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  sensitivity VARCHAR(16) NOT NULL DEFAULT 'ordinary'
    CHECK (sensitivity IN ('ordinary', 'sensitive')),
  owner_approved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_companion_relationships (
  companion_id BIGINT PRIMARY KEY REFERENCES ai_companions(id) ON DELETE CASCADE,
  relationship_stage VARCHAR(24) NOT NULL DEFAULT 'stranger'
    CHECK (relationship_stage IN (
      'stranger', 'acquaintance', 'friend', 'close_friend', 'trusted_companion'
    )),
  progress_score INTEGER NOT NULL DEFAULT 0 CHECK (progress_score >= 0),
  interaction_summary JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(interaction_summary) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_conversations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  companion_id BIGINT NOT NULL,
  owner_id INTEGER NOT NULL,
  conversation_type VARCHAR(16) NOT NULL DEFAULT 'dedicated'
    CHECK (conversation_type IN ('dedicated', 'group', 'room_activity')),
  title VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (companion_id, owner_id)
    REFERENCES ai_companions(id, owner_id) ON DELETE CASCADE,
  UNIQUE (id, owner_id)
);

CREATE TABLE ai_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  sender_type VARCHAR(12) NOT NULL
    CHECK (sender_type IN ('owner', 'companion', 'system')),
  message_content TEXT NOT NULL,
  message_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(message_metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_usage_daily (
  companion_id BIGINT NOT NULL REFERENCES ai_companions(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  text_units INTEGER NOT NULL DEFAULT 0 CHECK (text_units >= 0),
  voice_seconds INTEGER NOT NULL DEFAULT 0 CHECK (voice_seconds >= 0),
  image_generations INTEGER NOT NULL DEFAULT 0 CHECK (image_generations >= 0),
  games_activities INTEGER NOT NULL DEFAULT 0 CHECK (games_activities >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (companion_id, usage_date)
);

CREATE TABLE ai_companion_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  companion_id BIGINT NOT NULL REFERENCES ai_companions(id) ON DELETE CASCADE,
  reporter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason VARCHAR(80) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  evidence_reference TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  assigned_staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_group_conversations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_group_members (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES ai_group_conversations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  companion_id BIGINT REFERENCES ai_companions(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (user_id IS NOT NULL AND companion_id IS NULL) OR
    (user_id IS NULL AND companion_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ai_group_member_user_unique
  ON ai_group_members(group_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX ai_group_member_companion_unique
  ON ai_group_members(group_id, companion_id) WHERE companion_id IS NOT NULL;

CREATE TABLE ai_group_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES ai_group_conversations(id) ON DELETE CASCADE,
  sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_companion_id BIGINT REFERENCES ai_companions(id) ON DELETE SET NULL,
  message_content TEXT NOT NULL,
  message_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(message_metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (sender_user_id IS NOT NULL AND sender_companion_id IS NULL) OR
    (sender_user_id IS NULL AND sender_companion_id IS NOT NULL)
  )
);

CREATE INDEX ai_memories_companion_created_idx
  ON ai_companion_memories(companion_id, created_at DESC);
CREATE INDEX ai_conversations_owner_updated_idx
  ON ai_conversations(owner_id, updated_at DESC);
CREATE INDEX ai_messages_conversation_created_idx
  ON ai_messages(conversation_id, created_at);
CREATE INDEX ai_reports_status_created_idx
  ON ai_companion_reports(status, created_at DESC);
CREATE INDEX ai_group_messages_group_created_idx
  ON ai_group_messages(group_id, created_at);

INSERT INTO ai_companion_schema_migrations(version, description)
VALUES ('001', 'Create isolated AI Companion foundation');

COMMIT;
