const assert = require("node:assert/strict");
const fs = require("node:fs");

const server = fs.readFileSync("server.js", "utf8");
const database = fs.readFileSync("db.js", "utf8");
const render = fs.readFileSync("render.yaml", "utf8");

assert.match(server, /process\.env\.NODE_ENV\s*===\s*["']production["']/,
  "production must enforce an explicit session secret");
assert.match(server, /new PgSession\(\{\s*pool,\s*tableName:\s*["']user_sessions["']/,
  "sessions must be stored in PostgreSQL");
assert.match(server, /const ALLOWED_ORIGINS = new Set/,
  "credentialed CORS must use an explicit origin allowlist");
assert.doesNotMatch(server, /if\(origin\)\s*\{\s*res\.setHeader\(["']Access-Control-Allow-Origin["'],origin\)/,
  "CORS must not blindly reflect arbitrary origins");
assert.match(database, /SELECT l\.id,l\.action_type[\s\S]*FROM admin_logs l/,
  "audit history must be restored from PostgreSQL");
assert.match(server, /const auditRows=await pool\.query\(["']SELECT l\.id,l\.action_type/,
  "staff dashboard must read audit history from PostgreSQL");
assert.match(server, /INSERT INTO admin_logs\(action_type,performed_by,target_user_id,details,created_at\)/,
  "staff audit events must be written to the durable PostgreSQL audit table");
assert.match(server, /await log\(actor,'STAFF_APPLICATION_REJECT'/,
  "staff application rejections must await durable audit logging");
assert.match(server, /await log\(actor,'STAFF_APPLICATION_GRANT'/,
  "staff rank grants must await durable audit logging");
assert.match(server, /after the database transaction commits[\s\S]*target\.rank=requested;/,
  "in-memory rank state must only update after a successful database commit");
assert.match(render, /key:\s*OWNER_PASSWORD/,
  "Render configuration must expose the owner password as a secret");
assert.doesNotMatch(database, /Mal@123/,
  "the public default owner password must not be seeded");
assert.match(server, /featureAllowed\("private_messages"\)[\s\S]*Could not save read receipts/,
  "private-message read receipts must be access-checked and report persistence failures");
assert.match(server, /Persist first: never tell the client a receipt was saved if PostgreSQL failed/,
  "read receipts must only update in-memory state after PostgreSQL succeeds");
assert.match(server, /app\.post\(\s*"\/api\/gold\/gift",[\s\S]*?await client\.query\("BEGIN"\)[\s\S]*?gold >= \$1[\s\S]*?await client\.query\("COMMIT"\)/,
  "gold transfers must use a transaction and prevent overspending");
assert.match(server, /GOLD_SENT[\s\S]*GOLD_RECEIVED/,
  "gold transfer history must record both sender and receiver entries");

assert.match(database, /equippedCosmetics/,
  "equipped cosmetics must be restored from PostgreSQL");
assert.match(server, /equippedCosmetics:Array\.isArray\(u\.equippedCosmetics\)/,
  "equipped cosmetics must be included in safe profile data");
assert.match(server, /u\.equippedCosmetics=equipped\.rows/,
  "equipping a cosmetic must update the live profile state");
assert.match(fs.readFileSync("public/app.js", "utf8"), /equipped-profile-frame[\s\S]*equipped-profile-badge/,
  "profile UI must render equipped frames and badges");
assert.match(server, /Owner private-message inspection failed/,
  "owner private-message inspection must report database failures clearly");
assert.match(server, /sender_username:row\.sender_username\|\|data\.fromUsername/,
  "owner private-message inspection must normalize sender/receiver fields from PostgreSQL");
assert.match(server, /Private-message report evidence failed/,
  "staff private-message evidence endpoint must handle lookup errors");
assert.match(server, /isPermanentMainRoom[\s\S]*!hasFeature\(u,"join_rooms"\)/,
  "joining the permanent Main Room must not depend on optional room-join grants");
assert.match(fs.readFileSync("public/app.js", "utf8"), /state\.rooms\.find\(r => String\(r\.id\) === String\(id\)\)/,
  "room join must tolerate numeric/string room IDs");

console.log("Security, audit-log, messaging persistence, and profile cosmetic static checks passed.");
