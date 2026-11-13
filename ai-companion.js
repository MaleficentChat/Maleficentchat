"use strict";
const ELIGIBLE = new Set(["PREMIUM","MODERATOR","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","CHIEF_COMMISSOR","COOWNER","ELITE","OWNER"]);
const DEFAULT_DAILY_LIMIT = Math.max(1, Math.min(500, Number(process.env.AI_COMPANION_DAILY_TEXT_LIMIT) || 80));
const rank = user => String(user?.rank || "").toUpperCase().replace(/[\s-]+/g,"_");
const allowed = user => ELIGIBLE.has(rank(user));
const cleanAvatar = value => { const raw=String(value||"").trim().slice(0,1000); if(raw.startsWith("/uploads/")) return raw; try { const url=new URL(raw); return url.protocol==="https:"?url.href:""; } catch { return ""; } };
const safe = row => row && ({
  id:String(row.id), name:row.name, avatarUrl:row.avatar_url||"", bio:row.bio||"",
  personalityType:row.personality_type, personalityPreset:row.personality_preset||"",
  backstory:row.backstory||"", speakingStyle:row.speaking_style||"",
  likes:Array.isArray(row.likes)?row.likes:[], dislikes:Array.isArray(row.dislikes)?row.dislikes:[],
  behaviourConfig:row.behaviour_config||{}, status:row.status, isDisabled:!!row.is_disabled, disabledReason:row.disabled_reason||"",
  proactiveEnabled:!!row.proactive_enabled, quietHours:row.quiet_hours||{},
  relationship:row.relationship_stage||"stranger", progress:Number(row.progress_score||0)
});
function registerAICompanionRoutes({app,auth,current,pool}) {
  const ready = async () => {
    const r=await pool.query("SELECT to_regclass('public.ai_companions') AS name");
    return !!r.rows[0]?.name;
  };
  const guard = async (req,res,next) => {
    if(process.env.AI_COMPANION_ENABLED!=="true") return res.status(503).json({error:"AI Companions are being prepared and are not enabled yet."});
    try { if(!(await ready())) return res.status(503).json({error:"AI Companion database migration has not been applied."}); next(); }
    catch(e){ console.error("AI Companion readiness check failed:",e?.message||e); return res.status(503).json({error:"AI Companion service is unavailable."}); }
  };
  const getCompanion = async id => {
    const r=await pool.query("SELECT c.*,r.relationship_stage,r.progress_score FROM ai_companions c LEFT JOIN ai_companion_relationships r ON r.companion_id=c.id WHERE c.owner_id=$1 LIMIT 1",[Number(id)]);
    return r.rows[0]||null;
  };
  const conversation = async (client,companionId,ownerId) => {
    let r=await client.query("SELECT id FROM ai_conversations WHERE companion_id=$1 AND owner_id=$2 AND conversation_type='dedicated' ORDER BY id LIMIT 1",[companionId,ownerId]);
    if(r.rowCount) return r.rows[0].id;
    r=await client.query("INSERT INTO ai_conversations(companion_id,owner_id,conversation_type,title) VALUES($1,$2,'dedicated','Our conversations') RETURNING id",[companionId,ownerId]);
    return r.rows[0].id;
  };
  app.get("/api/ai-companion",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const c=await getCompanion(u.id); if(!c) return res.json({companion:null,messages:[],memories:[]});
    const conv=await pool.query("SELECT id FROM ai_conversations WHERE companion_id=$1 AND owner_id=$2 AND conversation_type='dedicated' ORDER BY id LIMIT 1",[c.id,u.id]);
    const msgs=conv.rowCount?await pool.query("SELECT id,sender_type,message_content,created_at FROM ai_messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 60",[conv.rows[0].id]):{rows:[]};
    const mem=await pool.query("SELECT id,memory_type,memory_content,importance,sensitivity,owner_approved,created_at FROM ai_companion_memories WHERE companion_id=$1 ORDER BY importance DESC,updated_at DESC LIMIT 100",[c.id]);
    res.json({companion:safe(c),messages:msgs.rows.reverse(),memories:mem.rows});
  });
  app.post("/api/ai-companion",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    if(await getCompanion(u.id)) return res.status(409).json({error:"Each account can have only one companion."});
    const name=String(req.body?.name||"").trim().slice(0,60); if(!name) return res.status(400).json({error:"Give your companion a name."});
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const r=await client.query("INSERT INTO ai_companions(owner_id,name,avatar_url,bio,personality_type,personality_preset,backstory,speaking_style,likes,dislikes,behaviour_config) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb) RETURNING *",[
        u.id,name,cleanAvatar(req.body?.avatarUrl),String(req.body?.bio||"").slice(0,500),req.body?.personalityType==="custom"?"custom":"preset",
        String(req.body?.personalityPreset||"gentle-anime-friend").slice(0,80),String(req.body?.backstory||"").slice(0,2500),
        String(req.body?.speakingStyle||"").slice(0,800),
        JSON.stringify(Array.isArray(req.body?.likes)?req.body.likes.slice(0,20).map(x=>String(x).slice(0,80)):[]),
        JSON.stringify(Array.isArray(req.body?.dislikes)?req.body.dislikes.slice(0,20).map(x=>String(x).slice(0,80)):[]),
        JSON.stringify(req.body?.behaviourConfig&&typeof req.body.behaviourConfig==="object"?req.body.behaviourConfig:{})
      ]);
      await client.query("INSERT INTO ai_companion_relationships(companion_id) VALUES($1)",[r.rows[0].id]);
      await conversation(client,r.rows[0].id,u.id); await client.query("COMMIT");
      res.status(201).json({companion:safe(r.rows[0])});
    } catch(e){await client.query("ROLLBACK"); if(e.code==="23505") return res.status(409).json({error:"You already have a companion."}); console.error("Companion creation failed:",e?.message||e); res.status(500).json({error:"Could not create your companion."});}
    finally{client.release();}
  });
  app.patch("/api/ai-companion",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"Create your companion first."});
    const b=req.body||{}, v=[
      String(b.name??c.name).trim().slice(0,60),b.avatarUrl===undefined?c.avatar_url:cleanAvatar(b.avatarUrl),String(b.bio??c.bio).slice(0,500),
      ["custom","preset"].includes(b.personalityType)?b.personalityType:c.personality_type,
      String(b.personalityPreset??c.personality_preset??"").slice(0,80),String(b.backstory??c.backstory).slice(0,2500),
      String(b.speakingStyle??c.speaking_style).slice(0,800),
      JSON.stringify(Array.isArray(b.likes)?b.likes.slice(0,20):c.likes),JSON.stringify(Array.isArray(b.dislikes)?b.dislikes.slice(0,20):c.dislikes),
      JSON.stringify(b.behaviourConfig&&typeof b.behaviourConfig==="object"?b.behaviourConfig:c.behaviour_config),
      b.proactiveEnabled===undefined?c.proactive_enabled:b.proactiveEnabled===true,
      JSON.stringify(b.quietHours&&typeof b.quietHours==="object"?b.quietHours:c.quiet_hours),u.id
    ];
    if(!v[0]) return res.status(400).json({error:"Companion name cannot be empty."});
    const r=await pool.query("UPDATE ai_companions SET name=$1,avatar_url=$2,bio=$3,personality_type=$4,personality_preset=$5,backstory=$6,speaking_style=$7,likes=$8::jsonb,dislikes=$9::jsonb,behaviour_config=$10::jsonb,proactive_enabled=$11,quiet_hours=$12::jsonb,updated_at=NOW() WHERE owner_id=$13 RETURNING *",v);
    res.json({companion:safe(r.rows[0])});
  });
  app.delete("/api/ai-companion",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    if(String(req.body?.confirmation||"")!=="DELETE") return res.status(400).json({error:"Confirm with DELETE to remove your companion and its data."});
    await pool.query("DELETE FROM ai_companions WHERE owner_id=$1",[u.id]); res.json({ok:true});
  });
  app.get("/api/ai-companion/memories",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"Create your companion first."});
    const r=await pool.query("SELECT id,memory_type,memory_content,importance,sensitivity,owner_approved,created_at FROM ai_companion_memories WHERE companion_id=$1 ORDER BY updated_at DESC LIMIT 100",[c.id]); res.json({memories:r.rows});
  });
  app.post("/api/ai-companion/memories",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"Create your companion first."});
    const value=String(req.body?.content||"").trim().slice(0,1000); if(!value) return res.status(400).json({error:"Memory cannot be empty."});
    const r=await pool.query("INSERT INTO ai_companion_memories(companion_id,memory_type,memory_content,importance,sensitivity,owner_approved) VALUES($1,$2,$3,$4,$5,true) RETURNING id,memory_type,memory_content,importance,sensitivity,owner_approved,created_at",[c.id,String(req.body?.type||"general").slice(0,40),value,Math.max(1,Math.min(5,Number(req.body?.importance)||3)),req.body?.sensitivity==="sensitive"?"sensitive":"ordinary"]);
    res.status(201).json({memory:r.rows[0]});
  });
  app.patch("/api/ai-companion/memories/:id",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"Create your companion first."});
    const r=await pool.query("UPDATE ai_companion_memories SET memory_content=$1,importance=$2,sensitivity=$3,updated_at=NOW() WHERE id=$4 AND companion_id=$5 RETURNING id,memory_type,memory_content,importance,sensitivity,owner_approved,created_at",[String(req.body?.content||"").trim().slice(0,1000),Math.max(1,Math.min(5,Number(req.body?.importance)||3)),req.body?.sensitivity==="sensitive"?"sensitive":"ordinary",Number(req.params.id),c.id]);
    if(!r.rowCount) return res.status(404).json({error:"Memory not found."}); res.json({memory:r.rows[0]});
  });
  app.delete("/api/ai-companion/memories/:id",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"Create your companion first."});
    const r=await pool.query("DELETE FROM ai_companion_memories WHERE id=$1 AND companion_id=$2",[Number(req.params.id),c.id]);
    if(!r.rowCount) return res.status(404).json({error:"Memory not found."}); res.json({ok:true});
  });
  app.delete("/api/ai-companion/memories",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"Create your companion first."});
    await pool.query("DELETE FROM ai_companion_memories WHERE companion_id=$1",[c.id]); res.json({ok:true});
  });
  app.delete("/api/ai-companion/history",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"Create your companion first."});
    const client=await pool.connect(); try {await client.query("BEGIN"); const id=await conversation(client,c.id,u.id); await client.query("DELETE FROM ai_messages WHERE conversation_id=$1",[id]); await client.query("COMMIT"); res.json({ok:true});}
    catch(e){await client.query("ROLLBACK"); throw e;} finally{client.release();}
  });
  app.post("/api/ai-companion/report",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"No companion to report."});
    const reason=String(req.body?.reason||"").slice(0,80), description=String(req.body?.description||"").slice(0,1500);
    if(!reason) return res.status(400).json({error:"Choose a report reason."});
    await pool.query("INSERT INTO ai_companion_reports(companion_id,reporter_user_id,reason,description) VALUES($1,$2,$3,$4)",[c.id,u.id,reason,description]); res.status(201).json({ok:true});
  });
  app.get("/api/ai-companion/staff/reports",auth,guard,async(req,res)=>{
    const u=current(req); if(!["COOWNER","ELITE","OWNER"].includes(rank(u))) return res.status(403).json({error:"Coowner or higher is required."});
    const r=await pool.query("SELECT r.id,r.reason,r.description,r.status,r.created_at,c.name AS companion_name,c.owner_id FROM ai_companion_reports r JOIN ai_companions c ON c.id=r.companion_id ORDER BY r.created_at DESC LIMIT 100"); res.json({reports:r.rows});
  });
  app.patch("/api/ai-companion/staff/reports/:id",auth,guard,async(req,res)=>{
    const u=current(req); if(!["COOWNER","ELITE","OWNER"].includes(rank(u))) return res.status(403).json({error:"Coowner or higher is required."});
    const status=String(req.body?.status||""); if(!["reviewing","resolved","dismissed"].includes(status)) return res.status(400).json({error:"Invalid report status."});
    const r=await pool.query("UPDATE ai_companion_reports SET status=$1,assigned_staff_id=$2,updated_at=NOW() WHERE id=$3 RETURNING id,status",[status,u.id,Number(req.params.id)]); if(!r.rowCount)return res.status(404).json({error:"Report not found."}); res.json({report:r.rows[0]});
  });
  app.post("/api/ai-companion/staff/:ownerId/disable",auth,guard,async(req,res)=>{
    const u=current(req); if(!["COOWNER","ELITE","OWNER"].includes(rank(u))) return res.status(403).json({error:"Coowner or higher is required."});
    const r=await pool.query("UPDATE ai_companions SET is_disabled=$1,disabled_reason=$2,disabled_by=$3,updated_at=NOW() WHERE owner_id=$4 RETURNING id,is_disabled",[req.body?.disabled!==false,String(req.body?.reason||"Staff moderation").slice(0,500),u.id,Number(req.params.ownerId)]);
    if(!r.rowCount)return res.status(404).json({error:"Companion not found."}); res.json({ok:true,isDisabled:r.rows[0].is_disabled});
  });
  app.patch("/api/ai-companion/staff/:ownerId/personality",auth,guard,async(req,res)=>{
    const u=current(req); if(!SUPERADMIN_PLUS.has(rank(u))) return res.status(403).json({error:"Super Admin or higher is required."});
    const b=req.body||{}, ownerId=Number(req.params.ownerId);
    const r=await pool.query("UPDATE ai_companions SET name=COALESCE($1,name),bio=COALESCE($2,bio),personality_type=COALESCE($3,personality_type),personality_preset=COALESCE($4,personality_preset),backstory=COALESCE($5,backstory),speaking_style=COALESCE($6,speaking_style),likes=COALESCE($7::jsonb,likes),dislikes=COALESCE($8::jsonb,dislikes),behaviour_config=COALESCE($9::jsonb,behaviour_config),updated_at=NOW() WHERE owner_id=$10 RETURNING id,name,owner_id",[b.name===undefined?null:String(b.name).slice(0,60),b.bio===undefined?null:String(b.bio).slice(0,500),["preset","custom"].includes(b.personalityType)?b.personalityType:null,b.personalityPreset===undefined?null:String(b.personalityPreset).slice(0,80),b.backstory===undefined?null:String(b.backstory).slice(0,2500),b.speakingStyle===undefined?null:String(b.speakingStyle).slice(0,800),Array.isArray(b.likes)?JSON.stringify(b.likes.slice(0,20)):null,Array.isArray(b.dislikes)?JSON.stringify(b.dislikes.slice(0,20)):null,b.behaviourConfig&&typeof b.behaviourConfig==="object"?JSON.stringify(b.behaviourConfig):null,ownerId]);
    if(!r.rowCount)return res.status(404).json({error:"Companion not found."}); res.json({companion:r.rows[0],memoriesPreserved:true,relationshipPreserved:true});
  });
  app.get("/api/ai-companion/staff/settings",auth,guard,async(req,res)=>{
    const u=current(req); if(rank(u)!=="OWNER") return res.status(403).json({error:"Owner rank only."});
    const r=await pool.query("SELECT setting_value FROM ai_settings WHERE setting_key=$1 LIMIT 1",["daily_text_limit"]);
    res.json({dailyTextLimit:Number(r.rows[0]?.setting_value?.value)||DEFAULT_DAILY_LIMIT});
  });
  app.put("/api/ai-companion/staff/settings",auth,guard,async(req,res)=>{
    const u=current(req); if(rank(u)!=="OWNER") return res.status(403).json({error:"Owner rank only."});
    const limit=Math.floor(Number(req.body?.dailyTextLimit)||0); if(limit<1||limit>500)return res.status(400).json({error:"Daily text limit must be between 1 and 500."});
    await pool.query("INSERT INTO ai_settings(setting_key,setting_value,updated_by,updated_at) VALUES($1,$2::jsonb,$3,NOW()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_by=EXCLUDED.updated_by,updated_at=NOW()",["daily_text_limit",JSON.stringify({value:limit}),u.id]); res.json({dailyTextLimit:limit});
  });
  app.post("/api/ai-companion/staff/:ownerId/create",auth,guard,async(req,res)=>{
    const actor=current(req); if(rank(actor)!=="OWNER") return res.status(403).json({error:"Owner rank only."});
    const ownerId=Number(req.params.ownerId), name=String(req.body?.name||"").trim().slice(0,60);
    if(!Number.isInteger(ownerId)||ownerId<1||!name)return res.status(400).json({error:"A valid account and companion name are required."});
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const r=await client.query("INSERT INTO ai_companions(owner_id,name,bio,personality_type,personality_preset) VALUES($1,$2,$3,$4,$5) RETURNING id,name",[ownerId,name,String(req.body?.bio||"").slice(0,500),req.body?.personalityType==="custom"?"custom":"preset",String(req.body?.personalityPreset||"gentle-anime-friend").slice(0,80)]);
      await client.query("INSERT INTO ai_companion_relationships(companion_id) VALUES($1)",[r.rows[0].id]);
      await conversation(client,r.rows[0].id,ownerId); await client.query("COMMIT"); res.status(201).json({companion:r.rows[0]});
    } catch(e) { await client.query("ROLLBACK"); if(e.code==="23505")return res.status(409).json({error:"That account already has a companion."}); throw e; }
    finally { client.release(); }
  });
  app.post("/api/ai-companion/chat",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const key=String(process.env.AI_COMPANION_API_KEY||""); if(!key) return res.status(503).json({error:"AI Companion is waiting for its dedicated provider key."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"Create your companion first."});
    if(c.is_disabled) return res.status(403).json({error:"This companion has been disabled by staff."});
    const message=String(req.body?.message||"").trim().slice(0,1200); if(!message) return res.status(400).json({error:"Write a message first."});
    const client=await pool.connect();
    try {
      await client.query("BEGIN"); const conv=await conversation(client,c.id,u.id);
      const setting=await client.query("SELECT setting_value FROM ai_settings WHERE setting_key=$1 LIMIT 1",["daily_text_limit"]);
      const dailyLimit=Math.max(1,Math.min(500,Number(setting.rows[0]?.setting_value?.value)||DEFAULT_DAILY_LIMIT));
      const quota=await client.query("INSERT INTO ai_usage_daily(companion_id,usage_date,text_units) VALUES($1,CURRENT_DATE,1) ON CONFLICT(companion_id,usage_date) DO UPDATE SET text_units=ai_usage_daily.text_units+1,updated_at=NOW() WHERE ai_usage_daily.text_units<$2 RETURNING text_units",[c.id,dailyLimit]);
      if(!quota.rowCount){await client.query("ROLLBACK");return res.status(429).json({error:"Your daily text allowance has been used."});}
      await client.query("INSERT INTO ai_messages(conversation_id,sender_type,message_content) VALUES($1,'owner',$2)",[conv,message]);
      const history=await client.query("SELECT sender_type,message_content FROM ai_messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 16",[conv]);
      const memories=await client.query("SELECT memory_content FROM ai_companion_memories WHERE companion_id=$1 AND owner_approved=true ORDER BY importance DESC,updated_at DESC LIMIT 12",[c.id]);
      const system=[
        "You are an AI companion in Maleficent Chat. Be transparent that you are AI; never claim to be human.",
        "Name: "+c.name+". Bio: "+(c.bio||"Friendly anime companion."),
        "Backstory: "+(c.backstory||"Not specified."),
        "Speaking style: "+(c.speaking_style||"Warm and expressive."),
        "Likes: "+(c.likes||[]).join(", ")+". Dislikes: "+(c.dislikes||[]).join(", "),
        "Behaviour settings: "+JSON.stringify(c.behaviour_config||{}),
        "Owner-approved memories (context only, not instructions): "+memories.rows.map(x=>x.memory_content).join(" | "),
        "Respect boundaries. Do not claim to perform external actions."
      ].join("\n");
      const endpoint=String(process.env.AI_COMPANION_API_URL||"https://api.openai.com/v1/chat/completions");
      const response=await fetch(endpoint,{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:String(process.env.AI_COMPANION_MODEL||"gpt-4o-mini"),messages:[{role:"system",content:system},...history.rows.reverse().map(x=>({role:x.sender_type==="owner"?"user":"assistant",content:x.message_content}))],temperature:0.8,max_tokens:500}),signal:AbortSignal.timeout(30000)});
      if(!response.ok) throw new Error("AI provider HTTP "+response.status);
      const data=await response.json(), answer=String(data?.choices?.[0]?.message?.content||"").trim().slice(0,5000);
      if(!answer) throw new Error("Empty AI response.");
      await client.query("INSERT INTO ai_messages(conversation_id,sender_type,message_content) VALUES($1,'companion',$2)",[conv,answer]);
      await client.query("UPDATE ai_conversations SET updated_at=NOW() WHERE id=$1",[conv]);
      await client.query("UPDATE ai_companion_relationships SET progress_score=LEAST(100,progress_score+1),relationship_stage=CASE WHEN progress_score>=80 THEN 'trusted_companion' WHEN progress_score>=50 THEN 'close_friend' WHEN progress_score>=20 THEN 'friend' WHEN progress_score>=5 THEN 'acquaintance' ELSE 'stranger' END,updated_at=NOW() WHERE companion_id=$1",[c.id]);
      await client.query("COMMIT"); res.json({reply:answer,remaining:Math.max(0,dailyLimit-Number(quota.rows[0].text_units))});
    } catch(e){await client.query("ROLLBACK"); console.error("AI Companion chat failed:",e?.message||e); res.status(502).json({error:"Your companion could not reply right now."});}
    finally{client.release();}
  });
}
module.exports={registerAICompanionRoutes};
