"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function expectFailure(fn, label) {
  let failed = false;
  try { await fn(); } catch { failed = true; }
  if (!failed) throw new Error("Expected constraint failure: " + label);
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for isolated migration tests.");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
  });
  await client.connect();
  try {
    await client.query("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL)");
    await client.query("INSERT INTO users(id,username) VALUES (1,'test-owner'),(2,'other-owner')");
    const migration = fs.readFileSync(path.join(__dirname,"..","migrations","ai_companion","001_create_ai_companion_core.sql"),"utf8");
    await client.query(migration);

    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'ai_%'");
    if (tables.rowCount !== 12) throw new Error("Expected 12 AI tables, found " + tables.rowCount);
    const version = await client.query("SELECT version FROM ai_companion_schema_migrations WHERE version='001'");
    if (version.rowCount !== 1) throw new Error("Migration marker missing.");

    const companion = await client.query(
      "INSERT INTO ai_companions(owner_id,name) VALUES(1,'Test companion') RETURNING id"
    );
    const companionId = companion.rows[0].id;
    await expectFailure(
      () => client.query("INSERT INTO ai_companions(owner_id,name) VALUES(1,'Duplicate')"),
      "one companion per account"
    );
    await expectFailure(
      () => client.query("INSERT INTO ai_companions(owner_id,name,likes) VALUES(2,'Bad likes','{}'::jsonb)"),
      "likes must be a JSON array"
    );
    await expectFailure(
      () => client.query("INSERT INTO ai_conversations(companion_id,owner_id) VALUES($1,2)",[companionId]),
      "conversation owner must match companion owner"
    );

    const conversation = await client.query(
      "INSERT INTO ai_conversations(companion_id,owner_id) VALUES($1,1) RETURNING id",[companionId]
    );
    await client.query(
      "INSERT INTO ai_messages(conversation_id,sender_type,message_content) VALUES($1,'owner','hello')",
      [conversation.rows[0].id]
    );
    await client.query(
      "INSERT INTO ai_companion_memories(companion_id,memory_content) VALUES($1,'Owner-approved test memory')",
      [companionId]
    );
    await client.query(
      "INSERT INTO ai_usage_daily(companion_id,usage_date,text_units) VALUES($1,CURRENT_DATE,1)",
      [companionId]
    );
    await expectFailure(
      () => client.query("INSERT INTO ai_companion_memories(companion_id,memory_content,importance) VALUES($1,'invalid',9)",[companionId]),
      "memory importance range"
    );

    const existingUserRows = await client.query("SELECT count(*)::int AS n FROM users");
    if (existingUserRows.rows[0].n !== 2) throw new Error("Existing user fixture unexpectedly changed.");

    const rollback = fs.readFileSync(path.join(__dirname,"..","migrations","ai_companion","001_rollback_ai_companion_core.sql"),"utf8");
    await client.query(rollback);
    const remaining = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'ai_%'");
    if (remaining.rows[0].n !== 0) throw new Error("Rollback left AI tables behind.");
    const usersAfter = await client.query("SELECT count(*)::int AS n FROM users");
    if (usersAfter.rows[0].n !== 2) throw new Error("Rollback modified the users table.");

    console.log("AI Companion migration test passed: schema, constraints, ownership, basic writes, rollback, and existing-user preservation.");
  } finally {
    await client.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
