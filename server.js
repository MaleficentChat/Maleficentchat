const express=require("express");
const http=require("http");
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const session=require("express-session");
const multer=require("multer");
const {Server}=require("socket.io");

const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000;
const DATA=path.resolve(process.env.DATA_FILE || path.join(process.env.PERSISTENT_DATA_DIR || path.join(__dirname,"data"),"db.json"));
const UP=path.resolve(process.env.UPLOAD_DIR || path.join(process.env.PERSISTENT_DATA_DIR || path.join(__dirname,"uploads"),"uploads"));
fs.mkdirSync(path.dirname(DATA),{recursive:true});
fs.mkdirSync(UP,{recursive:true});

const DEFAULT_OWNER=process.env.OWNER_USERNAME||"Maleficent";
const DEFAULT_OWNER_PASSWORD=process.env.OWNER_PASSWORD||"Mal@123";
const OWNER_DISPLAY=process.env.OWNER_DISPLAY_NAME||"Maleficent";

function load(){
  try{
    return JSON.parse(fs.readFileSync(DATA,"utf8"));
  }catch(e){
    return {
      users:[],
      rooms:[],
      messages:[],
      privateMessages:[],
      reports:[],
      logs:[],
      notifications:[],
      friends:[],
      goldTransactions:[],
      moderationHistory:[],
      bannedWords:[],
      settings:{
        xpPerLevel:100,
        dailyXpLimit:500,
        goldPerMinute:1,
        linkFilter:false,
        filterMuteMinRank:"MEMBER",
        filterMuteDurationMinutes:5
      }
    };
  }
}

let db=load();
db.featurePermissions ||= {};
db.profileLikes ||= [];
db.gameScores ||= {};
db.news ||= [];
db.gifts ||= [
  {id:"rose",name:"Rose",icon:"🌹",cost:25,creator:"SYSTEM",custom:false},
  {id:"star",name:"Star",icon:"⭐",cost:50,creator:"SYSTEM",custom:false},
  {id:"crown",name:"Crown",icon:"👑",cost:100,creator:"SYSTEM",custom:false},
  {id:"heart",name:"Heart",icon:"💜",cost:150,creator:"SYSTEM",custom:false}
];
for(const n of db.news) n.comments ||= [];
for(const r of db.rooms) r.announcements ||= [];
db.bannedWords ||= [];
db.settings ||= {};
db.settings.filterMuteMinRank ||= "MEMBER";
db.settings.filterMuteDurationMinutes = Number(db.settings.filterMuteDurationMinutes||5);
db.settings.goldPerMinute = Number(db.settings.goldPerMinute ?? 1);
db.aurora ||= { truth:[
  "What is one thing you have never told your closest friend?",
  "What is your most embarrassing harmless moment?",
  "Who was your first crush?",
  "What is one habit you wish you could stop?",
  "What is the kindest thing someone has done for you?",
  "What is one secret talent you have?",
  "What is a fear you rarely talk about?",
  "What is the funniest lie you have ever told?",
  "What is one thing you would change about your past?",
  "What is the most spontaneous thing you have done?"
], dare:[
  "Send a message using only emojis.",
  "Compliment the last person who messaged you.",
  "Change your status to something silly for 5 minutes.",
  "Write a three-word dramatic story in chat.",
  "Use a funny nickname for yourself for the next 10 minutes.",
  "Send your next message without using the letter E.",
  "Describe your day like a movie trailer.",
  "Say something genuinely nice about someone in this room.",
  "Type a tongue twister and challenge someone else to repeat it.",
  "Send a message that contains exactly five words."
]};

function save(){
  fs.writeFileSync(DATA,JSON.stringify(db,null,2));
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
  "OWNER"
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
  OWNER:"👑"
};

const rankOrder=Object.fromEntries(
  ranks.map((r,i)=>[r,i])
);

function hasRank(u,r){
  return !!u&&rankOrder[u.rank]>=rankOrder[r];
}

// Owner-configurable access controls. The owner can change the minimum rank
// for these implemented features without editing code.
const FEATURE_CONTROLS=[
  {key:"moderate_user",name:"Moderate users",category:"Staff",defaultRank:"MOD"},
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
  {key:"staff_rank_assignment",name:"Assign MOD or lower",category:"Staff",defaultRank:"MOD"},
  {key:"manage_gold",name:"Manage user gold",category:"Owner",defaultRank:"OWNER"},
  {key:"manage_ranks",name:"Manage ranks",category:"Owner",defaultRank:"OWNER"},
  {key:"inspect_private_messages",name:"Inspect private messages",category:"Owner",defaultRank:"OWNER"},
  {key:"profile_like",name:"Like profiles",category:"Social",defaultRank:"MEMBER"}
];

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
  if(u.username===DEFAULT_OWNER && u.rank==="OWNER") return true;
  return hasRank(u,featureRank(key));
}

function featureAllowed(key){
  return (req,res,next)=>{
    const u=current(req);
    if(!u) return res.status(401).json({error:"Login required"});
    if(!hasFeature(u,key)) return res.status(403).json({error:`${FEATURE_CONTROLS.find(x=>x.key===key)?.name||"Feature"} requires ${featureRank(key)} or higher.`});
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
function notify(userId,type,title,text){
  const target=findUser(userId);
  const key=notificationPreferenceKey(type);
  const prefs=target?.settings?.notificationPrefs||{};
  if(prefs[key]===false) return;
  db.notifications.push({id:id(),userId,type,title,text,time:Date.now(),read:false});
  save();
  io.to("user:"+userId).emit("notification");
}


function awardAchievement(u,key,title,description){
  if(!u) return false;
  ensureUserSchema(u);
  if(u.achievements.some(a=>a.key===key)) return false;
  const a={key,title,description,time:Date.now()};
  u.achievements.push(a);
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

function current(req){
  return req.session.userId
    ?db.users.find(u=>u.id===req.session.userId)
    :null;
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
    "OWNER"
  ].includes(r);
}

function ownerOnly(req,res,next){
  const u=current(req);

  if(
    !u||
    u.rank!=="OWNER"||
    u.username!==DEFAULT_OWNER
  ){
    return res.status(403).json({
      error:"Owner only"
    });
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

function ensureOwner(){
  let u=findUser(DEFAULT_OWNER);

  if(!u){
    u={
      id:"owner",
      username:DEFAULT_OWNER,
      displayName:OWNER_DISPLAY,
      passwordHash:bcrypt.hashSync(
        DEFAULT_OWNER_PASSWORD,
        10
      ),
      rank:"OWNER",
      verified:true,
      createdAt:Date.now(),
      lastSeen:Date.now(),
      online:false,
      level:1,
      xp:0,
      gold:10000,
      bio:"Permanent owner of Maleficent Chat.",
      pronouns:"",
      birthday:"",
      banner:"",
      theme:"obsidian",
      profileColor:"#ff4fd8",
      badge:"Owner",
      usernameHistory:[],
      privacy:{
        lastSeen:true,
        online:true
      },
      settings:{
        rememberLogin:true,
        theme:"obsidian",
        notificationPrefs:{messages:true,mentions:true,replies:true,security:true,staff:true,gamification:true,other:true}
      }
    };

    db.users.push(u);
    save();
  }
}

ensureOwner();
ensureFeaturePermissions();

app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));

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
      featurePermissions:db.featurePermissions
    })
);

app.use('/api/register',express.json(),(req,res,next)=>{
  const p=String(req.body?.password||'');
  if(req.body?.confirmPassword!==undefined && p!==String(req.body.confirmPassword)) return res.status(400).json({error:'Passwords do not match'});
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
      gender
    }=req.body;

    const normalizedEmail=String(email||"").trim();
    const normalizedDob=String(dateOfBirth||"").trim();
    const normalizedGender=String(gender||"").trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)){
      return res.status(400).json({error:"A valid email address is required."});
    }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDob)){
      return res.status(400).json({error:"Date of birth is required."});
    }
    if(!["Male","Female","Non-binary","Prefer not to say"].includes(normalizedGender)){
      return res.status(400).json({error:"Please select a gender."});
    }

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

    if(
      !displayName||
      String(displayName).length>32||
      !password||
      password.length<8
    ){
      return res.status(400).json({
        error:
          "Display name and password are required; password must be 8+ characters."
      });
    }

    if(findUser(username)){
      return res.status(409).json({
        error:"Username already exists."
      });
    }

    const u={
      id:id(),
      username,
      displayName,
      email:normalizedEmail,
      dateOfBirth:normalizedDob,
      gender:normalizedGender,

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
        user:safeUser(u)
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
      !(await bcrypt.compare(
        req.body.password||"",
        u.passwordHash
      ))
    ){
      return res.status(401).json({
        error:
          "Invalid username or password."
      });
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
        user:safeUser(u)
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

app.get(
  "/api/rooms",
  auth,
  (req,res)=>
    res.json({
      rooms:db.rooms.map(r=>({
        ...r,
        locked:!!r.passwordHash,
        passwordHash:undefined,
        onlineCount:io.sockets.adapter.rooms.get("room:"+r.id)?.size||0
      }))
    })
);

app.post(
  "/api/rooms",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasFeature(u,"create_room")){
      return res.status(403).json({error:`Create room requires ${featureRank("create_room")} or higher.`});
    }

    const r={
      id:id(),

      name:
        cleanText(req.body.name)
        .slice(0,60)||
        "New Room",

      icon:req.body.icon||"💬",

      description:
        cleanText(
          req.body.description
        ).slice(0,300),

      category:
        cleanText(
          req.body.category
        ).slice(0,40)||
        "Community",

      public:
        req.body.public!==false,

      passwordHash:
        req.body.password
          ?bcrypt.hashSync(
              req.body.password,
              10
            )
          :null,

      rankRequired:
        req.body.rankRequired||
        "MEMBER",

      limit:
        Number(req.body.limit)||
        100,

      slowMode:
        Number(req.body.slowMode)||
        0,

      announcement:"",

      ownerId:u.id,

      banner:
        req.body.banner||"",

      inviteToken:
        crypto.randomBytes(12)
        .toString("hex")
    };

    db.rooms.push(r);

    save();

    log(
      u,
      "ROOM_CREATE",
      r.name
    );

    res.json({
      room:{
        ...r,
        passwordHash:undefined
      }
    });
  }
);

app.patch(
  "/api/rooms/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    const r=db.rooms.find(
      x=>x.id===req.params.id
    );

    if(!r){
      return res.status(404).json({
        error:"Room not found"
      });
    }

    if(
      !(
        hasRank(u,"COOWNER")||
        r.ownerId===u.id
      )
    ){
      return res.status(403).json({
        error:"No permission"
      });
    }

    for(
      const k of [
        "name",
        "icon",
        "description",
        "category",
        "rankRequired",
        "announcement",
        "banner"
      ]
    ){
      if(req.body[k]!==undefined){
        r[k]=cleanText(
          req.body[k]
        );
      }
    }

    for(
      const k of [
        "limit",
        "slowMode"
      ]
    ){
      if(req.body[k]!==undefined){
        r[k]=Number(
          req.body[k]
        );
      }
    }

    if(
      req.body.password!==undefined
    ){
      r.passwordHash=
        req.body.password
          ?bcrypt.hashSync(
              req.body.password,
              10
            )
          :null;
    }

    save();

    log(
      u,
      "ROOM_EDIT",
      r.name
    );

    res.json({
      room:{
        ...r,
        passwordHash:undefined
      }
    });
  }
);

app.delete(
  "/api/rooms/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    const r=db.rooms.find(
      x=>x.id===req.params.id
    );

    if(!r||r.id==="main"){
      return res.status(400).json({
        error:"Cannot delete Main Room."
      });
    }

    if(!hasRank(u,"COOWNER")){
      return res.status(403).json({
        error:
          "Co-owner or owner required."
      });
    }

    db.rooms=
      db.rooms.filter(
        x=>x.id!==r.id
      );

    db.messages=
      db.messages.filter(
        m=>m.roomId!==r.id
      );

    save();

    log(
      u,
      "ROOM_DELETE",
      r.name
    );

    res.json({
      ok:true
    });
  }
);

app.post(
  "/api/rooms/:id/join",
  auth,
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
      room:{
        ...r,
        passwordHash:undefined
      }
    });
  }
);

app.get('/api/rooms/:id/pinned',auth,(req,res)=>{
  const room=db.rooms.find(x=>x.id===req.params.id); if(!room)return res.status(404).json({error:'Room not found'});
  res.json({messages:db.messages.filter(m=>m.roomId===room.id&&m.pinned&&!m.deleted).sort((a,b)=>b.time-a.time)});
});

app.get(
  "/api/rooms/:id/messages",
  auth,
  (req,res)=>{
    let arr=
      db.messages
        .filter(
          m=>m.roomId===req.params.id
        )
        .slice(-300);

    res.json({
      messages:arr
    });
  }
);

app.post(
  "/api/rooms/:id/messages",
  auth,
  upload.single("file"),
  (req,res)=>{
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
    if(u.mutedUntil&&u.mutedUntil>Date.now()){
      return res.status(403).json({error:"You are muted until "+new Date(u.mutedUntil).toLocaleString()});
    }

    if(
      req.file&&
      !/^image\/|^audio\//.test(
        req.file.mimetype
      )
    ){
      return res.status(400).json({
        error:
          "Only image/audio uploads are allowed."
      });
    }


    let text=
      cleanText(req.body.text);
    const malTimeMatch = text.match(/^@Mal\s+Time\s*$/i);


    if(
      !text&&
      !req.file
    ){
      return res.status(400).json({
        error:"Message is empty."
      });
    }

    const matchedFilter=filteredWord(text);
    const filterMaxRank=rankOrder[db.settings.filterMuteMinRank||"MEMBER"]??0;
    let autoMuted=false;
    if(matchedFilter && (rankOrder[u.rank]??999)<=filterMaxRank){
      const minutes=Math.max(1,Number(db.settings.filterMuteDurationMinutes||5));
      const stars="*".repeat(Math.max(3,String(matchedFilter).length));
      const re=new RegExp(String(matchedFilter).replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\$&"),"gi");
      text=text.replace(re,stars);
      u.mutedUntil=Date.now()+minutes*60*1000;
      u.muteReason="Automatic filtered-word protection";
      autoMuted=true;
      db.moderationHistory.push({id:id(),time:Date.now(),target:u.id,actor:"SYSTEM",action:"AUTO_MUTE",reason:`Filtered word: ${matchedFilter}`,minutes});
      notify(u.id,"moderation","Auto-mute",`Your message matched the room filter and you were muted for ${minutes} minute${minutes===1?"":"s"}.`);
    }

    const m={
      id:id(),
      roomId:r.id,
      userId:u.id,
      username:u.username,
      displayName:u.displayName,
      rank:u.rank,
      usernameColor:u.settings?.usernameColor||"",
      chatFont:u.settings?.chatFont||"",
      text,

      attachment:req.file
        ?{
            url:
              "/uploads/"+
              req.file.filename,
            type:req.file.mimetype,
            name:req.file.originalname
          }
        :null,

      replyTo:
        req.body.replyTo||
        null,

      forwardedFrom:
        req.body.forwardedFrom||
        null,

      reactions:{},
      edited:false,
      deleted:false,
      pinned:false,
      time:Date.now(),
      delivered:true
    };

    db.messages.push(m);
    u.stats ||= {messages:0,rooms:0,friends:0};
    u.stats.messages=(u.stats.messages||0)+1;
    checkAchievements(u);

    awardXp(u,5);

    save();

    io.to(
      "room:"+r.id
    ).emit(
      "message",
      m
    );

    if(malTimeMatch){
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,"0");
      const mm = String(now.getMinutes()).padStart(2,"0");
      const ss = String(now.getSeconds()).padStart(2,"0");
      const bot={id:id(),system:false,isBot:true,userId:"bot-mal",username:"Mal",displayName:"Mal",rank:"BOT",text:`${u.username} : ${hh}:${mm}:${ss}`,roomId:r.id,time:Date.now(),reactions:{},pinned:false,deleted:false};
      db.messages.push(bot);
      save();
      io.to("room:"+r.id).emit("message",bot);
    }

    const expiresIn = Number(req.body.expiresIn||0);
    if(expiresIn>0){
      m.expiresAt=Date.now()+Math.min(expiresIn,7*86400000);
      save();
    }

    const aur=auroraReplyFor(text);
    if(aur){
      const bot={id:id(),system:true,username:'Aurora',displayName:'Aurora',rank:'BOT',text:`${aur.type==='truth'?'💜 Truth':'🔥 Dare'}: ${aur.prompt}`,roomId:r.id,time:Date.now(),reactions:{},pinned:false,deleted:false};
      db.messages.push(bot); save(); io.to('room:'+r.id).emit('message',bot);
    }

    if(/@(Diaval|Davial)\b/i.test(text)){
      diavalReplyFor(text,r.id).then(answer=>{
        if(!answer) return;
        const bot={id:id(),system:false,isBot:true,userId:'bot-diaval',username:'Diaval',displayName:'Diaval',rank:'BOT',text:answer,roomId:r.id,time:Date.now(),reactions:{},pinned:false,deleted:false};
        db.messages.push(bot); save(); io.to('room:'+r.id).emit('message',bot);
      }).catch(error=>console.error("Diaval reply error:",error));
    }

    res.json({
      message:m
    });
  }
);
app.patch(
  "/api/messages/:id",
  auth,
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

app.get(
  "/api/dm/:id",
  auth,
  (req,res)=>{
    const u=current(req);
    const v=findUser(req.params.id);

    if(!v){
      return res.status(404).json({
        error:"User not found"
      });
    }

    const blocked=
      (u.blocked||[])
        .includes(v.id)||
      (v.blocked||[])
        .includes(u.id);

    if(blocked){
      return res.status(403).json({
        error:"Messaging blocked"
      });
    }

    res.json({
      messages:
        db.privateMessages
          .filter(
            m=>
              (
                m.from===u.id&&
                m.to===v.id
              )||
              (
                m.from===v.id&&
                m.to===u.id
              )
          )
          .slice(-300)
    });
  }
);

app.post(
  "/api/dm/:id",
  auth,
  upload.single("file"),
  (req,res)=>{
    const u=current(req);
    const v=findUser(req.params.id);

    if(!v){
      return res.status(404).json({
        error:"User not found"
      });
    }

    if(
      (u.blocked||[])
        .includes(v.id)||
      (v.blocked||[])
        .includes(u.id)
    ){
      return res.status(403).json({
        error:"Messaging blocked"
      });
    }

  const m={
  id:id(),
  from:u.id,
  to:v.id,

  text:
    cleanText(req.body.text),

  attachment:req.file
    ?{
        url:
          "/uploads/"+
          req.file.filename,
        type:req.file.mimetype,
        name:req.file.originalname
      }
    :null,

  replyTo:
    req.body.replyTo ||
    null,

  time:Date.now(),
  read:false,
  delivered:true
};
    if(
      !m.text&&
      !m.attachment
    ){
      return res.status(400).json({
        error:"Empty message"
      });
    }

    db.privateMessages.push(m);

    save();

    notify(
      v.id,
      "private-message",
      "New private message",
      "@"+u.username+
      " sent you a private message."
    );

    io.to(
      "user:"+v.id
    ).emit(
      "dm",
      m
    );

    res.json({
      message:m
    });
  }
);

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

function diavalLocalReply(question, roomId){
  const q=String(question||'').trim();
  const l=q.toLowerCase();
  if(!q) return 'Hello! I’m Diaval 🖤 Ask me anything.';

  // Simple arithmetic without eval(): only allow numbers/operators/parentheses.
  const math=q.replace(/,/g,'').trim();
  if(/^[0-9+\-*/().%\s]+$/.test(math) && /[0-9]/.test(math) && /[+\-*/%]/.test(math)){
    try{
      const tokens=math.match(/\d+(?:\.\d+)?|[()+\-*/%]/g)||[];
      let pos=0;
      function expr(){ let v=term(); while(tokens[pos]==='+'||tokens[pos]==='-'){const op=tokens[pos++],n=term();v=op==='+'?v+n:v-n;} return v; }
      function term(){ let v=factor(); while(tokens[pos]==='*'||tokens[pos]==='/'||tokens[pos]==='%'){const op=tokens[pos++],n=factor(); if((op==='/'||op==='%')&&n===0) throw new Error('zero'); v=op==='*'?v*n:op==='/'?v/n:v%n;} return v; }
      function factor(){ if(tokens[pos]==='-'){pos++;return -factor();} if(tokens[pos]==='+'){pos++;return factor();} if(tokens[pos]==='('){pos++;const v=expr();if(tokens[pos]!==')')throw new Error('paren');pos++;return v;} const n=Number(tokens[pos++]);if(!Number.isFinite(n))throw new Error('number');return n; }
      const value=expr();
      if(pos===tokens.length && Number.isFinite(value)) return `That comes to **${Number(value.toFixed(10))}**.`;
    }catch(e){}
  }

  if(/^(hi|hello|hey|yo|hii|heyy|sup)\b/i.test(q)) return ['Hey! 🖤 Diaval here. What are we getting into?','Hello! I’m Diaval. Throw a question at me.','Hey there! I’m listening. What do you need?'][Math.floor(Math.random()*3)];
  if(/how are you|how r u|hru/i.test(l)) return 'I’m doing well — online, awake, and ready to help. 😈';
  if(/who are you|what are you|your name/i.test(l)) return 'I’m Diaval, the built-in assistant of Maleficent Chat. I can chat, explain things, help with the site, do calculations, brainstorm, and keep track of the conversation in this room.';
  if(/what can you do|help me/i.test(l)) return 'I can explain concepts, answer everyday questions, do calculations, brainstorm ideas, help with writing and coding, and explain Maleficent Chat features. Ask me something specific and I’ll take it from there.';
  if(/thank|thx|thanks/i.test(l)) return 'Anytime. 🖤';
  if(/good morning/i.test(l)) return 'Good morning! ☀️ Diaval is awake. What are we working on?';
  if(/good night|gn/i.test(l)) return 'Good night! 🖤 Sleep well.';
  if(/joke|make me laugh/i.test(l)) return 'Why did the developer bring a ladder to the server room? Because the bugs were on another level. 😭';
  if(/weather/i.test(l)) return 'I’m running locally, so I don’t have live weather data. If you tell me the city and the forecast you see, I can help interpret it.';
  if(/time|date|today|tomorrow/i.test(l)) return `My local clock is available to the server, but I don’t have a live web connection. Today is ${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}.`;
  if(/password|login|register|account/i.test(l)) return 'For account issues, tell me what you were trying to do and the exact error you saw. I can help narrow down whether it is authentication, permissions, or a profile setting.';
  if(/announcement|news|gift|profile|notification|feature granting|hamburger|action button/i.test(l)) return 'That sounds like a Maleficent Chat feature. I can help you reason through it: tell me what you expected to happen, what actually happened, and I’ll break the problem into steps.';
  if(/game|score|rps|rock paper scissors|dice/i.test(l)) return 'Games are built into Maleficent Chat. You can play RPS or Dice and check the recorded scores from the Games section.';
  if(/code|javascript|html|css|node|program|bug|error/i.test(l)) return 'Sure. Paste the code or error message and I’ll explain what it means and suggest a fix. I’ll keep the explanation focused on the actual problem.';
  if(/maleficent|site|website|chat/i.test(l)) return 'For Maleficent Chat, I can help you think through rooms, profiles, messages, gifts, moderation, games, permissions, announcements, and settings.';
  if(/sad|angry|bored|tired|upset|stressed/i.test(l)) return 'I hear you. If you want to talk about it, tell me what happened. I’ll listen and help you think through it without judging you.';
  if(/what is|who is|explain|define|meaning of/i.test(l)) return `I can explain that, but I’m a local chatbot rather than a connected encyclopedia. Give me the exact term or a little context and I’ll give you the best explanation I can from my built-in knowledge.`;
  if(/how do i|how can i|how to/i.test(l)) return `Let’s break it down. For “${q.slice(0,180)}”, tell me what you’re trying to accomplish and what you have already tried, and I’ll give you a practical step-by-step approach.`;
  if(/why/i.test(l)) return `There can be a few reasons. For “${q.slice(0,180)}”, the important clues are the context and what happened immediately before it. Tell me those details and I’ll narrow it down.`;
  if(/\b(can you|could you|would you)\b/i.test(l)) return `Yes — I can try. For “${q.slice(0,180)}”, tell me the exact result you want and I’ll work through it with you.`;

  const recent=db.messages.filter(m=>m.roomId===roomId&&!m.deleted&&!m.system).slice(-6).map(m=>String(m.text||'').trim()).filter(Boolean);
  if(recent.length>1 && /^(okay|ok|sure|yes|yeah|no|why|then|and|also|really)\b/i.test(q)){
    return `I’m following the conversation. You’re continuing from “${recent[recent.length-2].slice(0,140)}”. Tell me what you want to change, know, or decide about it.`;
  }
  const replies=[
    `Interesting. I’d break “${q.slice(0,150)}” into the main question and the context around it. What part matters most to you?`,
    `I’m with you. For “${q.slice(0,150)}”, give me one concrete detail and I can make my answer much more specific.`,
    `Got it. I can work through that with you — what result are you hoping to get from “${q.slice(0,150)}”?`,
    `That’s something we can reason through. Start with what happened, what you expected, and what you want to happen next.`
  ];
  return replies[Math.floor(Math.random()*replies.length)];
}

async function diavalReplyFor(text, roomId){
  const match=String(text||'').match(/@(Diaval|Davial)\b\s*([\s\S]*)/i);
  if(!match) return null;
  return diavalLocalReply(String(match[2]||'').trim(),roomId);
}

function auroraReplyFor(text){
  const m=String(text||'').match(/@Aurora\s+(truth|dare)\b/i);
  if(!m) return null;
  const type=m[1].toLowerCase(), pool=db.aurora[type]||[];
  return {type,prompt:pool[Math.floor(Math.random()*pool.length)]||'Try again! Aurora is out of questions.'};
}

app.get('/api/diaval/history',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u);
  res.json({messages:(u.diavalHistory||[]).slice(-100)});
});
app.post('/api/diaval/message',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u);
  const text=cleanText(req.body.text||'').trim().slice(0,2000);
  if(!text) return res.status(400).json({error:'Message cannot be empty.'});
  u.diavalHistory ||= [];
  u.diavalHistory.push({role:'user',text,time:Date.now()});
  const answer=diavalLocalReply(text,null);
  u.diavalHistory.push({role:'assistant',text:answer,time:Date.now()});
  if(u.diavalHistory.length>200) u.diavalHistory=u.diavalHistory.slice(-200);
  checkAchievements(u); save();
  res.json({reply:answer,history:u.diavalHistory});
});
app.delete('/api/diaval/history',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u); u.diavalHistory=[]; save(); res.json({ok:true});
});

app.post('/api/rewards/daily',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u);
  const day=new Date().toISOString().slice(0,10);
  if(u.dailyRewardDay===day) return res.status(409).json({error:'Daily reward already claimed today.',claimed:true,gold:u.gold||0});
  u.dailyRewardDay=day; u.gold=(u.gold||0)+25; awardXp(u,15); notify(u.id,'gold','Daily reward','You received 25 gold and 15 XP.'); save();
  res.json({ok:true,gold:u.gold,xp:u.xp,amount:25});
});
app.get('/api/account/export',auth,(req,res)=>{
  const u=current(req);
  res.json({exportedAt:Date.now(),account:{username:u.username,displayName:u.displayName,createdAt:u.createdAt,rank:u.rank,level:u.level,xp:u.xp,gold:u.gold,bio:u.bio,interests:u.interests,achievements:u.achievements},diavalHistory:u.diavalHistory||[],loginHistory:u.loginHistory||[]});
});

app.get('/api/notifications/unread',auth,(req,res)=>{
  const u=current(req); res.json({notifications:db.notifications.filter(n=>n.userId===u.id&&!n.read).slice(-100).reverse()});
});
app.patch('/api/notifications/:id/read',auth,(req,res)=>{
  const n=db.notifications.find(x=>x.id===req.params.id&&x.userId===current(req).id);
  if(!n) return res.status(404).json({error:'Notification not found'});
  n.read=true; save(); res.json({ok:true});
});
app.delete('/api/notifications/:id',auth,(req,res)=>{
  const u=current(req),i=db.notifications.findIndex(x=>x.id===req.params.id&&x.userId===u.id);
  if(i<0)return res.status(404).json({error:'Notification not found'});
  db.notifications.splice(i,1); save(); res.json({ok:true});
});
app.delete('/api/notifications',auth,(req,res)=>{
  const uid=current(req).id; db.notifications=db.notifications.filter(n=>n.userId!==uid); save(); res.json({ok:true});
});

app.post(
  "/api/moderation/:action",
  auth,
  (req,res)=>{
    const actor=current(req);

    if(!hasRank(actor,"MOD")){
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

    const action=
      req.params.action.toUpperCase();

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

app.get(
  "/api/owner/overview",
  ownerOnly,
  (req,res)=>
    res.json({
      users:
        db.users.map(safeUser),

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

app.patch(
  "/api/owner/settings",
  ownerOnly,
  (req,res)=>{
    if(
      req.body.xpPerLevel!==undefined
    ){
      db.settings.xpPerLevel=
        Math.max(
          10,
          Number(
            req.body.xpPerLevel
          )
        );
    }

    if(
      req.body.dailyXpLimit!==undefined
    ){
      db.settings.dailyXpLimit=
        Math.max(
          1,
          Number(
            req.body.dailyXpLimit
          )
        );
    }

    if(
      req.body.goldPerMinute!==undefined
    ){
      db.settings.goldPerMinute=
        Math.max(
          0,
          Number(
            req.body.goldPerMinute
          )
        );
    }

    if(req.body.linkFilter!==undefined){
      db.settings.linkFilter=!!req.body.linkFilter;
    }
    if(req.body.filterMuteMinRank!==undefined && ranks.includes(String(req.body.filterMuteMinRank))){
      db.settings.filterMuteMinRank=String(req.body.filterMuteMinRank);
    }
    if(req.body.filterMuteDurationMinutes!==undefined){
      db.settings.filterMuteDurationMinutes=Math.min(10080,Math.max(1,Number(req.body.filterMuteDurationMinutes)||5));
    }

    save();

    res.json({
      settings:db.settings
    });
  }
);

app.get('/api/owner/feature-permissions',ownerOnly,(req,res)=>{
  ensureFeaturePermissions();
  const controls=FEATURE_CONTROLS.map(f=>({...f,implemented:true}));
  save();
  res.json({controls,permissions:db.featurePermissions,ranks});
});

app.patch('/api/owner/feature-permissions/:key',ownerOnly,(req,res)=>{
  ensureFeaturePermissions();
  const key=String(req.params.key);
  const f=FEATURE_CONTROLS.find(x=>x.key===key);
  const r=req.body.rank;
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
    if(target.username==='Maleficent' || target.rank==='OWNER') return res.status(403).json({error:'Permanent owner account is protected.'});
    target.usernameHistory ||= []; target.usernameHistory.push({from:target.username,to:nu,time:Date.now(),changedBy:actor.username}); target.username=nu;
  }
  if(req.body.email!==undefined) target.email=String(req.body.email||'').trim().slice(0,160);
  save();
  res.json({user:safeUser(target),email:target.email||''});
});

app.patch('/api/staff/user/:id/rank',auth,(req,res)=>{
  const actor=current(req), target=findUser(req.params.id), nr=String(req.body.rank||'');
  if(!target) return res.status(404).json({error:'User not found'});
  if(!hasFeature(actor,'staff_rank_assignment')) return res.status(403).json({error:`Rank assignment requires ${featureRank('staff_rank_assignment')} or higher.`});
  if(target.username==='Maleficent' || target.rank==='OWNER') return res.status(403).json({error:'Permanent owner is protected.'});
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
      !ranks.includes(
        req.body.rank
      )
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
          "Permanent owner rank cannot be changed."
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

    if(
      !req.body.password||
      req.body.password.length<6
    ){
      return res.status(400).json({
        error:"Password too short"
      });
    }

    v.passwordHash=
      await bcrypt.hash(
        req.body.password,
        10
      );

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

app.get("/api/owner/dms",ownerOnly,(req,res)=>{
  const usersById=new Map(db.users.map(u=>[u.id,u]));
  res.json({privateMessages:db.privateMessages.slice(-2000).reverse().map(m=>{
    const from=usersById.get(m.from), to=usersById.get(m.to);
    return {...m,fromUsername:from?.username||m.from,toUsername:to?.username||m.to,
      fromDisplayName:from?.displayName||"",toDisplayName:to?.displayName||""};
  })});
});

app.get("/api/dm/unread-count",auth,(req,res)=>{
  const u=current(req);
  const count=db.privateMessages.filter(m=>m.to===u.id&&!m.read).length;
  res.json({count});
});

app.get("/api/staff/unread-count",auth,(req,res)=>{
  const u=current(req);
  if(!staff(u.rank)) return res.status(403).json({reports:0,staffNotifications:0,total:0});
  const reports=db.reports.filter(r=>r.status==="OPEN").length;
  const staffNotifications=db.notifications.filter(n=>n.userId===u.id&&!n.read&&["report","moderation","staff"].includes(n.type)).length;
  res.json({reports,staffNotifications,total:reports+staffNotifications});
});

app.get(
  "/api/notifications",
  auth,
  (req,res)=>{
    res.json({
      notifications:
        db.notifications
          .filter(
            n=>
              n.userId===
              current(req).id
          )
          .slice(-200)
          .reverse()
    });
  }
);

app.post(
  "/api/notifications/read",
  auth,
  (req,res)=>{
    db.notifications
      .filter(
        n=>
          n.userId===
          current(req).id
      )
      .forEach(
        n=>n.read=true
      );

    save();

    res.json({
      ok:true
    });
  }
);

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

app.get('/api/gifts/catalog',auth,(req,res)=>res.json({gifts:db.gifts||[]}));

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
      userId=>{
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

    socket.on("join-room", roomId=>{
      const u=findUser(socket.data.userId);
      const r=db.rooms.find(x=>x.id===roomId);
      if(!u||!r) return;
      if(u.banned===true) return;
      if(u.kickedUntil&&u.kickedUntil>Date.now()) return;
      for(const room of socket.rooms){
        if(room.startsWith("room:") && room!=="room:"+roomId) socket.leave(room);
      }
      socket.join("room:"+roomId);
      socket.data.roomId=roomId;
      u.lastSeen=Date.now();
      save();
      io.emit("presence");
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
      ()=>{}
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
  const allowed=['rememberLogin','theme','accentColor','fontSize','compactMode','reducedMotion','highContrast','language','timezone','notificationPrefs','usernameColor','chatFont','messageEffects','textSize','bubbleStyle','profileAccentColor','profileColor'];
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
  if(!v||v.id===u.id||!Number.isFinite(amount)||amount<1)return res.status(400).json({error:'Invalid recipient or amount.'});
  if((u.gold||0)<amount)return res.status(400).json({error:'Not enough gold.'});
  u.gold=(u.gold||0)-amount; v.gold=(v.gold||0)+amount;
  db.goldTransactions.push({id:id(),time:Date.now(),actor:u.username,userId:u.id,type:'SHARE',delta:-amount,to:v.id}); db.goldTransactions.push({id:id(),time:Date.now(),actor:u.username,userId:v.id,type:'RECEIVE',delta:amount,from:u.id});
  save(); io.to('user:'+v.id).emit('gold:update',{gold:v.gold}); io.to('user:'+u.id).emit('gold:update',{gold:u.gold}); notify(v.id,'gold','Gold received',`@${u.username} sent you ${amount} gold.`); res.json({ok:true,remainingGold:u.gold});
});

app.post('/api/gifts/custom',auth,featureAllowed('create_custom_gift'),upload.single('file'),(req,res)=>{
  try{
    const u=current(req);
    const type=String(req.body.type||'image').toLowerCase();
    const name=cleanText(req.body.name||'Personalized Gift').trim().slice(0,40);
    const cost=Math.max(1,Math.min(100000,Number(req.body.cost)||10));
    if(!['image','text'].includes(type)) return res.status(400).json({error:'Invalid gift type.'});
    if(!name) return res.status(400).json({error:'Enter a gift name.'});
    if(type==='image'&&!req.file) return res.status(400).json({error:'Choose an image.'});
    const text=type==='text'?cleanText(req.body.text||'').trim().slice(0,180):'';
    if(type==='text'&&!text) return res.status(400).json({error:'Enter gift text.'});
    db.gifts ||= [];
    const gift={id:'gift_'+id(),name,cost,creator:u.username,creatorId:u.id,custom:true,type,icon:type==='text'?'✍️':'🖼️',text,url:req.file?'/uploads/'+req.file.filename:'' ,time:Date.now()};
    db.gifts.push(gift);
    save();
    res.status(201).json({ok:true,gift,gifts:db.gifts});
  }catch(e){ console.error('custom gift error',e); res.status(500).json({error:'Could not create the custom gift.'}); }
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
app.post('/api/rooms/:id/announcements',auth,(req,res)=>{
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

app.get('/api/games/scores',auth,(req,res)=>{
  const scores=db.gameScores||{};
  const rows=Object.entries(scores).map(([userId,s])=>({userId,username:findUser(userId)?.username||'Unknown',displayName:findUser(userId)?.displayName||'Unknown',rps:s.rps||{wins:0,losses:0,draws:0,played:0},dice:s.dice||{wins:0,losses:0,draws:0,played:0},totalWins:Number(s.totalWins||0),totalPlayed:Number(s.totalPlayed||0)})).sort((a,b)=>b.totalWins-a.totalWins||b.totalPlayed-a.totalPlayed);
  res.json({me:rows.find(x=>x.userId===current(req).id)||{userId:current(req).id,totalWins:0,totalPlayed:0,rps:{wins:0,losses:0,draws:0,played:0},dice:{wins:0,losses:0,draws:0,played:0}},leaderboard:rows.slice(0,10)});
});
app.post('/api/games/score',auth,(req,res)=>{
  const u=current(req), game=String(req.body.game||''), result=String(req.body.result||'');
  if(!['rps','dice'].includes(game)||!['win','loss','draw'].includes(result))return res.status(400).json({error:'Invalid game result.'});
  db.gameScores ||= {}; db.gameScores[u.id] ||= {totalWins:0,totalPlayed:0,rps:{wins:0,losses:0,draws:0,played:0},dice:{wins:0,losses:0,draws:0,played:0}};
  const s=db.gameScores[u.id], g=s[game]; g[result+'s']=(g[result+'s']||0)+1; g.played=(g.played||0)+1; s.totalPlayed=(s.totalPlayed||0)+1; if(result==='win')s.totalWins=(s.totalWins||0)+1;
  ensureUserSchema(u); u.gameStats.played=(u.gameStats.played||0)+1; u.gameStats[result+'s']=(u.gameStats[result+'s']||0)+1; if(result==='win')u.gameStats.wins=(u.gameStats.wins||0)+1;
  awardXp(u,result==='win'?10:4); checkAchievements(u); save(); res.json({ok:true,score:s,achievements:u.achievements});
});
app.post('/api/rooms/:id/youtube',auth,(req,res)=>{const u=current(req),r=db.rooms.find(x=>x.id===req.params.id);if(!r)return res.status(404).json({error:'Room not found'});const videoId=String(req.body.videoId||'');if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))return res.status(400).json({error:'Invalid YouTube video.'});const m={id:id(),userId:u.id,username:u.username,displayName:u.displayName,rank:u.rank,text:String(req.body.title||'YouTube video').slice(0,200),attachment:{type:'video/youtube',url:`https://www.youtube.com/watch?v=${videoId}`,videoId,name:String(req.body.title||'YouTube video').slice(0,200)},reactions:{},pinned:false,deleted:false,time:Date.now(),roomId:r.id};db.messages.push(m);save();io.to('room:'+r.id).emit('message',m);res.json({message:m});});

app.get('/api/gifts',auth,(req,res)=>{
  res.json({gifts:db.gifts||[]});
});

app.post('/api/gifts',auth,featureAllowed('create_custom_gift'),(req,res)=>{
  const u=current(req);
  const name=cleanText(req.body.name||'').trim().slice(0,40);
  const icon=String(req.body.icon||'🎁').trim().slice(0,4);
  const cost=Math.floor(Number(req.body.cost));
  if(!name || !icon || !Number.isFinite(cost) || cost<1 || cost>100000){
    return res.status(400).json({error:'Enter a gift name, emoji and a cost from 1 to 100000 gold.'});
  }
  const g={id:'gift_'+id(),name,icon,cost,creator:u.username,creatorId:u.id,custom:true,time:Date.now()};
  db.gifts.push(g);
  save();
  res.json({ok:true,gift:g,gifts:db.gifts});
});

app.post('/api/users/:id/gift',auth,featureAllowed('send_gift'),(req,res)=>{
  const u=current(req), v=findUser(req.params.id);
  if(!v || v.id===u.id) return res.status(400).json({error:"Invalid user"});
  const g=(db.gifts||[]).find(x=>x.id===String(req.body.gift));
  if(!g) return res.status(400).json({error:"Invalid gift"});
  if((u.gold||0)<g.cost) return res.status(400).json({error:`You need ${g.cost} gold.`});
  u.gold-=g.cost;
  v.giftsReceived ||= [];
  v.giftsReceived.push({from:u.id,gift:g.name,icon:g.icon,cost:g.cost,time:Date.now()}); v.badgesStats ||= {}; v.badgesStats.giftsReceived=(v.badgesStats.giftsReceived||0)+1; u.badgesStats ||= {}; u.badgesStats.giftsSent=(u.badgesStats.giftsSent||0)+1;
  notify(v.id,'gift','Gift received',`@${u.username} sent you ${g.icon} ${g.name}.`);
  db.goldTransactions.push({id:id(),time:Date.now(),actor:u.id,userId:u.id,type:'GIFT_SENT',delta:-g.cost,gift:g.name,to:v.id});
  save();
  res.json({ok:true,gift:g,remainingGold:u.gold});
});

app.get('/api/me/email',auth,(req,res)=>res.json({email:current(req).email||''}));
app.put('/api/me/email',auth,(req,res)=>{
  const u=current(req); const email=String(req.body.email||'').trim();
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Invalid email address.'});
  u.email=email; save(); res.json({ok:true,email:u.email||''});
});

app.post('/api/password/change',auth,(req,res)=>{
  const u=current(req);
  if(!req.body.currentPassword||!req.body.newPassword) return res.status(400).json({error:'Current and new password are required'});
  if(!bcrypt.compareSync(String(req.body.currentPassword),u.password)) return res.status(400).json({error:'Current password is incorrect'});
  if(String(req.body.newPassword).length<8) return res.status(400).json({error:'New password must be at least 8 characters'});
  u.password=bcrypt.hashSync(String(req.body.newPassword),12); u.passwordChangedAt=Date.now(); save();
  log(u,'PASSWORD_CHANGED',u.username); notify(u.id,'security','Password changed','Your password was changed successfully.');
  res.json({ok:true});
});

app.get('/api/security/sessions',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u);
  res.json({sessions:u.sessions.map(x=>({...x,current:x.id===req.sessionID}))});
});

app.post('/api/security/logout-all',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u); u.sessions=[]; save();
  req.session.destroy(()=>res.json({ok:true}));
});

app.get('/api/security/login-history',auth,(req,res)=>res.json({history:(current(req).loginHistory||[]).slice(-100).reverse()}));

app.post('/api/status',auth,(req,res)=>{
  const u=current(req); const allowed=['online','away','busy','invisible'];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:'Invalid status'});
  u.status=req.body.status; u.statusText=cleanText(req.body.statusText||'').slice(0,120); u.lastSeen=Date.now(); save(); io.emit('presence'); res.json({ok:true});
});

app.get('/api/users/search',auth,(req,res)=>{
  const q=String(req.query.q||'').trim().toLowerCase();
  const users=db.users.filter(u=>!q || u.username.toLowerCase().includes(q)||(u.displayName||'').toLowerCase().includes(q));
  res.json({users:users.slice(0,100).map(safeUser)});
});

app.post('/api/users/:id/mute',auth,(req,res)=>{
  const me=current(req), target=findUser(req.params.id); if(!target) return res.status(404).json({error:'User not found'});
  ensureUserSchema(me); if(!me.mutedUsers.includes(target.id)) me.mutedUsers.push(target.id); save(); res.json({ok:true});
});
app.delete('/api/users/:id/mute',auth,(req,res)=>{
  const me=current(req); ensureUserSchema(me); me.mutedUsers=me.mutedUsers.filter(x=>x!==req.params.id); save(); res.json({ok:true});
});

app.get('/api/notifications/preferences',auth,(req,res)=>res.json({preferences:current(req).settings?.notificationPrefs||{}}));
app.put('/api/notifications/preferences',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u); u.settings.notificationPrefs={...u.settings.notificationPrefs,...(req.body||{})}; save(); res.json({preferences:u.settings.notificationPrefs});
});

app.get('/api/analytics/overview',ownerOnly,(req,res)=>{
  const now=Date.now(), day=86400000;
  res.json({
    users:db.users.length, online:db.users.filter(u=>u.online).length, rooms:db.rooms.length,
    messages:db.messages.length, privateMessages:db.privateMessages.length,
    reports:db.reports.length, notifications:db.notifications.length,
    active24h:db.users.filter(u=>now-(u.lastSeen||0)<day).length,
    storageBytes:db.messages.reduce((n,m)=>n+Buffer.byteLength(JSON.stringify(m)),0)
  });
});

app.get('/api/owner/features',ownerOnly,(req,res)=>res.json({features:FEATURE_CONTROLS,total:FEATURE_CONTROLS.length}));


// ==================== MALeficent Chat 3.0 COMMUNITY SYSTEMS ====================
function notifyAll(type,title,text){ for(const u of db.users||[]) notify(u.id,type,title,text); }
function arr(key){ db[key] ||= []; return db[key]; }
function userStats(u){
  ensureUserSchema(u);
  const sent=Number(u.badgesStats?.giftsSent||0), received=Number(u.badgesStats?.giftsReceived||0);
  const friends=db.friends.filter(f=>f.status==='ACCEPTED'&&(f.a===u.id||f.b===u.id)).length;
  const ach=(u.achievements||[]).length;
  const msgs=Number(u.stats?.messages||0);
  const games=Number(u.gameStats?.played||0);
  return {messages:msgs,rooms:Number(u.stats?.rooms||0),friends,achievements:ach,gamesPlayed:games,gamesWon:Number(u.gameStats?.wins||0),giftsSent:sent,giftsReceived:received,xp:Number(u.xp||0),level:Number(u.level||1),gold:Number(u.gold||0),createdAt:u.createdAt,lastSeen:u.lastSeen};
}

app.get('/api/community/stats',auth,(req,res)=>{
  const u=current(req); const s=userStats(u); const day=86400000, now=Date.now();
  const recent=db.messages.filter(m=>now-(m.time||0)<day).length;
  res.json({me:s,community:{users:db.users.length,rooms:db.rooms.length,messages24h:recent,events:arr('events').filter(e=>!e.endsAt||e.endsAt>now).length}});
});

app.get('/api/community/trending',auth,(req,res)=>{
  const now=Date.now(), week=7*86400000;
  const msgCounts={}; db.messages.filter(m=>now-(m.time||0)<week&&!m.deleted).forEach(m=>{const k=m.roomId||'main';msgCounts[k]=(msgCounts[k]||0)+1;});
  const rooms=db.rooms.map(r=>({...r,activity:msgCounts[r.id]||0,online:db.users.filter(u=>u.online&&u.currentRoom===r.id).length})).sort((a,b)=>b.activity-a.activity).slice(0,8);
  const news=(db.news||[]).map(n=>({...n,score:Number(n.likes||0)*3+Number(n.comments?.length||0)})).sort((a,b)=>b.score-a.score).slice(0,8);
  const people=db.users.map(u=>({id:u.id,username:u.username,displayName:u.displayName,rank:u.rank,profileLikes:u.profileLikes||0,level:u.level||1})).sort((a,b)=>(b.profileLikes-b.profileLikes)+(b.profileLikes||0)-(a.profileLikes||0)).slice(0,8);
  res.json({rooms,news,people});
});

app.get('/api/community/events',auth,(req,res)=>res.json({events:arr('events').sort((a,b)=>a.startsAt-b.startsAt)}));
app.post('/api/community/events',auth,(req,res)=>{
  const u=current(req); if(!hasFeature(u,'publish_news')&&!hasRank(u,'ADMIN')) return res.status(403).json({error:'ADMIN or higher required.'});
  const title=cleanText(req.body.title||'').slice(0,100), description=cleanText(req.body.description||'').slice(0,1000); const startsAt=Number(req.body.startsAt), endsAt=Number(req.body.endsAt||0);
  if(!title||!Number.isFinite(startsAt)) return res.status(400).json({error:'Title and start time are required.'});
  const e={id:id(),title,description,startsAt,endsAt,creatorId:u.id,creator:u.username,icon:String(req.body.icon||'🗓️').slice(0,4),attendees:[],createdAt:Date.now()}; arr('events').push(e); notifyAll('event','🗓️ New event',`${title} was created.`); save(); res.status(201).json({event:e});
});
app.post('/api/community/events/:id/join',auth,(req,res)=>{const e=arr('events').find(x=>x.id===req.params.id);if(!e)return res.status(404).json({error:'Event not found'});const u=current(req);e.attendees ||= []; const i=e.attendees.indexOf(u.id); if(i>=0)e.attendees.splice(i,1);else e.attendees.push(u.id);save();res.json({joined:i<0,attendees:e.attendees.length});});

app.get('/api/community/shop',auth,(req,res)=>{arr('shop'); if(!db.shop.length) db.shop=[
  {id:'frame-midnight',name:'Midnight Frame',type:'frame',cost:250,icon:'🌙'},
  {id:'badge-shadow',name:'Shadow Badge',type:'badge',cost:500,icon:'🖤'},
  {id:'effect-spark',name:'Spark Name Effect',type:'effect',cost:750,icon:'✨'},
  {id:'theme-royal',name:'Royal Profile',type:'theme',cost:1000,icon:'👑'}
]; save(); res.json({items:db.shop,owned:current(req).cosmetics||[]});});
app.post('/api/community/shop/:id/buy',auth,(req,res)=>{const u=current(req),item=arr('shop').find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:'Item not found'});u.cosmetics ||= [];if(u.cosmetics.includes(item.id))return res.status(400).json({error:'Already owned.'});if((u.gold||0)<item.cost)return res.status(400).json({error:'Not enough gold.'});u.gold-=item.cost;u.cosmetics.push(item.id);db.goldTransactions.push({id:id(),time:Date.now(),actor:u.username,userId:u.id,type:'SHOP',delta:-item.cost,item:item.name});save();res.json({ok:true,gold:u.gold,owned:u.cosmetics});});
app.post('/api/community/shop/:id/equip',auth,(req,res)=>{const u=current(req),item=arr('shop').find(x=>x.id===req.params.id);if(!item||!(u.cosmetics||[]).includes(item.id))return res.status(400).json({error:'Item not owned.'});u.equippedCosmetics ||= {};u.equippedCosmetics[item.type]=item.id;save();res.json({ok:true,equipped:u.equippedCosmetics});});

const TITLES=[
  ['veteran','Veteran','Use Maleficent Chat for 30 days'],['chatterbox','Chatterbox','Send 1,000 messages'],['night-owl','Night Owl','Be active during late hours'],['gamer','Gamer','Play 25 games'],['generous','Generous','Send 25 gifts'],['social','Social Butterfly','Make 10 friends']
];
app.get('/api/community/titles',auth,(req,res)=>{const u=current(req);const owned=TITLES.filter(([k])=>(u.achievements||[]).some(a=>a.key.includes(k)||((k==='chatterbox')&&a.key==='chatterbox-1000')||((k==='gamer')&&a.key==='game-25'))).map(x=>x[0]);res.json({titles:TITLES.map(x=>({key:x[0],name:x[1],description:x[2],owned:owned.includes(x[0])})),featured:u.featuredTitle||null});});
app.put('/api/community/title',auth,(req,res)=>{const u=current(req),key=String(req.body.key||'');const t=TITLES.find(x=>x[0]===key);if(!t)return res.status(400).json({error:'Unknown title.'});const owned=(u.achievements||[]).some(a=>a.key.includes(key)||key==='chatterbox'&&a.key==='chatterbox-1000'||key==='gamer'&&a.key==='game-25');if(!owned)return res.status(403).json({error:'Unlock the title first.'});u.featuredTitle=key;save();res.json({ok:true,featuredTitle:key});});

app.get('/api/community/search',auth,(req,res)=>{const q=String(req.query.q||'').trim().toLowerCase().slice(0,80);if(!q)return res.json({users:[],rooms:[],messages:[],news:[]});const users=db.users.filter(u=>u.username.toLowerCase().includes(q)||(u.displayName||'').toLowerCase().includes(q)).slice(0,15).map(safeUser);const rooms=db.rooms.filter(r=>(r.name||'').toLowerCase().includes(q)||(r.description||'').toLowerCase().includes(q)).slice(0,15);const messages=db.messages.filter(m=>!m.deleted&&String(m.text||'').toLowerCase().includes(q)).slice(-25).reverse().map(m=>({id:m.id,roomId:m.roomId,username:m.username,text:m.text,time:m.time}));const news=(db.news||[]).filter(n=>String(n.title||n.text||'').toLowerCase().includes(q)).slice(0,15);res.json({users,rooms,messages,news});});

app.get('/api/community/media',auth,(req,res)=>{const rows=db.messages.filter(m=>m.attachment&&['image','audio'].some(t=>String(m.attachment.type||'').startsWith(t))).slice(-100).reverse().map(m=>({id:m.id,roomId:m.roomId,username:m.username,text:m.text,time:m.time,attachment:m.attachment}));res.json({media:rows});});

app.get('/api/community/automation',ownerOnly,(req,res)=>res.json({rules:db.automationRules||[]}));
app.post('/api/community/automation',ownerOnly,(req,res)=>{const r={id:id(),enabled:req.body.enabled!==false,condition:String(req.body.condition||'').slice(0,80),threshold:Math.max(1,Math.min(100,Number(req.body.threshold)||3)),action:String(req.body.action||'mute'),duration:Math.max(1,Math.min(10080,Number(req.body.duration)||10))};if(!['warnings','filteredMessages','reports'].includes(r.condition)||!['mute','notify'].includes(r.action))return res.status(400).json({error:'Invalid automation rule.'});arr('automationRules').push(r);save();res.json({rule:r});});
app.delete('/api/community/automation/:id',ownerOnly,(req,res)=>{db.automationRules=arr('automationRules').filter(x=>x.id!==req.params.id);save();res.json({ok:true});});

app.get('/api/community/audit',auth,(req,res)=>{const u=current(req);if(!hasRank(u,'MOD'))return res.status(403).json({error:'Staff only.'});res.json({logs:db.logs.slice(-250).reverse()});});
app.get('/api/community/backup',ownerOnly,(req,res)=>{const copy=JSON.parse(JSON.stringify(db));copy.users=(copy.users||[]).map(u=>{const x={...u};delete x.password;delete x.sessions;delete x.tokens;return x;});res.setHeader('Content-Type','application/json');res.setHeader('Content-Disposition','attachment; filename="maleficent-chat-backup.json"');res.send(JSON.stringify(copy,null,2));});

app.get('/api/diaval/profile',auth,(req,res)=>{const u=current(req);u.diaval ||= {personality:'normal',memories:[]};res.json({personality:u.diaval.personality,memories:u.diaval.memories});});
app.put('/api/diaval/profile',auth,(req,res)=>{const u=current(req);u.diaval ||= {personality:'normal',memories:[]};if(req.body.personality&&!['normal','mischievous','royal','funny','helpful'].includes(req.body.personality))return res.status(400).json({error:'Invalid personality.'});if(req.body.personality)u.diaval.personality=req.body.personality;if(Array.isArray(req.body.memories))u.diaval.memories=req.body.memories.map(x=>cleanText(x).slice(0,160)).slice(0,30);save();res.json({ok:true,diaval:u.diaval});});


/* ===================== 3.1 COMMUNITY UPGRADE ===================== */
function requireFeature(req,res,key,fallbackRank="MEMBER"){
  const u=current(req); if(!u)return false;
  if(u.username==="Maleficent"&&u.rank==="OWNER")return true;
  const required=db.featurePermissions?.[key]||fallbackRank;
  if(!hasRank(u,required)){res.status(403).json({error:"You do not have permission for this feature."});return false}
  return true;
}
app.get("/api/community/unified-search",auth,(req,res)=>{
  const u=current(req),q=String(req.query.q||"").trim().toLowerCase();
  if(!q)return res.json({users:[],rooms:[],messages:[],saved:[]});
  res.json({
    users:db.users.filter(x=>x.username.toLowerCase().includes(q)||(x.displayName||"").toLowerCase().includes(q)).slice(0,30).map(x=>({id:x.id,username:x.username,displayName:x.displayName,avatar:x.avatar,rank:x.rank,online:!!x.online})),
    rooms:db.rooms.filter(x=>[x.name,x.description,x.category].join(" ").toLowerCase().includes(q)).slice(0,30),
    messages:db.messages.filter(x=>(x.text||"").toLowerCase().includes(q)).slice(-100).reverse().slice(0,30),
    saved:(u.saved||[]).map(id=>db.messages.find(m=>m.id===id)).filter(Boolean).filter(m=>(m.text||"").toLowerCase().includes(q)).slice(0,30)
  });
});
app.get("/api/polls",auth,(req,res)=>{
  const polls=(db.polls||[]).slice().reverse().map(p=>{const votes=(db.pollVotes||[]).filter(v=>v.pollId===p.id);return {...p,counts:p.options.map((o,i)=>votes.filter(v=>v.option===i).length),total:votes.length,myVote:(votes.find(v=>v.userId===current(req).id)||{}).option}});
  res.json({polls});
});
app.post("/api/polls",auth,(req,res)=>{
  if(!requireFeature(req,res,"create_poll","MEMBER"))return;
  const q=String(req.body.question||"").trim().slice(0,240),options=Array.isArray(req.body.options)?req.body.options.map(x=>String(x).trim().slice(0,120)).filter(Boolean).slice(0,8):[];
  if(!q||options.length<2)return res.status(400).json({error:"A poll needs a question and at least two options."});
  const p={id:id(),question:q,options,creatorId:current(req).id,time:Date.now(),endsAt:req.body.endsAt?Number(req.body.endsAt):null,closed:false};db.polls.push(p);save();
  for(const u of db.users)if(u.id!==current(req).id)notify(u.id,"poll","📊 New poll",q);
  res.json({poll:p});
});
app.post("/api/polls/:id/vote",auth,(req,res)=>{
  const p=db.polls.find(x=>x.id===req.params.id),u=current(req),option=Number(req.body.option);
  if(!p)return res.status(404).json({error:"Poll not found."});
  if(p.closed||(p.endsAt&&p.endsAt<Date.now()))return res.status(400).json({error:"This poll is closed."});
  if(!Number.isInteger(option)||option<0||option>=p.options.length)return res.status(400).json({error:"Invalid option."});
  const old=db.pollVotes.find(v=>v.pollId===p.id&&v.userId===u.id);if(old)old.option=option;else db.pollVotes.push({id:id(),pollId:p.id,userId:u.id,option,time:Date.now()});save();res.json({ok:true});
});
app.patch("/api/polls/:id",auth,(req,res)=>{
  const p=db.polls.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:"Poll not found."});
  if(!requireFeature(req,res,"manage_polls","ADMIN"))return;p.closed=!!req.body.closed;save();res.json({ok:true,poll:p});
});
app.get("/api/rooms/:id/watch-queue",auth,(req,res)=>res.json({queue:db.watchQueues[req.params.id]||[]}));
app.post("/api/rooms/:id/watch-queue",auth,(req,res)=>{
  const room=db.rooms.find(r=>r.id===req.params.id),u=current(req),url=String(req.body.url||"").trim();
  if(!room)return res.status(404).json({error:"Room not found."});
  if(!/^https?:\/\//i.test(url))return res.status(400).json({error:"Enter a valid public http(s) URL."});
  db.watchQueues[room.id]||=[];if(db.watchQueues[room.id].length>=50)return res.status(400).json({error:"Queue is full."});
  db.watchQueues[room.id].push({id:id(),url,title:String(req.body.title||"Shared video").slice(0,160),addedBy:u.username,time:Date.now(),playing:false});save();res.json({queue:db.watchQueues[room.id]});
});
app.delete("/api/rooms/:id/watch-queue/:itemId",auth,(req,res)=>{
  if(!hasRank(current(req),"MOD"))return res.status(403).json({error:"Staff only."});
  db.watchQueues[req.params.id]=(db.watchQueues[req.params.id]||[]).filter(x=>x.id!==req.params.itemId);save();res.json({queue:db.watchQueues[req.params.id]});
});
app.post("/api/notifications/read-all",auth,(req,res)=>{
  const u=current(req);for(const n of db.notifications)if(n.userId===u.id)n.read=true;save();res.json({ok:true});
});
const THEME_PRESETS={obsidian:{name:"Obsidian",accent:"#00bfae",bg:"#071016",panel:"#111c23"},maleficent:{name:"Maleficent",accent:"#9b5cff",bg:"#080611",panel:"#110d1d"},rose:{name:"Rose",accent:"#ff4fd8",bg:"#100912",panel:"#1b1020"},midnight:{name:"Midnight",accent:"#5c8dff",bg:"#080d18",panel:"#111a2a"},emerald:{name:"Emerald",accent:"#20d7a1",bg:"#06110e",panel:"#0e211b"}};
app.get("/api/themes",auth,(req,res)=>res.json({presets:THEME_PRESETS,site:db.siteTheme||THEME_PRESETS.obsidian,user:current(req).settings?.customTheme||null}));
app.put("/api/themes/user",auth,(req,res)=>{const u=current(req);u.settings.customTheme={accent:String(req.body.accent||"#00bfae").slice(0,20),background:String(req.body.background||"#071016").slice(0,20),panel:String(req.body.panel||"#111c23").slice(0,20),bubble:String(req.body.bubble||"#24323a").slice(0,20)};save();res.json({theme:u.settings.customTheme})});
app.put("/api/themes/site",auth,(req,res)=>{if(!requireFeature(req,res,"manage_site_theme","OWNER"))return;db.siteTheme={name:String(req.body.name||"Site Theme").slice(0,40),accent:String(req.body.accent||"#00bfae").slice(0,20),bg:String(req.body.bg||"#071016").slice(0,20),panel:String(req.body.panel||"#111c23").slice(0,20)};save();res.json({theme:db.siteTheme})});
app.get("/api/community/daily-challenge",auth,(req,res)=>{
  const a=[["Say hello","Send one message in any room.",10,50],["Spread a reaction","React to a community message.",15,75],["Make a connection","Send a friend request.",20,100],["Play a game","Complete one game.",25,125]],c=a[Math.floor(Date.now()/86400000)%a.length];res.json({challenge:{id:c[0].toLowerCase().replace(/\W+/g,"-"),title:c[0],text:c[1],xp:c[2],gold:c[3]}});
});
app.post("/api/community/events/:id/rsvp",auth,(req,res)=>{const e=(db.events||[]).find(x=>x.id===req.params.id);if(!e)return res.status(404).json({error:"Event not found."});e.participants||=[];const u=current(req);if(!e.participants.includes(u.id))e.participants.push(u.id);save();res.json({participants:e.participants.length})});
app.post("/api/games/number-guess",auth,(req,res)=>{
  const n=Number(req.body.number);if(!Number.isInteger(n)||n<1||n>100)return res.status(400).json({error:"Choose a whole number from 1 to 100."});
  const target=(Math.floor(Date.now()/86400000)*73%100)+1,result=n===target?"win":n<target?"higher":"lower";
  if(result==="win"){const u=current(req);u.xp=(u.xp||0)+20;u.gold=(u.gold||0)+100;u.gameStats||={played:0,wins:0,losses:0,draws:0};u.gameStats.played++;u.gameStats.wins++;save();notify(u.id,"gamification","🎯 Challenge complete","+20 XP and +100 Gold.");}
  res.json({result,target:result==="win"?target:undefined,reward:result==="win"?{xp:20,gold:100}:null});
});

/* ===================== COMMUNITY LAB EXTENSIONS ===================== */
const cleanList=(v,max=20)=>Array.isArray(v)?v.map(x=>cleanText(String(x)).slice(0,300)).filter(Boolean).slice(0,max):[];
function currentActivity(u){
  db.activityTimeline[u.id] ||= [];
  return db.activityTimeline[u.id];
}
function recordActivity(u,type,text,extra={}){
  if(!u) return;
  const a=currentActivity(u);
  a.push({id:id(),type,text,time:Date.now(),...extra});
  if(a.length>200) a.splice(0,a.length-200);
}
function ensureCommunityProfile(u){
  u.community ||= {labels:[],reputation:0,collection:[],cards:[],stickers:[],guestbookEnabled:true,wallEnabled:true};
  u.reputation ||= 0;
}
for(const u of db.users) ensureCommunityProfile(u);

app.get("/api/community/blogs",auth,(req,res)=>res.json({posts:(db.blogPosts||[]).slice().reverse().map(x=>({...x,authorId:undefined}))}));
app.post("/api/community/blogs",auth,(req,res)=>{
  const u=current(req),title=cleanText(req.body.title||"").slice(0,120),body=cleanText(req.body.body||"").slice(0,5000);
  if(!title||!body)return res.status(400).json({error:"Title and body are required."});
  const p={id:id(),authorId:u.id,author:u.username,title,body,visibility:["public","private"].includes(req.body.visibility)?req.body.visibility:"public",comments:[],reactions:{},time:Date.now()};
  db.blogPosts.push(p);recordActivity(u,"blog","Published a mini blog post.",{postId:p.id});save();res.json({post:{...p,authorId:undefined}});
});
app.delete("/api/community/blogs/:id",auth,(req,res)=>{
  const u=current(req),p=db.blogPosts.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:"Post not found."});
  if(p.authorId!==u.id&&!hasRank(u,"MOD"))return res.status(403).json({error:"Not allowed."});
  db.blogPosts=db.blogPosts.filter(x=>x.id!==p.id);save();res.json({ok:true});
});
app.get("/api/community/lab/overview",auth,(req,res)=>{
  const u=current(req); ensureCommunityProfile(u);
  res.json({
    scheduled:(db.scheduledMessages||[]).filter(x=>x.userId===u.id),
    notes:Object.entries(db.userNotes||{}).filter(([k])=>k.startsWith(u.id+":")).map(([k,v])=>({...v,targetId:k.split(":")[1]})),
    labels:u.community.labels||[],
    suggestions:(db.suggestions||[]).slice(-30).reverse(),
    changelog:(db.changelog||[]).slice(-30).reverse(),
    seasons:db.seasons||[],
    museum:db.museum||[],
    cards:u.community.cards||[],
    reputation:u.community.reputation||u.reputation||0,
    collections:u.community.collection||[],
    stickers:(db.stickers||[]).filter(x=>x.ownerId===u.id||x.approved),
    soundboard:db.soundboard||[],
    roomBots:db.roomBots||{},
    lore:db.roomLore||{},
    memories:db.communityMemories||[]
  });
});

app.post("/api/community/scheduled",auth,(req,res)=>{
  const u=current(req),room=db.rooms.find(r=>r.id===String(req.body.roomId||""));
  if(!room)return res.status(400).json({error:"Room not found."});
  const text=cleanText(req.body.text||"").slice(0,4000),sendAt=Number(req.body.sendAt);
  if(!text||!Number.isFinite(sendAt)||sendAt<=Date.now())return res.status(400).json({error:"Message and a future send time are required."});
  const item={id:id(),userId:u.id,roomId:room.id,text,sendAt,createdAt:Date.now(),status:"scheduled"};
  db.scheduledMessages.push(item);save();res.json({scheduled:item});
});
app.delete("/api/community/scheduled/:id",auth,(req,res)=>{
  const u=current(req),i=db.scheduledMessages.find(x=>x.id===req.params.id&&x.userId===u.id);
  if(!i)return res.status(404).json({error:"Scheduled message not found."});
  db.scheduledMessages=db.scheduledMessages.filter(x=>x.id!==i.id);save();res.json({ok:true});
});

app.get("/api/community/bookmarks",auth,(req,res)=>{
  const u=current(req);u.bookmarkFolders ||= {General:[]};
  const rows={};for(const [folder,ids] of Object.entries(u.bookmarkFolders))rows[folder]=ids.map(x=>db.messages.find(m=>m.id===x)).filter(Boolean);
  res.json({folders:rows});
});
app.put("/api/community/bookmarks/folder",auth,(req,res)=>{
  const u=current(req),name=cleanText(req.body.name||"").slice(0,40);
  if(!name)return res.status(400).json({error:"Folder name required."});
  u.bookmarkFolders ||= {General:[]};u.bookmarkFolders[name] ||= [];save();res.json({folders:Object.keys(u.bookmarkFolders)});
});
app.post("/api/community/bookmarks",auth,(req,res)=>{
  const u=current(req),folder=cleanText(req.body.folder||"General").slice(0,40),messageId=String(req.body.messageId||"");
  if(!db.messages.some(m=>m.id===messageId))return res.status(404).json({error:"Message not found."});
  u.bookmarkFolders ||= {General:[]};u.bookmarkFolders[folder] ||= [];
  if(!u.bookmarkFolders[folder].includes(messageId))u.bookmarkFolders[folder].push(messageId);
  save();res.json({ok:true});
});

app.get("/api/messages/:id/thread",auth,(req,res)=>{
  const root=db.messages.find(m=>m.id===req.params.id);if(!root)return res.status(404).json({error:"Message not found."});
  res.json({root,replies:db.messages.filter(m=>m.threadId===root.id&&!m.deleted).slice(-100)});
});
app.post("/api/messages/:id/thread",auth,(req,res)=>{
  const root=db.messages.find(m=>m.id===req.params.id),u=current(req),text=cleanText(req.body.text||"").slice(0,4000);
  if(!root||!text)return res.status(400).json({error:"Message and thread reply are required."});
  const m={id:id(),roomId:root.roomId,userId:u.id,username:u.username,displayName:u.displayName,rank:u.rank,text,threadId:root.id,time:Date.now(),reactions:{},deleted:false,pinned:false};
  db.messages.push(m);recordActivity(u,"thread","Replied in a message thread.",{messageId:root.id});save();io.to("room:"+root.roomId).emit("message",m);res.json({message:m});
});

app.get("/api/community/notes/:userId",auth,(req,res)=>{
  const u=current(req),key=u.id+":"+req.params.userId;res.json({note:db.userNotes[key]||null});
});
app.put("/api/community/notes/:userId",auth,(req,res)=>{
  const u=current(req),key=u.id+":"+req.params.userId,text=cleanText(req.body.text||"").slice(0,1000);
  if(text)db.userNotes[key]={text,updatedAt:Date.now()};else delete db.userNotes[key];save();res.json({note:db.userNotes[key]||null});
});
app.put("/api/community/labels",auth,(req,res)=>{
  const u=current(req);ensureCommunityProfile(u);u.community.labels=cleanList(req.body.labels,8);save();res.json({labels:u.community.labels});
});

app.get("/api/users/:id/guestbook",auth,(req,res)=>{
  const target=db.users.find(x=>x.id===req.params.id);if(!target)return res.status(404).json({error:"User not found."});
  res.json({enabled:target.community?.guestbookEnabled!==false,entries:db.profileGuestbooks[req.params.id]||[]});
});
app.post("/api/users/:id/guestbook",auth,(req,res)=>{
  const u=current(req),target=db.users.find(x=>x.id===req.params.id),text=cleanText(req.body.text||"").slice(0,500);
  if(!target||!text)return res.status(400).json({error:"Invalid guestbook entry."});
  if(target.community?.guestbookEnabled===false)return res.status(403).json({error:"Guestbook disabled."});
  db.profileGuestbooks[target.id] ||= [];db.profileGuestbooks[target.id].push({id:id(),userId:u.id,username:u.username,text,time:Date.now()});
  db.profileGuestbooks[target.id]=db.profileGuestbooks[target.id].slice(-100);save();res.json({ok:true});
});
app.delete("/api/users/:id/guestbook/:entryId",auth,(req,res)=>{
  const u=current(req);if(u.id!==req.params.id&&!hasRank(u,"MOD"))return res.status(403).json({error:"Not allowed."});
  db.profileGuestbooks[req.params.id]=(db.profileGuestbooks[req.params.id]||[]).filter(x=>x.id!==req.params.entryId);save();res.json({ok:true});
});

app.get("/api/users/:id/activity",auth,(req,res)=>res.json({activity:(db.activityTimeline[req.params.id]||[]).slice().reverse()}));
app.get("/api/community/wall/:userId",auth,(req,res)=>res.json({posts:(db.profileWalls[req.params.userId]||[]).slice().reverse()}));
app.post("/api/community/wall/:userId",auth,(req,res)=>{
  const u=current(req),target=db.users.find(x=>x.id===req.params.userId),text=cleanText(req.body.text||"").slice(0,1000);
  if(!target||!text)return res.status(400).json({error:"Invalid wall post."});
  db.profileWalls[target.id] ||= [];db.profileWalls[target.id].push({id:id(),userId:u.id,username:u.username,text,time:Date.now()});db.profileWalls[target.id]=db.profileWalls[target.id].slice(-100);save();res.json({ok:true});
});

app.post("/api/community/suggestions",auth,(req,res)=>{
  const u=current(req),title=cleanText(req.body.title||"").slice(0,100),text=cleanText(req.body.text||"").slice(0,1000);
  if(!title||!text)return res.status(400).json({error:"Title and description required."});
  const s={id:id(),title,text,authorId:u.id,author:u.username,anonymous:!!req.body.anonymous,status:"Received",votes:0,time:Date.now()};
  db.suggestions.push(s);save();notifyStaff("suggestion","New suggestion",title);res.json({suggestion:s});
});
app.get("/api/community/suggestions",auth,(req,res)=>res.json({suggestions:(db.suggestions||[]).slice().reverse()}));
app.post("/api/community/suggestions/:id/vote",auth,(req,res)=>{
  const u=current(req),s=db.suggestions.find(x=>x.id===req.params.id);if(!s)return res.status(404).json({error:"Suggestion not found."});
  db.suggestionVotes ||= [];const old=db.suggestionVotes.find(x=>x.suggestionId===s.id&&x.userId===u.id);
  if(old)db.suggestionVotes=db.suggestionVotes.filter(x=>x!==old);else db.suggestionVotes.push({suggestionId:s.id,userId:u.id});
  s.votes=db.suggestionVotes.filter(x=>x.suggestionId===s.id).length;save();res.json({votes:s.votes,voted:!old});
});
app.patch("/api/community/suggestions/:id",auth,(req,res)=>{
  const u=current(req),s=db.suggestions.find(x=>x.id===req.params.id);if(!s||!hasRank(u,"ADMIN"))return res.status(403).json({error:"Admin required."});
  if(["Received","Reviewing","Implemented","Declined"].includes(req.body.status))s.status=req.body.status;save();res.json({suggestion:s});
});

app.get("/api/community/changelog",auth,(req,res)=>res.json({entries:(db.changelog||[]).slice().reverse()}));
app.post("/api/community/changelog",auth,(req,res)=>{
  const u=current(req);if(!hasRank(u,"ADMIN"))return res.status(403).json({error:"Admin required."});
  const e={id:id(),version:cleanText(req.body.version||"").slice(0,30),title:cleanText(req.body.title||"").slice(0,100),details:cleanList(req.body.details,20),time:Date.now(),author:u.username};
  if(!e.version||!e.title)return res.status(400).json({error:"Version and title required."});db.changelog.push(e);save();res.json({entry:e});
});

app.get("/api/community/reputation/:userId",auth,(req,res)=>{
  const u=db.users.find(x=>x.id===req.params.userId);if(!u)return res.status(404).json({error:"User not found."});
  res.json({reputation:u.reputation||u.community?.reputation||0});
});
app.post("/api/community/reputation/:userId",auth,(req,res)=>{
  const actor=current(req),target=db.users.find(x=>x.id===req.params.userId),delta=Math.max(-10,Math.min(10,Number(req.body.delta)||0));
  if(!target||!delta||target.id===actor.id)return res.status(400).json({error:"Invalid reputation action."});
  target.reputation=(target.reputation||0)+delta;target.community ||= {};target.community.reputation=target.reputation;save();res.json({reputation:target.reputation});
});

app.get("/api/community/collections",auth,(req,res)=>{
  const u=current(req);ensureCommunityProfile(u);
  res.json({items:u.community.collection||[],cards:u.community.cards||[]});
});
app.post("/api/community/collections/claim",auth,(req,res)=>{
  const u=current(req),item=cleanText(req.body.item||"").slice(0,80);if(!item)return res.status(400).json({error:"Item required."});
  ensureCommunityProfile(u);if(!u.community.collection.includes(item))u.community.collection.push(item);save();res.json({items:u.community.collection});
});
app.get("/api/community/cards",auth,(req,res)=>res.json({cards:db.tradingCards||[]}));
app.post("/api/community/cards",auth,(req,res)=>{
  const u=current(req);if(!hasRank(u,"ADMIN"))return res.status(403).json({error:"Admin required."});
  const c={id:id(),name:cleanText(req.body.name||"").slice(0,80),description:cleanText(req.body.description||"").slice(0,300),icon:String(req.body.icon||"🃏").slice(0,4),time:Date.now()};
  if(!c.name)return res.status(400).json({error:"Card name required."});db.tradingCards.push(c);save();res.json({card:c});
});

app.get("/api/community/stickers",auth,(req,res)=>res.json({stickers:db.stickers||[]}));
app.post("/api/community/stickers",auth,(req,res)=>{
  const u=current(req),name=cleanText(req.body.name||"").slice(0,60),url=String(req.body.url||"").slice(0,500);
  if(!name||!/^https?:\/\/|^\/uploads\//i.test(url))return res.status(400).json({error:"Sticker name and image URL required."});
  const s={id:id(),name,url,ownerId:u.id,owner:u.username,approved:hasRank(u,"ADMIN"),time:Date.now()};db.stickers.push(s);save();res.json({sticker:s});
});
app.get("/api/community/soundboard",auth,(req,res)=>res.json({sounds:db.soundboard||[]}));
app.post("/api/community/soundboard",auth,(req,res)=>{
  const u=current(req);const name=cleanText(req.body.name||"").slice(0,50),url=String(req.body.url||"").slice(0,500);
  if(!name||!/^https?:\/\/|^\/uploads\//i.test(url))return res.status(400).json({error:"Sound name and URL required."});
  const s={id:id(),name,url,creator:u.username,time:Date.now()};db.soundboard.push(s);save();res.json({sound:s});
});

app.get("/api/community/room/:roomId/bot",auth,(req,res)=>res.json({bot:db.roomBots[req.params.roomId]||null}));
app.put("/api/community/room/:roomId/bot",auth,(req,res)=>{
  const u=current(req);if(!hasRank(u,"ADMIN"))return res.status(403).json({error:"Admin required."});
  const room=db.rooms.find(x=>x.id===req.params.roomId);if(!room)return res.status(404).json({error:"Room not found."});
  db.roomBots[room.id]={enabled:req.body.enabled!==false,name:cleanText(req.body.name||"Room Bot").slice(0,40),welcome:cleanText(req.body.welcome||"Welcome!").slice(0,500),triggers:cleanList(req.body.triggers,20)};save();res.json({bot:db.roomBots[room.id]});
});
app.get("/api/community/room/:roomId/lore",auth,(req,res)=>res.json({lore:db.roomLore[req.params.roomId]||null}));
app.put("/api/community/room/:roomId/lore",auth,(req,res)=>{
  const u=current(req);if(!hasRank(u,"ADMIN"))return res.status(403).json({error:"Admin required."});
  db.roomLore[req.params.roomId]={title:cleanText(req.body.title||"").slice(0,100),history:cleanText(req.body.history||"").slice(0,3000),founders:cleanList(req.body.founders,20)};save();res.json({lore:db.roomLore[req.params.roomId]});
});

app.get("/api/community/time-machine/:roomId",auth,(req,res)=>{
  const from=Number(req.query.from||0),to=Number(req.query.to||Date.now());
  const messages=db.messages.filter(m=>m.roomId===req.params.roomId&&m.time>=from&&m.time<=to&&!m.deleted).slice(-500);
  res.json({messages});
});
app.get("/api/community/memories",auth,(req,res)=>res.json({memories:(db.communityMemories||[]).slice().reverse()}));
app.post("/api/community/memories",auth,(req,res)=>{
  const u=current(req);if(!hasRank(u,"ADMIN"))return res.status(403).json({error:"Admin required."});
  const m={id:id(),title:cleanText(req.body.title||"").slice(0,100),text:cleanText(req.body.text||"").slice(0,2000),time:Date.now(),author:u.username};db.communityMemories.push(m);save();res.json({memory:m});
});
app.get("/api/community/season",auth,(req,res)=>res.json({seasons:db.seasons||[]}));
app.post("/api/community/season",auth,(req,res)=>{
  const u=current(req);if(!hasRank(u,"OWNER"))return res.status(403).json({error:"Owner required."});
  const s={id:id(),name:cleanText(req.body.name||"").slice(0,80),theme:cleanText(req.body.theme||"").slice(0,80),startsAt:Number(req.body.startsAt)||Date.now(),endsAt:Number(req.body.endsAt)||Date.now()+90*86400000,active:req.body.active!==false};db.seasons.push(s);save();res.json({season:s});
});
app.get("/api/community/museum",auth,(req,res)=>res.json({items:db.museum||[]}));
app.post("/api/community/museum",auth,(req,res)=>{
  const u=current(req);if(!hasRank(u,"ADMIN"))return res.status(403).json({error:"Admin required."});
  const x={id:id(),title:cleanText(req.body.title||"").slice(0,100),description:cleanText(req.body.description||"").slice(0,1000),time:Date.now(),author:u.username};db.museum.push(x);save();res.json({item:x});
});
app.get("/api/community/quizzes",auth,(req,res)=>res.json({quizzes:(db.quizzes||[]).map(q=>({...q,answers:undefined}))}));
app.post("/api/community/quizzes",auth,(req,res)=>{
  const u=current(req);const q=cleanText(req.body.question||"").slice(0,300),options=cleanList(req.body.options,6),answer=Math.max(0,Number(req.body.answer)||0);
  if(!q||options.length<2||answer>=options.length)return res.status(400).json({error:"Invalid quiz."});
  const item={id:id(),question:q,options,answer,creator:u.username,time:Date.now()};db.quizzes.push(item);save();res.json({quiz:{...item,answer:undefined}});
});
app.post("/api/community/quizzes/:id/answer",auth,(req,res)=>{
  const q=db.quizzes.find(x=>x.id===req.params.id),a=Number(req.body.answer);if(!q||a<0||a>=q.options.length)return res.status(400).json({error:"Invalid answer."});
  const correct=a===q.answer;db.quizAttempts.push({id:id(),quizId:q.id,userId:current(req).id,correct,time:Date.now()});if(correct){const u=current(req);u.xp=(u.xp||0)+10;u.gold=(u.gold||0)+25;}save();res.json({correct,reward:correct?{xp:10,gold:25}:null});
});

app.get("/api/community/welcome",auth,(req,res)=>{
  const u=current(req);u.welcomeSeen ||= false;save();res.json({seen:u.welcomeSeen});
});
app.post("/api/community/welcome",auth,(req,res)=>{const u=current(req);u.welcomeSeen=true;save();res.json({ok:true});});

const communityInterval=setInterval(()=>{
  let changed=false,now=Date.now();
  for(const m of db.messages){
    if(m.expiresAt&&m.expiresAt<=now&&!m.deleted){
      m.deleted=true;m.text="This message expired.";changed=true;io.to("room:"+m.roomId).emit("message:update",m);
    }
  }
  for(const item of db.scheduledMessages||[]){
    if(item.status==="scheduled"&&item.sendAt<=now){
      const u=db.users.find(x=>x.id===item.userId),r=db.rooms.find(x=>x.id===item.roomId);
      if(u&&r){
        const m={id:id(),roomId:r.id,userId:u.id,username:u.username,displayName:u.displayName,rank:u.rank,text:item.text,reactions:{},deleted:false,pinned:false,time:now,scheduled:true};
        db.messages.push(m);io.to("room:"+r.id).emit("message",m);
      }
      item.status="sent";item.sentAt=now;changed=true;
    }
  }
  if(changed)save();
},5000);
communityInterval.unref?.();


app.get(
  "*",
  (req,res)=>
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    )
);

server.listen(
  PORT,
  ()=>console.log(
    "Maleficent Chat listening on "+
    PORT
  )
);
