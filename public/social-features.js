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
  if(!group.querySelector('[data-view="confessions"]')){
   const conf=document.createElement("button");conf.className="nav";conf.type="button";conf.dataset.view="confessions";conf.innerHTML='🥀 <span>Confessions</span>';group.appendChild(conf);
  }
 }
 const main=document.querySelector(".main");if(!main)return;
 if(!el("viewConfessions")){
  const conf=document.createElement("section");conf.id="viewConfessions";conf.className="view hidden sf-view";
  conf.innerHTML='<div class="topbar"><div><h2>🥀 Anonymous Confessions</h2><p class="muted">Share thoughts without showing your public identity.</p></div><div class="toolbar"><button class="mini" id="sfConfLatest">Latest</button><button class="mini" id="sfConfPopular">Popular</button><button class="mini" id="sfConfMine">My submissions</button></div></div><div class="sf-content" id="sfConfContent"></div>';
  main.appendChild(conf);
 }
 const confButton=group?.querySelector('[data-view="confessions"]');
 if(confButton&&!confButton.dataset.socialBound){
  confButton.dataset.socialBound="true";
  confButton.onclick=async event=>{
   event.preventDefault();event.stopPropagation();
   state.view="confessions";
   document.querySelectorAll(".nav[data-view]").forEach(item=>item.classList.toggle("active",item===confButton));
   document.querySelectorAll(".view").forEach(view=>view.classList.add("hidden"));
   el("viewConfessions")?.classList.remove("hidden");
   loadConfessions("latest");
  };
 }
}
async function loadConfessions(mode,category){
 const root=el("sfConfContent");if(!root)return;root.innerHTML='<p class="muted">Loading confessions…</p>';
 try{
  const params=new URLSearchParams();
  if(mode==="popular")params.set("sort","popular");
  if(category)params.set("category",category);
  const query=params.toString();
  const d=await request("/api/confessions"+(query?"?"+query:""));
  root.innerHTML='<div class="sf-conf-compose"><h3>Whisper into the darkness 🥀</h3><form id="sfConfForm"><select name="category">'+CATS.map(x=>'<option>'+esc(x)+'</option>').join("")+'</select><textarea name="body" maxlength="2000" required placeholder="Write what is on your mind…"></textarea><input name="warning" maxlength="160" placeholder="Optional content warning"><small>Your username and profile photo are never displayed publicly. Authorized Owner / Developer investigations are audited.</small><button class="primary">Submit anonymously</button></form></div><div class="sf-feed">'+(d.confessions||[]).map(confessionCard).join("")+'</div>';
  root.querySelector("#sfConfForm")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector("button[type=submit],button.primary");const category=form.elements.namedItem("category")?.value||"",body=String(form.elements.namedItem("body")?.value||"").trim(),warning=String(form.elements.namedItem("warning")?.value||"").trim();let feedback=form.querySelector("#sfConfFeedback");if(!feedback){feedback=document.createElement("p");feedback.id="sfConfFeedback";feedback.className="sf-conf-feedback";feedback.setAttribute("role","status");form.appendChild(feedback);}if(!CATS.includes(category)){feedback.textContent="Please choose a category.";return;}if(body.length<3){feedback.textContent="Please write at least 3 characters.";return;}if(button?.disabled)return;if(button){button.disabled=true;button.textContent="Submitting…";}feedback.textContent="";try{const result=await request("/api/confessions",{method:"POST",body:JSON.stringify({category,body,contentWarning:warning})});if(!result?.ok)throw new Error(result?.error||"The server did not confirm that your confession was saved.");say("Your confession was submitted anonymously.");await loadConfessions("latest");}catch(err){feedback.textContent=err?.message||"Could not submit your confession. Please try again.";if(button){button.disabled=false;button.textContent="Submit anonymously";}}});
  root.querySelectorAll("[data-conf-react]").forEach(b=>b.addEventListener("click",async()=>{try{await request("/api/confessions/"+b.dataset.confReact+"/reactions",{method:"POST",body:JSON.stringify({emoji:b.dataset.emoji})});loadConfessions(mode,category);}catch(e){say(e.message);}}));
  root.querySelectorAll("[data-conf-report]").forEach(b=>b.addEventListener("click",async()=>{const reason=prompt("Why are you reporting this confession?");if(!reason)return;try{await request("/api/confessions/"+b.dataset.confReport+"/report",{method:"POST",body:JSON.stringify({reason})});say("Report submitted.");}catch(e){say(e.message);}}));
  root.querySelectorAll("[data-conf-comments]").forEach(b=>b.addEventListener("click",()=>loadConfComments(b.dataset.confComments)));
 }catch(e){root.innerHTML='<div class="sf-empty">'+esc(e.message)+'</div>';}
}
function confessionCard(c){
 return '<article class="sf-conf-card"><div class="sf-conf-meta"><span>🥀 '+esc(c.category)+'</span><span>'+new Date(c.created_at).toLocaleString()+'</span></div>'+(c.content_warning?'<details class="sf-warning"><summary>Content warning: '+esc(c.content_warning)+'</summary><p>Content warning: '+esc(c.content_warning)+'</p></details>':'')+'<p class="sf-conf-body">'+esc(c.body)+'</p><div class="sf-entry-actions">'+REACTS.map(x=>'<button class="mini" data-conf-react="'+esc(c.id)+'" data-emoji="'+esc(x)+'">'+x+'</button>').join("")+'<button class="mini" data-conf-comments="'+esc(c.id)+'">◯ Comments ('+Number(c.comment_count||0)+')</button><button class="mini" data-conf-report="'+esc(c.id)+'">⚑ Report</button></div><div class="sf-comments" id="sfConfComments-'+esc(c.id)+'"></div></article>';
}
async function loadConfComments(id){
 const box=el("sfConfComments-"+id);if(!box)return;
 try{const d=await request("/api/confessions/"+id+"/comments");box.innerHTML=(d.comments||[]).map(c=>'<p><b>Anonymous member</b> '+esc(c.body)+'</p>').join("")+'<form data-conf-comment="'+id+'"><input maxlength="1000" required placeholder="Write a comment…"><button class="mini">Send</button></form>';box.querySelector("form")?.addEventListener("submit",async e=>{e.preventDefault();const input=e.currentTarget.querySelector("input");try{await request("/api/confessions/"+id+"/comments",{method:"POST",body:JSON.stringify({body:input.value})});loadConfComments(id);}catch(err){say(err.message);}});}catch(e){box.textContent=e.message;}
}
async function loadMyConfessions(){
 const root=el("sfConfContent");root.innerHTML='<p class="muted">Loading your submissions…</p>';
 try{const d=await request("/api/confessions/mine");const submissions=Array.isArray(d.confessions)?d.confessions:[];root.innerHTML='<h3>My submissions</h3>'+(submissions.length?submissions.map(c=>'<article class="sf-conf-card"><div class="sf-conf-meta">'+esc(c.category)+' · '+esc(c.status)+'</div><p>'+esc(c.body)+'</p><button class="mini danger" data-conf-delete="'+esc(c.id)+'">Delete</button></article>').join(""):'<p class="sf-empty">You have not submitted anything yet.</p>');root.querySelectorAll("[data-conf-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this confession?"))return;try{await request("/api/confessions/"+b.dataset.confDelete,{method:"DELETE"});loadMyConfessions();}catch(e){say(e.message);}});}catch(e){root.textContent=e.message;}
}

document.addEventListener("click",e=>{if(e.target.closest("#sfConfLatest"))loadConfessions("latest");if(e.target.closest("#sfConfPopular"))loadConfessions("popular");if(e.target.closest("#sfConfMine"))loadMyConfessions();});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",addNav);else addNav();
})();