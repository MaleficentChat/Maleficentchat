
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
      username TEXT UNIQUE,
      password TEXT,
      rank TEXT DEFAULT 'user',
      gold INT DEFAULT 0,
      avatar TEXT,
      birth_date DATE,
      gender TEXT,
      bio TEXT,
      email TEXT,
      vip_expires_at TIMESTAMP,
      is_premium BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,
      value JSONB
    );
    CREATE TABLE IF NOT EXISTS gifts(
      id SERIAL PRIMARY KEY,
      name TEXT,
      image TEXT,
      price INT
    );
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

  await pool.query(
    `INSERT INTO users(username,password,rank,gold)
     VALUES($1,$2,'owner',99999)
     ON CONFLICT(username) DO NOTHING`,
    [process.env.OWNER_USERNAME || "Maleficent",
     process.env.OWNER_PASSWORD || "Mal@123"]
  );
}

async function loadState(defaultState) {
  const { rows: settingRows } = await pool.query(
    `SELECT value FROM settings WHERE key='legacy_state'`
  );
  let state = defaultState;
  if (settingRows[0]?.value && typeof settingRows[0].value === "object") {
    state = { ...defaultState, ...settingRows[0].value };
  }

  const { rows: users } = await pool.query(`SELECT * FROM users ORDER BY id`);
  state.users = users.map(row => ({
    ...(state.users || []).find(u => String(u.id) === String(row.id)) || {},
    id: String(row.id),
    username: row.username,
    password: row.password,
    passwordHash: row.password && row.password.startsWith("$2") ? row.password : undefined,
    rank: String(row.rank || "user").toUpperCase(),
    gold: Number(row.gold || 0),
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

  const { rows: grants } = await pool.query(`SELECT value FROM settings WHERE key='feature_grants'`);
  state.settings ||= {};
  state.settings.feature_grants = grants[0]?.value || state.settings.feature_grants || {wall_post: ['OWNER','ADMIN'], gift_share: ['OWNER','ADMIN']};

  const { rows: gifts } = await pool.query(`SELECT * FROM gifts ORDER BY id`);
  if (gifts.length) state.gifts = gifts.map(g => ({
    id: String(g.id), name: g.name, icon: g.image || "🎁",
    image: g.image || "", cost: Number(g.price || 0), price: Number(g.price || 0),
    creator: "SYSTEM", custom: false
  }));

  const { rows: filters } = await pool.query(`SELECT word FROM filter_words ORDER BY id`);
  state.bannedWords = filters.map(x => x.word);

  return state;
}

async function persistState(state) {
  // The legacy feature state is JSONB inside PostgreSQL, never a filesystem JSON file.
  const copy = JSON.parse(JSON.stringify(state));
  delete copy.users;
  delete copy.gifts;
  delete copy.bannedWords;

  await pool.query(
    `INSERT INTO settings(key,value) VALUES('feature_grants',$1::jsonb)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify(state.settings?.feature_grants || {wall_post:['OWNER','ADMIN'],gift_share:['OWNER','ADMIN']})]
  );

  await pool.query(
    `INSERT INTO settings(key,value) VALUES('legacy_state',$1::jsonb)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify(copy)]
  );

  const userIds=(state.users||[]).map(u=>Number(u.id)).filter(Number.isFinite);
  if(userIds.length){
    await pool.query(`DELETE FROM users WHERE id <> ALL($1::int[]) AND username <> $2`,[userIds,process.env.OWNER_USERNAME||"Maleficent"]);
  }
  for (const u of state.users || []) {
    await pool.query(
      `INSERT INTO users(id,username,password,rank,gold,avatar,birth_date,gender,bio,email,vip_expires_at,is_premium,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,to_timestamp($13/1000.0))
       ON CONFLICT(id) DO UPDATE SET
       username=EXCLUDED.username,password=EXCLUDED.password,rank=EXCLUDED.rank,gold=EXCLUDED.gold,
       avatar=EXCLUDED.avatar,birth_date=EXCLUDED.birth_date,gender=EXCLUDED.gender,bio=EXCLUDED.bio,
       email=EXCLUDED.email,vip_expires_at=EXCLUDED.vip_expires_at,is_premium=EXCLUDED.is_premium`,
      [
        Number(u.id) || undefined, u.username, u.password || u.passwordHash || "",
        String(u.rank || "user").toLowerCase(), Number(u.gold || 0), u.avatar || null,
        u.birthDate || u.dateOfBirth || null, u.gender || null, u.bio || null, u.email || null,
        u.vipExpiresAt || u.vip_expires_at ? new Date(u.vipExpiresAt || u.vip_expires_at) : null,
        !!(u.isPremium || u.is_premium), Number(u.createdAt || Date.now())
      ]
    ).catch(async () => {
      await pool.query(
        `UPDATE users SET username=$2,password=$3,rank=$4,gold=$5,avatar=$6,birth_date=$7,gender=$8,bio=$9,email=$10,
         vip_expires_at=$11,is_premium=$12 WHERE id=$1`,
        [Number(u.id),u.username,u.password||u.passwordHash||"",String(u.rank||"user").toLowerCase(),
         Number(u.gold||0),u.avatar||null,u.birthDate||u.dateOfBirth||null,u.gender||null,u.bio||null,u.email||null,
         u.vipExpiresAt||u.vip_expires_at ? new Date(u.vipExpiresAt||u.vip_expires_at) : null,!!(u.isPremium||u.is_premium)]
      );
    });
  }

  // Keep the structured filter table authoritative.
  await pool.query(`DELETE FROM filter_words`);
  for (const word of [...new Set((state.bannedWords || []).map(w => String(w).trim().toLowerCase()).filter(Boolean))]) {
    await pool.query(
      `INSERT INTO filter_words(word,added_by) VALUES($1,$2) ON CONFLICT(word) DO NOTHING`,
      [word, Number(state.users?.find(u => String(u.username).toLowerCase() === "maleficent")?.id) || null]
    );
  }

  // Structured gifts mirror the current catalog.
  await pool.query(`DELETE FROM gifts`);
  for (const g of state.gifts || []) {
    await pool.query(
      `INSERT INTO gifts(name,image,price) VALUES($1,$2,$3)`,
      [g.name, g.image || g.icon || "", Number(g.price ?? g.cost ?? 0)]
    );
  }

  // Keep owner id sequence safe after explicit user IDs.
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), COALESCE((SELECT MAX(id) FROM users),1), true)`);
}

module.exports = { pool, initDB, loadState, persistState };
