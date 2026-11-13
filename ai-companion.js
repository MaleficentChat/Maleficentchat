"use strict";
const ELIGIBLE = new Set(["PREMIUM","ROYAL","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"]);
const DAILY_LIMIT = Math.max(1, Math.min(500, Number(process.env.AI_COMPANION_DAILY_TEXT_LIMIT) || 80));
const rank = user => String(user?.rank || "").toUpperCase().replace(/[\s-]+/g,"_");
const allowed = user => ELIGIBLE.has(rank(user));
const safe = row => row && ({
  id:String(row.id), name:row.name, avatarUrl:row.avatar_url||"", bio:row.bio||"",
  personalityType:row.personality_type, personalityPreset:row.personality_preset||"",
  backstory:row.backstory||"", speakingStyle:row.speaking_style||"",
  likes:Array.isArray(row.likes)?row.likes:[], dislikes:Array.isArray(row.dislikes)?row.dislikes:[],
  behaviourConfig:row.behaviour_config||{}, status:row.status,
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
      const r=await client.query("INSERT INTO ai_companions(owner_id,name,bio,personality_type,personality_preset,backstory,speaking_style,likes,dislikes,behaviour_config) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb) RETURNING *",[
        u.id,name,String(req.body?.bio||"").slice(0,500),req.body?.personalityType==="custom"?"custom":"preset",
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
      String(b.name??c.name).trim().slice(0,60),String(b.bio??c.bio).slice(0,500),
      ["custom","preset"].includes(b.personalityType)?b.personalityType:c.personality_type,
      String(b.personalityPreset??c.personality_preset??"").slice(0,80),String(b.backstory??c.backstory).slice(0,2500),
      String(b.speakingStyle??c.speaking_style).slice(0,800),
      JSON.stringify(Array.isArray(b.likes)?b.likes.slice(0,20):c.likes),JSON.stringify(Array.isArray(b.dislikes)?b.dislikes.slice(0,20):c.dislikes),
      JSON.stringify(b.behaviourConfig&&typeof b.behaviourConfig==="object"?b.behaviourConfig:c.behaviour_config),
      b.proactiveEnabled===undefined?c.proactive_enabled:b.proactiveEnabled===true,
      JSON.stringify(b.quietHours&&typeof b.quietHours==="object"?b.quietHours:c.quiet_hours),u.id
    ];
    if(!v[0]) return res.status(400).json({error:"Companion name cannot be empty."});
    const r=await pool.query("UPDATE ai_companions SET name=$1,bio=$2,personality_type=$3,personality_preset=$4,backstory=$5,speaking_style=$6,likes=$7::jsonb,dislikes=$8::jsonb,behaviour_config=$9::jsonb,proactive_enabled=$10,quiet_hours=$11::jsonb,updated_at=NOW() WHERE owner_id=$12 RETURNING *",v);
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
  app.post("/api/ai-companion/chat",auth,guard,async(req,res)=>{
    const u=current(req); if(!allowed(u)) return res.status(403).json({error:"MC Premium rank or higher is required."});
    const key=String(process.env.AI_COMPANION_API_KEY||""); if(!key) return res.status(503).json({error:"AI Companion is waiting for its dedicated provider key."});
    const c=await getCompanion(u.id); if(!c) return res.status(404).json({error:"Create your companion first."});
    const message=String(req.body?.message||"").trim().slice(0,1200); if(!message) return res.status(400).json({error:"Write a message first."});
    const client=await pool.connect();
    try {
      await client.query("BEGIN"); const conv=await conversation(client,c.id,u.id);
      const quota=await client.query("INSERT INTO ai_usage_daily(companion_id,usage_date,text_units) VALUES($1,CURRENT_DATE,1) ON CONFLICT(companion_id,usage_date) DO UPDATE SET text_units=ai_usage_daily.text_units+1,updated_at=NOW() WHERE ai_usage_daily.text_units<$2 RETURNING text_units",[c.id,DAILY_LIMIT]);
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
      await client.query("COMMIT"); res.json({reply:answer,remaining:Math.max(0,DAILY_LIMIT-Number(quota.rows[0].text_units))});
    } catch(e){await client.query("ROLLBACK"); console.error("AI Companion chat failed:",e?.message||e); res.status(502).json({error:"Your companion could not reply right now."});}
    finally{client.release();}
  });
}
module.exports={registerAICompanionRoutes};
