
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
      profile_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      vip_expires_at TIMESTAMP,
      is_premium BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INT DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(255);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_data JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value JSONB);
    CREATE TABLE IF NOT EXISTS device_fingerprints(id SERIAL PRIMARY KEY,fingerprint_hash VARCHAR(255) UNIQUE,ip_hash VARCHAR(255),user_id INT REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMP DEFAULT NOW());
    ALTER TABLE device_fingerprints ADD COLUMN IF NOT EXISTS ip_hash VARCHAR(255);
    CREATE TABLE IF NOT EXISTS private_nicknames(id SERIAL PRIMARY KEY,owner_id INT REFERENCES users(id) ON DELETE CASCADE,target_user_id INT REFERENCES users(id) ON DELETE CASCADE,nickname VARCHAR(50) NOT NULL,UNIQUE(owner_id,target_user_id));
    CREATE TABLE IF NOT EXISTS admin_logs(id SERIAL PRIMARY KEY,action_type VARCHAR(100),performed_by INT REFERENCES users(id) ON DELETE SET NULL,target_user_id INT REFERENCES users(id) ON DELETE SET NULL,details TEXT,created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS profile_notes(id SERIAL PRIMARY KEY,user_id INT REFERENCES users(id) ON DELETE CASCADE,added_by INT REFERENCES users(id) ON DELETE SET NULL,note TEXT,created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS feature_grants(id SERIAL PRIMARY KEY,user_id INT REFERENCES users(id) ON DELETE CASCADE,feature_name VARCHAR(100),granted BOOLEAN DEFAULT false,granted_by INT REFERENCES users(id) ON DELETE SET NULL,UNIQUE(user_id,feature_name));

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
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS min_age INT DEFAULT 0;
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS max_age INT DEFAULT 99;
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

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
      is_predefined BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE gifts ADD COLUMN IF NOT EXISTS is_predefined BOOLEAN DEFAULT false;
    ALTER TABLE gifts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    CREATE TABLE IF NOT EXISTS user_gifts(
      id SERIAL PRIMARY KEY,
      sender_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      receiver_user_id INT REFERENCES users(id) ON DELETE CASCADE,
      sender_username TEXT NOT NULL,
      sender_display_name TEXT NOT NULL DEFAULT '',
      gift_id INT REFERENCES gifts(id) ON DELETE SET NULL,
      gift_name TEXT NOT NULL,
      gift_icon TEXT NOT NULL DEFAULT '🎁',
      gold_cost INT NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_gifts_receiver_created_idx ON user_gifts(receiver_user_id,created_at DESC);

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
    CREATE TABLE IF NOT EXISTS achievements(
      id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, icon TEXT DEFAULT '🏆', earned_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id,name)
    );
    CREATE TABLE IF NOT EXISTS daily_rewards(
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_claim TIMESTAMP, streak INT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS premium_requests(
      id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bots(
      id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, avatar TEXT, auto_reply TEXT,
      is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const developerHash = await bcryptHash(process.env.OWNER_PASSWORD || "Mal@123");
  await pool.query(
    `INSERT INTO users(username,password,rank,gold,xp)
     VALUES('Maleficent',$1,'Developer',999999,999999)
     ON CONFLICT(username) DO NOTHING`,
    [developerHash]
  );

  // Keep the two default community rooms persistent; room access is not age-gated.
  await pool.query(`INSERT INTO rooms(name,created_by,icon,description,category,is_public,rank_required,invite_token,min_age,max_age,is_default)
    VALUES ('Main room 1',(SELECT id FROM users WHERE username='Maleficent'),'🏠','Meet and chat with the community.','Community',true,'MEMBER','main-1',0,120,true),
           ('Main room 2',(SELECT id FROM users WHERE username='Maleficent'),'🏠','A second open community room.','Community',true,'MEMBER','main-2',0,120,true)
    ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description,min_age=0,max_age=120,is_default=true`);
  const giftValues = `VALUES
    ('Rose','🌹',10),('Chocolate','🍫',15),('Heart','❤️',20),('Teddy Bear','🧸',25),('Diamond','💎',100),('Crown','👑',150),('Cake','🎂',30),('Flower','🌸',15),('Star','⭐',20),('Gift Box','🎁',50),
    ('Crown Jewel','💍',75),('Coffee','☕',10),('Cupcake','🧁',15),('Butterfly','🦋',20),('Moon','🌙',20),('Sun','☀️',20),('Music','🎵',10),('Paw','🐾',10),('Unicorn','🦄',40),('Castle','🏰',60)`;
  await pool.query(`UPDATE gifts g SET image=x.emoji,price=x.price,is_predefined=true FROM (${giftValues}) AS x(name,emoji,price) WHERE g.name=x.name`);
  await pool.query(`INSERT INTO gifts(name,image,price,is_predefined) SELECT x.name,x.emoji,x.price,true FROM (${giftValues}) AS x(name,emoji,price) WHERE NOT EXISTS (SELECT 1 FROM gifts g WHERE g.name=x.name)`);
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
    ...(row.profile_data && typeof row.profile_data === 'object' ? row.profile_data : {}),
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
  }

  // If a previous version had rooms in legacy_state, migrate them once into the real rooms table.
  const roomCount = await pool.query(`SELECT COUNT(*)::int AS count FROM rooms`);
  if (Array.isArray(state.rooms)) {
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
    id:String(r.id), name:r.name, icon:r.icon||"💬", description:r.description||"", category:r.category||"Community", isDefault:!!r.is_default,
    public:r.is_public!==false, passwordHash:r.password_hash||null, rankRequired:String(r.rank_required||"MEMBER").toUpperCase(),
    limit:Number(r.room_limit||100), slowMode:Number(r.slow_mode||0), announcement:r.announcement||"", ownerId:r.created_by?String(r.created_by):null,
    banner:r.banner||"", inviteToken:r.invite_token||""
  }));

  const { rows: messageRows } = await pool.query(`SELECT data FROM room_messages ORDER BY created_at`);
  state.messages = messageRows.map(r=>r.data).filter(Boolean);

  const { rows: dmRows } = await pool.query(`SELECT data FROM private_messages ORDER BY created_at`);
  state.privateMessages = dmRows.map(r=>r.data).filter(Boolean);

  const { rows: giftRows } = await pool.query(`SELECT id,sender_user_id,receiver_user_id,sender_username,sender_display_name,gift_name,gift_icon,gold_cost,message,created_at FROM user_gifts ORDER BY created_at`);
  for (const gift of giftRows) {
    const receiver=state.users.find(u=>String(u.id)===String(gift.receiver_user_id));
    if (!receiver) continue;
    receiver.giftsReceived ||= [];
    receiver.giftsReceived.push({id:String(gift.id),from:gift.sender_user_id?String(gift.sender_user_id):null,fromUsername:gift.sender_username,fromDisplayName:gift.sender_display_name,gift:gift.gift_name,icon:gift.gift_icon,cost:Number(gift.gold_cost||0),message:gift.message||'',time:gift.created_at?new Date(gift.created_at).getTime():Date.now()});
  }

  const { rows: reportRows } = await pool.query(`SELECT data FROM reports ORDER BY created_at`);
  state.reports = reportRows.map(r=>r.data).filter(Boolean);

  state.settings ||= {};
  state.settings.feature_grants = settingRows.find(x=>x.key==='feature_grants')?.value || state.settings.feature_grants || {};
  for(const [key,val] of settingRows.map(x=>[x.key,x.value])) {
    if(["gold_per_message","xp_per_message","daily_xp_limit","filter_affected_ranks","filter_mute_duration"].includes(key)) state.settings[key]=val;
  }
  state.settings.daily_reward_gold=Number(settingRows.find(x=>x.key==='daily_reward_gold')?.value??state.settings.daily_reward_gold??25);
  state.settings.daily_reward_xp=Number(settingRows.find(x=>x.key==='daily_reward_xp')?.value??state.settings.daily_reward_xp??15);
  state.settings.goldPerMessage=Number(state.settings.gold_per_message??state.settings.goldPerMessage??0);
  state.settings.xpPerMessage=Number(state.settings.xp_per_message??state.settings.xpPerMessage??5);
  state.settings.dailyXpLimit=Number(state.settings.daily_xp_limit??state.settings.dailyXpLimit??500);
  state.settings.filterMuteDurationMinutes=Number(state.settings.filter_mute_duration??state.settings.filterMuteDurationMinutes??5);
  state.settings.filter_affected_ranks=state.settings.filter_affected_ranks||state.settings.filterAffectedRanks||["MEMBER","VIP","PREMIUM","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"];

  const {rows: userGrantRows}=await pool.query(`SELECT user_id,feature_name,granted,granted_by FROM feature_grants`);
  state.userFeatureGrants={};
  for(const row of userGrantRows){
    const userId=String(row.user_id);state.userFeatureGrants[userId] ||= {};
    state.userFeatureGrants[userId][row.feature_name]={granted:!!row.granted,grantedBy:row.granted_by?String(row.granted_by):null};
  }

  const { rows: gifts } = await pool.query(`SELECT * FROM gifts ORDER BY id`);
  state.gifts = gifts.map(g => ({id:String(g.id),name:g.name,icon:g.image||"🎁",image:g.image||"",cost:Number(g.price||0),price:Number(g.price||0),creator:"SYSTEM",custom:false}));
  const { rows: filters } = await pool.query(`SELECT word FROM filter_words ORDER BY id`);
  state.bannedWords = filters.map(x=>x.word);

  return state;
}

function cryptoToken(){ return require("crypto").randomBytes(12).toString("hex"); }

async function persistState(state) {
  const copy = JSON.parse(JSON.stringify(state));
  delete copy.users; delete copy.gifts; delete copy.bannedWords; delete copy.rooms; delete copy.messages; delete copy.privateMessages; delete copy.reports; delete copy.userFeatureGrants;

  await pool.query(`INSERT INTO settings(key,value) VALUES('feature_grants',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify(state.settings?.feature_grants || {})]);
  await pool.query(`INSERT INTO settings(key,value) VALUES('legacy_state',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify(copy)]);

  for (const u of state.users || []) {
    if(!Number.isFinite(Number(u.id))) continue;
    const profileData={...u};
    for (const key of ['id','username','password','passwordHash','rank','gold','xp','avatar','birthDate','dateOfBirth','gender','bio','email','vipExpiresAt','vip_expires_at','isPremium','is_premium','giftsReceived']) delete profileData[key];
    await pool.query(
      `UPDATE users SET username=$2,password=$3,rank=$4,gold=$5,xp=$6,avatar=$7,birth_date=$8,gender=$9,bio=$10,email=$11,vip_expires_at=$12,is_premium=$13,profile_data=$14::jsonb WHERE id=$1`,
      [Number(u.id),u.username,u.passwordHash||u.password||"",String(u.rank||"MEMBER"),Number(u.gold||0),Number(u.xp||0),u.avatar||null,
       u.birthDate||u.dateOfBirth||null,u.gender||null,u.bio||null,u.email||null,
       (u.vipExpiresAt||u.vip_expires_at)?new Date(u.vipExpiresAt||u.vip_expires_at):null,!!(u.isPremium||u.is_premium),JSON.stringify(profileData)]
    );
  }

  await pool.query(`DELETE FROM filter_words`);
  for (const word of [...new Set((state.bannedWords||[]).map(w=>String(w).trim().toLowerCase()).filter(Boolean))]) {
    await pool.query(`INSERT INTO filter_words(word,added_by) VALUES($1,$2) ON CONFLICT(word) DO NOTHING`,
      [word,Number(state.users?.find(u=>u.username?.toLowerCase()==="maleficent")?.id)||null]);
  }
}

module.exports = { pool, initDB, loadState, persistState };
