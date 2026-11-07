(function(){
"use strict";
const CATS=["Love & Crushes","Heartbreak","Secrets","Rants","Friendships","Random Thoughts"];
const REACTS=["❤️","🥀","😭","👀","🖤"];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const el=id=>document.getElementById(id);
const say=m=>{if(typeof window.toast==="function")window.toast(m);else alert(m);};
async function request(url,options){return api(url,options||{});}
function mediaUrl(key){return "/uploads/"+String(key||"").split("/").map(encodeURIComponent).join("/");}
function addNav(){
 const group=document.querySelector(".nav-group");
 if(group){
  const conf=document.createElement("button");conf.className="nav";conf.type="button";conf.dataset.socialView="confessions";conf.textContent="🥀 Confessions";group.appendChild(conf);
  const book=document.createElement("button");book.className="nav";book.type="button";book.dataset.socialView="scrapbook";book.textContent="📖 My Scrapbook";group.appendChild(book);
 }
 const main=document.querySelector(".main");if(!main)return;
 const scrapbook=document.createElement("section");scrapbook.id="sfScrapbookView";scrapbook.className="view hidden sf-view";
 scrapbook.innerHTML='<div class="topbar"><div><h2>📖 My Scrapbook</h2><p class="muted">Your memories, your little corner of Maleficent Chat.</p></div><button class="primary" id="sfBookSettings">⚙ Settings</button></div><div class="sf-content" id="sfBookContent"></div>';
 const conf=document.createElement("section");conf.id="sfConfessionsView";conf.className="view hidden sf-view";
 conf.innerHTML='<div class="topbar"><div><h2>🥀 Anonymous Confessions</h2><p class="muted">Share thoughts without showing your public identity.</p></div><div class="toolbar"><button class="mini" id="sfConfLatest">Latest</button><button class="mini" id="sfConfPopular">Popular</button><button class="mini" id="sfConfMine">My submissions</button></div></div><div class="sf-content" id="sfConfContent"></div>';
 main.append(scrapbook,conf);
 document.querySelectorAll("[data-social-view]").forEach(b=>b.addEventListener("click",()=>openSocialView(b.dataset.socialView)));
}
function openSocialView(which){
 document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
 document.querySelectorAll(".nav[data-view],.nav[data-social-view]").forEach(v=>v.classList.remove("active"));
 const button=document.querySelector('[data-social-view="'+which+'"]');button?.classList.add("active");
 const view=el(which==="scrapbook"?"sfScrapbookView":"sfConfessionsView");view?.classList.remove("hidden");
 if(which==="scrapbook")loadScrapbook(state.user?.id,true);else loadConfessions("latest");
}
function bookEntry(entry,ownerId,isOwner){
 const media=entry.media_key?'<div class="sf-memory-media">'+(String(entry.media_key).match(/\.(mp4|webm|mov)$/i)?'<video controls preload="metadata" src="'+esc(mediaUrl(entry.media_key))+'"></video>':'<img loading="lazy" src="'+esc(mediaUrl(entry.media_key))+'" alt="Scrapbook memory">')+'</div>':'';
 const sticker=entry.sticker?'<div class="sf-sticker">'+esc(entry.sticker)+'</div>':'';
 return '<article class="sf-entry"><div class="sf-entry-top"><b>'+esc(entry.title||"A memory")+'</b>'+(entry.pinned?'<span>📌</span>':'')+'</div>'+media+sticker+(entry.body?'<p>'+esc(entry.body)+'</p>':'')+'<div class="sf-entry-foot"><span>'+new Date(entry.created_at).toLocaleDateString()+'</span><span>♡ '+Number(entry.reaction_count||0)+'</span><span>◯ '+Number(entry.comment_count||0)+'</span></div><div class="sf-entry-actions"><button class="mini" data-sf-react="'+entry.id+'">🖤 React</button><button class="mini" data-sf-comments="'+entry.id+'">Comments</button>'+(isOwner?'<button class="mini danger" data-sf-delete="'+entry.id+'">Delete</button>':'')+'</div><div class="sf-comments" id="sfComments-'+entry.id+'"></div></article>';
}
async function loadScrapbook(userId,isOwner){
 const profileRoot=document.querySelector(".profile-modal #profileTabContent");const root=profileRoot||el("sfBookContent");if(!root||!userId)return;
 root.innerHTML='<p class="muted">Loading scrapbook…</p>';
 try{
  const d=await request("/api/social/scrapbooks/"+encodeURIComponent(userId));
  const book=d.scrapbook||{};
  const ownerMode=!!isOwner&&String(state.user?.id)===String(userId);
  root.innerHTML='<div class="sf-book sf-theme-'+esc(book.theme||"midnight")+'"><div class="sf-book-head"><div><h2>'+esc(book.title||"My Scrapbook")+'</h2><p class="muted">'+esc(d.owner?.username||"")+'’s memories</p></div>'+(ownerMode?(profileRoot?'<button class="primary" id="sfOpenScrapbookEditor">✏️ Edit scrapbook</button>':'<button class="primary" id="sfAddMemory">＋ Add memory</button>'):'')+'</div><div class="sf-entry-grid">'+(d.entries||[]).map(x=>bookEntry(x,userId,ownerMode)).join("")+'</div>'+(d.entries?.length?'':'<div class="sf-empty">🌙 No memories here yet.</div>')+'</div>';
  if(ownerMode){el("sfAddMemory")?.addEventListener("click",addMemory);el("sfOpenScrapbookEditor")?.addEventListener("click",()=>openSocialView("scrapbook"));}
  root.querySelectorAll("[data-sf-delete]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Delete this scrapbook entry?"))return;try{await request("/api/social/scrapbooks/entries/"+b.dataset.sfDelete,{method:"DELETE"});loadScrapbook(userId,ownerMode);}catch(e){say(e.message);}}));
  root.querySelectorAll("[data-sf-react]").forEach(b=>b.addEventListener("click",async()=>{try{await request("/api/social/scrapbooks/entries/"+b.dataset.sfReact+"/reactions",{method:"POST",body:JSON.stringify({emoji:"🖤"})});say("Reaction saved.");}catch(e){say(e.message);}}));
  root.querySelectorAll("[data-sf-comments]").forEach(b=>b.addEventListener("click",()=>loadBookComments(b.dataset.sfComments)));
 }catch(e){root.innerHTML='<div class="sf-empty">'+esc(e.message)+'</div>';}
}
async function loadBookComments(id){
 const box=el("sfComments-"+id);if(!box)return;
 try{const d=await request("/api/social/scrapbooks/entries/"+id+"/comments");box.innerHTML=(d.comments||[]).map(c=>'<p><b>'+esc(c.author)+'</b> '+esc(c.body)+'</p>').join("")+'<form data-book-comment="'+id+'"><input maxlength="1000" placeholder="Write a comment…" required><button class="mini">Send</button></form>';box.querySelector("form")?.addEventListener("submit",async e=>{e.preventDefault();const input=e.currentTarget.querySelector("input");try{await request("/api/social/scrapbooks/entries/"+id+"/comments",{method:"POST",body:JSON.stringify({body:input.value})});loadBookComments(id);}catch(err){say(err.message);}});}catch(e){box.textContent=e.message;}
}
function addMemory(){
 const host=el("sfBookContent");if(!host)return;
 const form=document.createElement("form");form.className="sf-editor";form.innerHTML='<h3>Add to your scrapbook</h3><input name="title" maxlength="120" placeholder="Memory title"><textarea name="body" maxlength="4000" placeholder="Write a note or caption…"></textarea><label>Attach a photo or video <input name="file" type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime"></label><div class="toolbar"><button type="button" class="mini" id="sfCancelMemory">Cancel</button><button class="primary">Save memory</button></div>';
 host.prepend(form);el("sfCancelMemory").onclick=()=>form.remove();
 form.addEventListener("submit",async e=>{e.preventDefault();const f=form.elements.file.files[0];try{if(f){const fd=new FormData();fd.append("file",f);fd.append("title",form.elements.title.value);fd.append("caption",form.elements.body.value);await request("/api/social/scrapbooks/media",{method:"POST",body:fd});}else await request("/api/social/scrapbooks/entries",{method:"POST",body:JSON.stringify({type:"note",title:form.elements.title.value,body:form.elements.body.value})});loadScrapbook(state.user.id,true);}catch(err){say(err.message);}});
}
async function bookSettings(){
 const current=await request("/api/social/scrapbooks/"+encodeURIComponent(state.user.id));
 const s=current.scrapbook||{};
 const form=document.createElement("div");form.className="sf-editor";form.innerHTML='<h3>Scrapbook settings</h3><label>Title<input id="sfBookTitle" maxlength="100" value="'+esc(s.title||"My Scrapbook")+'"></label><label>Theme<select id="sfBookTheme"><option value="midnight">Midnight</option><option value="violet">Violet</option><option value="rose">Rose</option><option value="paper">Paper</option><option value="forest">Forest</option></select></label><label>Layout<select id="sfBookLayout"><option value="polaroid">Polaroid wall</option><option value="journal">Journal</option><option value="collage">Collage</option><option value="timeline">Timeline</option><option value="minimal">Minimal</option></select></label><label>Who can view?<select id="sfBookVisibility"><option value="public">Everyone</option><option value="friends">Friends</option><option value="private">Only me</option></select></label><label class="sf-check"><input id="sfBookComments" type="checkbox"> Allow comments</label><div class="toolbar"><button class="mini" id="sfSettingsCancel">Cancel</button><button class="primary" id="sfSettingsSave">Save settings</button></div>';
 document.querySelector(".sf-modal")?.remove();const overlay=document.createElement("div");overlay.className="sf-modal";overlay.append(form);document.body.append(overlay);
 el("sfBookTheme").value=s.theme||"midnight";el("sfBookLayout").value=s.layout||"polaroid";el("sfBookVisibility").value=s.visibility||"public";el("sfBookComments").checked=s.allowComments!==false;
 el("sfSettingsCancel").onclick=()=>overlay.remove();el("sfSettingsSave").onclick=async()=>{try{await request("/api/social/scrapbooks/settings",{method:"PUT",body:JSON.stringify({title:el("sfBookTitle").value,theme:el("sfBookTheme").value,layout:el("sfBookLayout").value,visibility:el("sfBookVisibility").value,allowComments:el("sfBookComments").checked})});overlay.remove();loadScrapbook(state.user.id,true);}catch(e){say(e.message);}};
}
async function loadConfessions(mode,category){
 const root=el("sfConfContent");if(!root)return;root.innerHTML='<p class="muted">Loading confessions…</p>';
 try{
  const d=await request("/api/confessions"+(mode==="popular"?"?sort=popular":"")+(category?"&category="+encodeURIComponent(category):""));
  root.innerHTML='<div class="sf-conf-compose"><h3>Whisper into the darkness 🥀</h3><form id="sfConfForm"><select name="category">'+CATS.map(x=>'<option>'+esc(x)+'</option>').join("")+'</select><textarea name="body" maxlength="2000" required placeholder="Write what is on your mind…"></textarea><input name="warning" maxlength="160" placeholder="Optional content warning"><small>Your username and profile photo are never displayed publicly. Authorized Owner / Developer investigations are audited.</small><button class="primary">Submit anonymously</button></form></div><div class="sf-feed">'+(d.confessions||[]).map(confessionCard).join("")+'</div>';
  root.querySelector("#sfConfForm")?.addEventListener("submit",async e=>{e.preventDefault();const f=e.currentTarget;try{await request("/api/confessions",{method:"POST",body:JSON.stringify({category:f.category.value,body:f.body.value,contentWarning:f.warning.value})});say("Your confession was submitted anonymously.");loadConfessions("latest");}catch(err){say(err.message);}});
  root.querySelectorAll("[data-conf-react]").forEach(b=>b.addEventListener("click",async()=>{try{await request("/api/confessions/"+b.dataset.confReact+"/reactions",{method:"POST",body:JSON.stringify({emoji:b.dataset.emoji})});loadConfessions(mode,category);}catch(e){say(e.message);}}));
  root.querySelectorAll("[data-conf-report]").forEach(b=>b.addEventListener("click",async()=>{const reason=prompt("Why are you reporting this confession?");if(!reason)return;try{await request("/api/confessions/"+b.dataset.confReport+"/report",{method:"POST",body:JSON.stringify({reason})});say("Report submitted.");}catch(e){say(e.message);}}));
  root.querySelectorAll("[data-conf-comments]").forEach(b=>b.addEventListener("click",()=>loadConfComments(b.dataset.confComments)));
 }catch(e){root.innerHTML='<div class="sf-empty">'+esc(e.message)+'</div>';}
}
function confessionCard(c){
 return '<article class="sf-conf-card"><div class="sf-conf-meta"><span>🥀 '+esc(c.category)+'</span><span>'+new Date(c.created_at).toLocaleString()+'</span></div>'+(c.content_warning?'<details class="sf-warning"><summary>Content warning: '+esc(c.content_warning)+'</summary></details>':'')+'<p class="sf-conf-body">'+esc(c.body)+'</p><div class="sf-entry-actions">'+REACTS.map(x=>'<button class="mini" data-conf-react="'+esc(c.id)+'" data-emoji="'+esc(x)+'">'+x+'</button>').join("")+'<button class="mini" data-conf-comments="'+esc(c.id)+'">◯ Comments ('+Number(c.comment_count||0)+')</button><button class="mini" data-conf-report="'+esc(c.id)+'">⚑ Report</button></div><div class="sf-comments" id="sfConfComments-'+esc(c.id)+'"></div></article>';
}
async function loadConfComments(id){
 const box=el("sfConfComments-"+id);if(!box)return;
 try{const d=await request("/api/confessions/"+id+"/comments");box.innerHTML=(d.comments||[]).map(c=>'<p><b>Anonymous member</b> '+esc(c.body)+'</p>').join("")+'<form data-conf-comment="'+id+'"><input maxlength="1000" required placeholder="Write a comment…"><button class="mini">Send</button></form>';box.querySelector("form")?.addEventListener("submit",async e=>{e.preventDefault();const input=e.currentTarget.querySelector("input");try{await request("/api/confessions/"+id+"/comments",{method:"POST",body:JSON.stringify({body:input.value})});loadConfComments(id);}catch(err){say(err.message);}});}catch(e){box.textContent=e.message;}
}
async function loadMyConfessions(){
 const root=el("sfConfContent");root.innerHTML='<p class="muted">Loading your submissions…</p>';
 try{const d=await request("/api/confessions/mine");root.innerHTML='<h3>My submissions</h3>'+(d.confessions||[]).map(c=>'<article class="sf-conf-card"><div class="sf-conf-meta">'+esc(c.category)+' · '+esc(c.status)+'</div><p>'+esc(c.body)+'</p><button class="mini danger" data-conf-delete="'+esc(c.id)+'">Delete</button></article>').join("")||'<p class="sf-empty">You have not submitted anything yet.</p>';root.querySelectorAll("[data-conf-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this confession?"))return;try{await request("/api/confessions/"+b.dataset.confDelete,{method:"DELETE"});loadMyConfessions();}catch(e){say(e.message);}});}catch(e){root.textContent=e.message;}
}
function installProfileTab(){
 const root=document.querySelector(".profile-modal"),tabs=root?.querySelector(".profile-tabs");if(!root||!tabs||tabs.querySelector('[data-sf-profile-tab]'))return;
 const userId=root.dataset.sfUserId,isSelf=root.dataset.sfIsSelf==="true";if(!userId)return;
 const button=document.createElement("button");button.className="profile-tab";button.type="button";button.dataset.sfProfileTab="true";button.textContent="📖 Scrapbook";tabs.appendChild(button);
 button.addEventListener("click",()=>{tabs.querySelectorAll(".profile-tab").forEach(x=>x.classList.remove("active"));button.classList.add("active");loadScrapbook(userId,isSelf);});
}
document.addEventListener("click",e=>{const b=e.target.closest("#sfBookSettings");if(b)bookSettings();});
document.addEventListener("click",e=>{if(e.target.closest("#sfConfLatest"))loadConfessions("latest");if(e.target.closest("#sfConfPopular"))loadConfessions("popular");if(e.target.closest("#sfConfMine"))loadMyConfessions();});
const observer=new MutationObserver(()=>installProfileTab());
observer.observe(document.body,{childList:true,subtree:true});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",addNav);else addNav();
})();