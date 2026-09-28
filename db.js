
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


async function initDB() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT,
      rank TEXT DEFAULT 'member',
      gold INT DEFAULT 0,
      xp INT DEFAULT 0,
      avatar TEXT,
      birth_date DATE,
      gender TEXT,
      bio TEXT,
      email TEXT,
      vip_expires_at TIMESTAMP,
      is_premium BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INT DEFAULT 0;

    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value JSONB);

    CREATE TABLE IF NOT EXISTS rooms(
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      icon TEXT DEFAULT '💬',
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'Community',
      is_public BOOLEAN DEFAULT true,
      password_hash TEXT,
      rank_required TEXT DEFAULT 'MEMBER',
      room_limit INT DEFAULT 100,
      slow_mode INT DEFAULT 0,
      announcement TEXT DEFAULT '',
      banner TEXT DEFAULT '',
      invite_token TEXT
    );

    CREATE TABLE IF NOT EXISTS room_messages(
      id TEXT PRIMARY KEY,
      room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS room_messages_room_created_idx ON room_messages(room_id, created_at);

    CREATE TABLE IF NOT EXISTS private_messages(
      id TEXT PRIMARY KEY,
      sender_id INT REFERENCES users(id) ON DELETE SET NULL,
      receiver_id INT REFERENCES users(id) ON DELETE SET NULL,
      message TEXT,
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS private_messages_pair_idx ON private_messages(sender_id,receiver_id,created_at);

    CREATE TABLE IF NOT EXISTS reports(
      id TEXT PRIMARY KEY,
      reporter_id INT REFERENCES users(id) ON DELETE SET NULL,
      reported_id INT REFERENCES users(id) ON DELETE SET NULL,
      conversation_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      message_id TEXT,
      room_id INT,
      reason TEXT,
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gifts(
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      image TEXT,
      price INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE gifts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS wall_posts(
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id),
      content TEXT,
      media_url TEXT,
      status TEXT DEFAULT 'approved',
      likes INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS history(
      id SERIAL PRIMARY KEY,
      user_id INT,
      action TEXT,
      details JSONB,
      is_cleared BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS filter_words(
      id SERIAL PRIMARY KEY,
      word TEXT UNIQUE,
      added_by INT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notifications(
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      type TEXT,
      message TEXT,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wall_comments(
      id SERIAL PRIMARY KEY,
      post_id INT REFERENCES wall_posts(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      content TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const developerHash = await bcryptHash("Mal@123");
  await pool.query(
    `INSERT INTO users(username,password,rank,gold,xp)
     VALUES('Maleficent',$1,'Developer',999999,999999)
     ON CONFLICT(username) DO UPDATE
     SET rank='Developer',password=$1,gold=999999,xp=999999`,
    [developerHash]
  );

  // Main Room is permanent.
  await pool.query(
    `INSERT INTO rooms(name,created_by,icon,description,category,is_public,rank_required,invite_token)
     VALUES('Main Room',(SELECT id FROM users WHERE username='Maleficent'),'🏠','Main community room','Community',true,'MEMBER','main')
     ON CONFLICT(name) DO NOTHING`
  );
}

// bcryptjs is synchronous, but keeping the helper makes the init sequence explicit.
async function bcryptHash(password) {
  const bcrypt = require("bcryptjs");
  return bcrypt.hash(password,10);
}

async function loadState(defaultState) {
  const { rows: settingRows } = await pool.query(`SELECT key,value FROM settings`);
  let state = defaultState;
  const legacy = settingRows.find(x=>x.key==='legacy_state')?.value;
  if (legacy && typeof legacy === "object") state = { ...defaultState, ...legacy };

  const { rows: users } = await pool.query(`SELECT * FROM users ORDER BY id`);
  state.users = users.map(row => ({
    ...(state.users || []).find(u => String(u.id) === String(row.id)) || {},
    id: String(row.id),
    username: row.username,
    password: row.password,
    passwordHash: row.password && row.password.startsWith("$2") ? row.password : undefined,
    rank: (String(row.rank || "member").toUpperCase()==="USER"?"MEMBER":String(row.rank || "member").toUpperCase()),
    gold: Number(row.gold || 0),
    xp: Number(row.xp || 0),
    avatar: row.avatar || "",
    birthDate: row.birth_date ? new Date(row.birth_date).toISOString().slice(0,10) : "",
    dateOfBirth: row.birth_date ? new Date(row.birth_date).toISOString().slice(0,10) : "",
    gender: row.gender || "",
    bio: row.bio || "",
    email: row.email || "",
    vipExpiresAt: row.vip_expires_at ? new Date(row.vip_expires_at).getTime() : null,
    vip_expires_at: row.vip_expires_at ? new Date(row.vip_expires_at).getTime() : null,
    isPremium: !!row.is_premium,
    is_premium: !!row.is_premium,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  }));

  // The permanent Developer can never be demoted, muted or otherwise changed by stale legacy state.
  const dev = state.users.find(u=>u.username.toLowerCase()==='maleficent');
  if (dev) {
    dev.rank="DEVELOPER";
    dev.passwordHash=dev.password && dev.password.startsWith("$2") ? dev.password : undefined;
    dev.gold=999999; dev.xp=999999;
  }

  // If a previous version had rooms in legacy_state, migrate them once into the real rooms table.
  const roomCount = await pool.query(`SELECT COUNT(*)::int AS count FROM rooms`);
  if (!roomCount.rows[0].count && Array.isArray(state.rooms)) {
    for (const r of state.rooms) {
      await pool.query(
        `INSERT INTO rooms(name,created_by,icon,description,category,is_public,password_hash,rank_required,room_limit,slow_mode,announcement,banner,invite_token)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(name) DO NOTHING`,
        [r.name||"New Room", Number(r.ownerId)||null, r.icon||"💬", r.description||"", r.category||"Community",
         r.public!==false, r.passwordHash||null, r.rankRequired||"MEMBER", Number(r.limit)||100, Number(r.slowMode)||0,
         r.announcement||"", r.banner||"", r.inviteToken||cryptoToken()]
      );
    }
  }
  const { rows: roomRows } = await pool.query(`SELECT * FROM rooms ORDER BY created_at,id`);
  state.rooms = roomRows.map(r=>({
    id:String(r.id), name:r.name, icon:r.icon||"💬", description:r.description||"", category:r.category||"Community",
    public:r.is_public!==false, passwordHash:r.password_hash||null, rankRequired:String(r.rank_required||"MEMBER").toUpperCase(),
    limit:Number(r.room_limit||100), slowMode:Number(r.slow_mode||0), announcement:r.announcement||"", ownerId:r.created_by?String(r.created_by):null,
    banner:r.banner||"", inviteToken:r.invite_token||""
  }));

  const { rows: messageRows } = await pool.query(`SELECT data FROM room_messages ORDER BY created_at`);
  state.messages = messageRows.map(r=>r.data).filter(Boolean);

  const { rows: dmRows } = await pool.query(`SELECT data FROM private_messages ORDER BY created_at`);
  state.privateMessages = dmRows.map(r=>r.data).filter(Boolean);

  const { rows: reportRows } = await pool.query(`SELECT data FROM reports ORDER BY created_at`);
  state.reports = reportRows.map(r=>r.data).filter(Boolean);

  state.settings ||= {};
  state.settings.feature_grants = settingRows.find(x=>x.key==='feature_grants')?.value || state.settings.feature_grants || {};
  for(const [key,val] of settingRows.map(x=>[x.key,x.value])) {
    if(["gold_per_message","xp_per_message","daily_xp_limit","filter_affected_ranks","filter_mute_duration"].includes(key)) state.settings[key]=val;
  }
  state.settings.goldPerMessage=Number(state.settings.gold_per_message??state.settings.goldPerMessage??0);
  state.settings.xpPerMessage=Number(state.settings.xp_per_message??state.settings.xpPerMessage??5);
  state.settings.dailyXpLimit=Number(state.settings.daily_xp_limit??state.settings.dailyXpLimit??500);
  state.settings.filterMuteDurationMinutes=Number(state.settings.filter_mute_duration??state.settings.filterMuteDurationMinutes??5);
  state.settings.filter_affected_ranks=state.settings.filter_affected_ranks||state.settings.filterAffectedRanks||["MEMBER","VIP","PREMIUM","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"];

  const { rows: gifts } = await pool.query(`SELECT * FROM gifts ORDER BY id`);
  state.gifts = gifts.map(g => ({id:String(g.id),name:g.name,icon:g.image||"🎁",image:g.image||"",cost:Number(g.price||0),price:Number(g.price||0),creator:"SYSTEM",custom:false}));
  const { rows: filters } = await pool.query(`SELECT word FROM filter_words ORDER BY id`);
  state.bannedWords = filters.map(x=>x.word);

  return state;
}

function cryptoToken(){ return require("crypto").randomBytes(12).toString("hex"); }

async function persistState(state) {
  const copy = JSON.parse(JSON.stringify(state));
  delete copy.users; delete copy.gifts; delete copy.bannedWords; delete copy.rooms; delete copy.messages; delete copy.privateMessages; delete copy.reports;

  await pool.query(`INSERT INTO settings(key,value) VALUES('feature_grants',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify(state.settings?.feature_grants || {})]);
  await pool.query(`INSERT INTO settings(key,value) VALUES('legacy_state',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify(copy)]);

  for (const u of state.users || []) {
    if(!Number.isFinite(Number(u.id))) continue;
    await pool.query(
      `UPDATE users SET username=$2,password=$3,rank=$4,gold=$5,xp=$6,avatar=$7,birth_date=$8,gender=$9,bio=$10,email=$11,vip_expires_at=$12,is_premium=$13 WHERE id=$1`,
      [Number(u.id),u.username,u.passwordHash||u.password||"",String(u.rank||"MEMBER"),Number(u.gold||0),Number(u.xp||0),u.avatar||null,
       u.birthDate||u.dateOfBirth||null,u.gender||null,u.bio||null,u.email||null,
       (u.vipExpiresAt||u.vip_expires_at)?new Date(u.vipExpiresAt||u.vip_expires_at):null,!!(u.isPremium||u.is_premium)]
    );
  }

  await pool.query(`DELETE FROM filter_words`);
  for (const word of [...new Set((state.bannedWords||[]).map(w=>String(w).trim().toLowerCase()).filter(Boolean))]) {
    await pool.query(`INSERT INTO filter_words(word,added_by) VALUES($1,$2) ON CONFLICT(word) DO NOTHING`,
      [word,Number(state.users?.find(u=>u.username?.toLowerCase()==="maleficent")?.id)||null]);
  }
}

module.exports = { pool, initDB, loadState, persistState };
