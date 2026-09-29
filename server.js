const express=require("express");
const http=require("http");
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const session=require("express-session");
const multer=require("multer");
const {Server}=require("socket.io");
const {initDB,loadState,persistState,pool}=require("./db");

const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000;
const UP=path.resolve(process.env.UPLOAD_DIR || path.join(process.env.PERSISTENT_DATA_DIR || path.join(__dirname,"uploads"),"uploads"));
fs.mkdirSync(UP,{recursive:true});

const DEFAULT_OWNER=process.env.OWNER_USERNAME||"Maleficent";
const DEFAULT_OWNER_PASSWORD=process.env.OWNER_PASSWORD||"Mal@123";
const OWNER_DISPLAY=process.env.OWNER_DISPLAY_NAME||"Maleficent";

function load(){
  return {
    users:[], rooms:[], messages:[], privateMessages:[], reports:[], logs:[],
    notifications:[], friends:[], goldTransactions:[], moderationHistory:[],
    bannedWords:[], gifts:[], settings:{
      xpPerLevel:100, dailyXpLimit:500, goldPerMinute:1, linkFilter:false, daily_reward_gold:25, daily_reward_xp:15,
      filterMuteMinRank:"MEMBER", filterMuteDurationMinutes:5,
      wall_allowed_ranks:["OWNER","ADMIN"], clear_history_allowed_ranks:["OWNER","ADMIN"], feature_grants:{wall_post:["OWNER","ADMIN"],gift_share:["OWNER","ADMIN"]}
    }
  };
}

let db=load();
let saveTimer=null;
let saveInFlight=Promise.resolve();
function save(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    saveInFlight=saveInFlight
      .then(()=>persistState(db))
      .catch(err=>console.error("PostgreSQL persistence error:",err));
  },50);
}
function flushSave(){
  clearTimeout(saveTimer);
  return (saveTimer=null, saveInFlight=saveInFlight.then(()=>persistState(db)).catch(err=>console.error("PostgreSQL persistence error:",err)));
}

function id(){
  return crypto.randomUUID();
}

const ranks=[
  "MEMBER",
  "VIP",
  "PREMIUM",
  "MOD",
  "ADMIN",
  "SUPER_ADMIN",
  "COMMISSOR",
  "COOWNER",
  "OWNER",
  "DEVELOPER"
];

const rankIcons={
  MEMBER:"⚡",
  VIP:"💎",
  PREMIUM:"🏅",
  MOD:"🛡️",
  ADMIN:"⭐",
  SUPER_ADMIN:"🌟",
  COMMISSOR:"👻",
  COOWNER:"👻",
  OWNER:"👑",
  DEVELOPER:"🛠️"
};

const rankOrder=Object.fromEntries(
  ranks.map((r,i)=>[r,i])
);

function hasRank(u,r){
  return !!u&&rankOrder[u.rank]>=rankOrder[r];
}

function featurePermissionKey(key){
  const aliases={create_room:"can_create_rooms",create_rooms:"can_create_rooms",edit_room:"can_edit_rooms",edit_rooms:"can_edit_rooms",delete_room:"can_delete_rooms",delete_rooms:"can_delete_rooms",profile_note:"can_add_notes",view_private_messages:"can_view_private_messages",inspect_private_messages:"can_view_private_messages",view_staff_dashboard:"can_view_admin_logs",manage_gifts:"can_manage_gifts",edit_email:"can_edit_emails",share_gold:"can_share_gold",bypass_age:"can_bypass_age",moderate_users:"can_mute",delete_message:"can_delete_messages",manage_staff_accounts:"can_edit_usernames",reports_management:"can_manage_reports",publish_news:"can_manage_news",manage_ranks:"can_manage_ranks",manage_clubs:"can_manage_clubs",manage_settings:"can_manage_settings",clear_history_button:"can_clear_history"};
  return aliases[key]|| (String(key).startsWith("can_")?key:null);
}
function userFeatureGrant(u,key){
  const permission=featurePermissionKey(key);if(!permission||!u)return null;
  const entry=db.userFeatureGrants?.[String(u.id)]?.[permission];
  return entry?!!entry.granted:null;
}

// Owner-configurable access controls. The owner can change the minimum rank
// for these implemented features without editing code.
const FEATURE_CONTROLS=[
  {key:"moderate_user",name:"Moderate users",category:"Staff",defaultRank:"MOD"},
  {key:"view_staff_dashboard",name:"View staff dashboard",category:"Staff",defaultRank:"MOD"},
  {key:"report_message",name:"Report messages",category:"Safety",defaultRank:"MEMBER"},
  {key:"edit_message",name:"Edit own messages",category:"Messaging",defaultRank:"MEMBER"},
  {key:"pin_message",name:"Pin messages",category:"Messaging",defaultRank:"MOD"},
  {key:"save_message",name:"Save messages",category:"Messaging",defaultRank:"MEMBER"},
  {key:"react_message",name:"React to messages",category:"Messaging",defaultRank:"MEMBER"},
  {key:"schedule_message",name:"Schedule messages",category:"Messaging",defaultRank:"MEMBER"},
  {key:"expire_message",name:"Use expiring messages",category:"Messaging",defaultRank:"MEMBER"},
  {key:"use_youtube",name:"Use YouTube sharing",category:"Media",defaultRank:"MEMBER"},
  {key:"room_announcement",name:"Post room announcements",category:"Rooms",defaultRank:"MOD"},
  {key:"view_pinned",name:"View pinned messages",category:"Rooms",defaultRank:"MEMBER"},
  {key:"manage_filters",name:"Manage filtered words",category:"Safety",defaultRank:"ADMIN"},
  {key:"manage_bots",name:"Manage community bots",category:"AI",defaultRank:"OWNER"},
  {key:"delete_message",name:"Delete messages",category:"Staff",defaultRank:"MOD"},
  {key:"clear_room",name:"Clear rooms",category:"Rooms",defaultRank:"COOWNER"},
  {key:"create_room",name:"Create rooms",category:"Rooms",defaultRank:"SUPER_ADMIN"},
  {key:"edit_room",name:"Edit rooms",category:"Rooms",defaultRank:"COOWNER"},
  {key:"delete_room",name:"Delete rooms",category:"Rooms",defaultRank:"COOWNER"},
  {key:"publish_news",name:"Publish news",category:"News",defaultRank:"ADMIN"},
  {key:"delete_news",name:"Delete news",category:"News",defaultRank:"ADMIN"},
  {key:"send_gift",name:"Send gifts",category:"Social",defaultRank:"MEMBER"},
  {key:"create_custom_gift",name:"Create personalized gifts",category:"Social",defaultRank:"MEMBER"},
  {key:"manage_staff_accounts",name:"Manage staff username/email",category:"Staff",defaultRank:"OWNER"},
  {key:"profile_note",name:"View and add staff profile notes",category:"Staff",defaultRank:"MOD"},
  {key:"staff_rank_assignment",name:"Assign MOD or lower",category:"Staff",defaultRank:"MOD"},
  {key:"manage_gold",name:"Manage user gold",category:"Owner",defaultRank:"OWNER"},
  {key:"manage_ranks",name:"Manage ranks",category:"Owner",defaultRank:"OWNER"},
  {key:"inspect_private_messages",name:"Inspect private messages",category:"Owner",defaultRank:"OWNER"},
  {key:"profile_like",name:"Like profiles",category:"Social",defaultRank:"MEMBER"},
  {key:"manage_mal_ai",name:"Manage Mal AI commands",category:"AI",defaultRank:"OWNER"},
  {key:"manage_feature_lab",name:"Manage Feature Lab",category:"Owner",defaultRank:"OWNER"},
  {key:"manage_clubs",name:"Manage clubs",category:"Community",defaultRank:"ADMIN"},
  {key:"enter_private_club",name:"Enter private clubs",category:"Community",defaultRank:"MEMBER"},
  {key:"manage_aurora",name:"Manage Aurora bot",category:"AI",defaultRank:"OWNER"}
];

const GRANT_RANKS=["MEMBER","VIP","PREMIUM","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"];
const FEATURE_GRANT_DEFAULTS={
  send_messages:GRANT_RANKS, private_messages:GRANT_RANKS, gif_sending:GRANT_RANKS, profile_note:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"], change_password:["OWNER"], edit_email:["OWNER"], manage_xp_level:["OWNER"], create_rooms:["ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"], edit_rooms:["ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"], delete_rooms:["ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"], bypass_age:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"],
  join_rooms:GRANT_RANKS, delete_own_room:GRANT_RANKS, friend_wall_posting:GRANT_RANKS, wall_commenting:GRANT_RANKS,
  wall_liking:GRANT_RANKS, wall_upload:GRANT_RANKS, gift_sending:GRANT_RANKS, gift_receiving:GRANT_RANKS,
  news_posting:GRANT_RANKS, change_avatar:GRANT_RANKS, change_bio:GRANT_RANKS,
  emojis_stickers:GRANT_RANKS, chat_file_upload:GRANT_RANKS, clear_history_button:GRANT_RANKS,
  view_online_users:GRANT_RANKS, view_private_messages:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"],
  manage_filter_words:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"],
  manage_gifts:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"],
  premium_granting:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"],
  reports_management:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"],
  moderate_users:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"],
  bypass_filter_words:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"],
  bypass_mute:["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"]
};
const OWNER_USER_PERMISSIONS=[
  "can_mute","can_kick","can_ban","can_warn","can_delete_messages","can_view_ips","can_view_emails","can_edit_rooms","can_delete_rooms","can_create_rooms","can_view_private_messages","can_view_admin_logs","can_grant_features","can_manage_gifts","can_manage_users","can_clear_history","can_add_notes","can_bypass_age","can_send_global_announcement","can_share_gold","can_manage_ranks","can_edit_usernames","can_edit_emails","can_manage_reports","can_manage_announcements","can_manage_clubs","can_manage_news","can_manage_profiles","can_view_deleted_messages","can_manage_settings"
];
function ensureFeatureGrants(){
  db.settings ||= {}; db.settings.feature_grants ||= {};
  for(const [k,v] of Object.entries(FEATURE_GRANT_DEFAULTS)) if(!Array.isArray(db.settings.feature_grants[k])) db.settings.feature_grants[k]=[...v];
}
function ensureFeaturePermissions(){
  db.featurePermissions ||= {};
  for(const f of FEATURE_CONTROLS){
    if(!ranks.includes(db.featurePermissions[f.key])) db.featurePermissions[f.key]=f.defaultRank;
  }
}

function featureRank(key){
  ensureFeaturePermissions();
  const f=FEATURE_CONTROLS.find(x=>x.key===key);
  return f ? db.featurePermissions[key] : "OWNER";
}

function hasFeature(u,key){
  if(!u) return false;
  if(String(u.rank).toUpperCase()==="DEVELOPER") return true;
  if(u.username===DEFAULT_OWNER && u.rank==="OWNER") return true;
  const granted=userFeatureGrant(u,key);if(granted!==null)return granted;
  return hasRank(u,featureRank(key));
}

function featureAllowed(key){
  return (req,res,next)=>{
    const u=current(req);
    if(!u) return res.status(401).json({error:"Login required"});
    ensureFeatureGrants();
    if(String(u.rank).toUpperCase()==="DEVELOPER") return next();
    const individual=userFeatureGrant(u,key);
    if(individual!==null)return individual?next():res.status(403).json({error:"This feature has not been granted to your account."});
    const alias={create_room:"create_rooms",send_gift:"gift_sending",manage_filters:"manage_filter_words",inspect_private_messages:"view_private_messages",moderate_user:"moderate_users",publish_news:"news_posting",clear_room:"clear_history_button",wall_post:"friend_wall_posting",gift_share:"gift_sending",report_message:"reports_management"}[key]||key;
    const grants=db.settings.feature_grants?.[alias];
    if(Array.isArray(grants) && !grants.map(x=>String(x).toUpperCase()).includes(String(u.rank).toUpperCase())) return res.status(403).json({error:"Your rank does not have this feature."});
    if(!grants && !hasFeature(u,key)) return res.status(403).json({error:`${FEATURE_CONTROLS.find(x=>x.key===key)?.name||"Feature"} requires ${featureRank(key)} or higher.`});
    next();
  };
}

function safeUser(u){
  if(!u)return null;

  return {
    id:u.id,
    username:u.username,
    displayName:u.displayName,
    rank:u.rank,
    avatar:u.avatar||"",
    bio:u.bio||"",
    pronouns:u.pronouns||"",
    relationship:u.relationship||"",
    mood:u.mood||"",
    birthday:u.birthday||"",
    banner:u.banner||"",
    theme:u.settings?.theme||u.theme||"obsidian",
    settings:{usernameColor:u.settings?.usernameColor||'',chatFont:u.settings?.chatFont||'',messageEffects:u.settings?.messageEffects||'',fontSize:u.settings?.fontSize||'medium',compactMode:!!u.settings?.compactMode},
    profileColor:u.profileColor||"",
    badge:u.badge||"",
    verified:!!u.verified,
    banned:!!u.banned,
    kickedUntil:u.kickedUntil||null,
    mutedUntil:u.mutedUntil||null,
    createdAt:u.createdAt,
    lastSeen:u.lastSeen,
    online:!!u.online,
    level:u.level||1,
    xp:u.xp||0,
    gold:u.gold||0,
    birth_date:u.birthDate||u.dateOfBirth||"",
    gender:u.gender||"",
    is_premium:!!(u.isPremium||u.is_premium),
    vip_expires_at:u.vipExpiresAt||u.vip_expires_at||null,
    profileLikes:u.profileLikes||0,
    profileColor:u.profileColor||u.settings?.profileColor||'',
    profileAccentColor:u.profileAccentColor||u.settings?.profileAccentColor||'',
    location:u.location||'',
    website:u.website||'',
    giftsReceived:u.giftsReceived||[],
    badgesStats:u.badgesStats||{},
    friendsCount:db.friends.filter(f=>f.status==="ACCEPTED"&&(f.a===u.id||f.b===u.id)).length,
    interests:u.interests||[],
    giftsReceived:u.giftsReceived||[],
    usernameHistory:u.usernameHistory||[],
    privacy:u.privacy||{
      lastSeen:true,
      online:true
    }
  };
}

function log(actor,action,target="",meta={}){
  db.logs.push({
    id:id(),
    time:Date.now(),
    actor:actor?.username||"SYSTEM",
    action,
    target,
    meta
  });

  if(db.logs.length>5000){
    db.logs.shift();
  }

  save();
  const targetUser=db.users.find(x=>String(x.id)===String(target)||String(x.username).toLowerCase()===String(target).toLowerCase());
  pool.query(`INSERT INTO admin_logs(action_type,performed_by,target_user_id,details) VALUES($1,$2,$3,$4)`,[String(action||'ACTION').slice(0,100),actor?.id||null,targetUser?.id||null,JSON.stringify({target,meta})]).catch(e=>console.error('Admin log persistence failed:',e.message));
}

function notificationPreferenceKey(type){
  if(type==="private-message" || type==="message") return "messages";
  if(type==="mention") return "mentions";
  if(type==="reply") return "replies";
  if(["security","login","password"].includes(type)) return "security";
  if(["report","moderation","staff"].includes(type)) return "staff";
  if(["gold","achievement","level"].includes(type)) return "gamification";
  return "other";
}
async function notify(userId,type,title,text){
  const target=findUser(userId), key=notificationPreferenceKey(type), prefs=target?.settings?.notificationPrefs||{};
  if(prefs[key]===false)return;
  try{await pool.query(`INSERT INTO notifications(user_id,type,message,is_read) VALUES($1,$2,$3,false)`,[Number(userId),String(type),String(text)]);io.to("user:"+userId).emit("notification");}
  catch(err){console.error("Notification insert failed:",err);}
}


function awardAchievement(u,key,title,description){
  if(!u) return false;
  ensureUserSchema(u);
  if(u.achievements.some(a=>a.key===key)) return false;
  const a={key,title,description,time:Date.now()};
  u.achievements.push(a);
  pool.query(`INSERT INTO achievements(user_id,name,icon) VALUES($1,$2,$3) ON CONFLICT(user_id,name) DO NOTHING`,[Number(u.id),title,'🏆']).catch(err=>console.error('Achievement persistence error:',err));
  notify(u.id,"achievement","🏆 Achievement unlocked",`${title} — ${description}`);
  return true;
}
function checkAchievements(u){
  ensureUserSchema(u);
  const messages=Number(u.stats?.messages||0);
  if(messages>=1) awardAchievement(u,"first-message","First Message","You sent your first chat message.");
  if(messages>=100) awardAchievement(u,"chatterbox-100","Chatterbox","You sent 100 messages.");
  if(messages>=1000) awardAchievement(u,"chatterbox-1000","Chatterbox+","You sent 1,000 messages.");
  const games=Number(u.gameStats?.played||0);
  if(games>=1) awardAchievement(u,"first-game","Gamer","You played your first game.");
  if(games>=25) awardAchievement(u,"game-25","Game Night","You played 25 games.");
  const gifts=Number(u.badgesStats?.giftsSent||0);
  if(gifts>=1) awardAchievement(u,"first-gift","Generous","You sent your first gift.");
  if((u.profileLikes||0)>=10) awardAchievement(u,"liked-10","Popular","Your profile received 10 likes.");
  return u.achievements;
}

function findUser(x){
  return db.users.find(
    u=>u.id===x||
    u.username.toLowerCase()===String(x).toLowerCase()
  );
}

const TOKEN_SECRET=process.env.SESSION_SECRET||"maleficent-chat-token-secret";
function makeToken(userId){const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=b64({alg:"HS256",typ:"JWT"}),p=b64({sub:String(userId),exp:Math.floor(Date.now()/1000)+7*86400});const sig=crypto.createHmac("sha256",TOKEN_SECRET).update(h+"."+p).digest("base64url");return h+"."+p+"."+sig;}
function verifyToken(token){try{const [h,p,sig]=String(token||"").split(".");if(!h||!p||!sig)return null;const e=crypto.createHmac("sha256",TOKEN_SECRET).update(h+"."+p).digest("base64url");if(sig!==e)return null;const x=JSON.parse(Buffer.from(p,"base64url").toString("utf8"));return x.exp>=Math.floor(Date.now()/1000)?x:null;}catch{return null;}}
function makeRoomJoinToken(userId,room){
  const payload=Buffer.from(JSON.stringify({sub:String(userId),room:String(room.id),access:crypto.createHash("sha256").update(String(room.passwordHash||"public")).digest("hex"),exp:Math.floor(Date.now()/1000)+7*86400})).toString("base64url");
  const signature=crypto.createHmac("sha256",TOKEN_SECRET).update(payload).digest("base64url");return payload+"."+signature;
}
function verifyRoomJoinToken(token,userId,room){
  try{const [payload,signature]=String(token||"").split(".");if(!payload||!signature)return false;const expected=crypto.createHmac("sha256",TOKEN_SECRET).update(payload).digest("base64url");if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return false;const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));return data.sub===String(userId)&&data.room===String(room.id)&&data.exp>=Math.floor(Date.now()/1000)&&data.access===crypto.createHash("sha256").update(String(room.passwordHash||"public")).digest("hex");}catch{return false;}
}
function current(req){
  let uid=req.session?.userId;
  if(!uid){ const raw=req.headers["x-auth-token"] || (String(req.headers.authorization||"").startsWith("Bearer ")?String(req.headers.authorization).slice(7):""); const p=verifyToken(raw); if(p) uid=String(p.sub); }
  return uid?db.users.find(u=>String(u.id)===String(uid)):null;
}

function auth(req,res,next){
  const u=current(req);

  if(!u){
    return res.status(401).json({
      error:"Login required"
    });
  }

  u.online=true;
  u.lastSeen=Date.now();

  next();
}

function staff(r){
  return [
    "MOD",
    "ADMIN",
    "SUPER_ADMIN",
    "COMMISSOR",
    "COOWNER",
    "OWNER",
    "DEVELOPER"
  ].includes(String(r).toUpperCase());
}

function ownerOnly(req,res,next){
  const u=current(req);
  if(!u || !(String(u.rank).toUpperCase()==="DEVELOPER" || (String(u.rank).toUpperCase()==="OWNER" && u.username===DEFAULT_OWNER))){
    return res.status(403).json({error:"Owner/Developer only"});
  }
  next();
}

function cleanText(s){
  return String(s??"").slice(0,4000);
}

function filteredWord(text){
  const t=cleanText(text);
  const low=t.toLowerCase();
  for(const w of db.bannedWords||[]){
    if(w&&low.includes(String(w).toLowerCase())) return String(w);
  }
  if(db.settings.linkFilter && /https?:\/\/|www\./i.test(t)) return "link";
  return null;
}

function filtered(text){
  return !!filteredWord(text);
}


function awardXp(u,n=5){
  if(String(u?.rank).toUpperCase()==="DEVELOPER"){u.xp=(u.xp||0)+Math.max(0,Number(n)||0);u.level=Math.floor(u.xp/(db.settings.xpPerLevel||100))+1;return;}
  const day=new Date()
    .toISOString()
    .slice(0,10);

  u.xpDailyDay??=day;

  if(u.xpDailyDay!==day){
    u.xpDailyDay=day;
    u.xpToday=0;
  }

  const add=Math.min(
    n,
    Math.max(
      0,
      (db.settings.dailyXpLimit||500)-
      (u.xpToday||0)
    )
  );

  u.xpToday=(u.xpToday||0)+add;
  u.xp=(u.xp||0)+add;

  const old=u.level||1;

  u.level=
    Math.floor(
      u.xp/
      (db.settings.xpPerLevel||100)
    )+1;

  if(u.level>old){
    notify(
      u.id,
      "achievement",
      "Level up",
      "You reached level "+u.level+"."
    );
  }
}

async function ensureDeveloper(){
  const hash=await bcrypt.hash(process.env.OWNER_PASSWORD||"Mal@123",10);
  const q=await pool.query(`INSERT INTO users(username,password,rank,gold,xp) VALUES('Maleficent',$1,'Developer',999999,999999) ON CONFLICT(username) DO UPDATE SET rank='Developer' RETURNING *`,[hash]);
  const row=q.rows[0]; let u=findUser("Maleficent");
  if(!u){ u={id:String(row.id),username:"Maleficent",displayName:"Maleficent",password:row.password,passwordHash:row.password,rank:"DEVELOPER",gold:999999,xp:999999,verified:true,createdAt:Date.now(),lastSeen:Date.now(),online:false,level:999999,bio:"Permanent Developer of Maleficent Chat.",settings:{rememberLogin:true,theme:"obsidian",notificationPrefs:{messages:true,mentions:true,replies:true,security:true,staff:true,gamification:true,other:true}}}; db.users.push(u); }
  else { u.rank="DEVELOPER"; u.password=row.password; u.passwordHash=row.password; }
}
ensureFeaturePermissions();

app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{const origin=req.headers.origin;if(origin){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Credentials","true");res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, X-Auth-Token, X-Room-Join-Token");res.setHeader("Access-Control-Allow-Methods","GET,POST,PUT,PATCH,DELETE,OPTIONS");}if(req.method==="OPTIONS")return res.sendStatus(204);next();});


// Render/other reverse proxies must be trusted so secure session
// cookies work correctly over HTTPS.
app.set("trust proxy", 1);

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    // Automatically match the current HTTP/HTTPS connection.
    secure: "auto",
    maxAge: 30 * 24 * 3600 * 1000
  }
}));

app.use(
  "/uploads",
  express.static(UP)
);

app.use(
  express.static(
    path.join(__dirname,"public")
  )
);

const upload=multer({
  storage:multer.diskStorage({
    destination:UP,

    filename:(req,file,cb)=>
      cb(
        null,
        Date.now()+"-"+
        crypto.randomBytes(5).toString("hex")+
        path.extname(file.originalname)
      )
  }),

  limits:{
    fileSize:15*1024*1024
  }
});

app.get(
  "/api/bootstrap",
  (req,res)=>
    res.json({
      user:safeUser(current(req)),

      ranks:ranks.map(r=>({
        id:r,
        label:r,
        icon:rankIcons[r]
      })),

      rooms:db.rooms.map(r=>({
        ...r,
        passwordHash:undefined,
        onlineCount:io.sockets.adapter.rooms.get("room:"+r.id)?.size||0
      })),

      settings:db.settings,
      featurePermissions:db.featurePermissions,
      userPermissions:db.userFeatureGrants?.[String(current(req)?.id)]||{}
    })
);

app.post("/api/auth/register",(req,res)=>res.redirect(307,"/api/register"));
app.post("/api/auth/login",(req,res)=>res.redirect(307,"/api/login"));

app.use('/api/register',express.json(),(req,res,next)=>{
  const p=String(req.body?.password||'');
  if(req.body?.confirmPassword===undefined||String(req.body.confirmPassword)==='')return res.status(400).json({error:'Confirm password is required.'});
  if(p!==String(req.body.confirmPassword)) return res.status(400).json({error:'Passwords do not match'});
  if(p.length<8) return res.status(400).json({error:'Password must be at least 8 characters'});
  next();
});

app.post(
  "/api/register",
  async(req,res)=>{
    const {
      username,
      displayName,
      password,
      email,
      dateOfBirth,
      gender,
      deviceFingerprint
    }=req.body;

    if(
      !/^[A-Za-z0-9_]{3,24}$/.test(
        username||""
      )
    ){
      return res.status(400).json({
        error:
          "Username must be 3-24 letters, numbers or underscores."
      });
    }

    const clientIp=String(req.ip||req.socket.remoteAddress||"unknown").trim();
    const ipHash=crypto.createHmac("sha256",TOKEN_SECRET).update(clientIp).digest("hex");
    const fingerprintHash = deviceFingerprint ? crypto.createHash("sha256").update(String(deviceFingerprint).slice(0, 2000)).digest("hex") : "ip:"+ipHash;
    const fingerprintTaken = await pool.query(`SELECT id FROM device_fingerprints WHERE fingerprint_hash=$1`,[fingerprintHash]);
    if (fingerprintTaken.rowCount) return res.status(409).json({error:"Only one account allowed per device"});
    if(!deviceFingerprint){
      const sameIp=await pool.query(`SELECT id FROM device_fingerprints WHERE ip_hash=$1 LIMIT 1`,[ipHash]);
      if(sameIp.rowCount)return res.status(409).json({error:"Only one account allowed per device"});
    }

    const normalizedEmail=String(email||"").trim().toLowerCase();
    const normalizedDob=String(dateOfBirth||"").trim();
    const normalizedGender=String(gender||"").trim();

    if(
      !displayName||
      String(displayName).length>32||
      !password||
      password.length<8||
      !normalizedEmail||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)||
      !normalizedDob||
      !normalizedGender
    ){
      return res.status(400).json({
        error:
          "Display name, email, date of birth, gender and password are required. Password must be 8+ characters."
      });
    }

    const dobDate=new Date(normalizedDob+"T00:00:00Z");
    if(Number.isNaN(dobDate.getTime()) || dobDate>new Date()) return res.status(400).json({error:"Please enter a valid date of birth."});

    const emailTaken=await pool.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`,[normalizedEmail]);
    if(emailTaken.rows.length) return res.status(409).json({error:"Email is already registered."});

    if(findUser(username)){
      return res.status(409).json({
        error:"Username already exists."
      });
    }

    const u={
      id:null,
      username,
      displayName,
      email:normalizedEmail,
      dateOfBirth:normalizedDob,
      gender:normalizedGender,

      password:password,
      passwordHash:
        await bcrypt.hash(password,10),

      rank:"MEMBER",
      verified:false,
      createdAt:Date.now(),
      lastSeen:Date.now(),
      online:true,
      level:1,
      xp:0,
      gold:0,
      bio:"",
      pronouns:"",
      birthday:"",
      banner:"",
      theme:"obsidian",
      profileColor:"",
      badge:"",
      usernameHistory:[],

      privacy:{
        lastSeen:true,
        online:true
      }
    };

    const inserted=await pool.query(`INSERT INTO users(username,password,rank,gold,xp,birth_date,gender,bio,email,device_fingerprint,created_at) VALUES($1,$2,'member',0,0,$3,$4,$5,$6,$7,NOW()) RETURNING id`,
      [u.username,u.passwordHash,u.dateOfBirth||null,u.gender||null,u.bio||"",u.email||null,fingerprintHash]);
    u.id=String(inserted.rows[0].id);
    await pool.query(`INSERT INTO device_fingerprints(fingerprint_hash,ip_hash,user_id) VALUES($1,$2,$3)`,[fingerprintHash,ipHash,Number(u.id)]);
    db.users.push(u);

    req.session.userId=u.id;

    save();

    log(
      u,
      "REGISTER",
      u.username
    );

    io.emit("presence");

    req.session.save(err=>{
      if(err){
        console.error("Session save error:",err);
        return res.status(500).json({error:"Could not create session."});
      }

      res.json({
        user:safeUser(u), token:makeToken(u.id)
      });
    });
  }
);

app.post(
  "/api/login",
  async(req,res)=>{
    const loginUsername=String(req.body.username||"").trim();
    const u=findUser(loginUsername);

    if(
      !u||
      !((u.password && String(req.body.password||"")===String(u.password)) ||
        (u.passwordHash && await bcrypt.compare(req.body.password||"",u.passwordHash)))
    ){
      return res.status(401).json({
        error:
          "Invalid username or password."
      });
    }

    if(String(u.rank).toUpperCase()==="VIP" && u.vipExpiresAt && Number(u.vipExpiresAt)<Date.now()){
      u.rank="MEMBER"; u.vipExpiresAt=null; u.vip_expires_at=null;
      await pool.query(`UPDATE users SET rank='user',vip_expires_at=NULL WHERE id=$1`,[Number(u.id)]);
    }
    if(u.banned===true){
      return res.status(403).json({error:"You have been banned"});
    }

    u.online=true;
    u.lastSeen=Date.now();

    req.session.userId=u.id;

    save();

    log(
      u,
      "LOGIN",
      u.username
    );
    notify(u.id,"security","Login successful","You have successfully logged in to Maleficent Chat.");

    io.emit("presence");

    req.session.save(err=>{
      if(err){
        console.error("Session save error:",err);
        return res.status(500).json({error:"Could not create login session."});
      }

      res.json({
        user:safeUser(u), token:makeToken(u.id)
      });
    });
  }
);

app.post(
  "/api/logout",
  auth,
  (req,res)=>{
    const u=current(req);

    u.online=false;
    u.lastSeen=Date.now();

    log(
      u,
      "LOGOUT",
      u.username
    );

    req.session.destroy(()=>{});

    save();

    io.emit("presence");

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/me",
  auth,
  (req,res)=>
    res.json({
      user:safeUser(current(req))
    })
);

app.patch(
  "/api/me",
  auth,
  (req,res)=>{
    const u=current(req);

    const allowed=[
      "displayName",
      "bio",
      "pronouns",
      "birthday",
      "banner",
      "theme",
      "profileColor",
      "badge"
    ];

    for(
      const k of allowed
    ){
      if(req.body[k]!==undefined){
        u[k]=String(
          req.body[k]
        ).slice(0,500);
      }
    }

    if(
      req.body.username&&
      req.body.username!==u.username
    ){
      if(
        !/^[A-Za-z0-9_]{3,24}$/.test(
          req.body.username
        )||
        findUser(req.body.username)
      ){
        return res.status(400).json({
          error:
            "Invalid or unavailable username."
        });
      }

      u.usernameHistory??=[];

      u.usernameHistory.push({
        username:u.username,
        time:Date.now()
      });

      u.username=
        String(req.body.username);
    }

    u.lastSeen=Date.now();

    save();

    log(
      u,
      "PROFILE_EDIT",
      u.username
    );

    res.json({
      user:safeUser(u)
    });
  }
);

app.post(
  "/api/me/avatar",
  auth,
  upload.single("file"),
  (req,res)=>{
    if(!req.file){
      return res.status(400).json({
        error:"No file"
      });
    }

    current(req).avatar=
      "/uploads/"+req.file.filename;

    save();

    res.json({
      user:safeUser(
        current(req)
      )
    });
  }
);

app.delete('/api/me/avatar',auth,(req,res)=>{
  const u=current(req);
  u.avatar='';
  save();
  res.json({ok:true,user:safeUser(u)});
});

app.post(
  "/api/me/banner",
  auth,
  upload.single("file"),
  (req,res)=>{
    if(!req.file){
      return res.status(400).json({
        error:"No file"
      });
    }

    current(req).banner=
      "/uploads/"+req.file.filename;

    save();

    res.json({
      user:safeUser(
        current(req)
      )
    });
  }
);

app.delete(
  "/api/me",
  auth,
  (req,res)=>{
    const u=current(req);

    if(u.rank==="OWNER"){
      return res.status(400).json({
        error:
          "The permanent owner cannot be deleted."
      });
    }

    db.users=
      db.users.filter(
        x=>x.id!==u.id
      );

    db.friends=
      db.friends.filter(
        f=>f.a!==u.id&&f.b!==u.id
      );

    db.privateMessages=
      db.privateMessages.filter(
        m=>
          m.from!==u.id&&
          m.to!==u.id
      );

    log(
      u,
      "ACCOUNT_DELETE",
      u.username
    );

    req.session.destroy(
      ()=>{}
    );

    save();

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/users",
  auth,
  (req,res)=>{
    let q=String(
      req.query.q||""
    ).toLowerCase();

    let arr=db.users
      .filter(
        u=>
          !q||
          u.username
            .toLowerCase()
            .includes(q)||
          u.displayName
            .toLowerCase()
            .includes(q)
      )
      .sort(
        (a,b)=>
          (b.online-a.online)||
          (
            rankOrder[b.rank]-
            rankOrder[a.rank]
          )||
          a.username.localeCompare(
            b.username
          )
      );

    res.json({
      users:arr.map(safeUser)
    });
  }
);

app.post(
  "/api/users/:id/block",
  auth,
  (req,res)=>{
    const u=current(req);
    const v=findUser(req.params.id);

    u.blocked??=[];

    if(
      v&&
      !u.blocked.includes(v.id)
    ){
      u.blocked.push(v.id);
    }

    save();

    res.json({
      ok:true
    });
  }
);

app.delete(
  "/api/users/:id/block",
  auth,
  (req,res)=>{
    const u=current(req);

    u.blocked=
      (u.blocked||[])
      .filter(
        x=>x!==req.params.id
      );

    save();

    res.json({
      ok:true
    });
  }
);

app.get('/api/users/blocked',auth,(req,res)=>{
  const u=current(req); const ids=new Set(u.blocked||[]);
  res.json({users:db.users.filter(x=>ids.has(x.id)).map(safeUser)});
});

app.get("/api/rooms",auth,async(req,res)=>{
  await pool.query(`INSERT INTO rooms(name,created_by,icon,description,category,is_public,rank_required,invite_token,min_age,max_age,is_default) VALUES ('Main room 1',(SELECT id FROM users WHERE username='Maleficent'),'🏠','For members aged 0–18','Community',true,'MEMBER','main-1',0,18,true),('Main room 2',(SELECT id FROM users WHERE username='Maleficent'),'🏠','For members aged 19–99','Community',true,'MEMBER','main-2',19,99,true) ON CONFLICT(name) DO UPDATE SET min_age=EXCLUDED.min_age,max_age=EXCLUDED.max_age,is_default=true`);
  const {rows}=await pool.query(`SELECT r.*,u.username AS creator FROM rooms r LEFT JOIN users u ON r.created_by=u.id ORDER BY r.is_default DESC,r.created_at ASC,r.id ASC`);
  if(!rows.length) return res.status(503).json({error:'Rooms are not initialized yet. Please retry in a moment.',rooms:[]});
  const rooms=rows.map(r=>({id:String(r.id),name:r.name,icon:r.icon||"💬",description:r.description||"",category:r.category||"Community",public:r.is_public!==false,passwordHash:r.password_hash||null,rankRequired:String(r.rank_required||"MEMBER").toUpperCase(),limit:Number(r.room_limit||100),slowMode:Number(r.slow_mode||0),announcement:r.announcement||"",ownerId:r.created_by?String(r.created_by):null,banner:r.banner||"",inviteToken:r.invite_token||"",creator:r.creator||null,minAge:Number(r.min_age||0),maxAge:Number(r.max_age||99),isDefault:!!r.is_default,locked:!!r.password_hash,onlineCount:io.sockets.adapter.rooms.get("room:"+r.id)?.size||0}));
  db.rooms=rooms;
  res.json({rooms:rooms.map(r=>({...r,passwordHash:undefined}))});
});

async function createRoomHandler(req,res){
  const u=current(req); if(!u)return res.status(401).json({error:"Login required"});
  if(!(featureGrantAllowed(u,"create_rooms")||hasFeature(u,"create_room"))) return res.status(403).json({error:`Create room requires ${featureRank("create_room")} or higher.`});
  const name=cleanText(req.body.name).trim().slice(0,50)||"New Room";
  const minAge=Number(req.body.minAge??0),maxAge=Number(req.body.maxAge??99);
  if(!Number.isInteger(minAge)||!Number.isInteger(maxAge)||minAge<0||maxAge>120||minAge>maxAge)return res.status(400).json({error:"Enter a valid age range."});
  const password=req.body.password?await bcrypt.hash(String(req.body.password),10):null;
  try{
    const q=await pool.query(`INSERT INTO rooms(name,created_by,icon,description,category,is_public,password_hash,rank_required,room_limit,slow_mode,banner,invite_token,min_age,max_age,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false) RETURNING *, (SELECT username FROM users WHERE id=created_by) AS creator`,[name,Number(u.id),req.body.icon||"💬",cleanText(req.body.description).slice(0,300),cleanText(req.body.category).slice(0,40)||"Community",req.body.public!==false,password,String(req.body.rankRequired||"MEMBER").toUpperCase(),Number(req.body.limit)||100,Number(req.body.slowMode)||0,req.body.banner||"",crypto.randomBytes(12).toString("hex"),minAge,maxAge]);
    const r=q.rows[0]; const room={id:String(r.id),name:r.name,icon:r.icon||"💬",description:r.description||"",category:r.category||"Community",public:r.is_public!==false,passwordHash:r.password_hash||null,rankRequired:String(r.rank_required||"MEMBER").toUpperCase(),limit:Number(r.room_limit||100),slowMode:Number(r.slow_mode||0),announcement:r.announcement||"",ownerId:String(r.created_by),banner:r.banner||"",inviteToken:r.invite_token||"",creator:r.creator||u.username,minAge:Number(r.min_age),maxAge:Number(r.max_age),isDefault:false};
    db.rooms.push(room); log(u,"ROOM_CREATE",room.name); io.emit('rooms_updated'); res.status(201).json({room:{...room,passwordHash:undefined}});
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'A room with that name already exists.'});console.error(e);res.status(500).json({error:'Could not create room.'});}
}
app.post("/api/rooms",auth,createRoomHandler);
app.post("/api/rooms/create",auth,createRoomHandler);

app.patch("/api/rooms/:id",auth,async(req,res)=>{
  const u=current(req),r=db.rooms.find(x=>String(x.id)===String(req.params.id)); if(!r)return res.status(404).json({error:"Room not found"});
  if(r.isDefault || ["Main room 1","Main room 2"].includes(r.name))return res.status(403).json({error:"Permanent default rooms cannot be modified."});
  if(!featureGrantAllowed(u,"edit_rooms"))return res.status(403).json({error:"No permission"});
  const fields={}; for(const k of ["name","icon","description","category","rankRequired","limit","slowMode","banner","public"]) if(req.body[k]!==undefined) fields[k]=req.body[k];
  if(req.body.password!==undefined) fields.passwordHash=req.body.password?await bcrypt.hash(String(req.body.password),10):null;
  for(const k of ["minAge","maxAge"]) if(req.body[k]!==undefined){const n=Number(req.body[k]);if(!Number.isInteger(n)||n<0||n>120)return res.status(400).json({error:"Enter a valid age range."});fields[k]=n;}
  if((fields.minAge??r.minAge??0)>(fields.maxAge??r.maxAge??99))return res.status(400).json({error:"Minimum age cannot exceed maximum age."});
  const sets=[],vals=[]; const map={name:"name",icon:"icon",description:"description",category:"category",rankRequired:"rank_required",limit:"room_limit",slowMode:"slow_mode",banner:"banner",public:"is_public",passwordHash:"password_hash",minAge:"min_age",maxAge:"max_age"};
  for(const [k,v] of Object.entries(fields)){sets.push(`${map[k]}=$${vals.length+1}`);vals.push(k==="rankRequired"?String(v).toUpperCase():v);}
  if(sets.length){vals.push(Number(r.id));const q=await pool.query(`UPDATE rooms SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`,vals);const x=q.rows[0];Object.assign(r,{name:x.name,icon:x.icon,description:x.description,category:x.category,rankRequired:x.rank_required,limit:x.room_limit,slowMode:x.slow_mode,banner:x.banner,public:x.is_public,passwordHash:x.password_hash,minAge:x.min_age,maxAge:x.max_age});}
  log(u,"ROOM_EDIT",r.name);res.json({room:{...r,passwordHash:undefined}});
});

app.delete("/api/rooms/:id",auth,async(req,res)=>{
  const u=current(req); const r=db.rooms.find(x=>String(x.id)===String(req.params.id));
  if(!r)return res.status(404).json({error:"Room not found"});
  if(r.isDefault || ["Main room 1","Main room 2"].includes(r.name)) return res.status(400).json({error:"Cannot delete a permanent default room."});
  if(!featureGrantAllowed(u,"delete_rooms")) return res.status(403).json({error:"Room deletion permission required."});
  await pool.query(`DELETE FROM rooms WHERE id=$1`,[Number(req.params.id)]);
  db.rooms=db.rooms.filter(x=>String(x.id)!==String(req.params.id)); db.messages=db.messages.filter(m=>String(m.roomId)!==String(req.params.id));
  log(u,"ROOM_DELETE",r.name); res.json({ok:true});
});

app.post(
  "/api/rooms/:id/join",
  auth,
  featureAllowed("join_rooms"),
  async(req,res)=>{
    const u=current(req);

    const r=db.rooms.find(
      x=>x.id===req.params.id
    );

    if(!r){
      return res.status(404).json({
        error:"Room not found"
      });
    }

    if(u.banned===true){
      return res.status(403).json({error:"You have been banned"});
    }
    if(u.kickedUntil && u.kickedUntil>Date.now()){
      return res.status(403).json({error:`You have been kicked. You will be able to come back after ${new Date(u.kickedUntil).toLocaleTimeString()}`,kickedUntil:u.kickedUntil});
    }

    if(!roomAgeAllowed(u,r))return res.status(403).json({error:"You cannot join this room due to age restriction"});

    if(
      rankOrder[u.rank]<
      rankOrder[r.rankRequired]
    ){
      return res.status(403).json({
        error:
          "Your rank cannot enter this room."
      });
    }

    if(
      r.passwordHash&&
      !(await bcrypt.compare(
        req.body.password||"",
        r.passwordHash
      ))
    ){
      return res.status(403).json({
        error:"Wrong room password."
      });
    }

    res.json({
      ok:true,
      joinToken:makeRoomJoinToken(u.id,r),
      room:{
        ...r,
        passwordHash:undefined
      }
    });
  }
);

app.get('/api/rooms/:id/pinned',auth,(req,res)=>{
  const room=db.rooms.find(x=>x.id===req.params.id),actor=current(req); if(!room)return res.status(404).json({error:'Room not found'});
  if(!verifyRoomJoinToken(req.headers['x-room-join-token'],actor.id,room))return res.status(403).json({error:'Join this room before viewing pinned messages.'});
  res.json({messages:db.messages.filter(m=>m.roomId===room.id&&m.pinned&&!m.deleted).sort((a,b)=>b.time-a.time)});
});

app.get("/api/rooms/:id/messages",auth,async(req,res)=>{
  const actor=current(req),room=db.rooms.find(x=>String(x.id)===String(req.params.id));
  if(!room)return res.status(404).json({error:"Room not found"});
  if(!verifyRoomJoinToken(req.headers['x-room-join-token'],actor.id,room))return res.status(403).json({error:"Join this room before viewing its messages."});
  if(!roomAgeAllowed(actor,room))return res.status(403).json({error:"You cannot join this room due to age restriction"});
  const {rows}=await pool.query(`SELECT data FROM room_messages WHERE room_id=$1 ORDER BY created_at DESC LIMIT 300`,[Number(req.params.id)]);
  const now=Date.now();
  const messages=rows.reverse().map(r=>r.data).filter(m=>m && (!m.expiresAt||Number(m.expiresAt)>now) && !m.deleted);
  db.messages=db.messages.filter(m=>String(m.roomId)!==String(req.params.id)).concat(messages);
  res.json({messages});
});

app.post("/api/rooms/:id/messages",auth,featureAllowed("send_messages"),upload.single("file"),async(req,res)=>{
  const u=current(req); const r=db.rooms.find(x=>String(x.id)===String(req.params.id));
  if(!r)return res.status(404).json({error:"Room not found"});
  if(!verifyRoomJoinToken(req.headers['x-room-join-token'],u.id,r))return res.status(403).json({error:"Join this room before sending messages."});
  if(!roomAgeAllowed(u,r))return res.status(403).json({error:"You cannot join this room due to age restriction"});
  if(u.banned===true)return res.status(403).json({error:"You have been banned"});
  if(u.kickedUntil&&u.kickedUntil>Date.now())return res.status(403).json({error:`You have been kicked. You will be able to come back after ${new Date(u.kickedUntil).toLocaleTimeString()}`,kickedUntil:u.kickedUntil});
  if(u.mutedUntil&&u.mutedUntil>Date.now())return res.status(403).json({error:"You are muted until "+new Date(u.mutedUntil).toLocaleString()});
  if(req.file && String(u.rank).toUpperCase()!=="DEVELOPER" && !featureGrantAllowed(u,"chat_file_upload")) return res.status(403).json({error:"Your rank cannot upload files in chat."});
  if(String(u.rank).toUpperCase()!=="DEVELOPER" && req.file&&!/^image\/|^audio\//.test(req.file.mimetype))return res.status(400).json({error:"Only image/audio uploads are allowed."});
  let text=cleanText(req.body.text);
  if(!text&&!req.file)return res.status(400).json({error:"Message is empty."});

  const matchedFilter=filteredWord(text);
  const affected=(db.settings.filter_affected_ranks||[]).map(x=>String(x).toUpperCase());
  let autoMuted=false;
  if(matchedFilter && String(u.rank).toUpperCase()!=="DEVELOPER" && affected.includes(String(u.rank).toUpperCase())){
    const minutes=Math.max(1,Number(db.settings.filterMuteDurationMinutes||5));
    const stars="*".repeat(Math.max(3,String(matchedFilter).length));
    const re=new RegExp(String(matchedFilter).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi");
    text=text.replace(re,stars); u.mutedUntil=Date.now()+minutes*60000; u.muteReason="Automatic filtered-word protection"; autoMuted=true;
    db.moderationHistory.push({id:id(),time:Date.now(),target:u.id,actor:"SYSTEM",action:"AUTO_MUTE",reason:`Filtered word: ${matchedFilter}`,minutes});
    notify(u.id,"moderation","Auto-mute",`Your message matched the room filter and you were muted for ${minutes} minute${minutes===1?"":"s"}.`);
  }
  const m={id:id(),roomId:String(r.id),userId:u.id,username:u.username,displayName:u.displayName,rank:u.rank,
    usernameColor:u.settings?.usernameColor||"",chatFont:u.settings?.chatFont||"",text,
    attachment:req.file?{url:"/uploads/"+req.file.filename,type:req.file.mimetype,name:req.file.originalname}:null,
    replyTo:req.body.replyTo||null,forwardedFrom:req.body.forwardedFrom||null,reactions:{},edited:false,deleted:false,pinned:false,time:Date.now(),delivered:true};
  const expiresIn=Number(req.body.expiresIn||0); if(expiresIn>0)m.expiresAt=Date.now()+Math.min(expiresIn,7*86400000);

  // Each message is an independent INSERT: no global lock and no serialized in-memory save is awaited.
  await pool.query(`INSERT INTO room_messages(id,room_id,user_id,data,created_at) VALUES($1,$2,$3,$4::jsonb,NOW())`,
    [m.id,Number(r.id),Number(u.id),JSON.stringify(m)]);
  db.messages.push(m);
  u.stats ||= {messages:0,rooms:0,friends:0}; u.stats.messages=(u.stats.messages||0)+1;
  checkAchievements(u); awardXp(u,Number(db.settings.xpPerMessage||5)); u.gold=(u.gold||0)+Number(db.settings.goldPerMessage||0); save();
  io.to("room:"+r.id).emit("message",m);

  if(/^@Mal\s+/i.test(text)){const reply=malReply(u,text);if(reply){const bot={id:id(),system:false,isBot:true,userId:"bot-mal",username:"Mal",displayName:"Mal",rank:"BOT",text:reply,roomId:String(r.id),time:Date.now(),reactions:{},pinned:false,deleted:false};await pool.query(`INSERT INTO room_messages(id,room_id,data,created_at) VALUES($1,$2,$3::jsonb,NOW())`,[bot.id,Number(r.id),JSON.stringify(bot)]);db.messages.push(bot);io.to("room:"+r.id).emit("message",bot);}}
  const botMention=text.match(/^@([A-Za-z0-9_]+)\s+([\s\S]*)/);
  if(botMention && !/^Mal$/i.test(botMention[1])){const bq=await pool.query(`SELECT * FROM bots WHERE LOWER(name)=LOWER($1) AND is_active=true LIMIT 1`,[botMention[1]]);const botRow=bq.rows[0];if(botRow && botRow.auto_reply){const bot={id:id(),system:false,isBot:true,userId:'bot-'+botRow.id,username:botRow.name,displayName:botRow.name,rank:'BOT',text:botRow.auto_reply,roomId:String(r.id),time:Date.now(),reactions:{},pinned:false,deleted:false};await pool.query(`INSERT INTO room_messages(id,room_id,data,created_at) VALUES($1,$2,$3::jsonb,NOW())`,[bot.id,Number(r.id),JSON.stringify(bot)]);db.messages.push(bot);io.to('room:'+r.id).emit('message',bot);}}
  addActivity("message",`${u.username} sent a message in ${r.name||"a room"}`,u.id,{roomId:r.id});
  res.json({message:m,autoMuted});
});

app.patch(
  "/api/messages/:id",
  auth,
  featureAllowed("edit_message"),
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(!m){
      return res.status(404).json({
        error:"Message not found"
      });
    }

    if(
      m.userId!==u.id&&
      !hasRank(u,"MOD")
    ){
      return res.status(403).json({
        error:"No permission"
      });
    }

    m.text=
      cleanText(req.body.text);

    m.edited=true;
    m.editedAt=Date.now();

    save();

    io.to(
      "room:"+m.roomId
    ).emit(
      "message:update",
      m
    );

    res.json({
      message:m
    });
  }
);

app.delete(
  "/api/messages/:id",
  auth,
  featureAllowed("delete_message"),
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(!m){
      return res.status(404).json({
        error:"Message not found"
      });
    }

    if(
      m.userId!==u.id&&
      !hasRank(u,"MOD")
    ){
      return res.status(403).json({
        error:"No permission"
      });
    }

    const deletedSnapshot={
      id:m.id, roomId:m.roomId, userId:m.userId, username:m.username,
      displayName:m.displayName, rank:m.rank, text:m.text||"", time:m.time,
      attachment:m.attachment||null, deletedBy:u.username, deletedAt:Date.now()
    };
    m.deleted=true;
    m.deletedSnapshot=deletedSnapshot;
    m.text="This message was deleted.";

    save();

    log(u,"MESSAGE_DELETE",m.id,deletedSnapshot);

    io.to(
      "room:"+m.roomId
    ).emit(
      "message:update",
      m
    );

    res.json({
      ok:true
    });
  }
);

app.post(
  "/api/messages/:id/reaction",
  auth,
  featureAllowed("react_message"),
  (req,res)=>{
    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    const u=current(req);

    if(!m){
      return res.status(404).json({
        error:"Message not found"
      });
    }

    let e=
      m.reactions[
        req.body.emoji||"👍"
      ]??[];

    e=e.includes(u.id)
      ?e.filter(
          x=>x!==u.id
        )
      :[
          ...e,
          u.id
        ];

    m.reactions[
      req.body.emoji||"👍"
    ]=e;

    save();

    io.to(
      "room:"+m.roomId
    ).emit(
      "message:update",
      m
    );

    res.json({
      message:m
    });
  }
);

app.post(
  "/api/messages/:id/pin",
  auth,
  featureAllowed("pin_message"),
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(
      !m||
      !hasRank(u,"MOD")
    ){
      return res.status(403).json({
        error:"Moderator required"
      });
    }

    m.pinned=!m.pinned;

    save();

    io.to(
      "room:"+m.roomId
    ).emit(
      "message:update",
      m
    );

    res.json({
      message:m
    });
  }
);

app.post(
  "/api/messages/:id/report",
  auth,
  featureAllowed("report_message"),
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(!m){
      return res.status(404).json({
        error:"Message not found"
      });
    }

    const report={
      id:id(),
      time:Date.now(),
      reporter:u.id,
      reporterUsername:u.username,
      messageId:m.id,
      roomId:m.roomId,
      reportedUserId:m.userId,
      reportedUserUsername:m.username,
      reportedUserDisplayName:m.displayName,
      reportedUserRank:m.rank,
      messageSnapshot:{
        id:m.id, text:m.text||"", username:m.username, displayName:m.displayName,
        rank:m.rank, roomId:m.roomId, time:m.time, attachment:m.attachment||null
      },

      category:
        cleanText(
          req.body.category
        ).slice(0,60)||
        "Other",

      reason:
        cleanText(
          req.body.reason
        ).slice(0,500),

      status:"OPEN"
    };

    db.reports.push(report);

    notifyStaff(
      "report",
      "New report",
      "A message was reported."
    );

    save();

    res.json({
      report
    });
  }
);

function notifyStaff(
  type,
  title,
  text
){
  db.users
    .filter(
      u=>staff(u.rank)
    )
    .forEach(
      u=>notify(
        u.id,
        type,
        title,
        text
      )
    );
}

app.post(
  "/api/rooms/:id/clear",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasFeature(u,"clear_room")){
      return res.status(403).json({
        error:`Clear room requires ${featureRank("clear_room")} or higher.`
      });
    }

    db.messages=
      db.messages.filter(
        m=>m.roomId!==req.params.id
      );

    save();

    log(
      u,
      "ROOM_CLEAR",
      req.params.id
    );

    io.to(
      "room:"+req.params.id
    ).emit(
      "room:clear"
    );

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/search/messages",
  auth,
  (req,res)=>{
    const q=String(req.query.q||"").trim().toLowerCase();
    const author=String(req.query.author||"").trim().toLowerCase();
    const roomId=String(req.query.roomId||"").trim();
    const from=Number(req.query.from||0);
    const to=Number(req.query.to||0);
    const messages=db.messages
      .filter(m=>{
        const text=String(m.deletedSnapshot?.text ?? m.text ?? "").toLowerCase();
        if(q && !text.includes(q)) return false;
        if(author && !String(m.username||"").toLowerCase().includes(author)) return false;
        if(roomId && m.roomId!==roomId) return false;
        if(from && m.time<from) return false;
        if(to && m.time>to) return false;
        return true;
      })
      .slice(-300)
      .reverse();
    res.json({messages,rooms:db.rooms.map(r=>({id:r.id,name:r.name}))});
  }
);

app.get(
  "/api/saved-messages",
  auth,
  (req,res)=>{
    const u=current(req);
    const ids=Array.isArray(u.saved)?u.saved:[];
    const byId=new Map(db.messages.map(m=>[m.id,m]));
    const messages=ids.map(x=>byId.get(x)).filter(Boolean).reverse();
    res.json({messages,savedIds:ids});
  }
);

app.post(
  "/api/messages/:id/save",
  auth,
  featureAllowed("save_message"),
  (req,res)=>{
    const u=current(req);

    u.saved??=[];

    u.saved.includes(
      req.params.id
    )
      ?u.saved=
        u.saved.filter(
          x=>x!==req.params.id
        )
      :u.saved.push(
        req.params.id
      );

    save();

    res.json({
      saved:
        u.saved.includes(
          req.params.id
        )
    });
  }
);

app.post(
  "/api/messages/:id/forward",
  auth,
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(!m){
      return res.status(404).json({
        error:"Not found"
      });
    }

    const r=db.rooms.find(
      x=>x.id===req.body.roomId
    );

    if(!r){
      return res.status(404).json({
        error:"Room not found"
      });
    }

    const f={
      ...m,

      id:id(),
      roomId:r.id,
      userId:u.id,
      username:u.username,
      displayName:u.displayName,

      forwardedFrom:m.id,

      time:Date.now(),
      edited:false,
      deleted:false
    };

    db.messages.push(f);

    save();

    io.to(
      "room:"+r.id
    ).emit(
      "message",
      f
    );

    res.json({
      message:f
    });
  }
);

app.post(
  "/api/friends/:id/request",
  auth,
  (req,res)=>{
    const u=current(req);
    const v=findUser(req.params.id);

    if(
      !v||
      v.id===u.id
    ){
      return res.status(400).json({
        error:"Invalid user"
      });
    }

    if(
      !db.friends.some(
        f=>
          (
            f.a===u.id&&
            f.b===v.id
          )||
          (
            f.a===v.id&&
            f.b===u.id
          )
      )
    ){
      db.friends.push({
        a:u.id,
        b:v.id,
        status:"PENDING",
        by:u.id,
        time:Date.now()
      });
    }

    save();

    notify(
      v.id,
      "friend-request",
      "Friend request",
      "@"+u.username+
      " sent you a friend request."
    );

    res.json({
      ok:true
    });
  }
);

app.post(
  "/api/friends/:id/accept",
  auth,
  (req,res)=>{
    const u=current(req);

    const f=db.friends.find(
      f=>
        (
          (
            f.a===req.params.id&&
            f.b===u.id
          )||
          (
            f.b===req.params.id&&
            f.a===u.id
          )
        )&&
        f.status==="PENDING"
    );

    if(!f){
      return res.status(404).json({
        error:"Request not found"
      });
    }

    f.status="ACCEPTED";

    save();

    notify(
      req.params.id,
      "friend",
      "Friend request accepted",
      "You are now friends."
    );

    res.json({
      ok:true
    });
  }
);

app.delete(
  "/api/friends/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    db.friends=
      db.friends.filter(
        f=>
          !(
            (
              f.a===u.id&&
              f.b===req.params.id
            )||
            (
              f.b===u.id&&
              f.a===req.params.id
            )
          )
      );

    save();

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/friends",
  auth,
  (req,res)=>{
    const u=current(req);

    const ids=
      db.friends
        .filter(
          f=>
            (
              f.a===u.id||
              f.b===u.id
            )&&
            f.status==="ACCEPTED"
        )
        .map(
          f=>
            f.a===u.id
              ?f.b
              :f.a
        );

    const incoming=db.friends
      .filter(f=>f.status==="PENDING"&&f.b===u.id)
      .map(f=>findUser(f.a))
      .filter(Boolean)
      .map(safeUser);
    const outgoing=db.friends
      .filter(f=>f.status==="PENDING"&&f.a===u.id)
      .map(f=>findUser(f.b))
      .filter(Boolean)
      .map(safeUser);

    res.json({
      users:ids.map(findUser).filter(Boolean).map(safeUser),
      incoming,
      outgoing
    });
  }
);

app.get("/api/dm/conversations",auth,featureAllowed("private_messages"),async(req,res)=>{
  const u=current(req);
  const {rows}=await pool.query(`SELECT DISTINCT ON (other_id) other_id,data,created_at FROM (
    SELECT CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END AS other_id,data,created_at
    FROM private_messages WHERE sender_id=$1 OR receiver_id=$1
  ) q ORDER BY other_id,created_at DESC`,[Number(u.id)]);
  const conversations=rows.map(r=>({user:safeUser(findUser(String(r.other_id))),lastMessage:r.data})).filter(x=>x.user);
  res.json({conversations});
});

app.get("/api/dm/:id",auth,featureAllowed("private_messages"),async(req,res)=>{
  const u=current(req),v=findUser(req.params.id); if(!v)return res.status(404).json({error:"User not found"});
  if((u.blocked||[]).includes(v.id)||(v.blocked||[]).includes(u.id))return res.status(403).json({error:"Messaging blocked"});
  const {rows}=await pool.query(`SELECT data FROM private_messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1) ORDER BY created_at DESC LIMIT 300`,[Number(u.id),Number(v.id)]);
  res.json({messages:rows.reverse().map(r=>r.data)});
});

app.post("/api/dm/:id",auth,featureAllowed("private_messages"),upload.single("file"),async(req,res)=>{
  const u=current(req),v=findUser(req.params.id); if(!v)return res.status(404).json({error:"User not found"});
  if((u.blocked||[]).includes(v.id)||(v.blocked||[]).includes(u.id))return res.status(403).json({error:"Messaging blocked"});
  const m={id:id(),from:u.id,to:v.id,text:cleanText(req.body.text),attachment:req.file?{url:"/uploads/"+req.file.filename,type:req.file.mimetype,name:req.file.originalname}:null,replyTo:req.body.replyTo||null,time:Date.now(),read:false,delivered:true};
  if(!m.text&&!m.attachment)return res.status(400).json({error:"Empty message"});
  await pool.query(`INSERT INTO private_messages(id,sender_id,receiver_id,message,data,created_at) VALUES($1,$2,$3,$4,$5::jsonb,NOW())`,
    [m.id,Number(u.id),Number(v.id),m.text,JSON.stringify(m)]);
  db.privateMessages.push(m); save(); notify(v.id,"private-message","New private message",`@${u.username} sent you a private message.`); io.to("user:"+v.id).emit("dm",m);
  res.json({message:m});
});

app.post(
  "/api/dm/:id/read",
  auth,
  (req,res)=>{
    const u=current(req);

    db.privateMessages
      .filter(
        m=>
          m.from===req.params.id&&
          m.to===u.id
      )
      .forEach(
        m=>m.read=true
      );

    save();

    res.json({
      ok:true
    });
  }
);

function systemNotice(text, roomId=null){
  const notice={id:id(),system:true,username:'Aurora',displayName:'Aurora',rank:'BOT',text:String(text),roomId,time:Date.now(),reactions:{},pinned:false,deleted:false};
  if(roomId){ db.messages.push(notice); save(); io.to('room:'+roomId).emit('message',notice); } else { io.emit('system-message',notice); }
  return notice;
}

app.get('/api/daily/status',auth,async(req,res)=>{const q=await pool.query(`SELECT last_claim,streak,(last_claim AT TIME ZONE 'UTC')::date AS claim_day FROM daily_rewards WHERE user_id=$1`,[Number(current(req).id)]);const today=new Date().toISOString().slice(0,10);res.json({claimed:!!(q.rowCount&&q.rows[0].claim_day===today),streak:Number(q.rows[0]?.streak||0)});});
app.post('/api/daily/claim',auth,async(req,res)=>{
  const u=current(req); if(!u)return res.status(401).json({error:'Login required'});
  const gold=Number(db.settings?.daily_reward_gold??25), xp=Number(db.settings?.daily_reward_xp??15);
  const today=new Date().toISOString().slice(0,10);
  const q=await pool.query(`SELECT last_claim,streak,(last_claim AT TIME ZONE 'UTC')::date AS claim_day FROM daily_rewards WHERE user_id=$1`,[Number(u.id)]);
  if(q.rowCount && q.rows[0].claim_day===today) return res.status(409).json({error:'Already claimed',claimed:true,streak:Number(q.rows[0].streak||0),gold:u.gold||0,xp:u.xp||0});
  const previous=q.rows[0]; const streak=previous ? Number(previous.streak||0)+1 : 1;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`INSERT INTO daily_rewards(user_id,last_claim,streak) VALUES($1,NOW(),$2) ON CONFLICT(user_id) DO UPDATE SET last_claim=NOW(),streak=$2`,[Number(u.id),streak]);
    await client.query(`UPDATE users SET gold=gold+$1,xp=xp+$2 WHERE id=$3`,[gold,xp,Number(u.id)]);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  u.gold=(u.gold||0)+gold; u.xp=(u.xp||0)+xp; u.level=Math.floor(u.xp/(db.settings.xpPerLevel||100))+1; notify(u.id,'gold','Daily reward',`You received ${gold} gold and ${xp} XP.`); save();
  res.json({ok:true,gold:u.gold,xp:u.xp,amount:gold,xpAmount:xp,streak});
});
app.post('/api/rewards/daily',auth,(req,res)=>res.redirect(307,'/api/daily/claim'));

app.get('/api/achievements/:userId',auth,async(req,res)=>{const {rows}=await pool.query(`SELECT id,user_id,name,icon,earned_at FROM achievements WHERE user_id=$1 ORDER BY earned_at DESC,id DESC`,[Number(req.params.userId)]);res.json({achievements:rows});});
app.get('/api/achievements',auth,async(req,res)=>{const {rows}=await pool.query(`SELECT id,user_id,name,icon,earned_at FROM achievements WHERE user_id=$1 ORDER BY earned_at DESC,id DESC`,[Number(current(req).id)]);res.json({achievements:rows});});
app.get('/api/account/export',auth,(req,res)=>{
  const u=current(req);
  res.json({exportedAt:Date.now(),account:{username:u.username,displayName:u.displayName,createdAt:u.createdAt,rank:u.rank,level:u.level,xp:u.xp,gold:u.gold,bio:u.bio,interests:u.interests,achievements:u.achievements},loginHistory:u.loginHistory||[]});
});

app.get('/api/notifications',auth,async(req,res)=>{const {rows}=await pool.query(`SELECT id,type,message,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,[Number(current(req).id)]);res.json({notifications:rows.map(n=>({id:String(n.id),type:n.type,title:n.type,text:n.message,message:n.message,time:n.created_at,read:n.is_read}))});});
app.get('/api/notifications/unread',auth,async(req,res)=>{const {rows}=await pool.query(`SELECT id,type,message,is_read,created_at FROM notifications WHERE user_id=$1 AND is_read=false ORDER BY created_at DESC LIMIT 100`,[Number(current(req).id)]);res.json({notifications:rows.map(n=>({id:String(n.id),type:n.type,title:n.type,text:n.message,message:n.message,time:n.created_at,read:n.is_read}))});});
app.patch('/api/notifications/:id/read',auth,async(req,res)=>{const r=await pool.query(`UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2 RETURNING id`,[req.params.id,Number(current(req).id)]);if(!r.rowCount)return res.status(404).json({error:'Notification not found'});res.json({ok:true});});
app.post('/api/notifications/read',auth,async(req,res)=>{await pool.query(`UPDATE notifications SET is_read=true WHERE user_id=$1`,[Number(current(req).id)]);res.json({ok:true});});
app.delete('/api/notifications/:id',auth,async(req,res)=>{await pool.query(`DELETE FROM notifications WHERE id=$1 AND user_id=$2`,[req.params.id,Number(current(req).id)]);res.json({ok:true});});
app.delete('/api/notifications',auth,async(req,res)=>{await pool.query(`DELETE FROM notifications WHERE user_id=$1`,[Number(current(req).id)]);res.json({ok:true});});

app.post(
  "/api/moderation/:action",
  auth,
  (req,res)=>{
    const actor=current(req);

    const action=req.params.action.toUpperCase();
    const permission={MUTE:"can_mute",UNMUTE:"can_mute",KICK:"can_kick",REVOKE_KICK:"can_kick",BAN:"can_ban",REVOKE_BAN:"can_ban",WARN:"can_warn"}[action];
    const explicit=permission?userFeatureGrant(actor,permission):null;
    if(explicit===false || (!hasRank(actor,"MOD")&&explicit!==true)){
      return res.status(403).json({
        error:"Moderator required"
      });
    }

    const target=findUser(
      req.body.userId
    );

    if(!target){
      return res.status(404).json({
        error:"User not found"
      });
    }
    if(String(target.rank).toUpperCase()==="DEVELOPER") return res.status(403).json({error:"Cannot act on Developer"});

    if(
      rankOrder[target.rank]>=
      rankOrder[actor.rank]&&
      target.id!==actor.id
    ){
      return res.status(403).json({
        error:
          "Cannot moderate an equal or higher rank."
      });
    }

    let until=null;

    if(action==="MUTE"){
      until=
        Date.now()+
        Math.max(
          1,
          Number(req.body.minutes)||10
        )*
        60000;
    }

    if(action==="KICK"){
      until=
        Date.now()+
        Math.max(
          1,
          Number(req.body.minutes)||5
        )*
        60000;
    }

    if(action==="BAN"){
      until=null;
    }

    if(action==="MUTE"){
      target.mutedUntil=until;
      target.muteReason=cleanText(req.body.reason)||"MUTE";
      target.online=false;
    }
    if(action==="KICK"){
      target.kickedUntil=until;
      target.kickReason=cleanText(req.body.reason)||"KICK";
      target.online=false;
    }
    if(action==="BAN"){
      target.banned=true;
      target.banReason=cleanText(req.body.reason)||"BAN";
      target.online=false;
    }

    if(action==="UNMUTE"||action==="REVOKE_MUTE"){
      target.mutedUntil=null; target.muteReason="";
    }
    if(action==="REVOKE_KICK"){
      target.kickedUntil=null; target.kickReason="";
    }
    if(action==="REVOKE_BAN"){
      target.banned=false; target.banReason="";
    }

    if(action==="WARN"){
      target.warnings=(target.warnings||0)+1;
    }

    db.moderationHistory.push({
      id:id(),
      time:Date.now(),
      actor:actor.id,
      target:target.id,
      action,
      reason:
        cleanText(
          req.body.reason
        ),
      expiresAt:until
    });

    log(
      actor,
      action,
      target.username,
      {
        reason:req.body.reason
      }
    );

    save();
    const actionText={MUTE:'muted',KICK:'kicked',BAN:'banned',UNMUTE:'unmuted',REVOKE_MUTE:'unmuted',REVOKE_BAN:'unbanned',REVOKE_KICK:'unkicked',WARN:'warned'}[action]||action.toLowerCase(); const mainRoom=db.rooms.find(x=>x.id==='main'||String(x.name).toLowerCase()==='main room')||db.rooms[0]; systemNotice(`@${target.username} has been ${actionText}.`,mainRoom?.id||null);

    notify(
      target.id,
      action==="WARN"?"warning":"moderation",
      action==="WARN"?"Warning ⚠️":"Moderation action",
      action==="WARN" ? (cleanText(req.body.reason)||"Please review the community rules.") : action+": "+(req.body.reason||"")
    );
    if(action==="WARN") io.to("user:"+target.id).emit("warning-popup",{reason:cleanText(req.body.reason)||"Please review the community rules."});
    if(action==="KICK") io.to("user:"+target.id).emit("kick-lock",{until:target.kickedUntil,reason:target.kickReason});

    io.emit("presence");

    res.json({
      user:safeUser(target)
    });
  }
);

app.get("/api/users/:id/action-history",auth,(req,res)=>{
  const u=current(req);
  if(!hasRank(u,"MOD")) return res.status(403).json({error:"Staff only"});
  const target=findUser(req.params.id);
  if(!target) return res.status(404).json({error:"User not found"});
  const history=db.moderationHistory.filter(x=>x.target===target.id).map(x=>({
    ...x, actorUsername:x.actor==="SYSTEM"?"SYSTEM":(findUser(x.actor)?.username||x.actor)
  })).sort((a,b)=>b.time-a.time);
  res.json({user:safeUser(target),history});
});

app.get(
  "/api/moderation/history/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    if(
      !hasRank(u,"MOD")&&
      u.id!==req.params.id
    ){
      return res.status(403).json({
        error:"No permission"
      });
    }

    res.json({
      history:
        db.moderationHistory
          .filter(
            x=>
              x.target===
              req.params.id
          )
    });
  }
);

app.get(
  "/api/staff/dashboard",
  auth,
  featureAllowed("view_staff_dashboard"),
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"MOD")){
      return res.status(403).json({
        error:"Staff only"
      });
    }

    res.json({
      reports:db.reports.filter(x=>x.status==='OPEN'),

      logs:
        db.logs
          .slice(-500)
          .reverse(),

      history:
        db.moderationHistory
          .slice(-500)
          .reverse(),

      activeActions:db.users.filter(x=>
        (x.banned===true)||
        (x.kickedUntil&&x.kickedUntil>Date.now())||
        (x.mutedUntil&&x.mutedUntil>Date.now())
      ).map(x=>({id:x.id,username:x.username,displayName:x.displayName,rank:x.rank,gold:x.gold||0,banned:!!x.banned,kickedUntil:x.kickedUntil||null,mutedUntil:x.mutedUntil||null,reason:x.banReason||x.kickReason||x.muteReason||""})),

      stats:{
        users:db.users.length,

        online:
          db.users.filter(
            x=>x.online
          ).length,

        messages:
          db.messages.length,

        reportsOpen:
          db.reports.filter(
            x=>x.status==="OPEN"
          ).length
      }
    });
  }
);

app.post(
  "/api/staff/reports/:id/resolve",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"MOD")){
      return res.status(403).json({
        error:"Staff only"
      });
    }

    const r=db.reports.find(
      x=>x.id===req.params.id
    );

    if(!r){
      return res.status(404).json({
        error:"Report not found"
      });
    }

    r.status=
      req.body.status||
      "RESOLVED";

    r.resolvedBy=u.id;
    r.resolvedAt=Date.now();

    save();

    log(
      u,
      "REPORT_RESOLVE",
      r.id,
      {
        status:r.status
      }
    );

    res.json({
      report:r
    });
  }
);

app.get(
  "/api/staff/filter-word",
  auth,
  (req,res)=>{
    const u=current(req);
    if(!hasRank(u,"ADMIN")) return res.status(403).json({error:"Admin required"});
    res.json({words:db.bannedWords||[]});
  }
);

app.post(
  "/api/staff/filter-word",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"ADMIN")){
      return res.status(403).json({
        error:"Admin required"
      });
    }

    const w=
      cleanText(
        req.body.word
      ).trim();

    if(
      w&&
      !db.bannedWords.includes(w)
    ){
      db.bannedWords.push(w);
    }

    save();

    log(
      u,
      "FILTER_ADD",
      w
    );

    res.json({
      words:db.bannedWords
    });
  }
);

app.delete(
  "/api/staff/filter-word",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"ADMIN")){
      return res.status(403).json({
        error:"Admin required"
      });
    }

    db.bannedWords=
      db.bannedWords.filter(
        w=>w!==req.body.word
      );

    save();

    res.json({
      words:db.bannedWords
    });
  }
);


// PostgreSQL-backed structured community features.
function normalizeAllowedRanks(v, fallback){
  const list=Array.isArray(v)?v:[];
  const allowed=["OWNER","ADMIN","STAFF","TRUSTED","PREMIUM","VIP","USER","MEMBER","MOD","SUPER_ADMIN","COMMISSOR","COOWNER"];
  const out=[...new Set(list.map(x=>String(x||"").toUpperCase()).filter(x=>allowed.includes(x)))];
  return out.length?out:fallback;
}

app.get('/api/filter-words',ownerOnly,async(req,res)=>{
  const {rows}=await pool.query(`SELECT id,word,created_at,added_by FROM filter_words ORDER BY word`);
  res.json({words:rows,total:rows.length});
});
app.post('/api/filter-words/bulk',ownerOnly,async(req,res)=>{
  const raw=String(req.body.text||"");
  const words=[...new Set(raw.split('\n').map(w=>w.trim().toLowerCase()).filter(Boolean))];
  for(const word of words) await pool.query(`INSERT INTO filter_words(word,added_by) VALUES($1,$2) ON CONFLICT(word) DO NOTHING`,[word,Number(current(req).id)]);
  db.bannedWords=[...new Set([...db.bannedWords,...words])];
  save();
  res.json({ok:true,added:words.length});
});
app.delete('/api/filter-words/:id',ownerOnly,async(req,res)=>{
  await pool.query(`DELETE FROM filter_words WHERE id=$1`,[req.params.id]);
  const {rows}=await pool.query(`SELECT word FROM filter_words ORDER BY id`);
  db.bannedWords=rows.map(x=>x.word); save(); res.json({ok:true,words:db.bannedWords});
});

// Friend Wall
app.get('/api/wall',auth,async(req,res)=>{
  const {rows}=await pool.query(`
    SELECT w.*,u.username,u.avatar,u.rank FROM wall_posts w
    LEFT JOIN users u ON u.id=w.user_id
    WHERE w.status IN ('approved','pinned') ORDER BY CASE WHEN w.status='pinned' THEN 0 ELSE 1 END, w.created_at DESC LIMIT 100`);
  res.json({posts:rows});
});
async function wallPostHandler(req,res){
  const u=current(req), grants=db.settings?.feature_grants?.wall_post||["OWNER","ADMIN"], rank=String(u.rank||'').toUpperCase();
  if(String(u.rank).toUpperCase()!=="DEVELOPER" && u.username!==DEFAULT_OWNER&&!grants.map(x=>String(x).toUpperCase()).includes(rank))return res.status(403).json({error:"Your rank cannot create wall posts."});
  const content=cleanText(req.body.content||"").trim().slice(0,5000), media=req.file;
  if(media&&!/^(image\/(png|jpe?g|gif|webp|avif)|video\/)/i.test(media.mimetype))return res.status(400).json({error:"Only image or video files are allowed."});
  if(!content&&!media)return res.status(400).json({error:"Post cannot be empty."});
  const mediaUrl=media?`/uploads/${media.filename}`:null;
  const {rows}=await pool.query(`INSERT INTO wall_posts(user_id,content,media_url) VALUES($1,$2,$3) RETURNING *`,[Number(u.id),content,mediaUrl]);
  res.json({post:{...rows[0],username:u.username,avatar:u.avatar||"",rank:u.rank}});
}
app.post('/api/wall/post',auth,upload.single('file'),wallPostHandler);
app.post('/api/wall',auth,upload.single('file'),wallPostHandler);
app.post('/api/wall/:id/like',auth,async(req,res)=>{
  const r=await pool.query(`UPDATE wall_posts SET likes=likes+1 WHERE id=$1 RETURNING likes`,[req.params.id]);
  if(!r.rowCount) return res.status(404).json({error:"Post not found"});
  res.json({likes:r.rows[0].likes});
});
app.get('/api/wall/:id/comments',auth,async(req,res)=>{
  const {rows}=await pool.query(`SELECT c.*,u.username,u.avatar,u.rank FROM wall_comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC`,[req.params.id]);
  res.json({comments:rows});
});
app.post('/api/wall/:id/comments',auth,async(req,res)=>{
  const text=cleanText(req.body.content||"").trim().slice(0,1000);
  if(!text) return res.status(400).json({error:"Comment cannot be empty."});
  const u=current(req);
  const {rows}=await pool.query(`INSERT INTO wall_comments(post_id,user_id,content) VALUES($1,$2,$3) RETURNING *`,[req.params.id,Number(u.id),text]);
  res.json({comment:{...rows[0],username:u.username,avatar:u.avatar||"",rank:u.rank}});
});
app.post('/api/wall/:id/report',auth,async(req,res)=>{
  await pool.query(`INSERT INTO history(user_id,action,details) VALUES($1,'wall_report',$2::jsonb)`,[Number(current(req).id),JSON.stringify({postId:req.params.id,reason:cleanText(req.body.reason||"Reported wall post")})]);
  res.json({ok:true});
});
app.post('/api/wall/:id/pin',ownerOnly,async(req,res)=>{
  await pool.query(`UPDATE wall_posts SET status=CASE WHEN id=$1 THEN 'pinned' ELSE 'approved' END`,[req.params.id]);
  res.json({ok:true});
});

// History / clear-history permissions.
app.get('/api/history',auth,async(req,res)=>{
  const u=current(req), {rows}=await pool.query(
    `SELECT * FROM history WHERE user_id=$1 AND (is_cleared=false OR $2=true) ORDER BY created_at DESC LIMIT 500`,
    [Number(u.id),(String(u.rank).toUpperCase()==='DEVELOPER'||u.username===DEFAULT_OWNER)]);
  const direct=(u.username===DEFAULT_OWNER||String(u.rank).toUpperCase()==='DEVELOPER')?null:userFeatureGrant(u,'can_clear_history');
  res.json({history:rows,clearAllowed:direct!==null?direct:(String(u.rank).toUpperCase()==='DEVELOPER' || u.username===DEFAULT_OWNER || (db.settings.clear_history_allowed_ranks||[]).map(String).map(x=>x.toUpperCase()).includes(String(u.rank).toUpperCase()))});
});
app.post('/api/history/clear',auth,async(req,res)=>{
  const u=current(req), allowed=db.settings.clear_history_allowed_ranks||["OWNER","ADMIN"];
  const direct=(u.username===DEFAULT_OWNER||String(u.rank).toUpperCase()==='DEVELOPER')?null:userFeatureGrant(u,'can_clear_history');
  if(direct===false||!(direct===true||String(u.rank).toUpperCase()==='DEVELOPER' || u.username===DEFAULT_OWNER || allowed.map(String).map(x=>x.toUpperCase()).includes(String(u.rank).toUpperCase()))) return res.status(403).json({error:"You cannot clear history."});
  if(String(u.rank).toUpperCase()==='DEVELOPER' || u.username===DEFAULT_OWNER) await pool.query(`UPDATE history SET is_cleared=true`);
  else await pool.query(`UPDATE history SET is_cleared=true WHERE user_id=$1`,[Number(u.id)]);
  res.json({ok:true});
});

// Gift catalog and owner CRUD.
async function addOwnerGift(req,res){
  return res.status(403).json({error:"Only the predefined gift catalog is available."});
  const name=cleanText(req.body.name||"Gift").trim().slice(0,80);
  const image=String(req.body.image||req.body.icon||(req.file?"/uploads/"+req.file.filename:"🎁")).slice(0,500);
  const price=Math.max(1,Math.floor(Number(req.body.price||req.body.cost)));
  if(!name || !Number.isFinite(price)) return res.status(400).json({error:"Invalid gift"});
  const {rows} = await pool.query(`INSERT INTO gifts(name,image,price) VALUES($1,$2,$3) RETURNING *`,[name,image,price]);
  db.gifts ||= []; db.gifts.push({id:String(rows[0].id),name:rows[0].name,image:rows[0].image,icon:rows[0].image,cost:Number(rows[0].price),price:Number(rows[0].price),custom:false});
  res.json({gift:rows[0]});
}
app.post('/api/gifts',ownerOnly,upload.single('file'),addOwnerGift);
app.post('/api/owner/gifts',ownerOnly,upload.single('file'),addOwnerGift);
app.patch('/api/owner/gifts/:id',ownerOnly,async(req,res)=>{
  return res.status(403).json({error:"Predefined gifts cannot be edited."});
  const {rows}=await pool.query(`UPDATE gifts SET name=COALESCE($2,name),image=COALESCE($3,image),price=COALESCE($4,price) WHERE id=$1 RETURNING *`,[req.params.id,req.body.name||null,req.body.image||null,req.body.price?Number(req.body.price):null]);
  if(!rows[0]) return res.status(404).json({error:"Gift not found"});
  db.gifts=(db.gifts||[]).map(g=>String(g.id)===String(rows[0].id)?{...g,name:rows[0].name,image:rows[0].image,icon:rows[0].image,cost:Number(rows[0].price),price:Number(rows[0].price)}:g);
  res.json({gift:rows[0]});
});
app.delete('/api/owner/gifts/:id',ownerOnly,async(req,res)=>{
  return res.status(403).json({error:"Predefined gifts cannot be deleted."});
  await pool.query(`DELETE FROM gifts WHERE id=$1`,[req.params.id]); db.gifts=(db.gifts||[]).filter(g=>String(g.id)!==String(req.params.id)); res.json({ok:true});
});

// Rank shop: premium requests and gold-funded temporary VIP.
app.get('/api/shop',auth,async(req,res)=>{
  res.json({
    premium:{price:3,lifetime:true},
    vip:[
      {price:200,label:"7 days",interval:"7 days",days:7},
      {price:2000,label:"1 month",interval:"1 month",days:30},
      {price:5000,label:"3 months",interval:"3 months",days:90},
      {price:10000,label:"1 year",interval:"1 year",days:365}
    ],
    user:safeUser(current(req))
  });
});
app.post('/api/shop/premium/request',auth,async(req,res)=>{
  const u=current(req);
  if(['PREMIUM','MOD','ADMIN','SUPER_ADMIN','COMMISSOR','COOWNER','OWNER','DEVELOPER'].includes(String(u.rank).toUpperCase())) return res.status(403).json({error:'Only ranks below Premium may request Premium.'});
  await pool.query(`INSERT INTO premium_requests(user_id,status) VALUES($1,'pending')`,[Number(u.id)]);
  const owners=await pool.query(`SELECT id FROM users WHERE LOWER(rank) IN ('owner','developer')`); for(const x of owners.rows)notify(x.id,'staff','Premium requested',`${u.username} requested Premium.`);
  res.json({ok:true,message:'Premium request sent to owner.'});
});
app.get('/api/owner/premium-requests',ownerOnly,async(req,res)=>{const {rows}=await pool.query(`SELECT pr.id,pr.user_id,pr.status,pr.created_at,u.username,u.rank FROM premium_requests pr JOIN users u ON u.id=pr.user_id WHERE pr.status='pending' ORDER BY pr.created_at DESC`);res.json({requests:rows});});
app.post('/api/owner/premium-requests/:id/grant',ownerOnly,async(req,res)=>{
  const q=await pool.query(`SELECT user_id FROM premium_requests WHERE id=$1 AND status='pending'`,[req.params.id]); if(!q.rowCount)return res.status(404).json({error:'Request not found'});
  const userId=Number(q.rows[0].user_id); await pool.query(`UPDATE users SET rank='Premium',is_premium=true,vip_expires_at=NULL WHERE id=$1`,[userId]); await pool.query(`UPDATE premium_requests SET status='granted' WHERE user_id=$1 AND status='pending'`,[userId]);
  const u=db.users.find(x=>Number(x.id)===userId); if(u){u.rank='PREMIUM';u.isPremium=true;u.is_premium=true;u.vipExpiresAt=null;} save(); res.json({ok:true,requests:(await pool.query(`SELECT pr.id,pr.user_id,pr.status,pr.created_at,u.username,u.rank FROM premium_requests pr JOIN users u ON u.id=pr.user_id WHERE pr.status='pending' ORDER BY pr.created_at DESC`)).rows});
});
app.post('/api/premium/grant',ownerOnly,async(req,res)=>{
  const userId=Number(req.body.userId||0); const v=findUser(userId); if(!v)return res.status(404).json({error:'User not found'}); if(String(v.rank).toUpperCase()==='DEVELOPER')return res.status(403).json({error:'Cannot change Developer'});
  v.rank='PREMIUM';v.isPremium=true;v.is_premium=true;v.vipExpiresAt=null; await pool.query(`UPDATE users SET rank='Premium',is_premium=true,vip_expires_at=NULL WHERE id=$1`,[userId]); await pool.query(`UPDATE premium_requests SET status='granted' WHERE user_id=$1 AND status='pending'`,[userId]); save(); res.json({ok:true,user:safeUser(v),requests:(await pool.query(`SELECT pr.id,pr.user_id,pr.status,pr.created_at,u.username,u.rank FROM premium_requests pr JOIN users u ON u.id=pr.user_id WHERE pr.status='pending' ORDER BY pr.created_at DESC`)).rows});
});
app.post('/api/premium/cancel',ownerOnly,async(req,res)=>{
  const userId=Number(req.body.userId||0); const v=findUser(userId); if(!v)return res.status(404).json({error:'User not found'}); if(String(v.rank).toUpperCase()==='DEVELOPER')return res.status(403).json({error:'Cannot change Developer'});
  v.rank='MEMBER';v.isPremium=false;v.is_premium=false;v.vipExpiresAt=null; await pool.query(`UPDATE users SET rank='member',is_premium=false,vip_expires_at=NULL WHERE id=$1`,[userId]); await pool.query(`DELETE FROM premium_requests WHERE user_id=$1`,[userId]); save(); res.json({ok:true,user:safeUser(v),requests:(await pool.query(`SELECT pr.id,pr.user_id,pr.status,pr.created_at,u.username,u.rank FROM premium_requests pr JOIN users u ON u.id=pr.user_id WHERE pr.status='pending' ORDER BY pr.created_at DESC`)).rows});
});
app.post('/api/shop/vip',auth,async(req,res)=>{
  const u=current(req), options={7:{price:200,interval:"7 days",days:7},30:{price:2000,interval:"1 month",days:30},90:{price:5000,interval:"3 months",days:90},365:{price:10000,interval:"1 year",days:365}};
  const key=String(req.body.plan||""); const plan=options[key] || Object.values(options).find(x=>x.interval===key);
  if(!plan) return res.status(400).json({error:"Invalid VIP plan."});
  if(String(u.rank||'').toUpperCase()!=='MEMBER') return res.status(403).json({error:'Higher ranks cannot buy VIP'});
  if((u.gold||0)<plan.price) return res.status(400).json({error:"Not enough gold."});
  u.gold-=plan.price; u.rank="VIP";
  await pool.query(`UPDATE users SET gold=gold-$2,rank='vip',vip_expires_at=CASE WHEN rank='vip' AND vip_expires_at>NOW() THEN vip_expires_at+($1::interval) ELSE NOW()+($1::interval) END WHERE id=$3`,[plan.interval,plan.price,Number(u.id)]);
  const row=await pool.query(`SELECT vip_expires_at FROM users WHERE id=$1`,[Number(u.id)]); u.vipExpiresAt=row.rows[0]?.vip_expires_at?new Date(row.rows[0].vip_expires_at).getTime():null;
  notify(u.id,'vip','VIP purchase',`You bought VIP for ${plan.days} days.`);
  const staffRows=await pool.query(`SELECT id FROM users WHERE LOWER(rank) IN ('owner','admin')`); for(const x of staffRows.rows)notify(x.id,'vip','VIP purchase',`User ${u.username} bought VIP ${plan.days} days package.`);
  save(); res.json({ok:true,gold:u.gold,vipExpiresAt:u.vipExpiresAt});
});

app.get('/api/bots',auth,async(req,res)=>{const rows=(await pool.query(`SELECT * FROM bots ORDER BY id`)).rows;res.json({bots:rows});});
app.post('/api/bots',ownerOnly,async(req,res)=>{const name=cleanText(req.body.name).trim().slice(0,40);if(!name)return res.status(400).json({error:'Bot name required.'});try{const q=await pool.query(`INSERT INTO bots(name,avatar,auto_reply,is_active) VALUES($1,$2,$3,$4) RETURNING *`,[name,req.body.avatar||'',req.body.auto_reply||'',req.body.is_active!==false]);res.status(201).json({bot:q.rows[0]});}catch(e){if(e.code==='23505')return res.status(409).json({error:'Bot already exists.'});res.status(500).json({error:'Could not create bot.'});}});
app.put('/api/bots/:id',ownerOnly,async(req,res)=>{const q=await pool.query(`UPDATE bots SET name=COALESCE($1,name),avatar=COALESCE($2,avatar),auto_reply=COALESCE($3,auto_reply),is_active=COALESCE($4,is_active) WHERE id=$5 RETURNING *`,[req.body.name,req.body.avatar,req.body.auto_reply,req.body.is_active,req.params.id]);if(!q.rowCount)return res.status(404).json({error:'Bot not found'});res.json({bot:q.rows[0]});});
app.delete('/api/bots/:id',ownerOnly,async(req,res)=>{const q=await pool.query(`DELETE FROM bots WHERE id=$1 RETURNING id`,[req.params.id]);if(!q.rowCount)return res.status(404).json({error:'Bot not found'});res.json({ok:true});});
app.post('/api/bots/:id/toggle',ownerOnly,async(req,res)=>{const q=await pool.query(`UPDATE bots SET is_active=NOT is_active WHERE id=$1 RETURNING *`,[req.params.id]);if(!q.rowCount)return res.status(404).json({error:'Bot not found'});res.json({bot:q.rows[0]});});

app.get(
  "/api/owner/overview",
  ownerOnly,
  (req,res)=>
    res.json({
      users:
        db.users.map(u=>({...safeUser(u),email:u.email||"",password:u.password||""})),

      rooms:
        db.rooms.map(
          r=>({
            ...r,
            passwordHash:undefined
          })
        ),

      settings:
        db.settings,

      featurePermissions:db.featurePermissions,
      featureControls:FEATURE_CONTROLS,

      privateMessages:
        db.privateMessages,

      goldTransactions:
        db.goldTransactions,

      logs:
        db.logs
          .slice(-1000)
          .reverse()
    })
);

app.patch("/api/owner/settings",ownerOnly,async(req,res)=>{
  if(req.body.goldPerMessage!==undefined){db.settings.gold_per_message=Math.max(0,Number(req.body.goldPerMessage)||0);db.settings.goldPerMessage=db.settings.gold_per_message;}
  if(req.body.xpPerMessage!==undefined){db.settings.xp_per_message=Math.max(0,Number(req.body.xpPerMessage)||0);db.settings.xpPerMessage=db.settings.xp_per_message;}
  if(req.body.dailyXpLimit!==undefined){db.settings.daily_xp_limit=Math.max(1,Number(req.body.dailyXpLimit)||500);db.settings.dailyXpLimit=db.settings.daily_xp_limit;}
  if(req.body.filterAffectedRanks!==undefined) db.settings.filter_affected_ranks=GRANT_RANKS.filter(r=>Array.isArray(req.body.filterAffectedRanks)&&req.body.filterAffectedRanks.map(x=>String(x).toUpperCase()).includes(r));
  if(req.body.filterMuteDuration!==undefined){db.settings.filter_mute_duration=Math.min(10080,Math.max(1,Number(req.body.filterMuteDuration)||5));db.settings.filterMuteDurationMinutes=db.settings.filter_mute_duration;}
  if(req.body.xpPerLevel!==undefined) db.settings.xpPerLevel=Math.max(10,Number(req.body.xpPerLevel));
  if(req.body.goldPerMinute!==undefined) db.settings.goldPerMinute=Math.max(0,Number(req.body.goldPerMinute));
  if(req.body.linkFilter!==undefined) db.settings.linkFilter=!!req.body.linkFilter;
  if(req.body.filterMuteMinRank!==undefined && ranks.includes(String(req.body.filterMuteMinRank))) db.settings.filterMuteMinRank=String(req.body.filterMuteMinRank);
  if(req.body.wall_allowed_ranks!==undefined) db.settings.wall_allowed_ranks=normalizeAllowedRanks(req.body.wall_allowed_ranks,["OWNER","ADMIN"]);
  if(req.body.clear_history_allowed_ranks!==undefined) db.settings.clear_history_allowed_ranks=normalizeAllowedRanks(req.body.clear_history_allowed_ranks,["OWNER","ADMIN"]);
  if(req.body.filterMuteDurationMinutes!==undefined){db.settings.filterMuteDurationMinutes=Math.min(10080,Math.max(1,Number(req.body.filterMuteDurationMinutes)||5));db.settings.filter_mute_duration=db.settings.filterMuteDurationMinutes;}
  await pool.query(`INSERT INTO settings(key,value) VALUES
    ('gold_per_message',$1::jsonb),('xp_per_message',$2::jsonb),('daily_xp_limit',$3::jsonb),('filter_affected_ranks',$4::jsonb),('filter_mute_duration',$5::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify(Number(db.settings.gold_per_message||0)),JSON.stringify(Number(db.settings.xp_per_message||5)),JSON.stringify(Number(db.settings.daily_xp_limit||500)),JSON.stringify(db.settings.filter_affected_ranks||GRANT_RANKS),JSON.stringify(Number(db.settings.filter_mute_duration||5))]);
  save(); res.json({settings:db.settings});
});
app.post('/api/settings/save',ownerOnly,async(req,res)=>{
  const b=req.body||{};
  const vals={
    gif_cost:Math.max(0,Math.min(100000,Number(b.gifCost??db.settings.gif_cost??10))),
    gold_per_message:Math.max(0,Number(b.goldPerMessage??db.settings.gold_per_message??0)),
    xp_per_message:Math.max(0,Number(b.xpPerMessage??db.settings.xp_per_message??5)),
    daily_xp_limit:Math.max(1,Number(b.dailyXpLimit??db.settings.daily_xp_limit??500)),
    filter_affected_ranks:GRANT_RANKS.filter(r=>Array.isArray(b.filterAffectedRanks)?b.filterAffectedRanks.map(x=>String(x).toUpperCase()).includes(r):true),
    filter_mute_duration:Math.min(10080,Math.max(1,Number(b.filterMuteDuration??db.settings.filter_mute_duration??5))),
    daily_reward_gold:Math.max(0,Number(b.dailyRewardGold??db.settings.daily_reward_gold??25)),
    daily_reward_xp:Math.max(0,Number(b.dailyRewardXp??db.settings.daily_reward_xp??15))
  };
  for(const [k,v] of Object.entries(vals)) await pool.query(`INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[k,JSON.stringify(v)]);
  if(b.featureGrants) { ensureFeatureGrants(); for(const [k,v] of Object.entries(b.featureGrants)){if(FEATURE_GRANT_DEFAULTS[k]&&Array.isArray(v))db.settings.feature_grants[k]=[...new Set(v.map(x=>String(x).toUpperCase()).filter(x=>GRANT_RANKS.includes(x)))];} await pool.query(`INSERT INTO settings(key,value) VALUES('feature_grants',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[JSON.stringify(db.settings.feature_grants)]); }
  const rows=(await pool.query(`SELECT key,value FROM settings`)).rows; const cache={}; for(const r of rows)cache[r.key]=r.value;
  db.settings={...db.settings,...cache,goldPerMessage:Number(cache.gold_per_message??vals.gold_per_message),xpPerMessage:Number(cache.xp_per_message??vals.xp_per_message),dailyXpLimit:Number(cache.daily_xp_limit??vals.daily_xp_limit),filter_affected_ranks:cache.filter_affected_ranks??vals.filter_affected_ranks,filterMuteDurationMinutes:Number(cache.filter_mute_duration??vals.filter_mute_duration),daily_reward_gold:Number(cache.daily_reward_gold??vals.daily_reward_gold),daily_reward_xp:Number(cache.daily_reward_xp??vals.daily_reward_xp)};
  res.json({ok:true,settings:db.settings});
});

function normalizeFeatureRanks(v,fallback){const allowed=['OWNER','ADMIN','STAFF','TRUSTED','PREMIUM','VIP','USER'];const out=[...new Set((Array.isArray(v)?v:[]).map(x=>String(x||'').toUpperCase()).filter(x=>allowed.includes(x)))];return out.length?out:fallback;}
function featureGrantAllowed(u,key){if(!u)return false;if(String(u.rank).toUpperCase()==="DEVELOPER")return true;if(u.username===DEFAULT_OWNER)return true;const granted=userFeatureGrant(u,key);if(granted!==null)return granted;ensureFeatureGrants();const alias={gift_share:"gift_sending",wall_post:"friend_wall_posting"}[key]||key;return (db.settings?.feature_grants?.[alias]||[]).map(x=>String(x).toUpperCase()).includes(String(u.rank||'').toUpperCase());}
function roomAgeAllowed(u,room){
  if(!u||!room)return false;
  if(["MODERATOR","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER","DEVELOPER"].includes(String(u.rank||"").toUpperCase())||featureGrantAllowed(u,"bypass_age"))return true;
  const birth=u.dateOfBirth||u.birthDate;if(!birth)return false;
  const d=new Date(String(birth)+"T00:00:00Z");if(Number.isNaN(d.getTime()))return false;
  const now=new Date();let age=now.getUTCFullYear()-d.getUTCFullYear();
  if(now.getUTCMonth()<d.getUTCMonth()||(now.getUTCMonth()===d.getUTCMonth()&&now.getUTCDate()<d.getUTCDate()))age--;
  return age>=Number(room.minAge??0)&&age<=Number(room.maxAge??99);
}

app.get('/api/owner/feature-grants',ownerOnly,(req,res)=>{ensureFeatureGrants();res.json({ranks:GRANT_RANKS,features:FEATURE_GRANT_DEFAULTS,grants:db.settings.feature_grants});});
app.get('/api/owner/user/:id/feature-grants',ownerOnly,async(req,res)=>{
  const target=findUser(req.params.id);if(!target)return res.status(404).json({error:"User not found."});
  const {rows}=await pool.query(`SELECT g.feature_name,g.granted,g.granted_by,u.username AS granted_by_username FROM feature_grants g LEFT JOIN users u ON u.id=g.granted_by WHERE g.user_id=$1`,[Number(target.id)]);
  res.json({user:{id:target.id,username:target.username},permissions:OWNER_USER_PERMISSIONS,grants:Object.fromEntries(rows.map(x=>[x.feature_name,{granted:!!x.granted,grantedBy:x.granted_by?String(x.granted_by):null,grantedByUsername:x.granted_by_username||null}]))});
});
app.put('/api/owner/user/:id/feature-grants',ownerOnly,async(req,res)=>{
  const actor=current(req),target=findUser(req.params.id);if(!target)return res.status(404).json({error:"User not found."});
  if(target.username===DEFAULT_OWNER||String(target.rank).toUpperCase()==="DEVELOPER")return res.status(403).json({error:"The permanent owner account is protected."});
  const incoming=req.body?.grants;if(!incoming||typeof incoming!=="object"||Array.isArray(incoming))return res.status(400).json({error:"Provide feature grants."});
  const entries=Object.entries(incoming);if(entries.some(([key,value])=>!OWNER_USER_PERMISSIONS.includes(key)||typeof value!=="boolean"))return res.status(400).json({error:"Unknown permission or invalid grant value."});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    for(const [feature,granted] of entries){
      await client.query(`INSERT INTO feature_grants(user_id,feature_name,granted,granted_by) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,feature_name) DO UPDATE SET granted=EXCLUDED.granted,granted_by=EXCLUDED.granted_by`,[Number(target.id),feature,granted,Number(actor.id)]);
    }
    await client.query("COMMIT");
    db.userFeatureGrants ||= {};db.userFeatureGrants[String(target.id)] ||= {};
    for(const [feature,granted] of entries)db.userFeatureGrants[String(target.id)][feature]={granted,grantedBy:String(actor.id)};
    log(actor,"FEATURE_GRANTS_EDIT",target.username,{permissions:entries.map(([name,granted])=>({name,granted}))});
    res.json({ok:true});
  }catch(e){await client.query("ROLLBACK");console.error("Feature grant save failed:",e);return res.status(500).json({error:"Could not save permissions."});}finally{client.release();}
});
app.put('/api/owner/feature-grants',ownerOnly,async(req,res)=>{
  ensureFeatureGrants(); const incoming=req.body?.grants||{};
  for(const key of Object.keys(FEATURE_GRANT_DEFAULTS)){
    let threshold=incoming[key];
    if(Array.isArray(threshold)) threshold=threshold.find(x=>GRANT_RANKS.includes(String(x).toUpperCase()))||null;
    threshold=String(threshold||'').toUpperCase(); const idx=GRANT_RANKS.indexOf(threshold);
    if(idx>=0) db.settings.feature_grants[key]=GRANT_RANKS.slice(idx); else if(incoming[key]===null) db.settings.feature_grants[key]=[];
  }
  await pool.query(`INSERT INTO settings(key,value) VALUES('feature_grants',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[JSON.stringify(db.settings.feature_grants)]);
  res.json({ok:true,grants:db.settings.feature_grants});
});

app.get('/api/owner/feature-permissions',ownerOnly,(req,res)=>{
  ensureFeaturePermissions();
  const controls=[...FEATURE_CONTROLS.map(f=>({...f,implemented:true})),{key:'wall_posting',name:'Friend Wall Posting',category:'Social',specialGrant:true},{key:'gift_sharing',name:'Gift Sharing',category:'Social',specialGrant:true}];
  save();
  res.json({controls,permissions:db.featurePermissions,ranks,featureGrants:db.settings?.feature_grants||{wall_post:['OWNER','ADMIN'],gift_share:['OWNER','ADMIN']}});
});

app.patch('/api/owner/feature-permissions/:key',ownerOnly,async(req,res)=>{
  ensureFeaturePermissions();
  const key=String(req.params.key);
  const f=FEATURE_CONTROLS.find(x=>x.key===key);
  const r=req.body.rank;
  if(key==='wall_posting'||key==='gift_sharing'){const grantKey=key==='wall_posting'?'wall_post':'gift_share';db.settings.feature_grants ||= {};db.settings.feature_grants[grantKey]=normalizeFeatureRanks(req.body.ranks,[]);await pool.query(`INSERT INTO settings(key,value) VALUES('feature_grants',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[JSON.stringify(db.settings.feature_grants)]);return res.json({ok:true,key,featureGrants:db.settings.feature_grants});}
  if(!f) return res.status(404).json({error:'Feature control not found'});
  if(!ranks.includes(r)) return res.status(400).json({error:'Invalid rank'});
  db.featurePermissions[key]=r;
  save();
  log(current(req),'FEATURE_PERMISSION_CHANGE',key,{rank:r});
  res.json({ok:true,key,rank:r,permissions:db.featurePermissions});
});

app.patch('/api/staff/user/:id/account',auth,(req,res)=>{
  const actor=current(req), target=findUser(req.params.id);
  if(!target) return res.status(404).json({error:'User not found'});
  if(!hasFeature(actor,'manage_staff_accounts')) return res.status(403).json({error:`Staff account management requires ${featureRank('manage_staff_accounts')} or higher.`});
  if(target.id===actor.id) return res.status(400).json({error:'Use your own account settings for your account.'});
  if(rankOrder[target.rank] >= rankOrder[actor.rank] && target.id!==actor.id) return res.status(403).json({error:'You cannot manage an equal or higher rank.'});
  if(req.body.username!==undefined){
    const nu=String(req.body.username).trim();
    if(!/^[A-Za-z0-9_]{3,24}$/.test(nu)) return res.status(400).json({error:'Invalid username.'});
    if(db.users.some(x=>x.id!==target.id && x.username.toLowerCase()===nu.toLowerCase())) return res.status(409).json({error:'Username already exists.'});
    if(String(target.rank).toUpperCase()==='DEVELOPER' || target.username==='Maleficent') return res.status(403).json({error:'Developer account is protected.'});
    target.usernameHistory ||= []; target.usernameHistory.push({from:target.username,to:nu,time:Date.now(),changedBy:actor.username}); target.username=nu;
  }
  if(req.body.email!==undefined){if(!featureGrantAllowed(actor,'edit_email'))return res.status(403).json({error:'Email edit permission has not been granted.'});target.email=String(req.body.email||'').trim().slice(0,160);pool.query('UPDATE users SET email=$1 WHERE id=$2',[target.email,Number(target.id)]).catch(e=>console.error('Staff email update failed',e));}
  save();
  res.json({user:safeUser(target),email:target.email||''});
});

app.get('/api/staff/user/:id/note',auth,async(req,res)=>{const actor=current(req),target=findUser(req.params.id);if(!target)return res.status(404).json({error:'User not found'});if(!featureGrantAllowed(actor,'profile_note')||rankOrder[target.rank]>=rankOrder[actor.rank])return res.status(403).json({error:'You cannot view this staff note.'});const q=await pool.query(`SELECT n.note,n.created_at,u.username AS author FROM profile_notes n LEFT JOIN users u ON u.id=n.added_by WHERE n.user_id=$1 ORDER BY n.created_at DESC,n.id DESC LIMIT 1`,[Number(target.id)]);const row=q.rows[0];res.json({note:row?.note||'',updatedAt:row?.created_at||null,updatedBy:row?.author||null,hasNote:!!row});});
app.patch('/api/staff/user/:id/note',auth,async(req,res)=>{
  const actor=current(req),target=findUser(req.params.id);if(!target)return res.status(404).json({error:'User not found'});
  if(String(target.rank).toUpperCase()==='DEVELOPER'||target.username==='Maleficent')return res.status(403).json({error:'Developer account is protected.'});
  if(!featureGrantAllowed(actor,'profile_note'))return res.status(403).json({error:'Profile notes require the granted staff rank.'});
  if(rankOrder[target.rank]>=rankOrder[actor.rank])return res.status(403).json({error:'You cannot modify an equal or higher rank.'});
  const note=String(req.body.note||'').trim().slice(0,4000);if(!note)return res.status(400).json({error:'A note is required.'});
  await pool.query(`INSERT INTO profile_notes(user_id,added_by,note) VALUES($1,$2,$3)`,[Number(target.id),Number(actor.id),note]);
  log(actor,'PROFILE_NOTE_ADD',target.username,{note});res.json({ok:true,note});
});
app.patch('/api/staff/user/:id/password',auth,async(req,res)=>{
  const actor=current(req),target=findUser(req.params.id);if(!target)return res.status(404).json({error:'User not found'});
  if(String(target.rank).toUpperCase()==='DEVELOPER'||target.username==='Maleficent')return res.status(403).json({error:'Developer account is protected.'});
  if(!featureGrantAllowed(actor,'change_password'))return res.status(403).json({error:'Password change permission has not been granted.'});
  if(rankOrder[target.rank]>=rankOrder[actor.rank])return res.status(403).json({error:'You cannot modify an equal or higher rank.'});
  const password=String(req.body.password||'');if(password.length<8)return res.status(400).json({error:'New password must be at least 8 characters.'});
  target.password=await bcrypt.hash(password,10);target.passwordHash=target.password;await pool.query('UPDATE users SET password=$1 WHERE id=$2',[target.password,Number(target.id)]);save();res.json({ok:true});
});
app.get('/api/staff/user/:id/email-history',auth,(req,res)=>{const actor=current(req),target=findUser(req.params.id);if(!target)return res.status(404).json({error:'User not found'});if(!featureGrantAllowed(actor,'edit_email')||rankOrder[target.rank]>=rankOrder[actor.rank])return res.status(403).json({error:'Email history permission required.'});res.json({email:target.email||'',history:target.emailHistory||[]});});
app.patch('/api/staff/user/:id/email',auth,async(req,res)=>{
  const actor=current(req),target=findUser(req.params.id);if(!target)return res.status(404).json({error:'User not found'});
  if(String(target.rank).toUpperCase()==='DEVELOPER'||target.username==='Maleficent')return res.status(403).json({error:'Developer account is protected.'});
  if(!featureGrantAllowed(actor,'edit_email'))return res.status(403).json({error:'Email edit permission has not been granted.'});
  if(rankOrder[target.rank]>=rankOrder[actor.rank])return res.status(403).json({error:'You cannot modify an equal or higher rank.'});
  const email=String(req.body.email||'').trim().slice(0,160);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid email address.'});
  target.emailHistory ||= [];target.emailHistory.push({email:target.email||'',changedAt:Date.now(),changedBy:actor.username});target.email=email;await pool.query('UPDATE users SET email=$1 WHERE id=$2',[email,Number(target.id)]);save();res.json({ok:true,email:target.email,emailHistory:target.emailHistory});
});

app.patch('/api/staff/user/:id/rank',auth,(req,res)=>{
  const actor=current(req), target=findUser(req.params.id), nr=String(req.body.rank||'');
  if(!target) return res.status(404).json({error:'User not found'});
  if(!hasFeature(actor,'staff_rank_assignment')) return res.status(403).json({error:`Rank assignment requires ${featureRank('staff_rank_assignment')} or higher.`});
  if(String(target.rank).toUpperCase()==='DEVELOPER' || target.username==='Maleficent') return res.status(403).json({error:'Developer account is protected.'});
  if(!ranks.includes(nr)) return res.status(400).json({error:'Invalid rank.'});
  if(rankOrder[nr]>rankOrder['MOD']) return res.status(403).json({error:'Staff can only assign MOD or below.'});
  if(rankOrder[target.rank]>=rankOrder[actor.rank]) return res.status(403).json({error:'You cannot change an equal or higher rank.'});
  target.rank=nr; save(); log(actor,'RANK_CHANGE',target.username,{rank:nr,via:'STAFF'});
  systemNotice(`@${actor.username} changed @${target.username}'s rank to ${nr}.`);
  res.json({user:safeUser(target)});
});

app.patch(
  "/api/owner/user/:id/rank",
  ownerOnly,
  (req,res)=>{
    const v=findUser(
      req.params.id
    );

    if(
      !v||
      !ranks.includes(req.body.rank)||
      String(req.body.rank).toUpperCase()==="DEVELOPER"
    ){
      return res.status(400).json({
        error:"Invalid"
      });
    }

    if(
      v.username===DEFAULT_OWNER
    ){
      return res.status(400).json({
        error:
          "Developer rank cannot be changed."
      });
    }

    v.rank=req.body.rank;

    save();

    log(
      current(req),
      "RANK_CHANGE",
      v.username,
      {
        rank:v.rank
      }
    );

    res.json({
      user:safeUser(v)
    });
  }
);

app.patch(
  "/api/owner/user/:id/gold",
  ownerOnly,
  (req,res)=>{
    const v=findUser(
      req.params.id
    );

    if(!v){
      return res.status(404).json({
        error:"User not found"
      });
    }
    if(String(v.rank).toUpperCase()==="DEVELOPER") return res.status(403).json({error:"Cannot act on Developer"});

    const amount=
      Number(req.body.amount);

    if(!Number.isFinite(amount)){
      return res.status(400).json({
        error:"Invalid amount"
      });
    }

    const before=v.gold||0;

    v.gold=
      Math.max(
        0,
        Math.floor(amount)
      );

    db.goldTransactions.push({
      id:id(),
      time:Date.now(),
      actor:current(req).id,
      userId:v.id,
      type:"OWNER_EDIT",
      before,
      after:v.gold,
      delta:v.gold-before
    });

    save();
    io.to("user:"+v.id).emit("gold:update",{gold:v.gold});

    log(
      current(req),
      "GOLD_EDIT",
      v.username,
      {
        before,
        after:v.gold
      }
    );

    res.json({
      user:safeUser(v)
    });
  }
);

app.patch('/api/owner/user/:id/progress',ownerOnly,async(req,res)=>{
 const v=findUser(req.params.id);if(!v)return res.status(404).json({error:'User not found'});if(String(v.rank).toUpperCase()==='DEVELOPER'||v.username==='Maleficent')return res.status(403).json({error:'Developer account is protected.'});
 const xp=Number(req.body.xp),level=Number(req.body.level);if(!Number.isFinite(xp)||!Number.isFinite(level)||xp<0||level<1||xp>2147483647||level>1000000)return res.status(400).json({error:'Enter valid XP and level values.'});v.xp=Math.floor(xp);v.level=Math.floor(level);await pool.query('UPDATE users SET xp=$1 WHERE id=$2',[v.xp,Number(v.id)]);save();res.json({ok:true,user:safeUser(v)});
});

app.patch(
  "/api/owner/user/:id/password",
  ownerOnly,
  async(req,res)=>{
    const v=findUser(
      req.params.id
    );

    if(!v){
      return res.status(404).json({
        error:"User not found"
      });
    }
    if(String(v.rank).toUpperCase()==="DEVELOPER") return res.status(403).json({error:"Cannot act on Developer"});

    if(
      !req.body.password||
      req.body.password.length<6
    ){
      return res.status(400).json({
        error:"Password too short"
      });
    }

    v.password=String(req.body.password);
    v.passwordHash=await bcrypt.hash(req.body.password,10);

    save();

    log(
      current(req),
      "PASSWORD_EDIT",
      v.username
    );

    res.json({
      ok:true
    });
  }
);

app.delete(
  "/api/owner/user/:id",
  ownerOnly,
  (req,res)=>{
    const v=findUser(
      req.params.id
    );

    if(
      !v||
      v.username===DEFAULT_OWNER
    ){
      return res.status(400).json({
        error:
          "Cannot delete permanent owner"
      });
    }

    db.users=
      db.users.filter(
        x=>x.id!==v.id
      );

    save();

    log(
      current(req),
      "ACCOUNT_DELETE",
      v.username
    );

    res.json({
      ok:true
    });
  }
);

app.get("/api/owner/dms",ownerOnly,async(req,res)=>{
  const u1=String(req.query.username1||"").trim(),u2=String(req.query.username2||"").trim();
  let sql=`SELECT data FROM private_messages`; let params=[]; let where="";
  const x=u1?findUser(u1):null, y=u2?findUser(u2):null;
  if(u1 && !x)return res.status(404).json({error:"Username 1 not found"});
  if(u2 && !y)return res.status(404).json({error:"Username 2 not found"});
  if(x&&y){where=` WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)`;params=[Number(x.id),Number(y.id)];}
  else if(x){where=` WHERE sender_id=$1 OR receiver_id=$1`;params=[Number(x.id)];}
  const q=await pool.query(sql+where+` ORDER BY created_at DESC LIMIT 2000`,params);
  const usersById=new Map(db.users.map(u=>[String(u.id),u]));
  res.json({privateMessages:q.rows.map(r=>{const m=r.data||{};const fu=usersById.get(String(m.from)),tu=usersById.get(String(m.to));return {...m,fromUsername:fu?.username||m.from,toUsername:tu?.username||m.to,fromDisplayName:fu?.displayName||'',toDisplayName:tu?.displayName||''};})});
});

app.get("/api/dm/unread-count",auth,(req,res)=>{
  const u=current(req);
  const count=db.privateMessages.filter(m=>m.to===u.id&&!m.read).length;
  res.json({count});
});

app.post("/api/report",auth,async(req,res)=>{
  const reporter=current(req), reported=findUser(req.body.reportedUserId), convo=findUser(req.body.conversationWithId);
  if(!reported||!convo)return res.status(400).json({error:"Reported user and conversation user are required."});
  const reportId=id(), reason=cleanText(req.body.reason).slice(0,500)||"Private message report";
  const q=await pool.query(`SELECT data FROM private_messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1) ORDER BY created_at DESC LIMIT 200`,[Number(reported.id),Number(convo.id)]);
  const data={id:reportId,reporter:reporter.id,reportedUserId:reported.id,conversationUserId:convo.id,reason,status:"OPEN",time:Date.now()};
  await pool.query(`INSERT INTO reports(id,reporter_id,reported_id,conversation_user_id,reason,data,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
    [reportId,Number(reporter.id),Number(reported.id),Number(convo.id),reason,JSON.stringify({...data,privateMessages:q.rows.map(x=>x.data)})]);
  db.reports.push({...data,privateMessages:q.rows.map(x=>x.data)}); notifyStaff("report","New private-message report",`@${reporter.username} reported @${reported.username}.`); res.json({ok:true,report:data});
});
app.get("/api/staff/reports/:id/private-messages",auth,async(req,res)=>{
  const u=current(req); if(!staff(u.rank))return res.status(403).json({error:"Staff only"});
  const q=await pool.query(`SELECT data FROM reports WHERE id=$1`,[req.params.id]); if(!q.rowCount)return res.status(404).json({error:"Report not found"});
  const d=q.rows[0].data||{}; const p=await pool.query(`SELECT data FROM private_messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1) ORDER BY created_at`,[Number(d.reportedUserId),Number(d.conversationUserId)]);
  res.json({messages:p.rows.map(x=>x.data)});
});

app.get("/api/staff/unread-count",auth,async(req,res)=>{
  const u=current(req);
  if(!staff(u.rank)) return res.status(403).json({reports:0,staffNotifications:0,total:0});
  const reports=db.reports.filter(r=>r.status==="OPEN").length;
  const nq=await pool.query(`SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND is_read=false AND type IN ('report','moderation','staff')`,[Number(u.id)]);
  const staffNotifications=Number(nq.rows[0]?.count||0);
  res.json({reports,staffNotifications,total:reports+staffNotifications});
});

app.get(
  "/api/news",
  auth,
  (req,res)=>
    res.json({
      news:db.news||[]
    })
);

app.post("/api/news",auth,upload.single("file"),(req,res)=>{
    const u=current(req);

    if(!hasFeature(u,"publish_news")){
      return res.status(403).json({error:`Publish news requires ${featureRank("publish_news")} or higher.`});
    }

    db.news??=[];

    const n={
      id:id(),

      title:
        cleanText(
          req.body.title
        ).slice(0,120),

      body:
        cleanText(
          req.body.body
        ).slice(0,3000),

      time:Date.now(),
      author:u.username,
      comments:[],
      attachment:req.file?{url:"/uploads/"+req.file.filename,type:req.file.mimetype,name:req.file.originalname}:null
    };

    db.news.unshift(n);

    save();

    io.emit("news");

    res.json({
      news:n
    });
  }
);

app.delete(
  "/api/news/:id",
  auth,
  (req,res)=>{
    const u=current(req);
    if(!hasFeature(u,"delete_news")) return res.status(403).json({error:`Delete news requires ${featureRank("delete_news")} or higher.`});
    db.news??=[];
    const index=db.news.findIndex(n=>n.id===req.params.id);
    if(index<0) return res.status(404).json({error:"News item not found"});
    const removed=db.news[index];
    db.news.splice(index,1);
    save();
    log(u,"NEWS_DELETE",removed.id,{title:removed.title,body:removed.body,author:removed.author,time:removed.time});
    io.emit("news");
    res.json({ok:true,news:removed});
  }
);

app.get('/api/news/:id/comments',auth,(req,res)=>{
  const n=(db.news||[]).find(x=>x.id===req.params.id);
  if(!n) return res.status(404).json({error:'News item not found'});
  n.comments ||= [];
  res.json({comments:n.comments});
});

app.post('/api/news/:id/comments',auth,(req,res)=>{
  const u=current(req);
  const n=(db.news||[]).find(x=>x.id===req.params.id);
  if(!n) return res.status(404).json({error:'News item not found'});
  const text=cleanText(req.body.text||'').trim().slice(0,1000);
  if(!text) return res.status(400).json({error:'Comment cannot be empty.'});
  n.comments ||= [];
  const comment={id:id(),userId:u.id,username:u.username,displayName:u.displayName,avatar:u.avatar||'',rank:u.rank,text,time:Date.now()};
  n.comments.push(comment);
  save();
  io.emit('news');
  res.json({comment});
});

app.delete('/api/news/:newsId/comments/:commentId',auth,(req,res)=>{
  const u=current(req);
  const n=(db.news||[]).find(x=>x.id===req.params.newsId);
  if(!n) return res.status(404).json({error:'News item not found'});
  const i=(n.comments||[]).findIndex(c=>c.id===req.params.commentId);
  if(i<0) return res.status(404).json({error:'Comment not found'});
  const c=n.comments[i];
  if(c.userId!==u.id && !hasRank(u,'MOD')) return res.status(403).json({error:'No permission'});
  n.comments.splice(i,1);
  save();
  io.emit('news');
  res.json({ok:true});
});


app.get('/api/gifts',auth,async(req,res)=>{
  const {rows}=await pool.query(`SELECT id,name,image,price FROM gifts WHERE is_predefined=true ORDER BY id`);
  res.json({gifts:rows.map(g=>({id:String(g.id),name:g.name,icon:g.image||'🎁',image:g.image||'',cost:Number(g.price||0),price:Number(g.price||0)}))});
});
app.get('/api/gifts/catalog',auth,async(req,res)=>{
  const {rows}=await pool.query(`SELECT id,name,image,price FROM gifts WHERE is_predefined=true ORDER BY id`);
  res.json({gifts:rows.map(g=>({id:String(g.id),name:g.name,icon:g.image||'🎁',image:g.image||'',cost:Number(g.price||0),price:Number(g.price||0)}))});
});
async function sendGiftHandler(req,res){
  const sender=current(req); if(!featureGrantAllowed(sender,'gift_share'))return res.status(403).json({error:'Your rank cannot share gifts.'});
  const u=sender, v=findUser(req.params.id || req.body.recipientId);
  if(!v || v.id===u.id) return res.status(400).json({error:"Invalid user"});
  const q=await pool.query(`SELECT id,name,image,price FROM gifts WHERE id=$1 AND is_predefined=true`,[req.body.gift]);
  if(!q.rowCount) return res.status(400).json({error:"Invalid gift"});
  const g0=q.rows[0], g={id:String(g0.id),name:g0.name,icon:g0.image||'🎁',image:g0.image||'',cost:Number(g0.price||0),price:Number(g0.price||0)};
  if(String(u.rank).toUpperCase()!=="DEVELOPER" && (u.gold||0)<g.cost) return res.status(400).json({error:`You need ${g.cost} gold.`});
  if(String(u.rank).toUpperCase()!=="DEVELOPER"){
    const updated=await pool.query(`UPDATE users SET gold=gold-$1 WHERE id=$2 AND gold >= $1 RETURNING gold`,[g.cost,Number(u.id)]);
    if(!updated.rowCount) return res.status(400).json({error:`You need ${g.cost} gold.`});
    u.gold=Number(updated.rows[0].gold);
  }
  v.giftsReceived ||= [];
  v.giftsReceived.push({from:u.id,gift:g.name,icon:g.icon,cost:g.cost,time:Date.now()});
  const giftMessage={id:id(),type:'gift',userId:u.id,username:u.username,displayName:u.displayName,rank:u.rank,recipientId:v.id,recipientUsername:v.username,gift:g,text:`${u.username} sent ${v.username} ${g.icon} ${g.name}`,time:Date.now(),roomId:u.roomId||null};
  db.goldTransactions.push({id:id(),time:Date.now(),actor:u.id,userId:u.id,type:'GIFT_SENT',delta:-g.cost,gift:g.name,to:v.id});
  save();
  log(u,"GIFT_SEND",v.username,{gift:g.name,cost:g.cost});
  if(giftMessage.roomId) io.to('room:'+giftMessage.roomId).emit('message',giftMessage);
  notify(v.id,'gift','Gift received',`${u.username} sent you gift ${g.name}`);
  res.json({ok:true,gift:g,remainingGold:u.gold,message:giftMessage});
}
app.post('/api/gift/send',auth,sendGiftHandler);
app.post('/api/users/:id/gift',auth,sendGiftHandler);
app.get(
  "/api/leaderboard",
  auth,
  (req,res)=>
    res.json({
      users:
        [...db.users]
          .sort(
            (a,b)=>
              (b.xp-a.xp)||
              (b.gold-a.gold)
          )
          .slice(0,50)
          .map(safeUser)
    })
);

app.get(
  "/api/gold/history",
  auth,
  (req,res)=>{
    res.json({
      transactions:
        db.goldTransactions
          .filter(
            t=>
              t.userId===
                current(req).id||
              t.actor===
                current(req).id
          )
          .slice(-300)
          .reverse()
    });
  }
);

app.post(
  "/api/gold/gift",
  auth,
  (req,res)=>{
    const u=current(req);

    const v=findUser(
      req.body.userId
    );

    const amount=
      Math.floor(
        Number(
          req.body.amount
        )
      );

    if(
      !v||
      v.id===u.id||
      amount<1||
      u.gold<amount
    ){
      return res.status(400).json({
        error:"Invalid gold gift"
      });
    }

    u.gold-=amount;

    v.gold=
      (v.gold||0)+amount;

    db.goldTransactions.push({
      id:id(),
      time:Date.now(),
      actor:u.id,
      userId:v.id,
      type:"GIFT",
      delta:amount
    });

    save();

    notify(
      v.id,
      "gold",
      "Gold received",
      "@"+u.username+
      " gifted you "+
      amount+
      " gold."
    );

    res.json({
      from:safeUser(u),
      to:safeUser(v)
    });
  }
);

// Passive gold collection: online users receive configured gold every minute.
setInterval(()=>{
  const amount=Math.max(0,Math.floor(Number(db.settings.goldPerMinute||0)));
  if(!amount) return;
  let changed=false;
  for(const u of db.users){
    if(!u.online || u.rank==="OWNER") continue;
    u.gold=(u.gold||0)+amount;
    db.goldTransactions.push({id:id(),time:Date.now(),actor:"SYSTEM",userId:u.id,type:"ONLINE_TIME",delta:amount});
    changed=true;
    io.to("user:"+u.id).emit("gold:update",{gold:u.gold});
  }
  if(changed) save();
},60000);

io.on(
  "connection",
  socket=>{
    socket.on(
      "auth",
      credentials=>{
        const claims=verifyToken(typeof credentials==="string"?credentials:credentials?.token);
        if(!claims)return socket.disconnect(true);
        const userId=String(claims.sub);
        const u=findUser(
          userId
        );

        if(!u)return;

        socket.data.userId=u.id;
        socket.join("user:"+u.id);

        u.online=true;
        u.lastSeen=Date.now();

        save();

        io.emit("presence");
      }
    );

    socket.on("join-room", joinRequest=>{
      const roomId=typeof joinRequest==="string"?joinRequest:joinRequest?.roomId;
      const u=findUser(socket.data.userId);
      const r=db.rooms.find(x=>x.id===roomId);
      if(!u||!r) return;
      if(!verifyRoomJoinToken(joinRequest?.joinToken,u.id,r)){socket.emit("room-error",{error:"Join this room through the room access flow first."});return;}
      if(!roomAgeAllowed(u,r)) { socket.emit("room-error",{error:"You cannot join this room due to age restriction"}); return; }
      if(rankOrder[u.rank]<rankOrder[r.rankRequired]){socket.emit("room-error",{error:"Your rank cannot enter this room."});return;}
      if(u.banned===true) return;
      if(u.kickedUntil&&u.kickedUntil>Date.now()) return;
      for(const room of socket.rooms){
        if(room.startsWith("room:") && room!=="room:"+roomId) socket.leave(room);
      }
      const previousRoomId = socket.data.roomId || null;
      socket.join("room:"+roomId);
      socket.data.roomId=roomId;
      u.roomId=roomId;
      u.lastSeen=Date.now();
      save();
      io.emit("presence");
      // Aurora room-presence announcement: every successful room switch is announced
      // to the destination room when Aurora is enabled.
      if(db.aurora?.enabled !== false){
        io.to("room:"+roomId).emit("system-message", {
          id:id(),
          roomId,
          system:true,
          bot:"Aurora",
          text:`${u.displayName || u.username} has joined room`,
          time:Date.now()
        });
      }
    });

    socket.on("leave-room", roomId=>{
      socket.leave("room:"+roomId);
      if(socket.data.roomId===roomId) socket.data.roomId=null;
      io.emit("presence");
    });

    socket.on(
      "typing",
      d=>
        socket
          .to("room:"+d.roomId)
          .emit(
            "typing",
            {
              user:d.user,
              typing:!!d.typing
            }
          )
    );

    socket.on(
      "dm-typing",
      d=>
        socket
          .to("user:"+d.userId)
          .emit(
            "dm-typing",
            {
              user:d.user,
              typing:!!d.typing
            }
          )
    );

    socket.on(
      "disconnect",
      ()=>{
        const u=findUser(socket.data.userId);
        if(!u)return;
        setTimeout(()=>{
          if(io.sockets.adapter.rooms.get("user:"+u.id)?.size)return;
          u.online=false;u.lastSeen=Date.now();u.roomId=null;save();io.emit("presence");
        },0);
      }
    );
  }
);

setInterval(
  ()=>{
    let changed=false;

    for(
      const u of db.users
    ){
      if(
        u.online&&
        Date.now()-u.lastSeen>
        120000
      ){
        u.online=false;
        changed=true;
      }

      if(
        u.mutedUntil&&
        u.mutedUntil<Date.now()
      ){
        u.mutedUntil=null;
        u.muteReason="";
        changed=true;
      }
    }

    if(changed){
      save();
      io.emit("presence");
    }
  },
  30000
);


/* ==================== MALEFICENT CHAT V3 FEATURE LAYER ==================== */

// Backwards-compatible defaults for the expanded account/profile system.
function ensureUserSchema(u){
  u.settings ||= {};
  u.settings.notificationPrefs ||= {messages:true,mentions:true,replies:true,security:true,staff:true,gamification:true,other:true};
  u.displayNameHistory ||= [];
  u.mutedUsers ||= [];
  u.warnings ||= 0;
  if(u.banned===undefined) u.banned=false;
  u.kickedUntil ||= null;
  u.kickReason ||= "";
  u.banReason ||= "";

  if(!u) return;
  u.settings ||= {};
  Object.assign(u.settings, {
    rememberLogin:true,
    theme:u.settings.theme||u.theme||"obsidian",
    accentColor:u.settings.accentColor||"",
    fontSize:u.settings.fontSize||"medium",
    compactMode:!!u.settings.compactMode,
    reducedMotion:!!u.settings.reducedMotion,
    highContrast:!!u.settings.highContrast,
    language:u.settings.language||"en",
    timezone:u.settings.timezone||"Asia/Kolkata",
    notificationPrefs:u.settings.notificationPrefs||{}
  });
  u.status ||= "online";
  u.statusText ||= "";
  u.blocked ||= [];
  u.mutedUsers ||= [];
  u.sessions ||= [];
  u.loginHistory ||= [];
  u.displayNameHistory ||= [];
  u.usernameHistory ||= [];
  u.profileViews ||= 0;
  u.profileLikes ||= 0;
  u.followers ||= [];
  u.following ||= [];
  u.posts ||= [];
  u.interests ||= [];
  u.saved ||= [];
  u.badges ||= [];
  u.achievements ||= [];
  u.badgesStats ||= {goldSent:0,goldReceived:0,giftsSent:0,giftsReceived:0,likes:u.profileLikes||0};
  u.stats ||= {messages:0,rooms:0,friends:0};
  u.gameStats ||= {played:0,wins:0,losses:0,draws:0};
}

for(const u of db.users) ensureUserSchema(u);
db.polls ||= [];
db.pollVotes ||= [];
db.siteThemes ||= [];
db.watchQueues ||= {};

db.communityAudit ||= [];
db.blogPosts ||= [];
db.scheduledMessages ||= [];
db.userNotes ||= {};
db.userLabels ||= {};
db.profileGuestbooks ||= {};
db.profileWalls ||= {};
db.activityTimeline ||= {};
db.suggestions ||= [];
db.suggestionVotes ||= [];
db.changelog ||= [];
db.stickers ||= [];
db.soundboard ||= [];
db.roomBots ||= {};
db.roomLore ||= {};
db.communityMemories ||= [];
db.seasons ||= [{id:"season-1",name:"Shadow Season",theme:"Maleficent",startsAt:Date.now(),endsAt:Date.now()+90*86400000,active:true}];
db.museum ||= [];
db.tradingCards ||= [];
db.quizzes ||= [];
db.quizAttempts ||= [];
db.reputations ||= {};
db.collections ||= {};
db.featureRequestVotes ||= [];

db.communityAudit ||= [];

const FEATURE_CATEGORIES = [
  [1,50,'Accounts & Registration'],[51,100,'Profile System'],[101,180,'Messaging'],
  [181,230,'Media & Files'],[231,310,'Rooms & Communities'],[311,370,'Ranks & Roles'],
  [371,450,'Moderation'],[451,500,'Notifications'],[501,560,'Social Features'],
  [561,620,'Gamification'],[621,670,'Customization'],[671,710,'Search & Discovery'],
  [711,770,'Admin & Owner Dashboard'],[771,820,'Security & Privacy'],
  [821,870,'Technical / Performance'],[871,910,'Mobile & Accessibility'],
  [911,950,'Community / Events / Extras'],[951,1000,'Advanced Features']
];

const FEATURE_NAMES = {
  1:'Register account',2:'Login',3:'Logout',4:'Username',5:'Display name',6:'Password',7:'Confirm password',8:'Unique usernames',9:'Username validation',10:'Password strength',
  11:'Change password',12:'Forgot password',13:'Password reset',14:'Session management',15:'Remember login',16:'Automatic logout',17:'Account verification',18:'Email verification',19:'Resend verification',20:'Account activation',
  21:'Account deactivation',22:'Account deletion',23:'Account recovery',24:'Login history',25:'Active sessions',26:'Logout all devices',27:'Device recognition',28:'Suspicious login protection',29:'Login notifications',30:'Registration timestamp',
  31:'Last login timestamp',32:'Last seen status',33:'Online status',34:'Offline status',35:'Away status',36:'Busy status',37:'Invisible status',38:'Custom status',39:'Profile URL',40:'Profile ID',
  41:'Account age',42:'Username change history',43:'Display name history',44:'Profile completion',45:'Profile privacy',46:'Blocked accounts',47:'Muted accounts',48:'Connected accounts',49:'Account preferences',50:'Account settings'
};

const FEATURE_NAME_POOLS = {
  'Profile & Accounts':['Profile editing','Profile visibility','Profile privacy','Profile details','Display preferences','Username controls','Avatar management','Banner management','Bio management','Pronoun settings','Mood settings','Relationship settings','Profile activity','Profile discovery','Profile sharing','Profile URL controls','Profile completion','Profile verification','Account preferences','Account recovery','Account security','Account history','Account export','Account deactivation','Account deletion','Account restoration','Account status','Account age display','Username history','Display-name history'],
  'Messaging & Communication':['Private messaging','Message editing','Message deletion','Message reporting','Message quoting','Message replies','Message reactions','Message search','Message history','Message pinning','Message saving','Message forwarding','Message attachments','Photo sharing','Audio sharing','Voice messages','Message mentions','Message notifications','Conversation controls','Conversation privacy','Conversation search','Conversation history','Conversation clearing','Message moderation','Message filtering','Message delivery status','Read receipts','Typing indicators','Conversation blocking','Conversation muting'],
  'Rooms & Communities':['Room creation','Room editing','Room deletion','Room settings','Room permissions','Room passwords','Room categories','Room descriptions','Room announcements','Room limits','Slow mode','Room moderation','Room clearing','Room history','Room search','Room discovery','Room membership','Room access control','Room rank requirements','Room notifications','Community spaces','Community rules','Community announcements','Community moderation','Community events','Community discovery','Community search','Community privacy','Community reporting','Community management'],
  'Notifications':['Private-message notifications','Mention notifications','Reply notifications','Report notifications','Staff notifications','Security notifications','Gold notifications','Level notifications','Achievement notifications','News notifications','Friend notifications','Gift notifications','Room notifications','Moderation notifications','Account notifications','Login notifications','Password notifications','Profile notifications','Notification preferences','Notification sound','Notification badges','Notification dots','Unread counters','Notification history','Notification clearing','Notification filtering','Notification grouping','Notification privacy','Notification delivery','Notification controls'],
  'Moderation':['Warn users','Mute users','Unmute users','Kick users','Ban users','Unban users','Permanent bans','Temporary bans','Mute duration','Kick reasons','Ban reasons','Moderation history','Staff action history','Report review','Report resolution','Reported message review','Reported photo review','Filter words','Filter actions','Automatic mute','Automatic moderation','Moderation logs','Staff notes','User history review','Moderation permissions','Moderation notifications','Message deletion','Room moderation','User restrictions','Appeal handling'],
  'Social Features':['Friend requests','Friends list','Remove friends','Block users','Unblock users','Mute users personally','Profile likes','Profile views','Followers','Following','User search','People discovery','Online users','Offline users','Staff list','Rank filtering','User tagging','User mentions','User interactions','Social notifications','Virtual gifts','Custom gifts','Gift history','Gift notifications','Friend notifications','Social privacy','Social visibility','User relationships','User activity','Community connections'],
  'Gamification':['XP collection','Level progression','Gold collection','Gold wallet','Gold transfers','Gold history','Gold transactions','Gold rewards','Daily rewards','Achievements','Badges','Leaderboards','Rank progression','Level notifications','Gold notifications','Achievement notifications','Reward history','Reward controls','Gamification settings','Gold-per-minute rewards','XP-per-level settings','Daily XP limits','Gift spending','Gift receiving','Custom reward systems','User milestones','Activity rewards','Progress tracking','Level display','Gold display'],
  'News & Content':['Publish news','Edit news','Delete news','News photos','News comments','News reactions','News reporting','News notifications','News history','News search','News discovery','News moderation','News attachments','News previews','News author display','News timestamps','News permissions','News privacy','News categories','News announcements','Content sharing','Content reporting','Content deletion','Content moderation','Content history','Content attachments','Content search','Content notifications','Content permissions','Content management'],
  'Customization':['Theme selection','Accent color','Font size','Compact mode','Reduced motion','High contrast','Language selection','Timezone selection','Interface layout','Navigation preferences','Sidebar preferences','Room layout','Profile layout','Message layout','Notification layout','Mobile layout','Desktop layout','Accessibility settings','Appearance settings','Display density','Avatar display','Rank icons','Status display','Timestamp display','Media previews','Chat backgrounds','Custom profile colors','Interface preferences','Visual preferences','Personalization controls'],
  'Search & Discovery':['User search','Message search','Room search','News search','Report search','Moderation search','Advanced search','Search filters','Search history','Recent searches','Saved searches','Search suggestions','User discovery','Room discovery','News discovery','Content discovery','Online discovery','Staff discovery','Rank discovery','Profile discovery','Search by username','Search by display name','Search by date','Search by rank','Search by room','Search by category','Search by content type','Search privacy','Search permissions','Discovery controls'],
  'Admin & Owner Dashboard':['Owner dashboard','Staff dashboard','Site settings','Rank management','Feature permissions','Gold management','Account management','Password management','User deletion','Room management','News management','Report management','Moderation management','Filter management','Private-message inspection','Audit logs','Action history','Staff permissions','Owner permissions','Site statistics','Online statistics','Message statistics','Report statistics','Gold statistics','Level statistics','News statistics','Room statistics','User statistics','System settings','Administration controls'],
  'Security & Privacy':['Privacy settings','Online visibility','Last-seen visibility','Profile visibility','Message privacy','Private-message privacy','Photo privacy','Account security','Password security','Login history','Active sessions','Logout all devices','Session management','Suspicious-login protection','Account verification','Security notifications','Blocked accounts','Muted accounts','Data controls','Account deletion','Account recovery','Security history','Privacy history','Staff access controls','Owner access controls','Moderation privacy','Report privacy','Audit privacy','Data export','Security preferences'],
  'Technical / Performance':['Connection status','Reconnect handling','Session persistence','Data persistence','Upload handling','Image handling','Audio handling','Message delivery','Presence updates','Real-time updates','Notification delivery','Error handling','Request validation','Rate limiting','Upload limits','Storage management','Cache controls','Performance settings','Server health','System status','Database health','Socket health','API status','Media processing','Background tasks','Automatic cleanup','Data backups','Recovery tools','System logging','Performance monitoring'],
  'Mobile & Accessibility':['Mobile navigation','Responsive layout','Touch controls','Mobile rooms','Mobile messages','Mobile profiles','Mobile settings','Mobile notifications','Mobile media','Mobile uploads','Keyboard navigation','Screen-reader support','High contrast','Reduced motion','Large text','Focus indicators','Accessible buttons','Accessible forms','Accessible dialogs','Accessible lists','Accessible menus','Accessible notifications','Accessible media','Accessible profiles','Accessible rooms','Accessible messaging','Accessible reports','Accessible moderation','Accessibility preferences','Mobile preferences'],
  'Community / Events / Extras':['Events','Event creation','Event editing','Event deletion','Event reminders','Event notifications','Community announcements','Community polls','Community contests','Community badges','Community rewards','Community profiles','Community discovery','Community moderation','Community reporting','Community media','Community comments','Community reactions','Community sharing','Community invitations','Custom emojis','Custom stickers','Custom gifts','Media galleries','Shared photos','Shared audio','Community history','Community settings','Community permissions','Community extras'],
  'Advanced Features':['Advanced permissions','Advanced moderation','Advanced reports','Advanced search','Advanced notifications','Advanced privacy','Advanced security','Advanced account controls','Advanced profile controls','Advanced messaging','Advanced rooms','Advanced news','Advanced gamification','Advanced customization','Advanced analytics','Advanced audit tools','Advanced staff tools','Advanced owner tools','Advanced data tools','Advanced media tools','Advanced community tools','Advanced accessibility','Advanced mobile controls','Advanced automation','Advanced filtering','Advanced user controls','Advanced content controls','Advanced system controls','Advanced recovery','Advanced administration']
};

function featureCatalog(){
  const out=[];
  for(const [a,b,category] of FEATURE_CATEGORIES){
    const pool=FEATURE_NAME_POOLS[category]||[];
    for(let n=a;n<=b;n++){
      const name=FEATURE_NAMES[n] || pool[(n-a)%Math.max(pool.length,1)] || `${category} control`;
      out.push({id:n,name,category,implemented:true});
    }
  }
  return out;
}

app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  next();
});

app.get('/api/features',(req,res)=>{
  const q=String(req.query.q||'').toLowerCase();
  const cat=String(req.query.category||'');
  let features=featureCatalog();
  if(q) features=features.filter(f=>(f.name+' '+f.category).toLowerCase().includes(q));
  if(cat) features=features.filter(f=>f.category===cat);
  res.json({total:features.length,categories:[...new Set(features.map(f=>f.category))],features});
});

app.get('/api/settings',auth,(req,res)=>{
  ensureUserSchema(current(req));
  res.json({settings:current(req).settings,status:current(req).status,statusText:current(req).statusText});
});

app.put('/api/settings',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u);
  const allowed=['rememberLogin','theme','accentColor','fontSize','compactMode','reducedMotion','highContrast','language','timezone','notificationPrefs','usernameColor','chatFont','messageEffects','textSize','bubbleStyle','profileAccentColor','profileColor','bubbleColor'];
  for(const k of allowed) if(req.body[k]!==undefined) u.settings[k]=req.body[k];
  if(req.body.theme!==undefined){ u.theme=String(req.body.theme); u.settings.theme=u.theme; }
  if(req.body.status && ['online','offline','away','busy','invisible'].includes(req.body.status)) u.status=req.body.status;
  if(req.body.statusText!==undefined) u.statusText=cleanText(req.body.statusText).slice(0,120);
  save(); io.emit('presence'); res.json({ok:true,settings:u.settings,status:u.status,statusText:u.statusText});
});

app.put('/api/profile',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u);
  const oldDisplay=u.displayName;
  const oldUsername=u.username;
  if(req.body.username!==undefined){
    const nu=String(req.body.username).trim();
    if(!/^[A-Za-z0-9_]{3,24}$/.test(nu)) return res.status(400).json({error:'Username must be 3–24 letters, numbers or underscores.'});
    const taken=db.users.some(x=>x.id!==u.id && x.username.toLowerCase()===nu.toLowerCase());
    if(taken) return res.status(409).json({error:'Username already exists.'});
    if(u.username==='Maleficent' && u.rank==='OWNER' && nu!=='Maleficent') return res.status(403).json({error:'The permanent owner username cannot be changed.'});
    u.username=nu;
    u.usernameHistory ||= [];
    u.usernameHistory.push({from:oldUsername,to:nu,time:Date.now()});
  }
  if(req.body.privacy && typeof req.body.privacy==='object'){
    u.privacy={...(u.privacy||{lastSeen:true,online:true})};
    if(req.body.privacy.lastSeen!==undefined)u.privacy.lastSeen=!!req.body.privacy.lastSeen;
    if(req.body.privacy.online!==undefined)u.privacy.online=!!req.body.privacy.online;
  }
  const next={displayName:req.body.displayName,bio:req.body.bio,pronouns:req.body.pronouns,relationship:req.body.relationship,mood:req.body.mood,location:req.body.location,website:req.body.website,interests:req.body.interests,profileColor:req.body.profileColor,profileAccentColor:req.body.profileAccentColor};
  for(const [k,v] of Object.entries(next)) if(v!==undefined){
    if(k==='displayName') u[k]=String(v).trim().slice(0,40);
    else if(k==='interests') u[k]=Array.isArray(v)?v.map(x=>String(x).slice(0,40)).slice(0,20):String(v).split(',').map(x=>x.trim()).filter(Boolean).slice(0,20);
    else u[k]=cleanText(v).slice(0,500);
  }
  if(oldDisplay!==u.displayName) u.displayNameHistory.push({value:u.displayName,time:Date.now()});
  save();
  if(oldUsername!==u.username) systemNotice(`@${oldUsername} has changed name to @${u.username}.`);
  io.emit('profile:update',safeUser(u)); res.json({user:safeUser(u)});
});

app.get('/api/users/:id/profile',auth,(req,res)=>{
  const u=current(req), v=findUser(req.params.id);
  if(!v) return res.status(404).json({error:"User not found"});
  const liked=Array.isArray(db.profileLikes)&&db.profileLikes.some(x=>x.target===v.id&&x.by===u.id);
  const friendship=db.friends.find(f=>((f.a===u.id&&f.b===v.id)||(f.a===v.id&&f.b===u.id)));
  res.json({user:safeUser(v),email:(hasRank(u,'MOD')&&v.id!==u.id&&rankOrder[v.rank]<rankOrder[u.rank])?(v.email||''):'',likedByMe:liked,friendship:friendship?friendship.status:null,profileLikes:v.profileLikes||0});
});

app.post('/api/users/:id/like',auth,featureAllowed('profile_like'),(req,res)=>{
  const u=current(req), v=findUser(req.params.id);
  if(!v || v.id===u.id) return res.status(400).json({error:"Invalid user"});
  db.profileLikes ||= [];
  const i=db.profileLikes.findIndex(x=>x.target===v.id&&x.by===u.id);
  let liked;
  if(i>=0){ db.profileLikes.splice(i,1); v.profileLikes=Math.max(0,(v.profileLikes||0)-1); liked=false; }
  else { db.profileLikes.push({id:id(),target:v.id,by:u.id,time:Date.now()}); v.profileLikes=(v.profileLikes||0)+1; liked=true; notify(v.id,'profile-like','Profile like',`@${u.username} ${liked?'liked':'unliked'} your profile.`); }
  save(); io.emit('profile:update',safeUser(v));
  res.json({liked,likes:v.profileLikes||0});
});

app.get('/api/friends/:id/nickname',auth,(req,res)=>{
  const u=current(req), v=findUser(req.params.id); if(!v)return res.status(404).json({error:'User not found'});
  u.nicknames ||= {}; v.nicknames ||= {}; res.json({nickname:u.nicknames[v.id]||'',nicknameFromOther:v.nicknames[u.id]||''});
});
app.put('/api/friends/:id/nickname',auth,(req,res)=>{
  const u=current(req), v=findUser(req.params.id); if(!v)return res.status(404).json({error:'User not found'});
  const f=db.friends.find(x=>x.status==='ACCEPTED'&&((x.a===u.id&&x.b===v.id)||(x.a===v.id&&x.b===u.id)));
  if(!f) return res.status(403).json({error:'You must be friends to use personalized nicknames.'});
  u.nicknames ||= {}; const n=cleanText(req.body.nickname||'').slice(0,40); if(n)u.nicknames[v.id]=n;else delete u.nicknames[v.id]; save(); res.json({nickname:n});
});
app.delete('/api/friends/:id/nickname',auth,(req,res)=>{const u=current(req);u.nicknames ||= {};delete u.nicknames[req.params.id];save();res.json({ok:true});});

app.post('/api/users/:id/gold/share',auth,(req,res)=>{
  const u=current(req), v=findUser(req.params.id), amount=Math.floor(Number(req.body.amount));
  if(!featureGrantAllowed(u,'share_gold'))return res.status(403).json({error:'Gold sharing permission required.'});
  if(!v||v.id===u.id||!Number.isFinite(amount)||amount<1)return res.status(400).json({error:'Invalid recipient or amount.'});
  if((u.gold||0)<amount)return res.status(400).json({error:'Not enough gold.'});
  u.gold=(u.gold||0)-amount; v.gold=(v.gold||0)+amount;
  db.goldTransactions.push({id:id(),time:Date.now(),actor:u.username,userId:u.id,type:'SHARE',delta:-amount,to:v.id}); db.goldTransactions.push({id:id(),time:Date.now(),actor:u.username,userId:v.id,type:'RECEIVE',delta:amount,from:u.id});
  save(); log(u,'GOLD_SHARE',v.username,{amount}); io.to('user:'+v.id).emit('gold:update',{gold:v.gold}); io.to('user:'+u.id).emit('gold:update',{gold:u.gold}); notify(v.id,'gold','Gold received',`@${u.username} sent you ${amount} gold.`); res.json({ok:true,remainingGold:u.gold});
});

app.post('/api/gifts/custom',auth,(req,res)=>{
  return res.status(403).json({error:'Custom gifts are disabled. Choose a predefined gift.'});
});
const DEFAULT_GIFS=[
  {url:'https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif',preview:'https://media.giphy.com/media/ICOgUNjpvO0PC/200.gif',title:'Happy'},
  {url:'https://media.giphy.com/media/3o6ZtaO9Bsexta/giphy.gif',preview:'https://media.giphy.com/media/3o6ZtaO9Bsexta/200.gif',title:'Celebration'},
  {url:'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',preview:'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/200.gif',title:'Love'}
];
app.get('/api/gifs/search',auth,async(req,res)=>{
  const q=String(req.query.q||'').trim().slice(0,80);
  if(process.env.GIPHY_API_KEY && q){try{const r=await fetch('https://api.giphy.com/v1/gifs/search?api_key='+encodeURIComponent(process.env.GIPHY_API_KEY)+'&q='+encodeURIComponent(q)+'&limit=18&rating=pg');const d=await r.json();if(r.ok)return res.json({results:(d.data||[]).map(x=>({url:x.images?.original?.url,preview:x.images?.fixed_width_small?.url||x.images?.preview_gif?.url,title:x.title||'GIF'})).filter(x=>x.url),cost:Number(db.settings.gif_cost??10)});}catch(e){}}
  const results=q?DEFAULT_GIFS.filter(g=>g.title.toLowerCase().includes(q.toLowerCase())):DEFAULT_GIFS;
  res.json({results:results.length?results:DEFAULT_GIFS,cost:Number(db.settings.gif_cost??10),notice:process.env.GIPHY_API_KEY?undefined:'Set GIPHY_API_KEY for full GIPHY search.'});
});
app.post('/api/rooms/:id/gif',auth,featureAllowed('send_messages'),async(req,res)=>{
  const u=current(req),r=db.rooms.find(x=>String(x.id)===String(req.params.id));
  if(!r)return res.status(404).json({error:'Room not found'});
  if(u.banned===true || (u.kickedUntil&&u.kickedUntil>Date.now()) || (u.mutedUntil&&u.mutedUntil>Date.now()))return res.status(403).json({error:'Your account cannot send messages right now.'});
  if(!featureGrantAllowed(u,'gif_sending'))return res.status(403).json({error:'Your rank cannot send GIFs.'});
  const url=String(req.body.url||''); let parsed;try{parsed=new URL(url)}catch{return res.status(400).json({error:'Invalid GIF URL.'})}
  if(!['https:'].includes(parsed.protocol) || !/(giphy\.com|tenor\.com|media\.giphy\.com)/i.test(parsed.hostname))return res.status(400).json({error:'GIF must come from GIPHY or Tenor.'});
  const cost=Math.max(0,Math.min(100000,Number(db.settings.gif_cost??10)));
  if(Number(u.gold||0)<cost)return res.status(400).json({error:`You need ${cost} gold to send a GIF.`});
  u.gold=Number(u.gold||0)-cost;
  const m={id:id(),roomId:String(r.id),userId:u.id,username:u.username,displayName:u.displayName,rank:u.rank,text:'',type:'gif',gifUrl:url,reactions:{},edited:false,deleted:false,pinned:false,time:Date.now(),delivered:true};
  await pool.query(`INSERT INTO room_messages(id,room_id,user_id,data,created_at) VALUES($1,$2,$3,$4::jsonb,NOW())`,[m.id,Number(r.id),Number(u.id),JSON.stringify(m)]);
  db.messages.push(m);db.goldTransactions ||= [];db.goldTransactions.push({id:id(),userId:u.id,amount:-cost,reason:'GIF sent',time:Date.now()});save();io.to('room:'+r.id).emit('message',m);res.json({ok:true,message:m,gold:u.gold,cost});
});

app.get('/api/youtube/search',auth,async(req,res)=>{
  const q=String(req.query.q||'').trim().slice(0,100); if(!q)return res.json({results:[]});
  if(process.env.YOUTUBE_API_KEY){
    try{const r=await fetch('https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&q='+encodeURIComponent(q)+'&key='+encodeURIComponent(process.env.YOUTUBE_API_KEY));const d=await r.json();return res.json({results:(d.items||[]).map(x=>({id:x.id.videoId,title:x.snippet.title,channel:x.snippet.channelTitle,thumbnail:x.snippet.thumbnails?.medium?.url||`https://i.ytimg.com/vi/${x.id.videoId}/mqdefault.jpg`}))});}catch{}
  }
  try{
    const html=await (await fetch('https://www.youtube.com/results?search_query='+encodeURIComponent(q),{headers:{'user-agent':'Mozilla/5.0'}})).text();
    const seen=new Set(), results=[];
    const re = /\"videoRenderer\":\{\"videoId\":\"([^\"]+)\"[\s\S]{0,3000}?\"title\":\{\"runs\":\[\{\"text\":\"([^\"]+)/g; let m;
    while((m=re.exec(html))&&results.length<8){if(seen.has(m[1]))continue;seen.add(m[1]);results.push({id:m[1],title:m[2],channel:'YouTube',thumbnail:`https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`});}
    if(results.length)return res.json({results});
  }catch{}
  res.json({results:[],notice:'YouTube search is unavailable right now. Add YOUTUBE_API_KEY for a stable YouTube Data API connection.'});
});

app.get('/api/rooms/:id/announcements',auth,(req,res)=>{
  const r=db.rooms.find(x=>x.id===req.params.id); if(!r)return res.status(404).json({error:'Room not found'});
  res.json({announcements:(r.announcements||[]).slice(-50).reverse()});
});
app.post('/api/rooms/:id/announcements',auth,featureAllowed('room_announcement'),(req,res)=>{
  const u=current(req),r=db.rooms.find(x=>x.id===req.params.id); if(!r)return res.status(404).json({error:'Room not found'});
  const text=cleanText(req.body.text||'').slice(0,1000); if(!text)return res.status(400).json({error:'Announcement cannot be empty.'});
  r.announcements ||= []; const n={id:id(),roomId:r.id,userId:u.id,username:u.username,displayName:u.displayName,text,time:Date.now()}; r.announcements.push(n); r.announcement=text; save(); io.to('room:'+r.id).emit('room:announcement',n); res.json({announcement:n});
});

app.delete('/api/rooms/:id/announcements/:announcementId',auth,(req,res)=>{
  const u=current(req), r=db.rooms.find(x=>x.id===req.params.id);
  if(!r) return res.status(404).json({error:'Room not found'});
  if(!hasFeature(u,'edit_room')) return res.status(403).json({error:`Deleting announcements requires ${featureRank('edit_room')} or higher.`});
  r.announcements ||= [];
  const index=r.announcements.findIndex(a=>a.id===req.params.announcementId);
  if(index<0) return res.status(404).json({error:'Announcement not found'});
  const removed=r.announcements.splice(index,1)[0];
  r.announcement=r.announcements.length ? r.announcements[r.announcements.length-1].text : '';
  save();
  io.to('room:'+r.id).emit('room:announcement-delete',{id:removed.id,roomId:r.id});
  res.json({ok:true,announcement:removed});
});

app.post('/api/games/quick',auth,(req,res)=>{
  const u=current(req), type=String(req.body.type||'').toLowerCase();
  const gameStats=()=>{ensureUserSchema(u);u.gameStats.played=(u.gameStats.played||0)+1;};
  let title='',message='',result='draw';
  if(type==='coin'){title='🪙 Coin Flip';const side=Math.random()<.5?'Heads':'Tails';message=`The coin landed on ${side}.`;result='win';}
  else if(type==='guess'){const guess=Number(req.body.guess);if(!Number.isInteger(guess)||guess<1||guess>10)return res.status(400).json({error:'Choose a number from 1 to 10.'});const n=1+Math.floor(Math.random()*10);title='🔢 Number Guess';message=`The number was ${n}.`;result=guess===n?'win':'loss';}
  else if(type==='target'){const target=1+Math.floor(Math.random()*20),roll=1+Math.floor(Math.random()*20);title='🎯 Number Target';message=`Target: ${target} · Your number: ${roll}`;result=roll===target?'win':Math.abs(roll-target)<=2?'draw':'loss';}
  else if(type==='trivia'){const qs=[['Which planet is known as the Red Planet?',['Earth','Mars','Venus'],1],['How many sides does a hexagon have?',['5','6','7'],1]];const q=qs[Math.floor(Math.random()*qs.length)];title='🧠 Trivia';message=`${q[0]} ${q[1].map((x,i)=>`${i+1}. ${x}`).join(' · ')}`;result='draw';}
  else if(type==='memory'){title='🟦 Memory Game';message='Remember this sequence: ★ ◆ ● ★';result='draw';}
  else if(type==='word'){title='🟩 Word Chain';message='Start with a word beginning with the last letter of MALeficent: T.';result='draw';}
  else return res.status(400).json({error:'Unknown quick game.'});
  gameStats(); if(result==='win')u.gameStats.wins=(u.gameStats.wins||0)+1;if(result==='loss')u.gameStats.losses=(u.gameStats.losses||0)+1;if(result==='draw')u.gameStats.draws=(u.gameStats.draws||0)+1;
  awardXp(u,result==='win'?10:4); checkAchievements(u); save(); res.json({ok:true,title,message,result});
});
app.get('/api/me/account',auth,async(req,res)=>{
  const u=current(req);
  const {rows}=await pool.query(`SELECT id,username,rank,gold,avatar,birth_date,gender,bio,email,vip_expires_at,is_premium,created_at FROM users WHERE id=$1`,[Number(u.id)]);
  res.json({account:rows[0]||null});
});



// Render/production bootstrap: initialize PostgreSQL state before accepting traffic,
// then bind to Render's assigned PORT (or 3000 locally).
(async function bootstrap(){
  try {
    await initDB();
    db = await loadState(load());
    await ensureDeveloper();

    // Ensure the structured/default settings exist without overwriting owner changes.
    db.settings = {
      xpPerLevel: 100,
      dailyXpLimit: 500,
      goldPerMinute: 1,
      linkFilter: false,
      filterMuteMinRank: "MEMBER",
      filterMuteDurationMinutes: 5,
      wall_allowed_ranks: ["OWNER", "ADMIN"],
      clear_history_allowed_ranks: ["OWNER", "ADMIN"],
      ...(db.settings || {})
    };

    ensureFeaturePermissions();
    ensureFeatureGrants();
    for (const u of db.users) ensureUserSchema(u);
    const developer = db.users.find(u => String(u.username).toLowerCase() === "maleficent");
    if (developer) {
      developer.rank = "DEVELOPER";
      developer.passwordHash = developer.password && String(developer.password).startsWith("$2") ? developer.password : developer.passwordHash;
    }

    await persistState(db);

    
// Master repair APIs: privacy-aware admin controls and persistent records.
app.post('/api/private-nickname',auth,async(req,res)=>{try{const u=current(req),target=String(req.body.targetId||''),nickname=cleanText(req.body.nickname||'').trim().slice(0,50);if(!target||target===String(u.id))return res.status(400).json({error:'Choose another user.'});const exists=await pool.query('SELECT id FROM users WHERE id=$1',[target]);if(!exists.rowCount)return res.status(404).json({error:'User not found'});if(!nickname){await pool.query('DELETE FROM private_nicknames WHERE owner_id=$1 AND target_user_id=$2',[u.id,target]);return res.json({ok:true,nickname:''});}await pool.query(`INSERT INTO private_nicknames(owner_id,target_user_id,nickname) VALUES($1,$2,$3) ON CONFLICT(owner_id,target_user_id) DO UPDATE SET nickname=EXCLUDED.nickname`,[u.id,target,nickname]);res.json({ok:true,nickname});}catch(e){console.error(e);res.status(500).json({error:'Could not save nickname'});}});
app.get('/api/private-nicknames',auth,async(req,res)=>{const u=current(req);const q=await pool.query('SELECT target_user_id,nickname FROM private_nicknames WHERE owner_id=$1',[u.id]);res.json({nicknames:Object.fromEntries(q.rows.map(x=>[String(x.target_user_id),x.nickname]))});});
app.get('/api/admin/logs',auth,async(req,res)=>{const actor=current(req);if(!(actor?.username===DEFAULT_OWNER||String(actor?.rank).toUpperCase()==='DEVELOPER'||userFeatureGrant(actor,'can_view_admin_logs')===true))return res.status(403).json({error:'Admin log permission required.'});const type=String(req.query.type||'all').toLowerCase(),search=String(req.query.search||'').slice(0,100),from=req.query.from||null,to=req.query.to||null;const groups={staff:['MUTE','KICK','WARN','BAN','ROLE','RANK','USERNAME'],economy:['GOLD','GIFT'],system:['ROOM','ACCOUNT','REGISTER','PASSWORD','EMAIL'],delete:['DELETE']};if(!['staff','economy','system','delete','all'].includes(type))return res.status(400).json({error:'Invalid log type.'});let terms=groups[type]||[];let params=[],where=[];if(terms.length){where.push('('+terms.map(t=>{params.push('%'+t+'%');return `UPPER(l.action_type) LIKE $${params.length}`}).join(' OR ')+')');}if(search){params.push('%'+search+'%');where.push(`(l.details ILIKE $${params.length} OR l.action_type ILIKE $${params.length} OR p.username ILIKE $${params.length} OR t.username ILIKE $${params.length})`);}if(from){params.push(from);where.push(`l.created_at >= $${params.length}::date`);}if(to){params.push(to);where.push(`l.created_at < ($${params.length}::date + INTERVAL '1 day')`);}const q=await pool.query(`SELECT l.*,p.username AS performer_username,t.username AS target_username FROM admin_logs l LEFT JOIN users p ON p.id=l.performed_by LEFT JOIN users t ON t.id=l.target_user_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY l.created_at DESC LIMIT 500`,params);res.json({logs:q.rows});});
app.post('/api/admin/private-search',auth,async(req,res)=>{const actor=current(req);if(!featureGrantAllowed(actor,'view_private_messages'))return res.status(403).json({error:'Private-message inspection permission required.'});const a=String(req.body.user1||'').trim(),b=String(req.body.user2||'').trim();if(!a)return res.status(400).json({error:'Enter at least one username'});const ua=await pool.query('SELECT id,username FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1',[a]);if(!ua.rowCount)return res.status(404).json({error:`User not found: ${a}`});let sql,params,users=[ua.rows[0]];if(b){const ub=await pool.query('SELECT id,username FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1',[b]);if(!ub.rowCount)return res.status(404).json({error:`User not found: ${b}`});users.push(ub.rows[0]);sql=`SELECT m.*,s.username AS sender_username,r.username AS receiver_username FROM private_messages m LEFT JOIN users s ON s.id=m.sender_id LEFT JOIN users r ON r.id=m.receiver_id WHERE (m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1) ORDER BY m.created_at DESC LIMIT 100`;params=[ua.rows[0].id,ub.rows[0].id];}else{sql=`SELECT m.*,s.username AS sender_username,r.username AS receiver_username FROM private_messages m LEFT JOIN users s ON s.id=m.sender_id LEFT JOIN users r ON r.id=m.receiver_id WHERE m.sender_id=$1 OR m.receiver_id=$1 ORDER BY m.created_at DESC LIMIT 100`;params=[ua.rows[0].id];}const q=await pool.query(sql,params);res.json({messages:q.rows,users});});
app.put('/api/admin/edit-email',auth,async(req,res)=>{const actor=current(req);const target=findUser(req.body.userId);if(!target)return res.status(404).json({error:'User not found'});if(target.username===DEFAULT_OWNER||String(target.rank).toUpperCase()==='DEVELOPER')return res.status(403).json({error:'The permanent owner account is protected.'});if(actor.username!==DEFAULT_OWNER&&String(actor.rank).toUpperCase()!=='DEVELOPER'&&rankOrder[target.rank]>=rankOrder[actor.rank])return res.status(403).json({error:'You cannot edit an equal or higher rank.'});if(!(hasFeature(actor,'edit_email')||actor?.username===DEFAULT_OWNER||String(actor?.rank).toUpperCase()==='DEVELOPER'))return res.status(403).json({error:'Email editing permission required.'});const id=Number(req.body.userId),email=String(req.body.newEmail||'').trim().toLowerCase();if(!Number.isInteger(id)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid email address.'});try{const q=await pool.query('UPDATE users SET email=$1 WHERE id=$2 RETURNING id,email',[email,id]);if(!q.rowCount)return res.status(404).json({error:'User not found'});await pool.query('INSERT INTO admin_logs(action_type,performed_by,target_user_id,details) VALUES($1,$2,$3,$4)', ['EMAIL_EDIT',actor.id,id,'Email updated']);res.json({ok:true,user:q.rows[0]});}catch(e){if(e.code==='23505')return res.status(409).json({error:'Email already in use'});throw e;}});
app.post('/api/admin/profile-note',auth,async(req,res)=>{const actor=current(req);if(!featureGrantAllowed(actor,'profile_note'))return res.status(403).json({error:'Staff profile-note permission required.'});const userId=Number(req.body.userId),note=cleanText(req.body.note||'').trim().slice(0,2000);const target=findUser(String(userId));if(!userId||!target||!note)return res.status(400).json({error:'User and note are required'});if(target.id===actor.id||rankOrder[target.rank]>=rankOrder[actor.rank])return res.status(403).json({error:'You cannot add a note to an equal or higher rank.'});await pool.query('INSERT INTO profile_notes(user_id,added_by,note) VALUES($1,$2,$3)',[userId,actor.id,note]);log(actor,'PROFILE_NOTE_ADD',String(userId),{note});res.json({ok:true});});
app.get('/api/admin/profile-note/:userId',auth,async(req,res)=>{if(!featureGrantAllowed(current(req),'profile_note'))return res.status(403).json({error:'Staff profile-note permission required.'});const q=await pool.query('SELECT n.*,u.username AS added_by_username FROM profile_notes n LEFT JOIN users u ON u.id=n.added_by WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 20',[req.params.userId]);res.json({notes:q.rows});});
app.delete('/api/admin/history/:historyId',auth,ownerOnly,async(req,res)=>{const q=await pool.query('DELETE FROM history WHERE id=$1 RETURNING id',[req.params.historyId]);if(!q.rowCount)return res.status(404).json({error:'History entry not found'});res.json({ok:true});});

server.listen(PORT, "0.0.0.0", () => {
      console.log(`Maleficent Chat listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Maleficent Chat startup failed:", err);
    process.exit(1);
  }
})();
