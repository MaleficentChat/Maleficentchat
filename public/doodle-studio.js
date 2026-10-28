(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const token=()=>{try{return localStorage.getItem("mc_token")||""}catch{return ""}};
  async function request(url,options={}){
    const headers={...(options.headers||{})};const t=token();if(t)headers["x-auth-token"]=t;
    if(options.body&&typeof options.body==="string")headers["Content-Type"]="application/json";
    const res=await fetch(url,{...options,headers,credentials:"same-origin"});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(data.error||"Request failed");return data;
  }
  let canvas,ctx,mode="pen",color="#171126",size=6,background="#ffffff",drawing=false,history=[],textLabel="✦";
  const status=message=>{const el=$("doodleStudioStatus");if(el)el.textContent=message||""};
  function render(){
    const root=$("doodleStudioRoot");if(!root)return;
    root.innerHTML='<section class="doodle-studio"><header class="doodle-studio-head"><div><h2>🖌️ Doodle Studio</h2><p>Create, save and share your own artwork without leaving Games.</p></div><span class="pill">ART LAB</span></header><div class="doodle-studio-layout"><div class="doodle-studio-workspace"><div class="doodle-studio-toolbar" role="toolbar" aria-label="Drawing tools"><button type="button" data-doodle-mode="pen" class="active">🖊 Pen</button><button type="button" data-doodle-mode="eraser">🧽 Eraser</button><button type="button" data-doodle-mode="text">🔤 Text</button><button type="button" data-doodle-mode="stamp">✨ Stamp</button><label>Color <input id="doodleStudioColor" type="color" value="#171126"></label><label>Size <input id="doodleStudioSize" type="range" min="2" max="36" value="6"></label><label>Canvas <select id="doodleStudioBackground"><option value="#ffffff">Paper</option><option value="#fff0fa">Rose</option><option value="#eaf7ff">Ice</option><option value="#171126">Midnight</option><option value="#eaffef">Mint</option></select></label><button type="button" id="doodleStudioUndo">↶ Undo</button><button type="button" id="doodleStudioClear">⌫ Clear</button></div><canvas id="doodleStudioCanvas" width="900" height="620" aria-label="Doodle Studio drawing canvas"></canvas><p class="doodle-studio-hint">Draw with touch or mouse. Text and stamps are placed where you tap. Your saved gallery is private to your account.</p><div class="doodle-studio-bottom"><input id="doodleStudioTitle" maxlength="80" placeholder="Give your doodle a title…" value="My midnight doodle"><button type="button" class="mini" id="doodleStudioDownload">⬇ Download</button><button type="button" class="mini" id="doodleStudioShare">➤ Send to chat</button><button type="button" class="primary" id="doodleStudioSave">♡ Save doodle</button></div><div id="doodleStudioStatus" class="doodle-studio-status" role="status" aria-live="polite"></div></div><aside class="doodle-studio-gallery"><h3>🌙 My Gallery</h3><p>Saved drawings stay with your account.</p><div id="doodleStudioGallery" class="doodle-gallery-list"><p class="muted">Loading your gallery…</p></div></aside></div></section>';
    canvas=$("doodleStudioCanvas");ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);history=[];snapshot();bindCanvas();bindTools();loadGallery();
  }
  function snapshot(){try{history.push(ctx.getImageData(0,0,canvas.width,canvas.height));if(history.length>30)history.shift()}catch{}}
  function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
  function bindCanvas(){
    canvas.addEventListener("pointerdown",e=>{e.preventDefault();const p=point(e);canvas.setPointerCapture?.(e.pointerId);
      if(mode==="text"){const value=prompt("Text to place on your doodle","Hello!");if(value){ctx.save();ctx.fillStyle=color;ctx.font="bold "+Math.max(18,size*5)+"px system-ui, sans-serif";ctx.fillText(value.slice(0,100),p.x,p.y,canvas.width-20);ctx.restore();snapshot()}return}
      if(mode==="stamp"){ctx.save();ctx.fillStyle=color;ctx.font=Math.max(24,size*5)+"px system-ui, sans-serif";ctx.textAlign="center";ctx.fillText(textLabel,p.x,p.y);ctx.restore();snapshot();return}
      drawing=true;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=mode==="eraser"?background:color;ctx.lineWidth=size;ctx.lineTo(p.x+.1,p.y+.1);ctx.stroke();
    });
    canvas.addEventListener("pointermove",e=>{if(!drawing)return;const p=point(e);ctx.strokeStyle=mode==="eraser"?background:color;ctx.lineWidth=size;ctx.lineTo(p.x,p.y);ctx.stroke()});
    const finish=()=>{if(drawing){drawing=false;ctx.closePath();snapshot()}};
    canvas.addEventListener("pointerup",finish);canvas.addEventListener("pointercancel",finish);canvas.addEventListener("lostpointercapture",finish);
  }
  function bindTools(){
    document.querySelectorAll("[data-doodle-mode]").forEach(btn=>btn.onclick=()=>{mode=btn.dataset.doodleMode;document.querySelectorAll("[data-doodle-mode]").forEach(b=>b.classList.toggle("active",b===btn));if(mode==="stamp"){const stamp=prompt("Choose a stamp: ✦ ✨ ♡ ☾ ★ 🌸 🦇 🖤","✦");if(stamp)textLabel=stamp.slice(0,8)}});
    $("doodleStudioColor").oninput=e=>color=e.target.value;$("doodleStudioSize").oninput=e=>size=Number(e.target.value);
    $("doodleStudioBackground").onchange=e=>{background=e.target.value;ctx.save();ctx.globalCompositeOperation="destination-over";ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();snapshot()};
    $("doodleStudioUndo").onclick=()=>{if(history.length<2)return;history.pop();ctx.putImageData(history[history.length-1],0,0);status("Last drawing step undone.")};
    $("doodleStudioClear").onclick=()=>{if(!confirm("Clear the canvas and start again?"))return;ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);snapshot();status("Canvas cleared.")};
    $("doodleStudioDownload").onclick=download;$("doodleStudioSave").onclick=saveDoodle;$("doodleStudioShare").onclick=shareToChat;
  }
  function exportPng(){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error("Could not export this drawing.")),"image/png"))}
  function download(){canvas.toBlob(blob=>{if(!blob){status("Could not export the drawing.");return}const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=(($("doodleStudioTitle").value||"maleficent-doodle").trim().replace(/[^a-z0-9-_]+/gi,"-").slice(0,60)||"maleficent-doodle")+".png";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status("Download started.")},"image/png")}
  async function saveDoodle(){
    const btn=$("doodleStudioSave");btn.disabled=true;status("Saving your doodle…");
    try{const blob=await exportPng();if(blob.size>1200000)throw Error("This drawing is too large to save. Use fewer details or a simpler background.");const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error("Could not read drawing."));reader.readAsDataURL(blob)});
      const data=await request("/api/doodles",{method:"POST",body:JSON.stringify({title:$("doodleStudioTitle").value.trim()||"Untitled doodle",image})});status("Saved to your private gallery.");await loadGallery();return data.doodle;
    }catch(e){status(e.message||"Could not save this doodle.");return null}finally{btn.disabled=false}
  }
  async function loadGallery(){
    const host=$("doodleStudioGallery");if(!host)return;
    try{const data=await request("/api/doodles");const items=data.doodles||[];
      if(!items.length){host.innerHTML='<p class="muted">No saved doodles yet. Create your first one!</p>';return}
      host.innerHTML=items.map(d=>'<article class="doodle-gallery-item"><img loading="lazy" alt="Saved doodle: '+esc(d.title)+'" data-doodle-image="'+esc(d.id)+'"><b>'+esc(d.title)+'</b><small class="muted">'+esc(new Date(d.created_at||d.createdAt).toLocaleDateString())+'</small><div class="doodle-gallery-actions"><button type="button" class="mini" data-doodle-load="'+esc(d.id)+'">Open</button><button type="button" class="mini danger" data-doodle-delete="'+esc(d.id)+'">Delete</button></div></article>').join("");
      for(const img of host.querySelectorAll("[data-doodle-image]")){try{const item=await request("/api/doodles/"+encodeURIComponent(img.dataset.doodleImage)+"/image");img.src=item.image}catch{img.alt="Could not load doodle image"}}
      host.querySelectorAll("[data-doodle-load]").forEach(btn=>btn.onclick=()=>openSaved(btn.dataset.doodleLoad));
      host.querySelectorAll("[data-doodle-delete]").forEach(btn=>btn.onclick=()=>deleteSaved(btn.dataset.doodleDelete));
    }catch(e){host.innerHTML='<p class="muted">Sign in to load your saved gallery.</p>';status(e.message)}
  }
  async function openSaved(id){
    try{const d=await request("/api/doodles/"+encodeURIComponent(id)+"/image");const img=new Image();img.onload=()=>{ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);snapshot();$("doodleStudioTitle").value=d.title||"Saved doodle";status("Opened "+(d.title||"saved doodle")+".")};img.src=d.image}catch(e){status(e.message)}
  }
  async function deleteSaved(id){if(!confirm("Delete this saved doodle from your gallery?"))return;try{await request("/api/doodles/"+encodeURIComponent(id),{method:"DELETE"});status("Doodle deleted.");loadGallery()}catch(e){status(e.message)}}
  async function shareToChat(){
    let access;try{access=JSON.parse(localStorage.getItem("mc_room_join")||"null")}catch{}
    if(!access?.roomId||!access?.joinToken){status("Join a chat room first, then return to Games to share your doodle.");return}
    const btn=$("doodleStudioShare");btn.disabled=true;status("Sending doodle to chat…");
    try{const blob=await exportPng(),form=new FormData();form.append("text","🖌️ A doodle from Doodle Studio");form.append("file",blob,"maleficent-doodle.png");const headers={"x-room-join-token":access.joinToken};const t=token();if(t)headers["x-auth-token"]=t;
      const res=await fetch("/api/rooms/"+encodeURIComponent(access.roomId)+"/messages",{method:"POST",body:form,headers,credentials:"same-origin"});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||"Could not send doodle to chat.");status("Doodle sent to your selected room.");
    }catch(e){status(e.message||"Could not send doodle.")}finally{btn.disabled=false}
  }
  document.addEventListener("DOMContentLoaded",()=>{render();document.querySelector('.nav[data-view="games"]')?.addEventListener("click",()=>{if(!$("doodleStudioCanvas"))render();else loadGallery()})});
})();