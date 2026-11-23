(function(){
"use strict";
const CATS=["Love & Crushes","Heartbreak","Secrets","Rants","Friendships","Random Thoughts"];
const REACTS=["❤️","🥀","😭","👀","🖤"];
const el=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const say=m=>{if(typeof window.toast==="function")window.toast(m);else alert(m);};
async function request(url,options){return api(url,options||{});}
let currentMode="latest",currentCategory="";
function ensureView(){
 const group=document.querySelector(".nav-group"),main=document.querySelector(".main");
 if(!main)return;
 if(group&&!group.querySelector('[data-view="confessions"]')){
  const button=document.createElement("button");button.className="nav";button.type="button";button.dataset.view="confessions";button.innerHTML='🥀 <span>Confessions</span>';group.appendChild(button);
 }
 if(!el("viewConfessions")){
  const view=document.createElement("section");view.id="viewConfessions";view.className="view hidden sf-view";
  view.innerHTML='<div class="topbar"><div><h2>🥀 Anonymous Confessions</h2><p class="muted">Share thoughts without showing your public identity.</p></div><div class="toolbar" role="group" aria-label="Confession views"><button type="button" class="mini" data-conf-view="latest" id="sfConfLatest">Latest</button><button type="button" class="mini" data-conf-view="popular" id="sfConfPopular">Popular</button><button type="button" class="mini" data-conf-view="mine" id="sfConfMine">My submissions</button></div></div><div class="sf-content" id="sfConfContent"><p class="muted">Choose a confession view.</p></div>';
  main.appendChild(view);
 }
}
function showView(){
 ensureView();
 const button=document.querySelector('.nav[data-view="confessions"]');
 document.querySelectorAll(".nav[data-view]").forEach(item=>item.classList.toggle("active",item===button));
 document.querySelectorAll(".view").forEach(view=>view.classList.add("hidden"));
 el("viewConfessions")?.classList.remove("hidden");
 if(state)state.view="confessions";
}
function confessionCard(c){
 const id=esc(c.id);
 return '<article class="sf-conf-card"><div class="sf-conf-meta"><span>🥀 '+esc(c.category)+'</span><span>'+esc(new Date(c.created_at).toLocaleString())+'</span></div>'+(c.content_warning?'<details class="sf-warning"><summary>Content warning: '+esc(c.content_warning)+'</summary><p>'+esc(c.content_warning)+'</p></details>':'')+'<p class="sf-conf-body">'+esc(c.body)+'</p><div class="sf-entry-actions">'+REACTS.map(x=>'<button type="button" class="mini" data-conf-react="'+id+'" data-emoji="'+esc(x)+'" aria-label="React '+esc(x)+'">'+x+'</button>').join("")+'<button type="button" class="mini" data-conf-comments="'+id+'">◯ Comments ('+Number(c.comment_count||0)+')</button><button type="button" class="mini" data-conf-report="'+id+'">⚑ Report</button></div><div class="sf-comments" id="sfConfComments-'+id+'"></div></article>';
}
function renderComposeAndFeed(confessions){
 const root=el("sfConfContent");if(!root)return;
 root.innerHTML='<div class="sf-conf-compose"><h3>Whisper into the darkness 🥀</h3><form id="sfConfForm"><label>Category<select name="category">'+CATS.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("")+'</select></label><label>Your confession<textarea name="body" maxlength="2000" required minlength="3" placeholder="Write what is on your mind…"></textarea></label><label>Content warning (optional)<input name="warning" maxlength="160" placeholder="Add a short content warning"></label><small>Your username and profile photo are never displayed publicly. Authorized investigations are audited.</small><button type="submit" class="primary">Submit anonymously</button><p id="sfConfFeedback" class="sf-conf-feedback" role="status" aria-live="polite"></p></form></div><div class="sf-feed">'+(confessions||[]).map(confessionCard).join("")+'</div>';
 if(!confessions?.length)root.querySelector(".sf-feed").innerHTML='<div class="sf-empty">No confessions to show yet. Be the first to share one.</div>';
}
async function loadConfessions(mode="latest",category=""){
 currentMode=mode;currentCategory=category;
 const root=el("sfConfContent");if(!root)return;
 root.innerHTML='<p class="muted sf-loading">Loading confessions…</p>';
 try{
  const params=new URLSearchParams();if(mode==="popular")params.set("sort","popular");if(category)params.set("category",category);
  const query=params.toString(),data=await request("/api/confessions"+(query?"?"+query:""));
  renderComposeAndFeed(Array.isArray(data.confessions)?data.confessions:[]);
  document.querySelectorAll("[data-conf-view]").forEach(b=>b.classList.toggle("active",b.dataset.confView===mode));
 }catch(error){root.innerHTML='<div class="sf-empty" role="alert">'+esc(error?.message||"Could not load confessions.")+'</div>';}
}
async function loadMyConfessions(){
 const root=el("sfConfContent");if(!root)return;currentMode="mine";
 root.innerHTML='<p class="muted sf-loading">Loading your submissions…</p>';
 try{
  const data=await request("/api/confessions/mine"),items=Array.isArray(data.confessions)?data.confessions:[];
  root.innerHTML='<div class="sf-my-head"><h3>My submissions</h3><button type="button" class="mini" data-conf-view="latest">← Back to latest</button></div>'+(items.length?items.map(c=>'<article class="sf-conf-card"><div class="sf-conf-meta">'+esc(c.category)+' · '+esc(c.status)+'</div><p class="sf-conf-body">'+esc(c.body)+'</p><button type="button" class="mini danger" data-conf-delete="'+esc(c.id)+'">Delete submission</button></article>').join(""):'<div class="sf-empty">You have not submitted anything yet.</div>');
  document.querySelectorAll("[data-conf-view]").forEach(b=>b.classList.toggle("active",b.dataset.confView==="mine"));
 }catch(error){root.innerHTML='<div class="sf-empty" role="alert">'+esc(error?.message||"Could not load your submissions.")+'</div>';}
}
async function loadConfComments(id){
 const box=el("sfConfComments-"+id);if(!box)return;
 box.innerHTML='<p class="muted">Loading comments…</p>';
 try{
  const data=await request("/api/confessions/"+encodeURIComponent(id)+"/comments");
  box.innerHTML=(data.comments||[]).map(c=>'<p><b>Anonymous member</b> '+esc(c.body)+'</p>').join("")+'<form data-conf-comment="'+esc(id)+'"><input name="body" maxlength="1000" required placeholder="Write a comment…"><button type="submit" class="mini">Send</button></form>';
  if(!data.comments?.length)box.insertAdjacentHTML("afterbegin",'<p class="muted">No comments yet.</p>');
 }catch(error){box.innerHTML='<p class="sf-empty">'+esc(error?.message||"Could not load comments.")+'</p>';}
}
async function handleSubmit(form){
 const button=form.querySelector('button[type="submit"]'),feedback=form.querySelector("#sfConfFeedback");
 const category=form.elements.namedItem("category")?.value||"",body=String(form.elements.namedItem("body")?.value||"").trim(),warning=String(form.elements.namedItem("warning")?.value||"").trim();
 if(!CATS.includes(category)){if(feedback)feedback.textContent="Please choose a category.";return;}
 if(body.length<3){if(feedback)feedback.textContent="Please write at least 3 characters.";return;}
 if(button?.disabled)return;
 if(button){button.disabled=true;button.textContent="Submitting…";}
 if(feedback)feedback.textContent="";
 try{
  const result=await request("/api/confessions",{method:"POST",body:JSON.stringify({category,body,contentWarning:warning})});
  if(!result?.ok||!result?.id)throw new Error(result?.error||"The server did not confirm that your confession was saved.");
  say("Your confession was submitted anonymously.");
  await loadConfessions("latest");
 }catch(error){if(feedback)feedback.textContent=error?.message||"Could not submit your confession. Please try again.";if(button){button.disabled=false;button.textContent="Submit anonymously";}}
}
document.addEventListener("click",async event=>{
 const target=event.target instanceof Element?event.target:event.target?.parentElement;if(!target)return;
 const nav=target.closest('.nav[data-view="confessions"]');
 if(nav){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();showView();await loadConfessions("latest");return;}
 const view=target.closest("[data-conf-view]");
 if(view){event.preventDefault();event.stopPropagation();showView();if(view.dataset.confView==="mine")await loadMyConfessions();else await loadConfessions(view.dataset.confView||"latest");return;}
 const react=target.closest("[data-conf-react]");
 if(react){event.preventDefault();if(react.disabled)return;react.disabled=true;try{await request("/api/confessions/"+encodeURIComponent(react.dataset.confReact)+"/reactions",{method:"POST",body:JSON.stringify({emoji:react.dataset.emoji})});await loadConfessions(currentMode==="popular"?"popular":"latest",currentCategory);}catch(error){react.disabled=false;say(error?.message||"Could not save reaction.");}return;}
 const comments=target.closest("[data-conf-comments]");
 if(comments){event.preventDefault();await loadConfComments(comments.dataset.confComments);return;}
 const report=target.closest("[data-conf-report]");
 if(report){event.preventDefault();const reason=prompt("Why are you reporting this confession?");if(!reason?.trim())return;report.disabled=true;try{await request("/api/confessions/"+encodeURIComponent(report.dataset.confReport)+"/report",{method:"POST",body:JSON.stringify({reason:reason.trim()})});say("Report submitted.");}catch(error){say(error?.message||"Could not submit report.");}finally{report.disabled=false;}return;}
 const remove=target.closest("[data-conf-delete]");
 if(remove){event.preventDefault();if(!confirm("Delete this confession?"))return;remove.disabled=true;try{await request("/api/confessions/"+encodeURIComponent(remove.dataset.confDelete),{method:"DELETE"});say("Your confession was deleted.");await loadMyConfessions();}catch(error){remove.disabled=false;say(error?.message||"Could not delete confession.");}return;}
},true);
document.addEventListener("submit",async event=>{
 const form=event.target;if(!(form instanceof HTMLFormElement))return;
 if(form.id==="sfConfForm"){event.preventDefault();event.stopPropagation();await handleSubmit(form);return;}
 if(form.matches("form[data-conf-comment]")){event.preventDefault();const id=form.dataset.confComment,input=form.elements.namedItem("body"),body=String(input?.value||"").trim(),button=form.querySelector('button[type="submit"]');if(body.length<1)return;if(button){button.disabled=true;button.textContent="Sending…";}try{await request("/api/confessions/"+encodeURIComponent(id)+"/comments",{method:"POST",body:JSON.stringify({body})});await loadConfComments(id);}catch(error){if(button){button.disabled=false;button.textContent="Send";}say(error?.message||"Could not post comment.");}}
},true);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ensureView);else ensureView();
})();
