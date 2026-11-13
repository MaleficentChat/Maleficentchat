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
    let response;
    try {
      response = await fetch(url, {...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal || AbortSignal.timeout(45000)});
    } catch(error) {
      if(error?.name==="TimeoutError"||error?.name==="AbortError") throw new Error("This request took too long. Check your connection and try again.");
      throw error;
    }
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
  const defaultAppearance = () => ({hairStyle:"Long flow",faceShape:"Soft oval",eyeStyle:"Sparkle",outfitStyle:"Academy",topStyle:"Academy blouse",bottomStyle:"Pleated skirt",footwear:"Ankle boots",skin:"#f8d9c5",hair:"#24202d",eyes:"#5b8fc9",outfit:"#4e3d70",background:"#29213b"});
  function appearanceFrom(companion) {
    const stored=companion?.behaviourConfig?.avatarAppearance;
    return {...defaultAppearance(),...(stored && typeof stored==="object"?stored:{})};
  }
  function avatarSvg(a, size=240) {
    const valid=(group,value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value||""))?String(value):fallback;
    const skin=valid("skin",a.skin,defaultAppearance().skin),hair=valid("hair",a.hair,defaultAppearance().hair),eyes=valid("eyes",a.eyes,defaultAppearance().eyes),outfit=valid("outfit",a.outfit,defaultAppearance().outfit),bg=valid("bg",a.background,defaultAppearance().background);
    const face=a.faceShape==="Round"?"M75 92 Q75 42 120 42 Q165 42 165 92 Q165 157 120 170 Q75 157 75 92":a.faceShape==="Heart"?"M120 168 Q65 126 76 78 Q86 39 120 66 Q154 39 164 78 Q175 126 120 168":a.faceShape==="Angular"?"M78 79 Q120 27 162 79 L154 137 L120 170 L86 137 Z":a.faceShape==="Diamond"?"M120 35 Q163 62 165 103 L120 174 L75 103 Q77 62 120 35":a.faceShape==="Long"?"M120 30 Q169 32 162 105 Q158 166 120 178 Q82 166 78 105 Q71 32 120 30":"M120 42 Q169 42 164 104 Q160 158 120 170 Q80 158 76 104 Q71 42 120 42";
    const hairBack=({"Soft bob":"M67 110 Q55 24 120 22 Q187 24 174 110 L164 142 Q120 158 76 142 Z","High ponytail":"M68 112 Q54 25 120 22 Q190 24 174 112 L190 150 L164 145 L76 164 Z","Twin tails":"M68 105 Q52 24 120 22 Q188 24 174 105 L185 168 L155 140 L85 140 L55 168 Z","Short cut":"M68 110 Q55 25 120 22 Q188 24 174 110 L158 126 L82 126 Z","Wavy layers":"M65 112 Q49 25 120 22 Q192 24 175 112 Q190 140 164 164 L76 164 Q50 140 65 112 Z","Side braid":"M68 110 Q54 25 120 22 Q190 24 174 110 L182 177 L160 160 L76 164 Z","Hime cut":"M68 110 Q55 24 120 22 Q187 24 174 110 L164 164 L76 164 Z"})[a.hairStyle]||"M68 111 Q53 26 120 22 Q190 25 174 116 L164 164 L76 164 Z";
    const outfitShape=a.outfitStyle==="Fantasy"?"M34 260 L49 205 Q70 183 94 190 L120 215 L146 190 Q170 183 191 205 L206 260 Z":a.outfitStyle==="Gothic"?"M34 260 L48 204 Q75 183 94 190 L120 214 L146 190 Q175 183 192 204 L206 260 Z":"M34 260 Q40 191 120 184 Q200 191 206 260 Z";
    const eyesShape=a.eyeStyle==="Sharp"?"M89 104 Q102 87 115 103 Q103 114 89 104 M125 103 Q138 87 151 104 Q137 114 125 103":a.eyeStyle==="Soft round"?"M92 104 Q102 91 113 104 Q102 117 92 104 M127 104 Q138 91 149 104 Q138 117 127 104":a.eyeStyle==="Dreamy"?"M90 104 Q102 89 115 104 Q102 119 90 104 M125 104 Q138 89 150 104 Q138 119 125 104":"M91 104 Q102 88 113 104 Q102 119 91 104 M127 104 Q138 88 149 104 Q138 119 127 104";
    const mouth=a.mouthStyle==="Pout"?"M109 138 Q120 132 132 138":a.mouthStyle==="Open smile"?"M109 136 Q120 153 132 136":a.mouthStyle==="Small smile"?"M112 138 Q120 144 128 138":a.expression==="Confident"?"M109 138 Q120 133 132 138":a.expression==="Shy"?"M114 139 Q120 143 126 139":a.expression==="Playful"?"M108 137 Q120 149 133 134":"M109 136 Q120 147 132 136";
    const glasses=a.accessory==="Round glasses"?'<g fill="none" stroke="#382c42" stroke-width="3"><circle cx="102" cy="104" r="13"/><circle cx="138" cy="104" r="13"/><path d="M115 103 L125 103"/></g>':"";
    const clips=a.accessory==="Star clips"?'<g fill="#f8d98a"><path d="M78 58 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z"/><path d="M162 54 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/></g>':a.accessory==="Flower pin"?'<g fill="#f5b6c7"><circle cx="162" cy="65" r="5"/><circle cx="169" cy="71" r="5"/><circle cx="162" cy="77" r="5"/><circle cx="155" cy="71" r="5"/><circle cx="162" cy="71" r="3" fill="#f5d77c"/></g>':a.accessory==="Crescent crown"?'<path d="M91 37 Q120 4 149 37 Q120 22 111 49 Q104 34 91 37" fill="#e8cf93"/>':"";
    const blush=a.makeup==="Rosy cheeks"?'<ellipse cx="87" cy="126" rx="10" ry="5" fill="#ed8f9c" opacity=".35"/><ellipse cx="153" cy="126" rx="10" ry="5" fill="#ed8f9c" opacity=".35"/>':"";
    const headphones=a.accessory==="Headphones"?'<g fill="none" stroke="#d8b8ef" stroke-width="7"><path d="M67 112 Q55 35 120 30 Q185 35 173 112"/><rect x="60" y="104" width="14" height="30" rx="6" fill="#d8b8ef" stroke="none"/><rect x="166" y="104" width="14" height="30" rx="6" fill="#d8b8ef" stroke="none"/></g>':"";
    return '<svg class="ai-avatar-svg" viewBox="0 0 240 260" role="img" aria-label="Custom anime companion avatar" width="'+size+'" height="'+size+'"><defs><clipPath id="aiAvatarClip"><rect width="240" height="260" rx="28"/></clipPath><linearGradient id="aiAvatarGlow" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".13"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><g clip-path="url(#aiAvatarClip)"><rect width="240" height="260" fill="'+bg+'"/><rect width="240" height="260" fill="url(#aiAvatarGlow)"/><circle cx="34" cy="38" r="3" fill="#fff" opacity=".55"/><circle cx="202" cy="54" r="4" fill="#fff" opacity=".5"/><path d="'+outfitShape+'" fill="'+outfit+'"/><path d="M94 177 L94 206 Q120 226 146 206 L146 177" fill="'+skin+'"/><path d="'+hairBack+'" fill="'+hair+'"/><path d="'+face+'" fill="'+skin+'"/><path d="M75 91 Q76 35 121 32 Q167 33 166 93 Q146 71 127 69 Q104 67 75 91" fill="'+hair+'"/><path d="M78 86 Q98 54 121 61 Q144 54 163 85" fill="none" stroke="'+hair+'" stroke-width="11" stroke-linecap="round"/><path d="'+eyesShape+'" fill="#fff" stroke="#302535" stroke-width="2"/><circle cx="103" cy="103" r="5" fill="'+eyes+'"/><circle cx="139" cy="103" r="5" fill="'+eyes+'"/><circle cx="104" cy="101" r="2" fill="#fff"/><circle cx="140" cy="101" r="2" fill="#fff"/><path d="'+(a.brows==="Arched"?"M91 87 Q102 79 113 87 M127 87 Q138 79 149 87":a.brows==="Straight"?"M91 87 L113 87 M127 87 L149 87":"M91 88 Q102 83 113 88 M127 88 Q138 83 149 88")+'" fill="none" stroke="'+hair+'" stroke-width="3" stroke-linecap="round"/><path d="'+(a.noseStyle==="Defined"?"M120 109 Q112 122 120 124":a.noseStyle==="Button"?"M117 119 Q120 122 123 119":"M119 112 Q115 120 120 121")+'" fill="none" stroke="#bd8978" stroke-width="2" stroke-linecap="round"/>'+blush+'<path d="'+mouth+'" fill="none" stroke="#a85d68" stroke-width="2.5" stroke-linecap="round"/><path d="M75 90 Q65 130 80 151" fill="none" stroke="'+hair+'" stroke-width="12" stroke-linecap="round"/><path d="M165 88 Q177 126 160 151" fill="none" stroke="'+hair+'" stroke-width="12" stroke-linecap="round"/>'+clips+glasses+headphones+'<path d="M88 194 Q120 213 152 194" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3"/></g></svg>';
  }
  const avatarChoices = {
    hairStyle:["Long flow","Soft bob","High ponytail","Twin tails","Short cut","Wavy layers","Side braid","Hime cut"],
    faceShape:["Soft oval","Round","Heart","Angular","Diamond","Long"],
    eyeStyle:["Sparkle","Soft round","Sharp","Dreamy","Bold","Wide"],
    noseStyle:["Button","Soft","Defined"],
    mouthStyle:["Gentle smile","Small smile","Open smile","Pout"],
    bodyType:["Petite","Balanced","Curvy"],
    brows:["Natural","Arched","Straight"],
    expression:["Gentle smile","Confident","Shy","Playful"],
    outfitStyle:["Academy","Casual","Fantasy","Streetwear","Elegant","Gothic","Hoodie","Summer dress","Denim jacket","Punk"],
    topStyle:["Academy blouse","Crop top","Oversized hoodie","Cardigan","Off-shoulder","Leather jacket","Ruffle blouse","Knit sweater"],
    bottomStyle:["Pleated skirt","Mini skirt","Wide-leg trousers","Skinny jeans","Shorts","Flowy maxi skirt","Cargo pants"],
    footwear:["Ankle boots","High-top sneakers","Mary Janes","Platform boots","Heels","Knee-high boots"],
    accessory:["None","Round glasses","Star clips","Headphones","Flower pin","Crescent crown"],
    makeup:["Natural","Rosy cheeks","Winged liner"]
  };
  function optionPreview(name,value,index) {
    const palette=["#c58b9c","#b98b65","#8d91b9","#739b91","#d1b77c","#7c668e"];
    const c=palette[index%palette.length], skin="#f0c8b2", hair="#423142";
    let art="";
    if(name==="topStyle") {
      const jacket=["Cardigan","Leather jacket","Oversized hoodie"].includes(value);
      art='<path d="M19 16 Q32 8 45 16 L53 49 H11Z" fill="'+c+'" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>'+(jacket?'<path d="M32 15 L32 49 M23 18 L32 27 L41 18" stroke="#f4e7dc" stroke-width="2" fill="none"/>':value==="Off-shoulder"?'<path d="M19 22 Q32 31 45 22" stroke="#f4d6df" stroke-width="4" fill="none"/>':value==="Ruffle blouse"?'<path d="M24 18 Q32 28 40 18 M24 25 Q32 35 40 25" stroke="#f4e7dc" stroke-width="2" fill="none"/>':'<path d="M26 17 L32 27 L38 17" fill="none" stroke="#f4e7dc" stroke-width="2"/>');
    } else if(name==="bottomStyle") {
      const skirt=["Pleated skirt","Mini skirt","Flowy maxi skirt"].includes(value);
      art=skirt?'<path d="M21 9 L43 9 L56 50 H8Z" fill="'+c+'" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/><path d="M25 14 L18 46 M32 14 L32 48 M39 14 L46 46" stroke="#f4e7dc" stroke-width="1.5"/>':'<path d="M18 9 L46 9 L43 50 H31 L30 23 L28 50 H16Z" fill="'+c+'" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>'+(value==="Cargo pants"?'<rect x="35" y="27" width="9" height="10" rx="2" fill="#f4e7dc"/>':'');
    } else if(name==="footwear") {
      art='<path d="M10 30 Q19 29 24 36 L26 46 H8Z M38 36 Q44 29 54 30 L56 46 H38Z" fill="'+c+'" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/><path d="M8 46 H26 M38 46 H56" stroke="#f4e7dc" stroke-width="3"/>';
    } else if(name==="outfitStyle") {
      const isDress=["Fantasy","Elegant","Summer dress","Gothic"].includes(value);
      const body=isDress?'<path d="M20 18 Q32 12 44 18 L57 51 H7Z" fill="'+c+'" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>':'<path d="M20 17 L44 17 L51 49 H13Z" fill="'+c+'" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>';
      const detail=value==="Academy"?'<path d="M27 18 L37 18 L32 37Z" fill="#f4e7dc"/><path d="M32 21 L29 29 L32 38 L35 29Z" fill="#493b59"/>':value==="Hoodie"?'<path d="M24 17 Q32 4 40 17" fill="none" stroke="'+c+'" stroke-width="5"/><rect x="24" y="33" width="16" height="7" rx="3" fill="rgba(0,0,0,.2)"/>':value==="Gothic"?'<path d="M18 32 L46 32 L57 51 H7Z" fill="#302536"/><path d="M32 18 L28 28 L32 33 L36 28Z" fill="#e8cf93"/>':value==="Fantasy"?'<path d="M18 19 L8 48 M46 19 L56 48" stroke="#e8cf93" stroke-width="4"/>':value==="Streetwear"||value==="Denim jacket"||value==="Punk"?'<path d="M23 20 L15 39 M41 20 L49 39" stroke="#e8cf93" stroke-width="3"/>':isDress?'<path d="M19 34 Q32 42 45 34" stroke="#f4d6df" stroke-width="3" fill="none"/>':'<path d="M25 18 L32 27 L39 18" fill="none" stroke="#f4e7dc" stroke-width="2"/>';
      art=body+detail;
    } else if(name==="hairStyle") {
      const hairShape=value==="Soft bob"||value==="Bob"?"M14 30 Q10 4 32 5 Q54 4 50 30 L45 39 Q32 33 19 39Z":value==="High ponytail"||value==="Ponytail"?"M15 27 Q11 4 32 5 Q54 4 49 27 L57 42 L48 38 L44 18Z":value==="Twin tails"||value==="Twin tails"?"M15 26 Q10 4 32 5 Q54 4 49 26 L58 48 L48 42 L16 42 L6 48Z":value==="Short cut"||value==="Short"?"M15 27 Q11 4 32 5 Q54 4 49 27 L44 31 L20 31Z":value==="Side braid"?"M15 27 Q10 4 32 5 Q54 4 49 27 L53 47 L45 43 L20 39Z":"M14 29 Q8 4 32 5 Q56 4 50 29 L53 50 L44 46 L20 46 L11 50Z";
      art=hairShape+'<ellipse cx="32" cy="26" rx="14" ry="17" fill="'+skin+'"/><path d="M18 22 Q32 4 46 22" fill="none" stroke="'+hair+'" stroke-width="4"/>';
    } else if(["faceShape","eyeStyle","noseStyle","mouthStyle","brows","expression"].includes(name)) {
      const rx=value==="Long"?11:value==="Round"?17:value==="Angular"||value==="Diamond"?12:14;
      art='<ellipse cx="32" cy="28" rx="'+rx+'" ry="'+(value==="Long"?20:17)+'" fill="'+skin+'" stroke="rgba(255,255,255,.5)"/><path d="M23 26 Q27 23 30 26 M35 26 Q39 23 42 26" stroke="'+hair+'" stroke-width="2" fill="none"/><circle cx="27" cy="29" r="2" fill="#493447"/><circle cx="38" cy="29" r="2" fill="#493447"/><path d="M29 39 Q32 42 36 39" stroke="#a75d69" stroke-width="2" fill="none"/>';
    } else {
      art='<circle cx="32" cy="27" r="16" fill="'+skin+'"/><path d="M15 27 Q13 6 32 7 Q52 7 49 27" fill="'+c+'"/><path d="M17 48 Q32 37 47 48" stroke="'+c+'" stroke-width="7" fill="none"/>';
    }
    return '<svg class="ai-option-preview" viewBox="0 0 64 54" aria-hidden="true">'+art+'</svg>';
  }
  function choiceTiles(label,name,values,selected) {
    return '<fieldset class="ai-choice-field"><legend>'+label+'</legend><div class="ai-option-tiles">'+values.map((v,i)=>'<button type="button" class="ai-option-tile '+(v===selected?'selected':'')+'" data-avatar-choice="'+name+'" data-value="'+esc(v)+'">'+optionPreview(name,v,i)+'<span>'+esc(v)+'</span></button>').join("")+'</div></fieldset>';
  }
  function colorField(label,name,values,selected) {
    return '<div class="ai-color-field"><span>'+label+'</span><div class="ai-swatches">'+values.map(v=>'<label class="ai-swatch '+(v===selected?'selected':'')+'" style="--swatch:'+v+'"><input type="radio" name="'+name+'" value="'+v+'" '+(v===selected?'checked':'')+' aria-label="'+v+'"><i></i></label>').join("")+'<label class="ai-custom-swatch" title="Choose a custom colour"><input type="color" data-color-for="'+name+'" value="'+(/^#[0-9a-f]{6}$/i.test(selected||"")?selected:values[0])+'" aria-label="Custom '+label+'"></label></div></div>';
  }
  let threeLoaderPromise=null;
  const threeScenes=new WeakMap();
  function loadThree(){
    if(window.THREE)return Promise.resolve(window.THREE);
    if(threeLoaderPromise)return threeLoaderPromise;
    threeLoaderPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js';
      script.async=true;script.onload=()=>window.THREE?resolve(window.THREE):reject(new Error('3D engine did not initialize.'));
      script.onerror=()=>reject(new Error('The 3D engine could not load. Check your connection and try again.'));
      document.head.appendChild(script);
    });
    return threeLoaderPromise;
  }
  function make3DCharacter(THREE,a){
    const group=new THREE.Group();
    const mat=(color,roughness=.72,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
    const skin=mat(a.skin), hair=mat(a.hair,.48), outfit=mat(a.outfit,.62), eye=mat(a.eyes,.25), white=mat('#fff',.24), dark=mat('#302535'), blush=mat('#e98e9d');
    const sphere=(parent,m,pos,scale,seg=32)=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,seg,Math.max(16,seg/2)),m);mesh.position.set(...pos);mesh.scale.set(...scale);parent.add(mesh);return mesh;};
    const cylinder=(parent,m,pos,rt,rb,h)=>{const mesh=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,40),m);mesh.position.set(...pos);parent.add(mesh);return mesh;};
    const torso=cylinder(group,outfit,[0,-1.12,0],.68,.84,1.25);
    torso.scale.x=a.bodyType==="Petite"?.88:a.bodyType==="Curvy"?1.18:1.06;
    torso.scale.y=a.bodyType==="Petite"?1.06:1;
    sphere(group,outfit,[-.48,-.72,0],[.42,.38,.38]);sphere(group,outfit,[.48,-.72,0],[.42,.38,.38]);
    const limb=(parent,material,start,end,radius)=>{const a=new THREE.Vector3(...start),b=new THREE.Vector3(...end),delta=b.clone().sub(a);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius*.78,radius,delta.length(),24),material);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());parent.add(mesh);return mesh;};
    const sleeve=mat(a.outfit,.68), shoe=mat('#29242d',.52), skinDetail=skin;
    // Full-body silhouette: shoulders, articulated-looking arms, hands, legs and shoes.
    limb(group,sleeve,[-.52,-.7,0],[-.82,-1.42,.02],.19);limb(group,sleeve,[.52,-.7,0],[.82,-1.42,.02],.19);
    sphere(group,skinDetail,[-.82,-1.52,.03],[.14,.18,.14]);sphere(group,skinDetail,[.82,-1.52,.03],[.14,.18,.14]);
    limb(group,mat(a.outfit,.78),[-.34,-1.62,0],[-.36,-2.38,0],.22);limb(group,mat(a.outfit,.78),[.34,-1.62,0],[.36,-2.38,0],.22);
    sphere(group,shoe,[-.36,-2.43,.08],[.25,.15,.38]);sphere(group,shoe,[.36,-2.43,.08],[.25,.15,.38]);
    sphere(group,mat('#fff',.8),[-.36,-2.39,.34],[.16,.055,.06]);sphere(group,mat('#fff',.8),[.36,-2.39,.34],[.16,.055,.06]);
    cylinder(group,skin,[0,-.34,0],.23,.25,.48);
    const head=new THREE.Group();group.add(head);head.position.set(0,.62,0);
    const faceScale=a.faceShape==="Round"?[.78,.82,.6]:a.faceShape==="Heart"?[.72,.84,.57]:a.faceShape==="Angular"?[.72,.86,.59]:a.faceShape==="Diamond"?[.69,.9,.57]:a.faceShape==="Long"?[.69,.98,.57]:[.72,.88,.58];
    const face=sphere(head,skin,[0,0,0],faceScale,48);
    sphere(head,skin,[-.72,-.05,0],[.14,.22,.13]);sphere(head,skin,[.72,-.05,0],[.14,.22,.13]);
    sphere(head,hair,[0,.58,-.02],[.79,.48,.62],40);
    const bangMat=hair;
    for(let i=0;i<5;i++){const x=-.53+i*.265;const lock=sphere(head,bangMat,[x,.49+Math.sin(i*.9)*.08,.43],[.22,.46,.17],24);lock.rotation.z=(i-2)*-.12;}
    const longHair=a.hairStyle==='Short cut'?false:true;
    if(longHair){
      const left=sphere(head,hair,[-.66,-.38,-.02],[.22,.94,.29],36),right=sphere(head,hair,[.66,-.38,-.02],[.22,.94,.29],36);
      left.rotation.z=-.05;right.rotation.z=.05;
      if(a.hairStyle==='Wavy layers'){for(const side of [-1,1])for(let i=0;i<3;i++){const strand=sphere(head,hair,[side*(.69+i*.045),-.48-i*.17,.12],[.095,.25,.11],20);strand.rotation.z=side*(.12+i*.08);}}
      if(a.hairStyle==='Hime cut'){for(const side of [-1,1]){const panel=sphere(head,hair,[side*.69,-.28,.23],[.15,.56,.14],28);panel.rotation.z=side*.02;}}
    }
    if(a.hairStyle==='Twin tails'){for(const side of [-1,1]){const tail=sphere(head,hair,[side*.91,.05,-.08],[.24,.74,.25],32);tail.rotation.z=side*.12;sphere(head,mat('#e8cf93',.35,.3),[side*.91,.57,.04],[.16,.09,.15],20);}}
    if(a.hairStyle==='High ponytail'){const pony=sphere(head,hair,[.02,.82,-.55],[.28,.78,.25],32);pony.rotation.x=-.45;sphere(head,hair,[.02,.25,-.5],[.18,.2,.18],24);}
    if(a.hairStyle==='Side braid'){for(let i=0;i<9;i++){const bead=sphere(head,hair,[.78,-.12-i*.14,.12],[.13,.16,.14],24);bead.rotation.z=-.12;}sphere(head,mat('#e8cf93',.35,.3),[.78,-1.32,.12],[.13,.07,.12],20);}
    if(a.hairStyle==='Soft bob'){for(const side of [-1,1]){const curl=sphere(head,hair,[side*.62,-.48,.08],[.22,.28,.2],28);curl.rotation.z=side*.2;}}
    const hairHighlight=mat(a.hair,.34),hairCurve=(points,r=.012)=>{const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));head.add(new THREE.Mesh(new THREE.TubeGeometry(curve,20,r,6,false),hairHighlight));};
    for(let i=0;i<5;i++){const x=-.42+i*.21;hairCurve([[x,.78,.37],[x-.04,.58,.52],[x+.02,.28,.55],[x+.08,.05,.48]],.009);}
    const eyeScale=a.eyeStyle==="Wide"?[.22,.17,.095]:a.eyeStyle==="Sharp"?[.22,.105,.075]:a.eyeStyle==="Soft round"?[.18,.17,.09]:a.eyeStyle==="Bold"?[.22,.18,.11]:[.205,.145,.09];
    for(const x of [-.29,.29]){
      sphere(head,mat('#b77d83',.8),[x,-.055,.493],[eyeScale[0]*1.12,eyeScale[1]*1.18,.045]);
      sphere(head,white,[x,-.06,.525],eyeScale);
      sphere(head,eye,[x,-.065,.608],[.098,.118,.038]);
      sphere(head,mat('#17202d',.22),[x,-.065,.637],[.054,.082,.022]);
      sphere(head,white,[x-.028,.005,.657],[.029,.034,.014]);
      sphere(head,white,[x+.035,-.11,.653],[.012,.014,.009]);
      const lid=new THREE.Mesh(new THREE.TorusGeometry(eyeScale[0]*.92,.018,8,32,Math.PI),hair);lid.position.set(x,-.045,.548);lid.rotation.z=Math.PI;head.add(lid);
      if(a.eyeStyle==='Sparkle'||a.eyeStyle==='Dreamy'){const star=mat('#fff0c7',.2,.15);sphere(head,star,[x+.035,-.005,.65],[.022,.022,.012],16);sphere(head,star,[x-.045,-.12,.65],[.012,.012,.008],16);}
      if(a.eyeStyle==='Sharp'||a.eyeStyle==='Bold'){for(let i=0;i<3;i++)limb(head,dark,[x+(x<0?-.13:.13),.01+i*.025,.54],[x+(x<0?-.19:.19),.08+i*.025,.52],.012);}
    }
    for(const x of [-.29,.29]){const brow=sphere(head,hair,[x,.16,.5],a.brows==="Arched"?[.19,.055,.035]:[.19,.035,.035],20);brow.rotation.z=a.brows==="Straight"?0:(x<0?.1:-.1);}
    const noseScale=a.noseStyle==="Defined"?[.055,.105,.055]:a.noseStyle==="Soft"?[.045,.075,.035]:[.04,.055,.03];
    sphere(head,skin,[0,-.2,.57],noseScale,20);
    const noseShade=mat('#b77d83',.9);sphere(head,noseShade,[.025,-.235,.585],[.025,.018,.012],12);
    if(a.makeup==='Rosy cheeks'){sphere(head,blush,[-.48,-.29,.47],[.15,.075,.025],24);sphere(head,blush,[.48,-.29,.47],[.15,.075,.025],24);}
    if(a.makeup==='Natural'||a.makeup==='Rosy cheeks'){for(const side of [-1,1])for(let i=0;i<3;i++)sphere(head,mat('#b77d83',.95),[side*(.43+(i%2)*.045),-.24-Math.floor(i/2)*.045,.493],[.009,.009,.006],8);}
    const mouthMat=mat('#9d5865');
    const mouthPoints=a.mouthStyle==="Pout"?[[-.09,-.4,.56],[0,-.37,.59],[.09,-.4,.56]]:a.mouthStyle==="Open smile"?[[-.11,-.38,.55],[0,-.47,.58],[.11,-.38,.55]]:a.expression==="Confident"?[[-.1,-.4,.56],[0,-.42,.58],[.1,-.4,.56]]:a.expression==="Shy"?[[-.08,-.41,.56],[0,-.44,.58],[.08,-.41,.56]]:[[-.105,-.39,.55],[0,-.43,.58],[.105,-.39,.55]];
    const mouthCurve=new THREE.CatmullRomCurve3(mouthPoints.map(p=>new THREE.Vector3(...p)));head.add(new THREE.Mesh(new THREE.TubeGeometry(mouthCurve,16,.018,8,false),mouthMat));
    if(a.makeup==="Winged liner"){for(const x of [-.29,.29]){const wing=sphere(head,dark,[x+(x<0?-.17:.17),-.02,.51],[.07,.025,.018],16);wing.rotation.z=x<0?.3:-.3;}}
    if(a.accessory==='Round glasses'){for(const x of [-.29,.29]){const ring=new THREE.Mesh(new THREE.TorusGeometry(.19,.018,10,40),dark);ring.position.set(x,-.06,.61);head.add(ring);}const bridge=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.17,12),dark);bridge.rotation.z=Math.PI/2;bridge.position.set(0,-.06,.61);head.add(bridge);}
    if(a.accessory==='Headphones'){const band=new THREE.Mesh(new THREE.TorusGeometry(.76,.055,12,48,Math.PI),mat('#d8b8ef'));band.rotation.z=Math.PI;band.position.set(0,.22,-.03);head.add(band);sphere(head,mat('#d8b8ef'),[-.76,-.08,0],[.13,.25,.16]);sphere(head,mat('#d8b8ef'),[.76,-.08,0],[.13,.25,.16]);}
    if(a.accessory==='Star clips'||a.accessory==='Flower pin'||a.accessory==='Crescent crown'){const pinMat=mat('#f0d18e',.3,.35);sphere(head,pinMat,[.57,.48,.48],[.12,.12,.06],20);}
    const trim=mat('#e8cf93',.35,.3), accent=mat('#35263d',.62),stitch=mat('#f4d9c8',.75);
    const seam=(points,r=.012)=>{const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));group.add(new THREE.Mesh(new THREE.TubeGeometry(curve,24,r,6,false),stitch));};
    seam([[-.48,-.72,.39],[-.32,-.92,.47],[0,-1.02,.49],[.32,-.92,.47],[.48,-.72,.39]],.014);
    for(const x of [-.52,.52]){const cuff=new THREE.Mesh(new THREE.TorusGeometry(.17,.035,8,24),trim);cuff.position.set(x,-1.36,.02);cuff.rotation.x=Math.PI/2;group.add(cuff);}
    const belt=new THREE.Mesh(new THREE.BoxGeometry(.72,.075,.06),trim);belt.position.set(0,-1.48,.43);group.add(belt);
    const buckle=new THREE.Mesh(new THREE.BoxGeometry(.12,.11,.045),accent);buckle.position.set(0,-1.48,.47);group.add(buckle);
    const badge=(x,y,z,scale)=>sphere(group,trim,[x,y,z],scale,20);
    const skirt=(color,top,bottom)=>{const mesh=new THREE.Mesh(new THREE.CylinderGeometry(bottom,top,.62,48,1,true),color);mesh.position.set(0,-1.67,.015);group.add(mesh);};
    if(a.outfitStyle==='Academy'){
      // Crisp academy jacket, collar and tie.
      const lapelL=new THREE.Mesh(new THREE.ConeGeometry(.22,.58,4),trim);lapelL.position.set(-.19,-.84,.47);lapelL.rotation.z=-.25;group.add(lapelL);
      const lapelR=new THREE.Mesh(new THREE.ConeGeometry(.22,.58,4),trim);lapelR.position.set(.19,-.84,.47);lapelR.rotation.z=.25;group.add(lapelR);
      const tie=new THREE.Mesh(new THREE.ConeGeometry(.105,.62,4),accent);tie.position.set(0,-1.03,.49);tie.rotation.x=Math.PI;group.add(tie);
      for(let i=0;i<3;i++)badge(.36,-.9-i*.17,.47,[.035,.035,.025]);
    } else if(a.outfitStyle==='Casual'){
      const collar=new THREE.Mesh(new THREE.TorusGeometry(.22,.07,8,24,Math.PI),trim);collar.position.set(0,-.52,.18);collar.rotation.x=Math.PI/2;group.add(collar);
    } else if(a.outfitStyle==='Fantasy'){
      const cape=new THREE.Mesh(new THREE.ConeGeometry(.72,1.5,4,1,true),accent);cape.position.set(0,-1.25,-.38);cape.rotation.x=Math.PI;group.add(cape);
      skirt(trim,.38,.72);badge(0,-.68,.48,[.16,.16,.07]);
    } else if(a.outfitStyle==='Streetwear'||a.outfitStyle==='Denim jacket'||a.outfitStyle==='Punk'){
      const jacket=mat(a.outfitStyle==='Punk'?'#302b37':a.outfit,.55);
      for(const x of [-.52,.52]){const panel=new THREE.Mesh(new THREE.BoxGeometry(.24,.9,.12),jacket);panel.position.set(x,-1.05,.39);panel.rotation.z=x<0?-.08:.08;group.add(panel);}
      if(a.outfitStyle==='Punk'){for(let i=0;i<4;i++)badge(-.42+i*.28,-.72,.5,[.035,.035,.035]);}
    } else if(a.outfitStyle==='Elegant'||a.outfitStyle==='Summer dress'){
      skirt(outfit,.4,.78);
      const sash=new THREE.Mesh(new THREE.BoxGeometry(.72,.1,.06),trim);sash.position.set(0,-1.15,.43);group.add(sash);
      if(a.outfitStyle==='Elegant')badge(0,-.59,.49,[.1,.13,.05]);
    } else if(a.outfitStyle==='Gothic'){
      skirt(accent,.4,.82);
      const collar=new THREE.Mesh(new THREE.ConeGeometry(.18,.36,3),trim);collar.position.set(0,-.58,.43);collar.rotation.x=Math.PI;group.add(collar);
      for(let i=0;i<3;i++)badge(0,-1.3-i*.16,.46,[.025,.025,.02]);
    } else if(a.outfitStyle==='Hoodie'){
      const hood=sphere(group,outfit,[0,-.38,-.34],[.42,.46,.22],24);
      const pocket=new THREE.Mesh(new THREE.BoxGeometry(.52,.24,.07),outfit);pocket.position.set(0,-1.45,.43);group.add(pocket);
      const strings=mat('#eee0d8');for(const x of [-.09,.09])limb(group,strings,[x,-.72,.47],[x,-1.02,.47],.018);
    }
    // Separate wardrobe layers: top, bottom and footwear can be mixed independently.
    const top=a.topStyle||({Academy:'Academy blouse',Hoodie:'Oversized hoodie',Gothic:'Ruffle blouse',Fantasy:'Off-shoulder',Streetwear:'Leather jacket'}[a.outfitStyle]||'Academy blouse');
    const bottom=a.bottomStyle||(['Fantasy','Elegant','Gothic','Summer dress'].includes(a.outfitStyle)?'Flowy maxi skirt':'Pleated skirt');
    const topTrim=mat('#f0d8d0',.72),topMat=outfit;
    if(top==='Oversized hoodie'){sphere(group,topMat,[0,-.88,.05],[.73,.63,.46]);const pocket=new THREE.Mesh(new THREE.BoxGeometry(.62,.22,.08),topMat);pocket.position.set(0,-1.25,.47);group.add(pocket);}
    if(top==='Crop top'){const hem=new THREE.Mesh(new THREE.TorusGeometry(.47,.025,8,40),trim);hem.position.set(0,-1.42,.02);hem.rotation.x=Math.PI/2;group.add(hem);}
    if(top==='Cardigan'||top==='Leather jacket'){for(const x of [-1,1]){const panel=new THREE.Mesh(new THREE.BoxGeometry(.23,.78,.09),topMat);panel.position.set(x*.22,-.98,.45);group.add(panel);}for(let i=0;i<4;i++)sphere(group,trim,[.08,-.78-i*.16,.51],[.025,.025,.018],12);}
    if(top==='Off-shoulder'){const band=new THREE.Mesh(new THREE.TorusGeometry(.48,.07,10,48,Math.PI),topMat);band.position.set(0,-.53,.05);band.rotation.x=Math.PI/2;group.add(band);}
    if(top==='Ruffle blouse'){for(let i=0;i<3;i++){const r=new THREE.Mesh(new THREE.TorusGeometry(.19+i*.035,.025,8,32,Math.PI),topTrim);r.position.set(0,-.57-i*.09,.45);r.rotation.x=Math.PI/2;group.add(r);}}
    if(top==='Knit sweater'){for(let i=0;i<5;i++)seam([[-.38,-.72-i*.12,.4],[0,-.76-i*.12,.49],[.38,-.72-i*.12,.4]],.009);}
    if(top==='Academy blouse'){const collarL=new THREE.Mesh(new THREE.ConeGeometry(.13,.3,3),topTrim);collarL.position.set(-.12,-.59,.48);collarL.rotation.z=-.2;group.add(collarL);const collarR=collarL.clone();collarR.position.x=.12;collarR.rotation.z=.2;group.add(collarR);}
    if(bottom==='Pleated skirt'||bottom==='Mini skirt'||bottom==='Flowy maxi skirt'){const length=bottom==='Mini skirt'?.38:bottom==='Flowy maxi skirt'?.88:.62;const skirtMesh=new THREE.Mesh(new THREE.CylinderGeometry(bottom==='Mini skirt'?.5:.68,bottom==='Flowy maxi skirt'?.82:.76,length,48,1,true),outfit);skirtMesh.position.set(0,-1.58,.02);group.add(skirtMesh);for(let i=0;i<12;i++){const angle=i*Math.PI/6;const pleat=limb(group,trim,[Math.sin(angle)*.47,-1.34,.02+Math.cos(angle)*.35],[Math.sin(angle)*.7,-1.95,.02+Math.cos(angle)*.45],.009);}}
    if(['Wide-leg trousers','Skinny jeans','Cargo pants','Shorts'].includes(bottom)){const width=bottom==='Wide-leg trousers'?.25:bottom==='Cargo pants'?.23:bottom==='Shorts'?.22:.17;for(const x of [-.36,.36]){const legMesh=new THREE.Mesh(new THREE.CylinderGeometry(width,width*.9,bottom==='Shorts'?.48:1.02,24),outfit);legMesh.position.set(x,-1.92,.02);group.add(legMesh);}if(bottom==='Cargo pants'){for(const x of [-.56,.56]){const pocket=new THREE.Mesh(new THREE.BoxGeometry(.16,.22,.08),trim);pocket.position.set(x,-1.8,.17);group.add(pocket);}}}
    const footwear=a.footwear||'Ankle boots';
    const shoeColour=footwear==='Mary Janes'||footwear==='Heels'?'#211b29':footwear==='High-top sneakers'?'#f2e8e4':'#3a303b';
    const bootMat=mat(shoeColour,.42);
    for(const x of [-.36,.36]){
      const sole=new THREE.Mesh(new THREE.BoxGeometry(.48,.055,.65),mat('#17151b',.65));sole.position.set(x,-2.52,.12);group.add(sole);
      sphere(group,bootMat,[x,-2.43,.27],[.22,.12,.22],24);
      for(let i=0;i<3;i++)limb(group,trim,[x-.07,-2.38+i*.035,.43],[x+.07,-2.38+i*.035,.43],.008);
    }
    group.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    return group;
  }
  function update3DAvatar(stage,a){
    if(!stage)return;
    loadThree().then(THREE=>{
      if(!stage.isConnected)return;
      let state=threeScenes.get(stage);
      if(!state){
        const scene=new THREE.Scene();scene.background=null;
        const camera=new THREE.PerspectiveCamera(32,1,.1,100);camera.position.set(0,-.35,8.35);
        const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));renderer.setSize(stage.clientWidth||320,stage.clientHeight||370);renderer.outputColorSpace=THREE.SRGBColorSpace;
        stage.querySelector('.ai-3d-loading')?.remove();stage.prepend(renderer.domElement);renderer.domElement.className='ai-3d-canvas';
        scene.add(new THREE.HemisphereLight('#fff0e8','#392c48',2.0));
        const key=new THREE.DirectionalLight('#fff4e9',2.5);key.position.set(3,5,6);scene.add(key);
        const rim=new THREE.DirectionalLight('#d8b8ff',1.9);rim.position.set(-4,2,-3);scene.add(rim);
        const fill=new THREE.DirectionalLight('#f5c6b5',.9);fill.position.set(0,-2,5);scene.add(fill);
        const floor=new THREE.Mesh(new THREE.CircleGeometry(1.42,64),new THREE.MeshBasicMaterial({color:a.background,transparent:true,opacity:.42}));floor.rotation.x=-Math.PI/2;floor.position.set(0,-2.58,0);scene.add(floor);
        const halo=new THREE.Mesh(new THREE.TorusGeometry(1.05,.012,8,96),new THREE.MeshBasicMaterial({color:'#e8c7dc',transparent:true,opacity:.52}));halo.rotation.x=Math.PI/2;halo.position.set(0,-2.54,0);scene.add(halo);
        const pedestal=new THREE.Mesh(new THREE.CylinderGeometry(.78,.92,.12,64),new THREE.MeshStandardMaterial({color:'#49374d',metalness:.35,roughness:.42}));pedestal.position.set(0,-2.63,0);scene.add(pedestal);
        state={scene,camera,renderer,group:null,rotation:0,drag:false,lastX:0,resize:null};threeScenes.set(stage,state);
        const resize=()=>{if(!stage.isConnected)return;const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};
        if(typeof ResizeObserver!=='undefined'){state.resize=new ResizeObserver(resize);state.resize.observe(stage);}else window.addEventListener('resize',resize);
        const activePointers=new Map();let pinchStart=0,pinchZoom=0;
        renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();camera.position.z=Math.max(5.4,Math.min(11.5,camera.position.z+e.deltaY*.008));},{passive:false});
        renderer.domElement.addEventListener('pointerdown',e=>{activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});renderer.domElement.setPointerCapture?.(e.pointerId);if(activePointers.size===1){state.drag=true;state.lastX=e.clientX;}if(activePointers.size===2){const p=[...activePointers.values()];pinchStart=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);pinchZoom=camera.position.z;state.drag=false;}});
        renderer.domElement.addEventListener('pointermove',e=>{if(!activePointers.has(e.pointerId))return;const previous=activePointers.get(e.pointerId);activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(activePointers.size===2){const p=[...activePointers.values()],distance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);if(pinchStart>0)camera.position.z=Math.max(5.4,Math.min(11.5,pinchZoom*pinchStart/Math.max(1,distance)));return;}if(state.drag){state.rotation+=(e.clientX-previous.x)*.012;state.lastX=e.clientX;if(state.group)state.group.rotation.y=state.rotation;}});
        const end=e=>{activePointers.delete(e.pointerId);state.drag=activePointers.size===1;if(state.drag)state.lastX=[...activePointers.values()][0].x;else pinchStart=0;};renderer.domElement.addEventListener('pointerup',end);renderer.domElement.addEventListener('pointercancel',end);
        const animate=()=>{if(!stage.isConnected){state.resize?.disconnect();renderer.dispose();threeScenes.delete(stage);return;}state.frame=requestAnimationFrame(animate);if(state.group&&!state.drag)state.group.position.y=-.05+Math.sin(Date.now()/950)*.018;renderer.render(scene,camera);};animate();resize();
        stage.querySelectorAll('[data-3d-view]').forEach(btn=>btn.addEventListener('click',()=>{const view=btn.dataset['3dView'];state.rotation=view==='side'?Math.PI/2:view==='back'?Math.PI:0;if(state.group)state.group.rotation.y=state.rotation;stage.querySelectorAll('[data-3d-view]').forEach(x=>x.classList.toggle('active',x===btn));}));
      }
      if(state.group){state.scene.remove(state.group);state.group.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});}
      state.group=make3DCharacter(THREE,a);state.group.position.y=-.05;state.group.rotation.y=state.rotation;state.scene.add(state.group);
      const floor=state.scene.children.find(o=>o.geometry&&o.geometry.type==='CircleGeometry');if(floor)floor.material.color.set(a.background);
      stage.classList.add('is-3d-ready');
    }).catch(error=>{if(stage.isConnected){const msg=stage.querySelector('.ai-3d-loading');if(msg){msg.outerHTML=avatarSvg(a,280);stage.classList.add('is-3d-fallback');}const note=stage.parentElement?.querySelector('.ai-preview-caption');if(note)note.textContent='2D PREVIEW · 3D ENGINE UNAVAILABLE';}});
  }
  function avatarEditor(a) {
    return '<div class="ai-avatar-studio"><div class="ai-avatar-preview-column"><div class="ai-avatar-stage ai-3d-stage" id="aiAvatarStage"><div class="ai-3d-loading">Loading interactive 3D character…</div><div class="ai-3d-view-controls"><button type="button" data-3d-view="front" class="active">Front</button><button type="button" data-3d-view="side">Side</button><button type="button" data-3d-view="back">Back</button></div></div><div class="ai-preview-caption"><span>LIVE PREVIEW</span><span>✦ YOUR ORIGINAL CHARACTER</span></div></div><div class="ai-avatar-controls"><div class="ai-studio-heading"><span class="ai-step">CHARACTER CREATOR · 01</span><h3>Design every detail</h3><p>Choose a look, layer on details and watch your character change instantly.</p></div><div class="ai-editor-section"><h4>Face & features</h4>'+choiceTiles("Face shape","faceShape",avatarChoices.faceShape,a.faceShape)+choiceTiles("Eye design","eyeStyle",avatarChoices.eyeStyle,a.eyeStyle)+choiceTiles("Brows","brows",avatarChoices.brows,a.brows)+choiceTiles("Nose","noseStyle",avatarChoices.noseStyle,a.noseStyle)+choiceTiles("Mouth","mouthStyle",avatarChoices.mouthStyle,a.mouthStyle)+choiceTiles("Expression","expression",avatarChoices.expression,a.expression)+choiceTiles("Body proportions","bodyType",avatarChoices.bodyType,a.bodyType)+'</div><div class="ai-editor-section"><h4>Hair & styling</h4>'+choiceTiles("Hairstyle","hairStyle",avatarChoices.hairStyle,a.hairStyle)+colorField("Hair colour","hair",palettes.hair,a.hair)+'</div><div class="ai-editor-section"><h4>Clothing & accessories</h4>'+choiceTiles("Outfit theme","outfitStyle",avatarChoices.outfitStyle,a.outfitStyle)+choiceTiles("Top / jacket","topStyle",avatarChoices.topStyle,a.topStyle)+choiceTiles("Bottoms","bottomStyle",avatarChoices.bottomStyle,a.bottomStyle)+choiceTiles("Shoes","footwear",avatarChoices.footwear,a.footwear)+choiceTiles("Accessory","accessory",avatarChoices.accessory,a.accessory)+choiceTiles("Makeup","makeup",avatarChoices.makeup,a.makeup)+colorField("Outfit colour","outfit",palettes.outfit,a.outfit)+'</div><div class="ai-editor-section ai-editor-colours"><h4>Finishing touches</h4>'+colorField("Skin tone","skin",palettes.skin,a.skin)+colorField("Eye colour","eyes",palettes.eyes,a.eyes)+colorField("Scene","background",palettes.bg,a.background)+'</div><label class="ai-image-url">Or use your own avatar image (HTTPS URL)<input name="avatarUrl" type="url" maxlength="1000" placeholder="https://…"></label></div></div>';
  }
  function bindAvatarEditor(host, initial) {
    const update=()=>{
      const form=host.querySelector(".ai-avatar-controls"); if(!form)return;
      const a={...initial};
      // .ai-avatar-controls is a DIV, not a form. FormData(div) throws and
      // prevented every avatar choice/colour change from reaching the preview.
      form.querySelectorAll("[name]").forEach(el=>{
        if(el.name==="avatarUrl"||el.disabled)return;
        if(el.type==="radio"||el.type==="checkbox"){if(!el.checked)return;}
        if(el.type==="hidden"&&el.dataset.choiceFor&&!el.value)return;
        a[el.name]=el.value;
      });
      const stage=host.querySelector("#aiAvatarStage"); if(stage)update3DAvatar(stage,a);
      host.querySelectorAll(".ai-swatch").forEach(s=>s.classList.toggle("selected",!!s.querySelector("input:checked")));
      host.querySelectorAll("[data-avatar-choice]").forEach(b=>b.classList.toggle("selected",b.dataset.value===a[b.dataset.avatarChoice]));
    };
    host.querySelectorAll("[data-avatar-choice]").forEach(btn=>btn.addEventListener("click",()=>{
      const form=host.querySelector(".ai-avatar-controls"); if(!form)return;
      const name=btn.dataset.avatarChoice;
      let input=form.querySelector('input[type="hidden"][data-choice-for="'+name+'"]');
      if(!input){input=document.createElement("input");input.type="hidden";input.name=name;input.dataset.choiceFor=name;form.appendChild(input);}
      input.value=btn.dataset.value;
      form.querySelectorAll('input[type="radio"][name="'+name+'"]').forEach(r=>r.checked=false);
      update();
    }));
    host.querySelectorAll(".ai-avatar-controls input[type=radio]").forEach(el=>el.addEventListener("change",()=>{host.querySelector('.ai-avatar-controls input[type=hidden][data-custom-for="'+el.name+'"]')?.remove();update();}));
    host.querySelectorAll(".ai-avatar-controls input[type=color][data-color-for]").forEach(el=>el.addEventListener("input",()=>{const name=el.dataset.colorFor;let hidden=host.querySelector('.ai-avatar-controls input[type=hidden][data-custom-for="'+name+'"]');if(!hidden){hidden=document.createElement("input");hidden.type="hidden";hidden.name=name;hidden.dataset.customFor=name;host.querySelector(".ai-avatar-controls").appendChild(hidden);}hidden.value=el.value;update();}));
    host.querySelectorAll(".ai-avatar-controls input[type=url]").forEach(el=>el.addEventListener("input",()=>{
      const stage=host.querySelector("#aiAvatarStage"); if(!stage)return;
      let photo=stage.querySelector(".ai-avatar-photo-preview");
      const canvas=stage.querySelector(".ai-3d-canvas");
      if(el.value.trim()){
        if(!photo){photo=document.createElement("img");photo.className="ai-avatar-photo-preview";photo.alt="Avatar preview";stage.appendChild(photo);}
        photo.src=el.value.trim();photo.style.display="block";
        if(canvas)canvas.style.display="none";
      }else{
        if(photo)photo.remove();
        if(canvas)canvas.style.display="block";
        update();
      }
    }));
  }
  function readAppearance(form, initial) {
    const a={...initial}; const allowed=["hairStyle","faceShape","eyeStyle","brows","expression","noseStyle","mouthStyle","bodyType","outfitStyle","topStyle","bottomStyle","footwear","accessory","makeup","skin","hair","eyes","outfit","background"]; new FormData(form).forEach((v,k)=>{if(allowed.includes(k))a[k]=v;}); return a;
  }
  function create() {
    const a=defaultAppearance();
    root().innerHTML='<div class="ai-create-intro"><span class="ai-step">YOUR AI COMPANION</span><h3>Create someone unforgettable.</h3><p>Design an anime-style character, then give them a personality and a voice of their own.</p><div class="ai-choice-row"><button type="button" class="ai-choice active" data-preset="custom">Create my own</button><button type="button" class="ai-choice" data-preset="gentle-anime-friend">Gentle friend</button><button type="button" class="ai-choice" data-preset="cheerful-adventurer">Adventurer</button><button type="button" class="ai-choice" data-preset="playful-rival">Playful rival</button></div></div>'+
      '<form id="aiCreateForm" class="ai-create-card"><div class="ai-form-section"><span class="ai-step">01 / AVATAR</span><h3>Make them yours</h3>'+avatarEditor(a)+'</div><div class="ai-form-section"><span class="ai-step">02 / PERSONALITY</span><h3>Who are they?</h3><div class="ai-personality-grid"><label>Companion name <small>Optional — we will choose a name if you skip this.</small><input name="name" maxlength="60" placeholder="e.g. Aiko"></label><label>Personality type<select name="personalityType"><option value="preset">Premade personality</option><option value="custom">Custom personality</option></select></label><label>Short introduction<textarea name="bio" maxlength="500" placeholder="How would they introduce themselves?"></textarea></label><label>Backstory<textarea name="backstory" maxlength="2500" placeholder="Their world, history, dreams…"></textarea></label><label>Speaking style<textarea name="speakingStyle" maxlength="800" placeholder="Warm, witty, shy, poetic…"></textarea></label><label>Likes<input name="likes" placeholder="Music, stargazing, ramen…"></label><label>Dislikes<input name="dislikes" placeholder="Comma-separated"></label></div><input type="hidden" name="personalityPreset" value="gentle-anime-friend"><input type="hidden" name="behaviourConfig" value=""></div><button class="primary ai-create-submit" type="submit">Create my companion <span>✦</span></button><p class="ai-form-note">One companion per account. You can change their look and personality later without deleting their memories.</p></form>';
    const form=root().querySelector("#aiCreateForm"), studio=root();
    bindAvatarEditor(studio,a);update3DAvatar(studio.querySelector("#aiAvatarStage"),a);
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
    root().innerHTML='<section class="ai-companion-dashboard"><div class="ai-companion-hero"><div class="ai-hero-avatar ai-hero-avatar-stage">'+(c.avatarUrl?avatar:'<div class="ai-3d-stage ai-hero-3d-stage" id="aiHeroAvatarStage"><div class="ai-3d-loading">Preparing your companion…</div></div>')+'</div><div class="ai-hero-copy"><span class="ai-step">YOUR COMPANION</span><h3>'+esc(c.name)+'</h3><p>'+esc(c.bio||"Your anime companion is ready to talk.")+'</p><span class="ai-tag">✦ '+esc((c.personalityPreset||"custom").replace(/-/g," "))+'</span></div><button type="button" class="primary ai-talk-jump" id="aiTalkJump">Talk now ↘</button></div>'+
      '<nav class="ai-tabs"><button type="button" class="active" data-tab="talk">Talk</button><button type="button" data-tab="avatar">Avatar studio</button><button type="button" data-tab="personality">Personality</button><button type="button" data-tab="memories">Memories ('+memories.length+')</button></nav>'+
      '<section class="ai-tab-panel" data-panel="talk"><div class="ai-chat-card"><div class="ai-section-head"><div><span class="ai-step">PRIVATE SPACE</span><h3>Conversation with '+esc(c.name)+'</h3></div><button id="aiClearHistory" class="ai-secondary" type="button">Clear chat</button></div><div class="ai-messages" id="aiMessages">'+(messages.map(m=>'<article class="ai-message '+(m.sender_type==="owner"?"owner":"companion")+'"><b>'+(m.sender_type==="owner"?"You":esc(c.name))+'</b><p>'+esc(m.message_content)+'</p></article>').join("")||'<p class="muted ai-empty-chat">Say hello. Your companion is listening.</p>')+'</div><form id="aiChat"><textarea name="message" maxlength="1200" required placeholder="Message your companion…"></textarea><button class="primary" type="submit">Send ↗</button></form><p class="ai-form-note">Your companion uses their personality and approved memories to shape replies.</p></div></section>'+
      '<section class="ai-tab-panel hidden" data-panel="avatar"><form id="aiAvatarForm" class="ai-create-card"><div class="ai-form-section"><span class="ai-step">AVATAR STUDIO</span><h3>Change their look</h3>'+avatarEditor(appearance)+'</div><button class="primary" type="submit">Save appearance</button></form></section>'+
      '<section class="ai-tab-panel hidden" data-panel="personality"><form id="aiEdit" class="ai-create-card"><span class="ai-step">PERSONALITY SETTINGS</span><h3>Make them more them</h3><div class="ai-personality-grid"><label>Name<input name="name" maxlength="60" value="'+esc(c.name)+'"></label><label>Personality type<select name="personalityType"><option value="preset" '+(c.personalityType!=="custom"?"selected":"")+'>Premade</option><option value="custom" '+(c.personalityType==="custom"?"selected":"")+'>Custom</option></select></label><label>Preset<select name="personalityPreset">'+["gentle-anime-friend","cheerful-adventurer","calm-and-wise","playful-rival"].map(x=>'<option value="'+x+'" '+(c.personalityPreset===x?"selected":"")+'>'+x.replace(/-/g," ")+'</option>').join("")+'</select></label><label>Introduction<textarea name="bio" maxlength="500">'+esc(c.bio)+'</textarea></label><label>Backstory<textarea name="backstory" maxlength="2500">'+esc(c.backstory)+'</textarea></label><label>Speaking style<textarea name="speakingStyle" maxlength="800">'+esc(c.speakingStyle)+'</textarea></label><label>Likes<input name="likes" value="'+esc((c.likes||[]).join(", "))+'"></label><label>Dislikes<input name="dislikes" value="'+esc((c.dislikes||[]).join(", "))+'"></label></div><button class="primary" type="submit">Save personality</button></form></section>'+
      '<section class="ai-tab-panel hidden" data-panel="memories"><div class="ai-memory-card"><div class="ai-section-head"><div><span class="ai-step">SHARED HISTORY</span><h3>What '+esc(c.name)+' remembers</h3></div><button id="aiClearMemories" class="ai-secondary" type="button">Clear all</button></div><form id="aiMemory"><input name="content" maxlength="1000" required placeholder="Add something for your companion to remember…"><select name="importance" aria-label="Memory importance"><option value="3">Normal importance</option><option value="5">Very important</option><option value="4">Important</option><option value="2">Low importance</option><option value="1">Optional detail</option></select><select name="sensitivity" aria-label="Memory privacy"><option value="ordinary">Ordinary memory</option><option value="sensitive">Sensitive · use carefully</option></select><button class="primary" type="submit">Save memory</button></form><div class="ai-memory-list">'+(memories.map(m=>'<article class="ai-memory"><p>'+esc(m.memory_content)+'</p><small>Importance '+m.importance+'/5</small><div><button type="button" data-edit="'+m.id+'">Edit</button><button type="button" data-delete="'+m.id+'">Delete</button></div></article>').join("")||'<p class="muted">No memories saved yet.</p>')+'</div></div></section></section>';
    const heroStage=root().querySelector("#aiHeroAvatarStage");if(heroStage)update3DAvatar(heroStage,appearance);
    const tabs=root().querySelectorAll("[data-tab]");
    function activate(tab){tabs.forEach(t=>t.classList.toggle("active",t.dataset.tab===tab));root().querySelectorAll("[data-panel]").forEach(p=>p.classList.toggle("hidden",p.dataset.panel!==tab));}
    tabs.forEach(t=>t.onclick=()=>activate(t.dataset.tab));
    root().querySelector("#aiTalkJump").onclick=()=>{activate("talk");root().querySelector("#aiChat textarea").focus();};
    const avatarForm=root().querySelector("#aiAvatarForm");bindAvatarEditor(avatarForm,appearance);update3DAvatar(avatarForm.querySelector("#aiAvatarStage"),appearance);
    avatarForm.onsubmit=async e=>{e.preventDefault();const a=readAppearance(avatarForm,appearance),url=avatarForm.elements.avatarUrl.value.trim();try{await api("/api/ai-companion",{method:"PATCH",body:{avatarUrl:url||"",behaviourConfig:{...(c.behaviourConfig||{}),avatarAppearance:a}}});await load();}catch(error){fail(error);}};
    root().querySelector("#aiEdit").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));d.name=String(d.name||"").trim()||"My Companion";d.likes=String(d.likes||"").split(",").map(x=>x.trim()).filter(Boolean);d.dislikes=String(d.dislikes||"").split(",").map(x=>x.trim()).filter(Boolean);d.behaviourConfig=c.behaviourConfig||{};try{await api("/api/ai-companion",{method:"PATCH",body:d});await load();}catch(error){fail(error);}};
    root().querySelector("#aiChat").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,message=form.elements.message.value.trim();if(!message)return;const send=form.querySelector("button");let notice=form.querySelector(".ai-chat-error");if(notice)notice.remove();send.disabled=true;send.textContent="Sending…";try{await api("/api/ai-companion/chat",{method:"POST",body:{message}});form.elements.message.value="";await load();}catch(error){notice=document.createElement("p");notice.className="ai-error ai-chat-error";notice.setAttribute("role","alert");notice.textContent=error.message||"Your companion could not reply. Please try again.";form.insertAdjacentElement("afterend",notice);send.disabled=false;send.textContent="Retry ↗";}};
    root().querySelector("#aiMemory").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;try{await api("/api/ai-companion/memories",{method:"POST",body:{content:form.elements.content.value,importance:Number(form.elements.importance.value),sensitivity:form.elements.sensitivity.value}});await load();activate("memories");}catch(error){fail(error);}};
    root().querySelector("#aiClearHistory").onclick=async()=>{if(confirm("Clear chat history? Memories will remain."))try{await api("/api/ai-companion/history",{method:"DELETE",body:{}});await load();}catch(error){fail(error);}};
    root().querySelector("#aiClearMemories").onclick=async()=>{if(confirm("Delete all memories? Chat history will remain."))try{await api("/api/ai-companion/memories",{method:"DELETE",body:{}});await load();}catch(error){fail(error);}};
    root().querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{try{await api("/api/ai-companion/memories/"+b.dataset.delete,{method:"DELETE",body:{}});await load();activate("memories");}catch(error){fail(error);}});
    root().querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{const old=memories.find(m=>String(m.id)===b.dataset.edit),value=prompt("Edit memory",old.memory_content);if(value===null)return;try{await api("/api/ai-companion/memories/"+b.dataset.edit,{method:"PATCH",body:{content:value,importance:old.importance,sensitivity:old.sensitivity}});await load();activate("memories");}catch(error){fail(error);}});
    const box=root().querySelector("#aiMessages");if(box)box.scrollTop=box.scrollHeight;
  }
  async function load(){
    if(!root())return;root().innerHTML='<p class="muted">Loading your companion…</p>';
    try{const data=await api("/api/ai-companion");if(data.companion)render(data);else create();}
    catch(error){root().innerHTML='<div class="ai-unavailable"><h3>AI Companion</h3><p>'+esc(error.message)+'</p><p class="muted">Your companion could not be loaded. Your saved companion and memories have not been deleted.</p><button type="button" class="primary" id="aiRetryLoad">Try again</button></div>';const retry=root().querySelector("#aiRetryLoad");if(retry)retry.onclick=loadWhenVisible;}
  }
  let loadInProgress=false;
  async function loadWhenVisible(){if(loadInProgress)return;loadInProgress=true;try{await load();}finally{loadInProgress=false;}}
  document.addEventListener("mc:open-ai-companion",loadWhenVisible);
  const companionView=document.getElementById("viewAiCompanion");
  if(companionView&&typeof MutationObserver!=="undefined"){const observer=new MutationObserver(()=>{if(!companionView.classList.contains("hidden"))loadWhenVisible();});observer.observe(companionView,{attributes:true,attributeFilter:["class"]});if(!companionView.classList.contains("hidden"))loadWhenVisible();}
  else if(companionView&&!companionView.classList.contains("hidden"))loadWhenVisible();
})();