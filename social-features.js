const crypto=require("crypto");
const multer=require("multer");
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:1}});
const CATEGORIES=["Love & Crushes","Heartbreak","Secrets","Rants","Friendships","Random Thoughts"];
const REACTIONS=["❤️","🥀","😭","👀","🖤"];
async function initSocialFeatureTables(pool){
  await pool.query("CREATE TABLE IF NOT EXISTS social_scrapbooks(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,title VARCHAR(100) NOT NULL DEFAULT 'My Scrapbook',theme VARCHAR(40) NOT NULL DEFAULT 'midnight',layout VARCHAR(24) NOT NULL DEFAULT 'polaroid',visibility VARCHAR(16) NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','friends','private')),allow_comments BOOLEAN NOT NULL DEFAULT true,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS social_scrapbook_entries(id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,entry_type VARCHAR(16) NOT NULL CHECK(entry_type IN ('note','media','sticker')),title VARCHAR(120) NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',media_key TEXT,sticker VARCHAR(80),visibility VARCHAR(16) NOT NULL DEFAULT 'inherit' CHECK(visibility IN ('inherit','public','friends','private')),pinned BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS social_scrapbook_entries_owner_time_idx ON social_scrapbook_entries(user_id,created_at DESC)");
  await pool.query("CREATE TABLE IF NOT EXISTS social_scrapbook_reactions(entry_id BIGINT NOT NULL REFERENCES social_scrapbook_entries(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,emoji VARCHAR(12) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(entry_id,user_id,emoji))");
  await pool.query("CREATE TABLE IF NOT EXISTS social_scrapbook_comments(id BIGSERIAL PRIMARY KEY,entry_id BIGINT NOT NULL REFERENCES social_scrapbook_entries(id) ON DELETE CASCADE,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,body VARCHAR(1000) NOT NULL,status VARCHAR(12) NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS social_confessions(id UUID PRIMARY KEY,category VARCHAR(40) NOT NULL,body VARCHAR(2000) NOT NULL,content_warning VARCHAR(160) NOT NULL DEFAULT '',status VARCHAR(12) NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden','removed')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS social_confessions_feed_idx ON social_confessions(status,created_at DESC)");
  await pool.query("CREATE TABLE IF NOT EXISTS social_confession_identities(confession_id UUID PRIMARY KEY REFERENCES social_confessions(id) ON DELETE CASCADE,sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS social_confession_identity_sender_idx ON social_confession_identities(sender_user_id,submitted_at DESC)");
  await pool.query("CREATE TABLE IF NOT EXISTS social_confession_reactions(confession_id UUID NOT NULL REFERENCES social_confessions(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,emoji VARCHAR(12) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(confession_id,user_id,emoji))");
  await pool.query("CREATE TABLE IF NOT EXISTS social_confession_comments(id BIGSERIAL PRIMARY KEY,confession_id UUID NOT NULL REFERENCES social_confessions(id) ON DELETE CASCADE,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,body VARCHAR(1000) NOT NULL,status VARCHAR(12) NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS social_confession_reports(id BIGSERIAL PRIMARY KEY,confession_id UUID NOT NULL REFERENCES social_confessions(id) ON DELETE CASCADE,reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,reason VARCHAR(500) NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','removed','dismissed')),reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,reviewed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS social_confession_reports_status_idx ON social_confession_reports(status,created_at DESC)");
  await pool.query("CREATE TABLE IF NOT EXISTS personal_media_vault(id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,media_url TEXT NOT NULL,title VARCHAR(140) NOT NULL DEFAULT '',media_type VARCHAR(16) NOT NULL CHECK(media_type IN ('image','video','gif','link')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,media_url))");
  await pool.query("CREATE INDEX IF NOT EXISTS personal_media_vault_owner_time_idx ON personal_media_vault(user_id,created_at DESC)");
  await pool.query("CREATE TABLE IF NOT EXISTS social_confession_audit_logs(id BIGSERIAL PRIMARY KEY,confession_id UUID NOT NULL REFERENCES social_confessions(id) ON DELETE CASCADE,actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,action VARCHAR(40) NOT NULL,reason VARCHAR(500) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}
function registerSocialFeatureRoutes({app,auth,current,pool,storeMediaBuffer,hasFeature,getState}){
  const who=req=>current(req),clean=(v,n)=>String(v??"").trim().slice(0,n),int=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
  const senior=u=>["OWNER","DEVELOPER"].includes(String(u?.rank||"").toUpperCase());
  const moderate=u=>senior(u)||(typeof hasFeature==="function"&&hasFeature(u,"moderate_user"));
  const ensureBook=async id=>{await pool.query("INSERT INTO social_scrapbooks(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[id]);return (await pool.query("SELECT * FROM social_scrapbooks WHERE user_id=$1",[id])).rows[0];};
  const canView=async(req,id,visibility)=>{
    const u=who(req);if(String(u.id)===String(id))return true;if(visibility==="private")return false;if(visibility==="public")return true;
    const friends=getState?.()?.friends||[];
    return friends.some(f=>String(f.status||"").toUpperCase()==="ACCEPTED"&&
      ((String(f.a)===String(u.id)&&String(f.b)===String(id))||(String(f.b)===String(u.id)&&String(f.a)===String(id))));
  };
  const canViewEntry=async(req,entryId)=>{
    const q=await pool.query("SELECT e.user_id,e.visibility,s.visibility AS book_visibility FROM social_scrapbook_entries e JOIN social_scrapbooks s ON s.user_id=e.user_id WHERE e.id=$1",[entryId]);
    if(!q.rowCount)return false;
    const row=q.rows[0];if(String(who(req).id)===String(row.user_id))return true;
    return canView(req,row.user_id,row.visibility==="inherit"?row.book_visibility:row.visibility);
  };
  app.get("/api/social/scrapbooks/:userId",auth,async(req,res)=>{
    const id=int(req.params.userId);if(!id)return res.status(400).json({error:"Invalid profile."});
    const owner=await pool.query("SELECT id,username,profile_data FROM users WHERE id=$1",[id]);if(!owner.rowCount)return res.status(404).json({error:"Profile not found."});
    const book=await ensureBook(id);const profileData=owner.rows[0].profile_data||{};if(String(who(req).id)!==String(id)&&profileData.privacy?.showScrapbook===false)return res.status(403).json({error:"This scrapbook is hidden."});if(!await canView(req,id,book.visibility))return res.status(403).json({error:"This scrapbook is private."});
    const isOwner=String(who(req).id)===String(id);
    const entries=await pool.query("SELECT e.id,e.entry_type,e.title,e.body,e.media_key,e.sticker,e.visibility,e.pinned,e.created_at,(SELECT COUNT(*)::int FROM social_scrapbook_reactions r WHERE r.entry_id=e.id) AS reaction_count,(SELECT COUNT(*)::int FROM social_scrapbook_comments c WHERE c.entry_id=e.id AND c.status='visible') AS comment_count FROM social_scrapbook_entries e WHERE e.user_id=$1 AND ($3=true OR e.visibility='inherit' OR e.visibility=$2) ORDER BY e.pinned DESC,e.created_at DESC LIMIT 100",[id,book.visibility,isOwner]);
    res.json({owner:owner.rows[0],scrapbook:{title:book.title,theme:book.theme,layout:book.layout,visibility:book.visibility,allowComments:book.allow_comments},entries:entries.rows});
  });
  app.put("/api/social/scrapbooks/settings",auth,async(req,res)=>{
    const u=who(req),b=req.body||{},visibility=["public","friends","private"].includes(b.visibility)?b.visibility:"public",theme=["midnight","violet","rose","paper","forest"].includes(b.theme)?b.theme:"midnight",layout=["polaroid","journal","collage","timeline","minimal"].includes(b.layout)?b.layout:"polaroid";
    await pool.query("INSERT INTO social_scrapbooks(user_id,title,theme,layout,visibility,allow_comments) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET title=EXCLUDED.title,theme=EXCLUDED.theme,layout=EXCLUDED.layout,visibility=EXCLUDED.visibility,allow_comments=EXCLUDED.allow_comments,updated_at=NOW()",[Number(u.id),clean(b.title,100)||"My Scrapbook",theme,layout,visibility,b.allowComments!==false]);
    res.json({ok:true});
  });
  app.post("/api/social/scrapbooks/entries",auth,async(req,res)=>{
    const u=who(req),b=req.body||{},type=b.type==="sticker"?"sticker":"note",body=clean(b.body,4000),sticker=clean(b.sticker,80);
    if(type==="note"&&!body)return res.status(400).json({error:"Write something before saving."});if(type==="sticker"&&!sticker)return res.status(400).json({error:"Choose a sticker."});
    const vis=["inherit","public","friends","private"].includes(b.visibility)?b.visibility:"inherit";
    const r=await pool.query("INSERT INTO social_scrapbook_entries(user_id,entry_type,title,body,sticker,visibility) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,entry_type,title,body,sticker,visibility,pinned,created_at",[Number(u.id),type,clean(b.title,120),body,sticker,vis]);res.status(201).json({entry:r.rows[0]});
  });
  app.post("/api/social/scrapbooks/media",auth,upload.single("file"),async(req,res)=>{
    const u=who(req),f=req.file;if(!f)return res.status(400).json({error:"Choose a photo or video."});
    if(!/^image\/(jpeg|png|gif|webp|avif)$|^video\/(mp4|webm|quicktime)$/i.test(f.mimetype))return res.status(415).json({error:"Unsupported photo or video format."});
    const key="scrapbooks/"+Number(u.id)+"/"+crypto.randomUUID()+"-"+clean(f.originalname,80).replace(/[^a-zA-Z0-9._-]/g,"_");
    await storeMediaBuffer(key,f.buffer,f.mimetype,f.originalname);
    const r=await pool.query("INSERT INTO social_scrapbook_entries(user_id,entry_type,title,body,media_key,visibility) VALUES($1,'media',$2,$3,$4,'inherit') RETURNING id,entry_type,title,body,media_key,visibility,pinned,created_at",[Number(u.id),clean(req.body?.title,120),clean(req.body?.caption,1000),key]);
    res.status(201).json({entry:r.rows[0],url:"/uploads/"+key});
  });
  app.delete("/api/social/scrapbooks/entries/:id",auth,async(req,res)=>{const id=int(req.params.id);if(!id)return res.status(400).json({error:"Invalid entry."});const r=await pool.query("DELETE FROM social_scrapbook_entries WHERE id=$1 AND user_id=$2 RETURNING id",[id,Number(who(req).id)]);if(!r.rowCount)return res.status(404).json({error:"Entry not found."});res.json({ok:true});});
  app.post("/api/social/scrapbooks/entries/:id/reactions",auth,async(req,res)=>{const id=int(req.params.id),emoji=clean(req.body?.emoji,12);if(!id||!REACTIONS.includes(emoji))return res.status(400).json({error:"Invalid reaction."});const u=who(req);if(!await canViewEntry(req,id))return res.status(404).json({error:"Entry not found."});const d=await pool.query("DELETE FROM social_scrapbook_reactions WHERE entry_id=$1 AND user_id=$2 AND emoji=$3 RETURNING entry_id",[id,Number(u.id),emoji]);if(!d.rowCount)await pool.query("INSERT INTO social_scrapbook_reactions(entry_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[id,Number(u.id),emoji]);res.json({ok:true,reacted:!d.rowCount});});
  app.post("/api/social/scrapbooks/entries/:id/comments",auth,async(req,res)=>{const id=int(req.params.id),body=clean(req.body?.body,1000),u=who(req);if(!id||!body)return res.status(400).json({error:"Write a comment first."});if(!await canViewEntry(req,id))return res.status(404).json({error:"Entry not found."});const e=await pool.query("SELECT e.user_id,s.allow_comments FROM social_scrapbook_entries e JOIN social_scrapbooks s ON s.user_id=e.user_id WHERE e.id=$1",[id]);if(!e.rowCount)return res.status(404).json({error:"Entry not found."});if(!e.rows[0].allow_comments&&String(e.rows[0].user_id)!==String(u.id))return res.status(403).json({error:"Comments are disabled."});const r=await pool.query("INSERT INTO social_scrapbook_comments(entry_id,user_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at",[id,Number(u.id),body]);res.status(201).json({comment:{...r.rows[0],author:"Member"}});});
  app.get("/api/social/scrapbooks/entries/:id/comments",auth,async(req,res)=>{const id=int(req.params.id);if(!id)return res.status(400).json({error:"Invalid entry."});if(!await canViewEntry(req,id))return res.status(404).json({error:"Entry not found."});const r=await pool.query("SELECT id,body,created_at FROM social_scrapbook_comments WHERE entry_id=$1 AND status='visible' ORDER BY created_at LIMIT 100",[id]);res.json({comments:r.rows.map(x=>({...x,author:"Member"}))});});

  app.get("/api/confessions",auth,async(req,res)=>{
    const category=CATEGORIES.includes(req.query.category)?req.query.category:null,sort=req.query.sort==="popular"?"reaction_count DESC,c.created_at DESC":"c.created_at DESC",params=[];let where="c.status='visible'";if(category){params.push(category);where+=" AND c.category=$"+params.length;}
    const sql="SELECT c.id,c.category,c.body,c.content_warning,c.created_at,(SELECT COUNT(*)::int FROM social_confession_reactions r WHERE r.confession_id=c.id) AS reaction_count,(SELECT COUNT(*)::int FROM social_confession_comments m WHERE m.confession_id=c.id AND m.status='visible') AS comment_count FROM social_confessions c WHERE "+where+" ORDER BY "+sort+" LIMIT 100";
    const r=params.length?await pool.query(sql,params):await pool.query(sql);res.json({confessions:r.rows});
  });
  app.get("/api/confessions/mine",auth,async(req,res)=>{const r=await pool.query("SELECT c.id,c.category,c.body,c.content_warning,c.status,c.created_at FROM social_confessions c JOIN social_confession_identities i ON i.confession_id=c.id WHERE i.sender_user_id=$1 ORDER BY c.created_at DESC LIMIT 100",[Number(who(req).id)]);res.json({confessions:r.rows});});
  app.post("/api/confessions",auth,async(req,res)=>{
    const u=who(req),b=req.body||{},category=clean(b.category,40),body=clean(b.body,2000),warning=clean(b.contentWarning,160);if(!CATEGORIES.includes(category))return res.status(400).json({error:"Choose a confession category."});if(body.length<3)return res.status(400).json({error:"Your confession is too short."});
    const recent=await pool.query("SELECT COUNT(*)::int AS count FROM social_confession_identities WHERE sender_user_id=$1 AND submitted_at>NOW()-INTERVAL '1 minute'",[Number(u.id)]);if(Number(recent.rows[0]?.count||0)>=3)return res.status(429).json({error:"Please wait before submitting another confession."});
    const id=crypto.randomUUID(),c=await pool.connect();try{await c.query("BEGIN");await c.query("INSERT INTO social_confessions(id,category,body,content_warning) VALUES($1,$2,$3,$4)",[id,category,body,warning]);await c.query("INSERT INTO social_confession_identities(confession_id,sender_user_id) VALUES($1,$2)",[id,Number(u.id)]);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}res.status(201).json({ok:true,id});
  });
  app.delete("/api/confessions/:id",auth,async(req,res)=>{const r=await pool.query("DELETE FROM social_confessions c USING social_confession_identities i WHERE c.id=$1 AND i.confession_id=c.id AND i.sender_user_id=$2 RETURNING c.id",[req.params.id,Number(who(req).id)]);if(!r.rowCount)return res.status(404).json({error:"Your confession was not found."});res.json({ok:true});});
  app.post("/api/confessions/:id/reactions",auth,async(req,res)=>{const emoji=clean(req.body?.emoji,12);if(!REACTIONS.includes(emoji))return res.status(400).json({error:"Invalid reaction."});const u=who(req),exists=await pool.query("SELECT id FROM social_confessions WHERE id=$1 AND status='visible'",[req.params.id]);if(!exists.rowCount)return res.status(404).json({error:"Confession not found."});const d=await pool.query("DELETE FROM social_confession_reactions WHERE confession_id=$1 AND user_id=$2 AND emoji=$3 RETURNING confession_id",[req.params.id,Number(u.id),emoji]);if(!d.rowCount)await pool.query("INSERT INTO social_confession_reactions(confession_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[req.params.id,Number(u.id),emoji]);res.json({ok:true,reacted:!d.rowCount});});
  app.get("/api/confessions/:id/comments",auth,async(req,res)=>{const r=await pool.query("SELECT id,body,created_at FROM social_confession_comments WHERE confession_id=$1 AND status='visible' ORDER BY created_at LIMIT 100",[req.params.id]);res.json({comments:r.rows.map(x=>({...x,author:"Anonymous member"}))});});
  app.post("/api/confessions/:id/comments",auth,async(req,res)=>{const body=clean(req.body?.body,1000),u=who(req);if(!body)return res.status(400).json({error:"Write a comment first."});const c=await pool.query("SELECT id FROM social_confessions WHERE id=$1 AND status='visible'",[req.params.id]);if(!c.rowCount)return res.status(404).json({error:"Confession not found."});const r=await pool.query("INSERT INTO social_confession_comments(confession_id,user_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at",[req.params.id,Number(u.id),body]);res.status(201).json({comment:{...r.rows[0],author:"Anonymous member"}});});
  app.post("/api/confessions/:id/report",auth,async(req,res)=>{const u=who(req),reason=clean(req.body?.reason,500)||"Community guidelines concern",c=await pool.query("SELECT id FROM social_confessions WHERE id=$1 AND status='visible'",[req.params.id]);if(!c.rowCount)return res.status(404).json({error:"Confession not found."});await pool.query("INSERT INTO social_confession_reports(confession_id,reporter_id,reason) VALUES($1,$2,$3)",[req.params.id,Number(u.id),reason]);res.status(201).json({ok:true});});
  app.get("/api/staff/confessions/reports",auth,async(req,res)=>{if(!moderate(who(req)))return res.status(403).json({error:"Confession moderation access is not granted."});const r=await pool.query("SELECT r.id,r.confession_id,r.reason,r.status,r.created_at,c.category,c.body FROM social_confession_reports r JOIN social_confessions c ON c.id=r.confession_id WHERE r.status='open' ORDER BY r.created_at LIMIT 100");res.json({reports:r.rows});});
  app.patch("/api/staff/confessions/:id",auth,async(req,res)=>{const u=who(req);if(!moderate(u))return res.status(403).json({error:"Confession moderation access is not granted."});const action=clean(req.body?.action,20),reason=clean(req.body?.reason,500);if(!["hide","remove","restore","dismiss"].includes(action)||reason.length<5)return res.status(400).json({error:"Choose an action and provide a reason."});const c=await pool.connect();try{await c.query("BEGIN");if(action==="hide")await c.query("UPDATE social_confessions SET status='hidden' WHERE id=$1",[req.params.id]);if(action==="remove")await c.query("UPDATE social_confessions SET status='removed' WHERE id=$1",[req.params.id]);if(action==="restore")await c.query("UPDATE social_confessions SET status='visible' WHERE id=$1",[req.params.id]);await c.query("UPDATE social_confession_reports SET status=$2,reviewed_by=$3,reviewed_at=NOW() WHERE confession_id=$1 AND status='open'",[req.params.id,action==="dismiss"?"dismissed":action==="remove"?"removed":"reviewed",Number(u.id)]);await c.query("INSERT INTO social_confession_audit_logs(confession_id,actor_id,action,reason) VALUES($1,$2,$3,$4)",[req.params.id,Number(u.id),action,reason]);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}res.json({ok:true});});
  app.get("/api/staff/confessions/:id/identity",auth,async(req,res)=>{const u=who(req);if(!senior(u))return res.status(403).json({error:"Only Owner or Developer can resolve confession identities."});const reason=clean(req.query.reason,500);if(reason.length<8)return res.status(400).json({error:"An investigation reason of at least 8 characters is required."});const r=await pool.query("SELECT i.sender_user_id,u.username,u.rank,i.submitted_at FROM social_confession_identities i JOIN users u ON u.id=i.sender_user_id WHERE i.confession_id=$1",[req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Identity not found."});await pool.query("INSERT INTO social_confession_audit_logs(confession_id,actor_id,action,reason) VALUES($1,$2,'identity_lookup',$3)",[req.params.id,Number(u.id),reason]);res.json({identity:r.rows[0]});});
  const safeVaultUrl=(raw,req)=>{
    const value=clean(raw,2048);if(!value)throw new Error("Add a media link first.");
    let url;
    if(value.startsWith("/uploads/")){
      if(!/^\/uploads\/[A-Za-z0-9._/-]+$/.test(value)||value.split("/").some(part=>part===".."||part==="."))throw new Error("Invalid media link.");
      url=value;
    }else{
      let parsed;try{parsed=new URL(value);}catch(_){throw new Error("Use a valid media link.");}
      if(parsed.protocol!=="https:")throw new Error("Only secure HTTPS links can be saved.");
      if(parsed.host===req.get("host")&&parsed.pathname.startsWith("/uploads/")){url=parsed.pathname;if(!/^\\/uploads\\/[A-Za-z0-9._/-]+$/.test(url)||url.split("/").some(part=>part===".."||part==="."))throw new Error("Invalid media link.");}
      else if(["youtube.com","www.youtube.com","youtu.be","www.youtu.be","youtube-nocookie.com","www.youtube-nocookie.com"].includes(parsed.hostname))url=parsed.toString();
      else throw new Error("For privacy, save only this site's uploaded media or YouTube links.");
    }
    const lower=url.toLowerCase();
    const type=/\.(mp4|webm|mov|ogg)(\?|$)/.test(lower)?"video":/\.(gif)(\?|$)/.test(lower)?"gif":/\.(png|jpe?g|webp|avif)(\?|$)/.test(lower)?"image":/youtu/.test(lower)?"video":"link";
    return {url,type};
  };
  app.get("/api/media-vault",auth,async(req,res)=>{
    const r=await pool.query("SELECT id,media_url,title,media_type,created_at FROM personal_media_vault WHERE user_id=$1 ORDER BY created_at DESC LIMIT 300",[Number(who(req).id)]);
    res.json({items:r.rows});
  });
  app.post("/api/media-vault",auth,async(req,res)=>{
    const u=who(req),b=req.body||{};let media;
    try{media=safeVaultUrl(b.url,req);}catch(error){return res.status(400).json({error:error.message});}
    const title=clean(b.title,140);
    const r=await pool.query("INSERT INTO personal_media_vault(user_id,media_url,title,media_type) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,media_url) DO UPDATE SET title=CASE WHEN EXCLUDED.title<>'' THEN EXCLUDED.title ELSE personal_media_vault.title END RETURNING id,media_url,title,media_type,created_at",[Number(u.id),media.url,title,media.type]);
    res.status(201).json({item:r.rows[0]});
  });
  app.delete("/api/media-vault/:id",auth,async(req,res)=>{
    const id=int(req.params.id);if(!id)return res.status(400).json({error:"Invalid vault item."});
    const r=await pool.query("DELETE FROM personal_media_vault WHERE id=$1 AND user_id=$2 RETURNING id",[id,Number(who(req).id)]);
    if(!r.rowCount)return res.status(404).json({error:"Vault item not found."});
    res.json({ok:true});
  });
}
module.exports={initSocialFeatureTables,registerSocialFeatureRoutes};
