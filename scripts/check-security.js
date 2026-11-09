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
assert.match(server, /const isAgeRoom=\/\^\(teen chat\|adult chat\)\$\/i\.test\(String\(r\.name\|\|""\)\.trim\(\)\)/,
  "Teen Chat and Adult Chat must remain the only age-room join-grant exemptions");
assert.match(server, /if\(!isAgeRoom&&!isStaffAccount&&!hasFeature\(u,"join_rooms"\)\)/,
  "custom rooms must continue to enforce the room-join grant");
const systemNoticeStart = server.indexOf("function systemNotice(text, roomId=null){");
const systemNoticeEnd = server.indexOf("\n}", systemNoticeStart);
assert.ok(systemNoticeStart >= 0 && systemNoticeEnd > systemNoticeStart,
  "system notices must have a dedicated routing function");
const systemNoticeSource = server.slice(systemNoticeStart, systemNoticeEnd);
assert.doesNotMatch(systemNoticeSource, /main room|db\.rooms\[0\]/i,
  "site-wide notices must never fall back to the retired Main Room or the first database room");
assert.match(systemNoticeSource, /if\(roomId\)[\s\S]*auroraRoomMessage\(text,roomId\)/,
  "room-scoped notices must be delivered only to their explicitly selected room");
assert.match(server, /roomDelivery\.emit\("message",m\)/,
  "persisted room messages must be pushed through Socket.IO");
assert.match(server, /io\.to\("user:"\+v\.id\)\.emit\("dm",m\)/,
  "private messages must be pushed to the recipient's authenticated Socket.IO room");
const activeClient = fs.readFileSync("public/app.js", "utf8");
const accountEditorStart = activeClient.indexOf("function openProfileEditMenu(targetUser=null){");
const accountEditorEnd = activeClient.indexOf("function openAccountUploadMenu(targetUser=null){", accountEditorStart);
assert.ok(accountEditorStart >= 0 && accountEditorEnd > accountEditorStart,
  "the account editor must expose its own action list");
const accountEditorSource = activeClient.slice(accountEditorStart, accountEditorEnd);
assert.match(accountEditorSource, /title:'Remove profile picture'[\\s\\S]*show:self\\|\\|\\(!self&&canModify&&canAccessStaffTarget\\(user\\)\\)/,
  "the Edit account menu must expose picture removal to the owner and authorized staff on lower-ranked profiles");
assert.match(accountEditorSource, /title:'Remove background'[\\s\\S]*show:self\\|\\|\\(!self&&canModify&&canAccessStaffTarget\\(user\\)\\)/,
  "the Edit account menu must expose background removal to the owner and authorized staff on lower-ranked profiles");
assert.match(accountEditorSource, /removeProfilePicture'[\s\S]*deleteStaffProfileMedia\(user,'avatar'\)/);
assert.match(accountEditorSource, /removeProfileBackground'[\s\S]*deleteStaffProfileMedia\(user,'banner'\)/);
assert.match(activeClient, /state\.socket\.on\("message"/,
  "the browser must subscribe to Socket.IO room-message events");
assert.match(activeClient, /state\.socket\.on\("dm"/,
  "the browser must subscribe to Socket.IO private-message events");
assert.match(activeClient, /function startActiveDMMessageBackgroundSync\(\)[\s\S]*?setInterval\(async\(\)=>[\s\S]*?refreshActiveDMMessageList\(peerId\)[\s\S]*?\},2000\)/,
  "the active private conversation must have single-flight recovery for missed realtime events");
assert.match(activeClient, /startActiveDMMessageBackgroundSync\(\)/,
  "active private-message recovery must start after login");
assert.match(server, /app\.post\(["']\/api\/news["'][\s\S]*?io\.emit\(["']news["']\)/,
  "publishing a News post must broadcast a live feed update");
assert.match(activeClient, /state\.socket\.on\(["']news["'][\s\S]*?loadNews\(\)/,
  "the open News feed must refresh on live post events");
const mobileStyles = fs.readFileSync("public/style.css", "utf8");
assert.match(mobileStyles, /#viewRooms\.chatting \.composer\{[^}]*display:grid/s,
  "the mobile chat composer must use a real grid layout so its input and send button stay visible");
assert.doesNotMatch(server + activeClient + fs.readFileSync("public/index.html", "utf8") + fs.readFileSync("package.json", "utf8"), /\bAbly\b|ably-live|@ably\//i,
  "Socket.IO must be the only active realtime transport");

assert.match(server, /UPDATE rooms SET is_default=false WHERE name IN \(\x27Main Room\x27,\x27Teen Chat\x27,\x27Adult Chat\x27\)/,
  "legacy Main Room must not remain a default room");
assert.ok(server.includes('if(String(room.name||"").trim().toLowerCase()==="main room")return false;'),
  "the retired Main Room must not be exposed by the room-list API");
assert.doesNotMatch(activeClient, /syncLiveMessages\(|livePollUrl\(|startLiveSync\(/,
  "room and private-message bodies must not rely on recurring REST history synchronization");
assert.doesNotMatch(activeClient, /refreshRoomMessageList\(sentRoomId|refreshActiveDMMessageList\(String\(id\)/,
  "successful sends must not trigger a second history fetch to make messages appear");
assert.match(fs.readFileSync("public/app.js", "utf8"), /state\.rooms\.find\(r => String\(r\.id\) === String\(id\)\)/,
  "room join must tolerate numeric/string room IDs");

console.log("Security, audit-log, messaging persistence, and profile cosmetic static checks passed.");


const app = fs.readFileSync("public/app.js", "utf8");
assert.equal((app.match(/async function loadSuggestions\(\)/g) || []).length, 1,
  "suggestions must have a single renderer so the richer status UI is not overwritten");
assert.equal((app.match(/case "suggestions":/g) || []).length, 1,
  "navigation must contain only one suggestions route");

console.log("Suggestions renderer/navigation regression checks passed.");

const currentStart = server.indexOf("function current(req){");
const currentEnd = server.indexOf("\n}", currentStart);
assert.ok(currentStart >= 0 && currentEnd > currentStart,
  "current() authentication resolver must exist");
const currentSource = server.slice(currentStart, currentEnd);
assert.ok(
  currentSource.indexOf('req.headers["x-auth-token"]') >= 0 &&
  currentSource.indexOf('req.headers["x-auth-token"]') < currentSource.indexOf("const sessionUid=req.session?.userId"),
  "a valid signed client token must be resolved before a possibly stale cookie session"
);

const doodleSaveStart = app.indexOf("$('doodleSave')?.addEventListener");
const doodleSendStart = app.indexOf("$('doodleSend')?.addEventListener", doodleSaveStart);
assert.ok(doodleSaveStart >= 0 && doodleSendStart > doodleSaveStart,
  "Doodle Studio save and send handlers must exist");
assert.match(app.slice(doodleSaveStart, doodleSendStart), /await loadDoodleLibrary\(\)/,
  "saving a doodle must refresh the saved-drawings library immediately");

const staffNoteReadStart = server.indexOf("app.get('/api/admin/profile-note/:userId'");
const staffNoteReadEnd = server.indexOf("\n", staffNoteReadStart);
assert.ok(staffNoteReadStart >= 0 && staffNoteReadEnd > staffNoteReadStart,
  "legacy staff-note read endpoint must exist for regression coverage");
const legacyStaffNoteRead = server.slice(staffNoteReadStart, staffNoteReadEnd);
assert.match(legacyStaffNoteRead, /target=findUser\(req\.params\.userId\)/,
  "legacy staff-note reads must resolve the target account before querying notes");
assert.match(legacyStaffNoteRead, /!canAccessStaffTarget\(actor,target\)/,
  "legacy staff-note reads must enforce the same strict rank hierarchy as the dedicated endpoint");
assert.match(legacyStaffNoteRead, /LEFT JOIN users u ON u\.id=n\.added_by/,
  "legacy staff-note reads must keep the actual note author attached to each result");

const staffAccessStart = server.indexOf("function canAccessStaffTarget(actor,target){");
const staffAccessEnd = server.indexOf("\n}", staffAccessStart);
assert.ok(staffAccessStart >= 0 && staffAccessEnd > staffAccessStart,
  "shared staff-target authorization helper must exist");
const rankListStart = server.indexOf("const ranks=[");
const rankListEnd = server.indexOf("];", rankListStart);
assert.ok(rankListStart >= 0 && rankListEnd > rankListStart,
  "role ordering must exist for staff-target policy tests");
const rankNames = [...server.slice(rankListStart, rankListEnd).matchAll(/\"([A-Z_]+)\"/g)].map(match => match[1]);
const vm = require("node:vm");
const policyContext = {
  rankOrder: Object.fromEntries(rankNames.map((rank, index) => [rank, index])),
  DEFAULT_OWNER: "Maleficent"
};
vm.runInNewContext(`${server.slice(staffAccessStart, staffAccessEnd + 2)}\nglobalThis.canAccessStaffTarget = canAccessStaffTarget;`, policyContext);
assert.equal(policyContext.canAccessStaffTarget({id: "1", rank: "MOD"}, {id: "2", rank: "ADMIN"}), false,
  "moderators must not read or manage higher-ranked staff notes");
assert.equal(policyContext.canAccessStaffTarget({id: "1", rank: "MOD"}, {id: "2", rank: "VIP"}), true,
  "staff-target checks must preserve access to lower-ranked accounts");
assert.equal(policyContext.canAccessStaffTarget({id: "1", rank: "OWNER"}, {id: "2", rank: "DEVELOPER"}), false,
  "the Developer account must remain protected from lower-ranked staff");
assert.equal(policyContext.canAccessStaffTarget({id: "1", rank: "MOD"}, {id: "2", rank: "UNKNOWN"}), false,
  "unknown target ranks must fail closed");

console.log("Staff note rank-access regression checks passed.");

const roomListStart = server.indexOf('app.get("/api/rooms",auth,async(req,res)=>{');
const roomListEnd = server.indexOf("function roomAgeAllowed(", roomListStart);
assert.ok(roomListStart >= 0 && roomListEnd > roomListStart, "room directory route must exist");
const roomListRoute = server.slice(roomListStart, roomListEnd);
assert.doesNotMatch(roomListRoute, /DELETE\s+FROM\s+(?:rooms|room_messages)/i,
  "loading the room directory must not delete rooms or messages");
assert.doesNotMatch(roomListRoute, /UPDATE\s+room_messages\s+SET\s+room_id/i,
  "loading the room directory must not migrate message history between rooms");
assert.doesNotMatch(server, /Chill Zone|unwantedRoom/i,
  "startup and room-list requests must not remove a named room or its history");
assert.doesNotMatch(database, /DELETE\s+FROM\s+rooms\s+WHERE\s+id\s*=\s*ANY/i,
  "database initialization must preserve legacy room records");
assert.doesNotMatch(server, /DELETE\s+FROM\s+rooms\s+WHERE\s+id\s*=\s*ANY/i,
  "server startup must preserve legacy room records");

const roomDeleteStart = server.indexOf('app.delete("/api/rooms/:id",auth,async(req,res)=>{');
const roomDeleteEnd = server.indexOf('app.post(\n  "/api/rooms/:id/join"', roomDeleteStart);
assert.ok(roomDeleteStart >= 0 && roomDeleteEnd > roomDeleteStart, "room deletion route must exist");
const roomDeleteRoute = server.slice(roomDeleteStart, roomDeleteEnd);
assert.ok(roomDeleteRoute.indexOf('INSERT INTO room_clear_evidence') < roomDeleteRoute.indexOf('DELETE FROM rooms'),
  "room history must be archived durably before the room row is deleted");
assert.match(roomDeleteRoute, /await client\.query\("BEGIN"\)[\s\S]*await client\.query\("COMMIT"\)[\s\S]*ROLLBACK/,
  "room history archive and room deletion must share a rollback-capable transaction");

const bootstrapStart = server.indexOf("function clientBootstrapSettings(actor){");
const bootstrapEnd = server.indexOf("\n}", bootstrapStart);
assert.ok(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, "safe bootstrap settings filter must exist");
const bootstrapContext = {
  db: {settings: {feature_grants: {join_rooms: ["MEMBER"]}, mode_management: {enabled: false}, linkFilter: true, room_staff: {"9": {"2": "ROOM_OWNER"}}, room_moderation_logs: {"9": [{reason: "private"}]}, room_blocks: {"9": {"3": {reason: "private"}}}}}
};
vm.runInNewContext(`${server.slice(bootstrapStart, bootstrapEnd + 2)}\nglobalThis.clientBootstrapSettings=clientBootstrapSettings;`, bootstrapContext);
assert.deepEqual(JSON.parse(JSON.stringify(bootstrapContext.clientBootstrapSettings(null))), {},
  "unauthenticated bootstrap must not expose global settings");
const safeBootstrap = JSON.parse(JSON.stringify(bootstrapContext.clientBootstrapSettings({id: "1"})));
assert.deepEqual(Object.keys(safeBootstrap).sort(), ["feature_grants", "linkFilter", "mode_management"],
  "authenticated bootstrap must only return client settings that the UI needs");
assert.equal(safeBootstrap.room_moderation_logs, undefined,
  "bootstrap must not expose private room moderation logs");

const roomPolicyStart = server.indexOf("function roomIsPrivate(room){");
const roomPolicyEnd = server.indexOf("function roomAccessFingerprint(room){", roomPolicyStart);
assert.ok(roomPolicyStart >= 0 && roomPolicyEnd > roomPolicyStart, "private-room join policy must exist");
const roomPolicyContext = {
  Buffer,
  crypto: require("node:crypto"),
  Date,
  TOKEN_SECRET: "test-secret",
  rankOrder: {MEMBER: 0, VIP: 1, MOD: 2, ADMIN: 3, OWNER: 4},
  db: {settings: {room_staff: {}, room_blocks: {}, room_kicks: {}}, users: []},
  roomStaffStore() { return roomPolicyContext.db.settings; },
  roomRankCanEnter(user, room) { return roomPolicyContext.rankOrder[user.rank] >= roomPolicyContext.rankOrder[room.rankRequired]; },
  hasFeature(user, feature) { return feature === "join_rooms" && user.features?.includes(feature); },
  roomFriendsOnly() { return false; },
  areAcceptedFriends() { return true; },
  roomRole(roomId, userId) { return roomPolicyContext.db.settings.room_staff[String(roomId)]?.[String(userId)] || "USER"; },
  roomOwnerOrGlobal(user, room) { return String(user.id) === String(room.ownerId) || user.rank === "OWNER"; }
};
vm.runInNewContext(`${server.slice(roomPolicyStart, roomPolicyEnd)}\nglobalThis.roomJoinPolicyAllowed=roomJoinPolicyAllowed; globalThis.makeRoomInviteToken=makeRoomInviteToken; globalThis.verifyRoomInviteToken=verifyRoomInviteToken;`, roomPolicyContext);
const privateRoom = {id: "9", name: "Private room", public: false, ownerId: "2", inviteToken: "invite-secret", rankRequired: "MEMBER"};
const roomMember = {id: "3", rank: "MEMBER", features: ["join_rooms"]};
const signedInvite = roomPolicyContext.makeRoomInviteToken(privateRoom);
assert.equal(roomPolicyContext.roomJoinPolicyAllowed(roomMember, privateRoom), false,
  "private rooms must reject members without an invite or existing signed access");
assert.equal(roomPolicyContext.verifyRoomInviteToken(signedInvite, privateRoom), true,
  "private-room invitation signatures must validate");
assert.equal(roomPolicyContext.roomJoinPolicyAllowed(roomMember, privateRoom, {inviteToken: signedInvite}), true,
  "a signed private-room invitation must permit eligible members to join");
assert.equal(roomPolicyContext.roomJoinPolicyAllowed(roomMember, privateRoom, {inviteToken: "invite-secret"}), false,
  "the stored room secret must never be accepted as a public invitation token");
assert.equal(roomPolicyContext.roomJoinPolicyAllowed(roomMember, privateRoom, {existingJoinToken: true}), true,
  "an existing signed room session must preserve private-room membership");
roomPolicyContext.db.settings.room_blocks["9"] = {"3": {reason: "blocked"}};
assert.equal(roomPolicyContext.roomJoinPolicyAllowed(roomMember, privateRoom, {inviteToken: "invite-secret"}), false,
  "room blocks must override a valid private-room invitation");
delete roomPolicyContext.db.settings.room_blocks["9"];
roomPolicyContext.db.settings.room_kicks["9"] = {"3": {until: Date.now() + 60000}};
assert.equal(roomPolicyContext.roomJoinPolicyAllowed(roomMember, privateRoom, {inviteToken: "invite-secret"}), false,
  "active room kicks must override a valid private-room invitation");

for (const route of [
  'app.get("/api/rooms/:id/staff"', 'app.get("/api/rooms/:id/rules"',
  'app.put("/api/rooms/:id/rules"', 'app.get("/api/rooms/:id/moderation-log"',
  'app.put("/api/rooms/:id/staff/:userId"', 'app.post("/api/rooms/:id/staff-action"',
  "app.get('/api/rooms/:id/announcements'", "app.post('/api/rooms/:id/announcements'",
  "app.delete('/api/rooms/:id/announcements/:announcementId'"
]) {
  const routeStart = server.indexOf(route);
  const routeEnd = server.indexOf("\n});", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, `private room route ${route} must exist`);
  assert.match(server.slice(routeStart, routeEnd), /requirePrivateRoomAccess\(req,res,/,
    `private room route ${route} must require a verified room session`);
}

const joinClientStart = app.indexOf("async function joinRoom(id) {");
const joinClientEnd = app.indexOf("\nfunction ", joinClientStart + 1);
const joinClient = app.slice(joinClientStart, joinClientEnd);
assert.ok(joinClientStart >= 0 && joinClientEnd > joinClientStart, "client room-join flow must exist");
assert.ok(joinClient.indexOf("safeStorage.setItem('mc_room_join'") < joinClient.indexOf("/staff`"),
  "room access token must be saved before loading private room staff details");
assert.match(joinClient, /inviteToken:roomInvite\?\.roomId===id\?roomInvite\.inviteToken/, 
  "private room join must submit the fragment invitation token in the request body");
assert.match(app, /URLSearchParams\(String\(location\.hash\|\|""\)\.replace\(\/\^#\//,
  "private invitation URLs must keep the token in the browser fragment, outside HTTP requests");
assert.match(server, /app\.post\("\/api\/rooms\/:id\/invites",auth/,
  "private invitation links must be issued through an authenticated route");
assert.match(roomListRoute, /inviteToken:undefined/,
  "room directory responses must not expose the persistent invitation secret");
const joinRouteStart = server.indexOf('"/api/rooms/:id/join"');
const joinRouteEnd = server.indexOf("\n);", joinRouteStart);
assert.ok(joinRouteStart >= 0 && joinRouteEnd > joinRouteStart, "room join route must exist");
assert.match(server.slice(joinRouteStart, joinRouteEnd), /inviteToken:undefined/,
  "room join responses must not expose the persistent invitation secret");
assert.match(server.slice(server.indexOf('app.put("/api/rooms/:id",auth'), server.indexOf('app.put("/api/rooms/:id/theme"')),
  /inviteToken:undefined/,
  "room edit responses must not expose the persistent invitation secret");

const dmBlockStart = server.indexOf("function privateMessagesBlocked(userA,userB){");
const dmBlockEnd = server.indexOf("\n}", dmBlockStart);
assert.ok(dmBlockStart >= 0 && dmBlockEnd > dmBlockStart, "shared private-message block policy must exist");
const dmBlockContext = {};
vm.runInNewContext(`${server.slice(dmBlockStart, dmBlockEnd + 2)}\nglobalThis.privateMessagesBlocked=privateMessagesBlocked;`, dmBlockContext);
assert.equal(dmBlockContext.privateMessagesBlocked({id: 1, blocked: ["2"]}, {id: "2", blocked: []}), true,
  "private-message blocks must match numeric and string user IDs");
assert.equal(dmBlockContext.privateMessagesBlocked({id: "1", blocked: []}, {id: 2, blocked: []}), false,
  "unblocked users must retain private-message access");
assert.equal(dmBlockContext.privateMessagesBlocked({id: "1", blocked: []}, null), true,
  "missing message participants must fail closed");
for (const route of [
  'app.get("/api/dm/:id"', 'app.post("/api/dm/:id"',
  '"/api/dm/:id/read"'
]) {
  const routeStart = server.indexOf(route);
  const routeEnd = server.indexOf("\n});", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, `private-message route ${route} must exist`);
  assert.match(server.slice(routeStart, routeEnd), /privateMessagesBlocked\(/,
    `private-message route ${route} must use the normalized block policy`);
}
const dmTypingStart = server.indexOf('socket.on("dm-typing", d=>{');
const dmTypingEnd = server.indexOf("\n    });", dmTypingStart);
assert.ok(dmTypingStart >= 0 && dmTypingEnd > dmTypingStart, "private-message typing handler must exist");
assert.match(server.slice(dmTypingStart, dmTypingEnd), /privateMessagesBlocked\(u,recipient\)/,
  "blocked users must not bypass private-message blocks by sending typing events");

const capacityStart = server.indexOf("function roomCapacityAvailable(user,room){");
const capacityEnd = server.indexOf("\n}", capacityStart);
assert.ok(capacityStart >= 0 && capacityEnd > capacityStart, "server room capacity policy must exist");
const capacityContext = {
  db: {users: []},
  io: {sockets: {sockets: new Map()}},
  roomOwnerOrGlobal: () => false,
  roomRoleLevel: () => 0,
  roomRole: () => "USER",
  String,
  Number,
  Set
};
vm.runInNewContext(`${server.slice(capacityStart, capacityEnd + 2)}\nglobalThis.roomCapacityAvailable=roomCapacityAvailable;`, capacityContext);
const cappedRoom = {id: "9", name: "Capped", limit: 1};
capacityContext.io.sockets.sockets.set("active", {data: {roomId: "9", userId: "2"}});
assert.equal(capacityContext.roomCapacityAvailable({id: "1"}, cappedRoom), false,
  "new members must be rejected when a room reaches its configured capacity");
assert.equal(capacityContext.roomCapacityAvailable({id: "2"}, cappedRoom), true,
  "existing room members must be allowed to reconnect when the room is full");

const slowModeStart = server.indexOf("function reserveRoomSlowMode(user,room){");
const slowModeEnd = server.indexOf("\n}", server.indexOf("function releaseRoomSlowMode(reservation){", slowModeStart));
assert.ok(slowModeStart >= 0 && slowModeEnd > slowModeStart, "server slow-mode policy must exist");
const slowModeContext = {
  roomMessageLastSent: new Map(),
  Date,
  Number,
  Math,
  hasRank: () => false,
  roomOwnerOrGlobal: () => false,
  roomRoleLevel: () => 0
};
vm.runInNewContext(`${server.slice(slowModeStart, slowModeEnd + 2)}\nglobalThis.reserveRoomSlowMode=reserveRoomSlowMode; globalThis.releaseRoomSlowMode=releaseRoomSlowMode;`, slowModeContext);
const slowRoom = {id: "9", slowMode: 30};
const slowReservation = slowModeContext.reserveRoomSlowMode({id: "1"}, slowRoom);
assert.equal(slowReservation.ok, true, "the first message should be accepted in slow mode");
assert.equal(slowModeContext.reserveRoomSlowMode({id: "1"}, slowRoom).ok, false,
  "slow mode must reject a second message before its configured delay");
slowModeContext.releaseRoomSlowMode(slowReservation);
assert.equal(slowModeContext.reserveRoomSlowMode({id: "1"}, slowRoom).ok, true,
  "a failed database insert must release its slow-mode reservation");

assert.match(server.slice(server.indexOf('async function createRoomHandler(req,res){'), server.indexOf('app.post("/api/rooms",auth,createRoomHandler)')),
  /Member limit must be between 2 and 500[\s\S]*Slow mode must be between 0 and 3600 seconds/,
  "room creation must validate capacity and slow-mode settings on the server");
assert.match(server.slice(joinRouteStart, joinRouteEnd), /roomCapacityAvailable\(u,r\)/,
  "room joining must enforce the configured member limit");
assert.match(server.slice(server.indexOf('app.post("/api/rooms/:id/messages"'), server.indexOf("async function getStoredRoomMessage")),
  /reserveRoomSlowMode\(u,r\)/,
  "room message delivery must enforce slow mode on the server");

const messageHelperStart = server.indexOf("async function getStoredRoomMessage(messageId){");
const messageHelperEnd = server.indexOf('app.patch("/api/messages/:id"', messageHelperStart);
assert.ok(messageHelperStart >= 0 && messageHelperEnd > messageHelperStart, "durable message helpers must exist");
const messageHelpers = server.slice(messageHelperStart, messageHelperEnd);
assert.match(messageHelpers, /SELECT data FROM room_messages WHERE id=\$1/,
  "message edits and moderation must load authoritative persisted content");
assert.match(messageHelpers, /UPDATE room_messages SET data=\$2::jsonb WHERE id=\$1/,
  "message edits and moderation must write changes to PostgreSQL");
for (const [route, nextRoute] of [
  ['app.patch("/api/messages/:id"', 'app.delete(\n  "/api/messages/:id"'],
  ['app.delete(\n  "/api/messages/:id"', 'app.post(\n  "/api/messages/:id/reaction"'],
  ['app.post(\n  "/api/messages/:id/reaction"', 'app.post(\n  "/api/messages/:id/pin"'],
  ['app.post(\n  "/api/messages/:id/pin"', 'app.post(\n  "/api/messages/:id/report"']
]) {
  const start = server.indexOf(route);
  const end = server.indexOf(nextRoute, start + route.length);
  assert.ok(start >= 0 && end > start, `message route ${route} must exist`);
  const routeSource = server.slice(start, end);
  assert.match(routeSource, /getStoredRoomMessage\(/, `${route} must load the current durable message`);
  assert.match(routeSource, /saveStoredRoomMessage\(/, `${route} must persist its message update`);
  assert.match(routeSource, /requirePrivateRoomAccess\(/, `${route} must protect private-room messages`);
}
const forwardStart = server.indexOf('"/api/messages/:id/forward"');
const forwardEnd = server.indexOf('app.post(\n  "/api/friends/:id/request"', forwardStart);
assert.ok(forwardStart >= 0 && forwardEnd > forwardStart, "message forward route must exist");
assert.match(server.slice(forwardStart, forwardEnd), /INSERT INTO room_messages/,
  "forwarded messages must persist and survive reloads");
assert.match(server.slice(forwardStart, forwardEnd), /featureAllowed\("send_messages"\)/,
  "forwarding must enforce the normal chat send permission");
assert.match(app, /messageMatch=String\(url\)\.match\(\/\\\/api\\\/messages/,
  "private-room message actions must send the active room session token");

const indexHtml=fs.readFileSync("public/index.html","utf8");
const roomCreateStart=app.indexOf("function openRoomCreationModal()"),roomCreateEnd=app.indexOf("/* ---------------- V3 SETTINGS",roomCreateStart);
assert.ok(roomCreateStart>=0&&roomCreateEnd>roomCreateStart,"room creation modal must exist");
const roomCreateSource=app.slice(roomCreateStart,roomCreateEnd);
assert.match(roomCreateSource,/id="rVisibility"[\s\S]*Secret Society — hidden, invitation key required/,
  "room creation must visibly offer numeric-code secret rooms");
assert.match(roomCreateSource,/public:\$\("rVisibility"\)\.value!=="secret"/,
  "secret-room creation must persist private visibility through the existing room API");
assert.match(roomCreateSource,/showInvite\(created\.room\)/,
  "creating a secret room must display its numeric room code");
assert.match(app,/async function showInvite\(roomOrId=state\.currentRoom\)/,
  "room invitation UI must accept a newly created room even when the room list hides it");
assert.match(app,/roomOrId&&typeof roomOrId==="object"[\s\S]*?roomOrId\s*:\s*state\.rooms\.find/,
  "secret-room invite creation must not depend on the filtered room list");
assert.match(app,/roomInviteFromHash\(\)/,
  "secret-room invitation links must continue through the signed invite resolver");

const dmDeleteStart=server.indexOf('app.delete("/api/dm/messages/:messageId"');
const dmDeleteEnd=server.indexOf('app.post(\n  "/api/dm/:id/read"',dmDeleteStart);
assert.ok(dmDeleteStart>=0&&dmDeleteEnd>dmDeleteStart,"private-message deletion route must exist");
const dmDeleteRoute=server.slice(dmDeleteStart,dmDeleteEnd);
assert.match(dmDeleteRoute,/featureAllowed\("private_messages"\)/,
  "private-message deletion must honor the private-message permission");
assert.match(dmDeleteRoute,/WHERE id=\$1 AND sender_id=\$2/,
  "private-message deletion must be limited to the original sender");
assert.match(dmDeleteRoute,/data->'deleted' IS DISTINCT FROM 'true'::jsonb/,
  "private-message deletion must not run repeatedly against an existing tombstone");
assert.match(dmDeleteRoute,/path\.basename\(fileName\)===fileName[\s\S]*fs\.promises\.unlink\(filePath\)/,
  "deleting a private message must safely remove its uploaded attachment");
assert.match(dmDeleteRoute,/deletedAt[\s\S]*dm-updated/,
  "private-message deletion must persist a tombstone and sync it to both participants");
assert.match(app,/const deleteAction=String\(message\.from\)===String\(state\.user\?\.id\)&&!message\.deleted/,
  "the private-message delete button must only render for the sender's active message");
assert.match(app,/data-dm-delete/,
  "the private conversation UI must expose a delete control");
assert.match(app,/Delete this private message for both participants/,
  "deleting a private message must require user confirmation");
assert.match(app,/state\.socket\.on\("dm-updated"/,
  "deleted private messages must synchronize across active sessions");

assert.match(database,/ALTER TABLE wall_posts ADD COLUMN IF NOT EXISTS expires_at/,
  "Shadow Feed expiry must use a safe additive migration");
assert.match(database,/ALTER TABLE wall_posts ADD COLUMN IF NOT EXISTS featured/,
  "Shadow Feed feature flags must use a safe additive migration");
assert.match(database,/CREATE TABLE IF NOT EXISTS wall_post_saves/,
  "saved feed posts must have durable per-user storage");
assert.match(indexHtml,/id="wallSavedToggle"[\s\S]*id="wallFriendsToggle"/,
  "Shadow Feed must expose Saved posts and Friends activity controls");
assert.match(app,/wallShowingSaved\?[\s\S]*\/api\/wall\/saved[\s\S]*wallShowingFriends\?[\s\S]*\/api\/wall\/friends/,
  "Shadow Feed controls must load the matching server feeds");
assert.match(app,/expiresInHours/,
  "Shadow Feed posting must submit the selected expiry");
const friendsFeedStart=server.indexOf("app.get('/api/wall/friends'");
const friendsFeedEnd=server.indexOf("app.post('/api/wall/:id/save'",friendsFeedStart);
assert.ok(friendsFeedStart>=0&&friendsFeedEnd>friendsFeedStart,"accepted-friends feed route must exist");
const friendsFeedRoute=server.slice(friendsFeedStart,friendsFeedEnd);
assert.match(friendsFeedRoute,/status\|\|''\)\.toUpperCase\(\)==='ACCEPTED'/,
  "Friends Activity must include accepted friends only");
assert.match(friendsFeedRoute,/w\.user_id=ANY\(\$1::int\[\]\)/,
  "Friends Activity must query only accepted friends' posts");
assert.match(server,/Your rank cannot create wall posts/,
  "Shadow Feed additions must preserve existing post-creation authorization");

console.log("Room history, private-room access, invitations, private-message deletion, Shadow Feed, Friends Activity, bootstrap privacy, capacity, and slow-mode regression checks passed.");
