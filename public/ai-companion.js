(() => {
  const root = () => document.getElementById("aiCompanionRoot");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const token = () => { try { return localStorage.getItem("mc_token") || ""; } catch { return ""; } };
  const palettes = {
    skin:["#f8d9c5","#edbd9e","#c98f70","#8e5c45","#f0c7a7"],
    hair:["#24202d","#6c3e32","#c58b42","#d9d2c7","#a94f72","#7257a5","#e7a9b7"],
    eyes:["#5b8fc9","#754b35","#579b78","#9a70c8","#c58a45"],
    outfit:["#4e3d70","#2d6470","#9c476c","#3f526c","#876044","#303039"],
    bg:["#29213b","#1e3b48","#48273b","#26364c","#3b3428"]
  };
  const options = {
    hairStyle:["Long","Bob","Ponytail","Twin tails","Short","Wavy"],
    faceShape:["Soft oval","Round","Heart"],
    eyeStyle:["Sparkle","Soft","Sharp"],
    outfitStyle:["Academy","Casual","Fantasy","Streetwear"]
  };
  async function api(url, options = {}) {
    const headers = {"Content-Type":"application/json"};
    if (token()) headers["x-auth-token"] = token();
    const response = await fetch(url, {...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  function fail(error, host=root()) {
    if (!host) return;
    host.querySelectorAll(".ai-error").forEach(node => node.remove());
    const p=document.createElement("p"); p.className="ai-error"; p.textContent=error.message || "Something went wrong.";
    host.prepend(p);
  }
  const defaultAppearance = () => ({hairStyle:"Long",faceShape:"Soft oval",eyeStyle:"Sparkle",outfitStyle:"Academy",skin:"#f8d9c5",hair:"#24202d",eyes:"#5b8fc9",outfit:"#4e3d70",background:"#29213b"});
  function appearanceFrom(companion) {
    const stored=companion?.behaviourConfig?.avatarAppearance;
    return {...defaultAppearance(),...(stored && typeof stored==="object"?stored:{})};
  }
  function avatarSvg(a, size=240) {
    const valid=(group,value,fallback)=>palettes[group].includes(value)?value:fallback;
    const skin=valid("skin",a.skin,defaultAppearance().skin),hair=valid("hair",a.hair,defaultAppearance().hair),eyes=valid("eyes",a.eyes,defaultAppearance().eyes),outfit=valid("outfit",a.outfit,defaultAppearance().outfit),bg=valid("bg",a.background,defaultAppearance().background);
    const face=a.faceShape==="Round"?"M75 92 Q75 42 120 42 Q165 42 165 92 Q165 157 120 170 Q75 157 75 92":a.faceShape==="Heart"?"M120 168 Q65 126 76 78 Q86 39 120 66 Q154 39 164 78 Q175 126 120 168":a.faceShape==="Angular"?"M78 79 Q120 27 162 79 L154 137 L120 170 L86 137 Z":"M120 42 Q169 42 164 104 Q160 158 120 170 Q80 158 76 104 Q71 42 120 42";
    const hairBack=({"Soft bob":"M67 110 Q55 24 120 22 Q187 24 174 110 L164 142 Q120 158 76 142 Z","High ponytail":"M68 112 Q54 25 120 22 Q190 24 174 112 L190 150 L164 145 L76 164 Z","Twin tails":"M68 105 Q52 24 120 22 Q188 24 174 105 L185 168 L155 140 L85 140 L55 168 Z","Short cut":"M68 110 Q55 25 120 22 Q188 24 174 110 L158 126 L82 126 Z","Wavy layers":"M65 112 Q49 25 120 22 Q192 24 175 112 Q190 140 164 164 L76 164 Q50 140 65 112 Z","Side braid":"M68 110 Q54 25 120 22 Q190 24 174 110 L182 177 L160 160 L76 164 Z","Hime cut":"M68 110 Q55 24 120 22 Q187 24 174 110 L164 164 L76 164 Z"})[a.hairStyle]||"M68 111 Q53 26 120 22 Q190 25 174 116 L164 164 L76 164 Z";
    const outfitShape=a.outfitStyle==="Fantasy"?"M34 260 L49 205 Q70 183 94 190 L120 215 L146 190 Q170 183 191 205 L206 260 Z":a.outfitStyle==="Gothic"?"M34 260 L48 204 Q75 183 94 190 L120 214 L146 190 Q175 183 192 204 L206 260 Z":"M34 260 Q40 191 120 184 Q200 191 206 260 Z";
    const eyesShape=a.eyeStyle==="Sharp"?"M89 104 Q102 87 115 103 Q103 114 89 104 M125 103 Q138 87 151 104 Q137 114 125 103":a.eyeStyle==="Soft round"?"M92 104 Q102 91 113 104 Q102 117 92 104 M127 104 Q138 91 149 104 Q138 117 127 104":a.eyeStyle==="Dreamy"?"M90 104 Q102 89 115 104 Q102 119 90 104 M125 104 Q138 89 150 104 Q138 119 125 104":"M91 104 Q102 88 113 104 Q102 119 91 104 M127 104 Q138 88 149 104 Q138 119 127 104";
    const mouth=a.expression==="Confident"?"M109 138 Q120 133 132 138":a.expression==="Shy"?"M114 139 Q120 143 126 139":a.expression==="Playful"?"M108 137 Q120 149 133 134":"M109 136 Q120 147 132 136";
    const glasses=a.accessory==="Round glasses"?'<g fill="none" stroke="#382c42" stroke-width="3"><circle cx="102" cy="104" r="13"/><circle cx="138" cy="104" r="13"/><path d="M115 103 L125 103"/></g>':"";
    const clips=a.accessory==="Star clips"?'<g fill="#f8d98a"><path d="M78 58 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z"/><path d="M162 54 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/></g>':a.accessory==="Flower pin"?'<g fill="#f5b6c7"><circle cx="162" cy="65" r="5"/><circle cx="169" cy="71" r="5"/><circle cx="162" cy="77" r="5"/><circle cx="155" cy="71" r="5"/><circle cx="162" cy="71" r="3" fill="#f5d77c"/></g>':a.accessory==="Crescent crown"?'<path d="M91 37 Q120 4 149 37 Q120 22 111 49 Q104 34 91 37" fill="#e8cf93"/>':"";
    const blush=a.makeup==="Rosy cheeks"?'<ellipse cx="87" cy="126" rx="10" ry="5" fill="#ed8f9c" opacity=".35"/><ellipse cx="153" cy="126" rx="10" ry="5" fill="#ed8f9c" opacity=".35"/>':"";
    const headphones=a.accessory==="Headphones"?'<g fill="none" stroke="#d8b8ef" stroke-width="7"><path d="M67 112 Q55 35 120 30 Q185 35 173 112"/><rect x="60" y="104" width="14" height="30" rx="6" fill="#d8b8ef" stroke="none"/><rect x="166" y="104" width="14" height="30" rx="6" fill="#d8b8ef" stroke="none"/></g>':"";
    return '<svg class="ai-avatar-svg" viewBox="0 0 240 260" role="img" aria-label="Custom anime companion avatar" width="'+size+'" height="'+size+'"><defs><clipPath id="aiAvatarClip"><rect width="240" height="260" rx="28"/></clipPath><linearGradient id="aiAvatarGlow" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".13"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><g clip-path="url(#aiAvatarClip)"><rect width="240" height="260" fill="'+bg+'"/><rect width="240" height="260" fill="url(#aiAvatarGlow)"/><circle cx="34" cy="38" r="3" fill="#fff" opacity=".55"/><circle cx="202" cy="54" r="4" fill="#fff" opacity=".5"/><path d="'+outfitShape+'" fill="'+outfit+'"/><path d="M94 177 L94 206 Q120 226 146 206 L146 177" fill="'+skin+'"/><path d="'+hairBack+'" fill="'+hair+'"/><path d="'+face+'" fill="'+skin+'"/><path d="M75 91 Q76 35 121 32 Q167 33 166 93 Q146 71 127 69 Q104 67 75 91" fill="'+hair+'"/><path d="M78 86 Q98 54 121 61 Q144 54 163 85" fill="none" stroke="'+hair+'" stroke-width="11" stroke-linecap="round"/><path d="'+eyesShape+'" fill="#fff" stroke="#302535" stroke-width="2"/><circle cx="103" cy="103" r="5" fill="'+eyes+'"/><circle cx="139" cy="103" r="5" fill="'+eyes+'"/><circle cx="104" cy="101" r="2" fill="#fff"/><circle cx="140" cy="101" r="2" fill="#fff"/><path d="'+(a.brows==="Arched"?"M91 87 Q102 79 113 87 M127 87 Q138 79 149 87":a.brows==="Straight"?"M91 87 L113 87 M127 87 L149 87":"M91 88 Q102 83 113 88 M127 88 Q138 83 149 88")+'" fill="none" stroke="'+hair+'" stroke-width="3" stroke-linecap="round"/><path d="M119 112 Q115 120 120 121" fill="none" stroke="#bd8978" stroke-width="2" stroke-linecap="round"/>'+blush+'<path d="'+mouth+'" fill="none" stroke="#a85d68" stroke-width="2.5" stroke-linecap="round"/><path d="M75 90 Q65 130 80 151" fill="none" stroke="'+hair+'" stroke-width="12" stroke-linecap="round"/><path d="M165 88 Q177 126 160 151" fill="none" stroke="'+hair+'" stroke-width="12" stroke-linecap="round"/>'+clips+glasses+headphones+'<path d="M88 194 Q120 213 152 194" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3"/></g></svg>';
  }
  const avatarChoices = {
    hairStyle:["Long flow","Soft bob","High ponytail","Twin tails","Short cut","Wavy layers","Side braid","Hime cut"],
    faceShape:["Soft oval","Round","Heart","Angular"],
    eyeStyle:["Sparkle","Soft round","Sharp","Dreamy","Bold"],
    brows:["Natural","Arched","Straight"],
    expression:["Gentle smile","Confident","Shy","Playful"],
    outfitStyle:["Academy","Casual","Fantasy","Streetwear","Elegant","Gothic"],
    accessory:["None","Round glasses","Star clips","Headphones","Flower pin","Crescent crown"],
    makeup:["Natural","Rosy cheeks","Winged liner"]
  };
  function choiceTiles(label,name,values,selected) {
    return '<fieldset class="ai-choice-field"><legend>'+label+'</legend><div class="ai-option-tiles">'+values.map((v,i)=>'<button type="button" class="ai-option-tile '+(v===selected?'selected':'')+'" data-avatar-choice="'+name+'" data-value="'+esc(v)+'"><span class="ai-option-glyph">'+(["✦","◈","❋","◇","✧","☾","❀","♡"][i%8])+'</span><span>'+esc(v)+'</span></button>').join("")+'</div></fieldset>';
  }
  function colorField(label,name,values,selected) {
    return '<div class="ai-color-field"><span>'+label+'</span><div class="ai-swatches">'+values.map(v=>'<label class="ai-swatch '+(v===selected?'selected':'')+'" style="--swatch:'+v+'"><input type="radio" name="'+name+'" value="'+v+'" '+(v===selected?'checked':'')+' aria-label="'+v+'"><i></i></label>').join("")+'</div></div>';
  }
  function avatarEditor(a) {
    return '<div class="ai-avatar-studio"><div class="ai-avatar-preview-column"><div class="ai-avatar-stage" id="aiAvatarStage">'+avatarSvg(a)+'</div><div class="ai-preview-caption"><span>LIVE PREVIEW</span><span>✦ YOUR ORIGINAL CHARACTER</span></div></div><div class="ai-avatar-controls"><div class="ai-studio-heading"><span class="ai-step">CHARACTER CREATOR · 01</span><h3>Design every detail</h3><p>Choose a look, layer on details and watch your character change instantly.</p></div><div class="ai-editor-section"><h4>Face & features</h4>'+choiceTiles("Face shape","faceShape",avatarChoices.faceShape,a.faceShape)+choiceTiles("Eye design","eyeStyle",avatarChoices.eyeStyle,a.eyeStyle)+choiceTiles("Brows","brows",avatarChoices.brows,a.brows)+choiceTiles("Expression","expression",avatarChoices.expression,a.expression)+'</div><div class="ai-editor-section"><h4>Hair & styling</h4>'+choiceTiles("Hairstyle","hairStyle",avatarChoices.hairStyle,a.hairStyle)+colorField("Hair colour","hair",palettes.hair,a.hair)+'</div><div class="ai-editor-section"><h4>Outfit & extras</h4>'+choiceTiles("Outfit style","outfitStyle",avatarChoices.outfitStyle,a.outfitStyle)+choiceTiles("Accessory","accessory",avatarChoices.accessory,a.accessory)+choiceTiles("Makeup","makeup",avatarChoices.makeup,a.makeup)+colorField("Outfit colour","outfit",palettes.outfit,a.outfit)+'</div><div class="ai-editor-section ai-editor-colours"><h4>Finishing touches</h4>'+colorField("Skin tone","skin",palettes.skin,a.skin)+colorField("Eye colour","eyes",palettes.eyes,a.eyes)+colorField("Scene","background",palettes.bg,a.background)+'</div><label class="ai-image-url">Or use your own avatar image (HTTPS URL)<input name="avatarUrl" type="url" maxlength="1000" placeholder="https://…"></label></div></div>';
  }
  function bindAvatarEditor(host, initial) {
    const update=()=>{
      const form=host.querySelector(".ai-avatar-controls"); if(!form)return;
      const a={...initial}; new FormData(form).forEach((v,k)=>{if(k!=="avatarUrl")a[k]=v;});
      const stage=host.querySelector("#aiAvatarStage"); if(stage)stage.innerHTML=avatarSvg(a);
      host.querySelectorAll(".ai-swatch").forEach(s=>s.classList.toggle("selected",!!s.querySelector("input:checked")));
      host.querySelectorAll("[data-avatar-choice]").forEach(b=>b.classList.toggle("selected",b.dataset.value===a[b.dataset.avatarChoice]));
    };
    host.querySelectorAll("[data-avatar-choice]").forEach(btn=>btn.addEventListener("click",()=>{
      const form=host.querySelector(".ai-avatar-controls"); if(!form)return;
      const name=btn.dataset.avatarChoice;
      let input=form.querySelector('input[name="'+name+'"]');
      if(!input){input=document.createElement("input");input.type="hidden";input.name=name;form.appendChild(input);}
      input.value=btn.dataset.value;update();
    }));
    host.querySelectorAll(".ai-avatar-controls input[type=radio]").forEach(el=>el.addEventListener("change",update));
    host.querySelectorAll(".ai-avatar-controls input[type=url]").forEach(el=>el.addEventListener("input",()=>{
      const stage=host.querySelector("#aiAvatarStage"); if(!stage)return;
      if(el.value.trim()){stage.innerHTML='<img class="ai-avatar-photo-preview" src="'+esc(el.value.trim())+'" alt="Avatar preview" onerror="this.style.display=\'none\'">';}
      else update();
    }));
  }
  function readAppearance(form, initial) {
    const a={...initial}; new FormData(form).forEach((v,k)=>{if(k!=="avatarUrl")a[k]=v;}); return a;
  }
  function create() {
    const a=defaultAppearance();
    root().innerHTML='<div class="ai-create-intro"><span class="ai-step">YOUR AI COMPANION</span><h3>Create someone unforgettable.</h3><p>Design an anime-style character, then give them a personality and a voice of their own.</p><div class="ai-choice-row"><button type="button" class="ai-choice active" data-preset="custom">Create my own</button><button type="button" class="ai-choice" data-preset="gentle-anime-friend">Gentle friend</button><button type="button" class="ai-choice" data-preset="cheerful-adventurer">Adventurer</button><button type="button" class="ai-choice" data-preset="playful-rival">Playful rival</button></div></div>'+
      '<form id="aiCreateForm" class="ai-create-card"><div class="ai-form-section"><span class="ai-step">01 / AVATAR</span><h3>Make them yours</h3>'+avatarEditor(a)+'</div><div class="ai-form-section"><span class="ai-step">02 / PERSONALITY</span><h3>Who are they?</h3><div class="ai-personality-grid"><label>Companion name <small>Optional — we will choose a name if you skip this.</small><input name="name" maxlength="60" placeholder="e.g. Aiko"></label><label>Personality type<select name="personalityType"><option value="preset">Premade personality</option><option value="custom">Custom personality</option></select></label><label>Short introduction<textarea name="bio" maxlength="500" placeholder="How would they introduce themselves?"></textarea></label><label>Backstory<textarea name="backstory" maxlength="2500" placeholder="Their world, history, dreams…"></textarea></label><label>Speaking style<textarea name="speakingStyle" maxlength="800" placeholder="Warm, witty, shy, poetic…"></textarea></label><label>Likes<input name="likes" placeholder="Music, stargazing, ramen…"></label><label>Dislikes<input name="dislikes" placeholder="Comma-separated"></label></div><input type="hidden" name="personalityPreset" value="gentle-anime-friend"><input type="hidden" name="behaviourConfig" value=""></div><button class="primary ai-create-submit" type="submit">Create my companion <span>✦</span></button><p class="ai-form-note">One companion per account. You can change their look and personality later without deleting their memories.</p></form>';
    const form=root().querySelector("#aiCreateForm"), studio=root();
    bindAvatarEditor(studio,a);
    studio.querySelectorAll("[data-preset]").forEach(btn=>btn.onclick=()=>{
      studio.querySelectorAll("[data-preset]").forEach(x=>x.classList.toggle("active",x===btn));
      form.elements.personalityPreset.value=btn.dataset.preset==="custom"?"gentle-anime-friend":btn.dataset.preset;
      if(btn.dataset.preset==="gentle-anime-friend"){form.elements.speakingStyle.value="Gentle, warm, thoughtful and reassuring.";form.elements.bio.value="A kind anime friend who loves meaningful conversations.";}
      if(btn.dataset.preset==="cheerful-adventurer"){form.elements.speakingStyle.value="Energetic, curious, optimistic and playful.";form.elements.bio.value="A cheerful adventurer who is always ready to explore.";}
      if(btn.dataset.preset==="playful-rival"){form.elements.speakingStyle.value="Teasing, competitive, secretly caring.";form.elements.bio.value="A spirited rival who turns every conversation into a fun challenge.";}
      if(btn.dataset.preset==="custom"){form.elements.speakingStyle.value="";form.elements.bio.value="";}
    });
    form.onsubmit=async event=>{
      event.preventDefault(); const submit=form.querySelector(".ai-create-submit");
      root().querySelectorAll(".ai-error").forEach(n=>n.remove());
      const data=Object.fromEntries(new FormData(form));
      data.name=String(data.name||"").trim()||"My Companion";
      data.likes=String(data.likes||"").split(",").map(x=>x.trim()).filter(Boolean);
      data.dislikes=String(data.dislikes||"").split(",").map(x=>x.trim()).filter(Boolean);
      const appearance=readAppearance(form,a);
      data.behaviourConfig={avatarAppearance:appearance};
      if(submit){submit.disabled=true;submit.textContent="Creating your companion…";}
      try{await api("/api/ai-companion",{method:"POST",body:data});await load();}
      catch(error){fail(error);if(submit){submit.disabled=false;submit.innerHTML='Create my companion <span>✦</span>';}}
    };
  }
  function render(data) {
    const c=data.companion,messages=data.messages||[],memories=data.memories||[],appearance=appearanceFrom(c);
    const avatar=c.avatarUrl?'<img src="'+esc(c.avatarUrl)+'" alt="'+esc(c.name)+' avatar" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'✦\'))">':avatarSvg(appearance,180);
    root().innerHTML='<section class="ai-companion-dashboard"><div class="ai-companion-hero"><div class="ai-hero-avatar">'+avatar+'</div><div class="ai-hero-copy"><span class="ai-step">YOUR COMPANION</span><h3>'+esc(c.name)+'</h3><p>'+esc(c.bio||"Your anime companion is ready to talk.")+'</p><span class="ai-tag">✦ '+esc((c.personalityPreset||"custom").replace(/-/g," "))+'</span></div><button type="button" class="primary ai-talk-jump" id="aiTalkJump">Talk now ↘</button></div>'+
      '<nav class="ai-tabs"><button type="button" class="active" data-tab="talk">Talk</button><button type="button" data-tab="avatar">Avatar studio</button><button type="button" data-tab="personality">Personality</button><button type="button" data-tab="memories">Memories ('+memories.length+')</button></nav>'+
      '<section class="ai-tab-panel" data-panel="talk"><div class="ai-chat-card"><div class="ai-section-head"><div><span class="ai-step">PRIVATE SPACE</span><h3>Conversation with '+esc(c.name)+'</h3></div><button id="aiClearHistory" class="ai-secondary" type="button">Clear chat</button></div><div class="ai-messages" id="aiMessages">'+(messages.map(m=>'<article class="ai-message '+(m.sender_type==="owner"?"owner":"companion")+'"><b>'+(m.sender_type==="owner"?"You":esc(c.name))+'</b><p>'+esc(m.message_content)+'</p></article>').join("")||'<p class="muted ai-empty-chat">Say hello. Your companion is listening.</p>')+'</div><form id="aiChat"><textarea name="message" maxlength="1200" required placeholder="Message your companion…"></textarea><button class="primary" type="submit">Send ↗</button></form><p class="ai-form-note">Your companion uses their personality and approved memories to shape replies.</p></div></section>'+
      '<section class="ai-tab-panel hidden" data-panel="avatar"><form id="aiAvatarForm" class="ai-create-card"><div class="ai-form-section"><span class="ai-step">AVATAR STUDIO</span><h3>Change their look</h3>'+avatarEditor(appearance)+'</div><button class="primary" type="submit">Save appearance</button></form></section>'+
      '<section class="ai-tab-panel hidden" data-panel="personality"><form id="aiEdit" class="ai-create-card"><span class="ai-step">PERSONALITY SETTINGS</span><h3>Make them more them</h3><div class="ai-personality-grid"><label>Name<input name="name" maxlength="60" value="'+esc(c.name)+'"></label><label>Personality type<select name="personalityType"><option value="preset" '+(c.personalityType!=="custom"?"selected":"")+'>Premade</option><option value="custom" '+(c.personalityType==="custom"?"selected":"")+'>Custom</option></select></label><label>Preset<select name="personalityPreset">'+["gentle-anime-friend","cheerful-adventurer","calm-and-wise","playful-rival"].map(x=>'<option value="'+x+'" '+(c.personalityPreset===x?"selected":"")+'>'+x.replace(/-/g," ")+'</option>').join("")+'</select></label><label>Introduction<textarea name="bio" maxlength="500">'+esc(c.bio)+'</textarea></label><label>Backstory<textarea name="backstory" maxlength="2500">'+esc(c.backstory)+'</textarea></label><label>Speaking style<textarea name="speakingStyle" maxlength="800">'+esc(c.speakingStyle)+'</textarea></label><label>Likes<input name="likes" value="'+esc((c.likes||[]).join(", "))+'"></label><label>Dislikes<input name="dislikes" value="'+esc((c.dislikes||[]).join(", "))+'"></label></div><button class="primary" type="submit">Save personality</button></form></section>'+
      '<section class="ai-tab-panel hidden" data-panel="memories"><div class="ai-memory-card"><div class="ai-section-head"><div><span class="ai-step">SHARED HISTORY</span><h3>What '+esc(c.name)+' remembers</h3></div><button id="aiClearMemories" class="ai-secondary" type="button">Clear all</button></div><form id="aiMemory"><input name="content" maxlength="1000" required placeholder="Add something for your companion to remember…"><button class="primary" type="submit">Save memory</button></form><div class="ai-memory-list">'+(memories.map(m=>'<article class="ai-memory"><p>'+esc(m.memory_content)+'</p><small>Importance '+m.importance+'/5</small><div><button type="button" data-edit="'+m.id+'">Edit</button><button type="button" data-delete="'+m.id+'">Delete</button></div></article>').join("")||'<p class="muted">No memories saved yet.</p>')+'</div></div></section></section>';
    const tabs=root().querySelectorAll("[data-tab]");
    function activate(tab){tabs.forEach(t=>t.classList.toggle("active",t.dataset.tab===tab));root().querySelectorAll("[data-panel]").forEach(p=>p.classList.toggle("hidden",p.dataset.panel!==tab));}
    tabs.forEach(t=>t.onclick=()=>activate(t.dataset.tab));
    root().querySelector("#aiTalkJump").onclick=()=>{activate("talk");root().querySelector("#aiChat textarea").focus();};
    const avatarForm=root().querySelector("#aiAvatarForm");bindAvatarEditor(avatarForm,appearance);
    avatarForm.onsubmit=async e=>{e.preventDefault();const a=readAppearance(avatarForm,appearance),url=avatarForm.elements.avatarUrl.value.trim();try{await api("/api/ai-companion",{method:"PATCH",body:{avatarUrl:url||"",behaviourConfig:{...(c.behaviourConfig||{}),avatarAppearance:a}}});await load();}catch(error){fail(error);}};
    root().querySelector("#aiEdit").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));d.name=String(d.name||"").trim()||"My Companion";d.likes=String(d.likes||"").split(",").map(x=>x.trim()).filter(Boolean);d.dislikes=String(d.dislikes||"").split(",").map(x=>x.trim()).filter(Boolean);d.behaviourConfig=c.behaviourConfig||{};try{await api("/api/ai-companion",{method:"PATCH",body:d});await load();}catch(error){fail(error);}};
    root().querySelector("#aiChat").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,message=form.elements.message.value.trim();if(!message)return;const send=form.querySelector("button");send.disabled=true;send.textContent="Sending…";try{await api("/api/ai-companion/chat",{method:"POST",body:{message}});await load();}catch(error){fail(error);send.disabled=false;send.textContent="Send ↗";}};
    root().querySelector("#aiMemory").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;try{await api("/api/ai-companion/memories",{method:"POST",body:{content:form.elements.content.value}});await load();activate("memories");}catch(error){fail(error);}};
    root().querySelector("#aiClearHistory").onclick=async()=>{if(confirm("Clear chat history? Memories will remain."))try{await api("/api/ai-companion/history",{method:"DELETE",body:{}});await load();}catch(error){fail(error);}};
    root().querySelector("#aiClearMemories").onclick=async()=>{if(confirm("Delete all memories? Chat history will remain."))try{await api("/api/ai-companion/memories",{method:"DELETE",body:{}});await load();}catch(error){fail(error);}};
    root().querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{try{await api("/api/ai-companion/memories/"+b.dataset.delete,{method:"DELETE",body:{}});await load();activate("memories");}catch(error){fail(error);}});
    root().querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{const old=memories.find(m=>String(m.id)===b.dataset.edit),value=prompt("Edit memory",old.memory_content);if(value===null)return;try{await api("/api/ai-companion/memories/"+b.dataset.edit,{method:"PATCH",body:{content:value,importance:old.importance,sensitivity:old.sensitivity}});await load();activate("memories");}catch(error){fail(error);}});
    const box=root().querySelector("#aiMessages");if(box)box.scrollTop=box.scrollHeight;
  }
  async function load(){
    if(!root())return;root().innerHTML='<p class="muted">Loading your companion…</p>';
    try{const data=await api("/api/ai-companion");if(data.companion)render(data);else create();}
    catch(error){root().innerHTML='<div class="ai-unavailable"><h3>AI Companion</h3><p>'+esc(error.message)+'</p><p class="muted">MC access begins at Premium rank. The AI provider key and database setup must be configured before conversations can generate replies.</p></div>';}
  }
  let loadInProgress=false;
  async function loadWhenVisible(){if(loadInProgress)return;loadInProgress=true;try{await load();}finally{loadInProgress=false;}}
  document.addEventListener("mc:open-ai-companion",loadWhenVisible);
  const companionView=document.getElementById("viewAiCompanion");
  if(companionView&&typeof MutationObserver!=="undefined"){const observer=new MutationObserver(()=>{if(!companionView.classList.contains("hidden"))loadWhenVisible();});observer.observe(companionView,{attributes:true,attributeFilter:["class"]});if(!companionView.classList.contains("hidden"))loadWhenVisible();}
  else if(companionView&&!companionView.classList.contains("hidden"))loadWhenVisible();
})();