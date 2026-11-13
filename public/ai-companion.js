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
  const defaultAppearance = () => ({hairStyle:"Long",faceShape:"Soft oval",eyeStyle:"Sparkle",outfitStyle:"Academy",skin:"#f8d9c5",hair:"#24202d",eyes:"#5b8fc9",outfit:"#4e3d70",background:"#29213b"});
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
    outfitStyle:["Academy","Casual","Fantasy","Streetwear","Elegant","Gothic"],
    accessory:["None","Round glasses","Star clips","Headphones","Flower pin","Crescent crown"],
    makeup:["Natural","Rosy cheeks","Winged liner"]
  };
  function choiceTiles(label,name,values,selected) {
    return '<fieldset class="ai-choice-field"><legend>'+label+'</legend><div class="ai-option-tiles">'+values.map((v,i)=>'<button type="button" class="ai-option-tile '+(v===selected?'selected':'')+'" data-avatar-choice="'+name+'" data-value="'+esc(v)+'"><span class="ai-option-glyph">'+(["✦","◈","❋","◇","✧","☾","❀","♡"][i%8])+'</span><span>'+esc(v)+'</span></button>').join("")+'</div></fieldset>';
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
    if(longHair){sphere(head,hair,[-.65,-.38,-.02],[.2,.92,.28],28);sphere(head,hair,[.65,-.38,-.02],[.2,.92,.28],28);}
    if(a.hairStyle==='Twin tails'){sphere(head,hair,[-.9,.15,-.08],[.24,.72,.24]);sphere(head,hair,[.9,.15,-.08],[.24,.72,.24]);}
    if(a.hairStyle==='High ponytail'){const pony=sphere(head,hair,[.02,.82,-.55],[.28,.78,.25]);pony.rotation.x=-.45;}
    if(a.hairStyle==='Side braid'){for(let i=0;i<7;i++)sphere(head,hair,[.78,-.18-i*.15,.05],[.13,.15,.14],20);}
    const eyeScale=a.eyeStyle==="Wide"?[.22,.17,.095]:a.eyeStyle==="Sharp"?[.22,.105,.075]:a.eyeStyle==="Soft round"?[.18,.17,.09]:a.eyeStyle==="Bold"?[.22,.18,.11]:[.205,.145,.09];
    for(const x of [-.29,.29]){sphere(head,white,[x,-.06,.51],eyeScale);sphere(head,eye,[x,-.06,.588],[.095,.112,.035]);sphere(head,dark,[x,-.06,.615],[.045,.075,.022]);sphere(head,white,[x-.025,.005,.635],[.027,.03,.012]);}
    for(const x of [-.29,.29]){const brow=sphere(head,hair,[x,.16,.5],a.brows==="Arched"?[.19,.055,.035]:[.19,.035,.035],20);brow.rotation.z=a.brows==="Straight"?0:(x<0?.1:-.1);}
    const noseScale=a.noseStyle==="Defined"?[.055,.105,.055]:a.noseStyle==="Soft"?[.045,.075,.035]:[.04,.055,.03];
    sphere(head,skin,[0,-.2,.57],noseScale,16);
    if(a.makeup==='Rosy cheeks'){sphere(head,blush,[-.48,-.29,.47],[.13,.07,.025],20);sphere(head,blush,[.48,-.29,.47],[.13,.07,.025],20);}
    const mouthMat=mat('#9d5865');
    const mouthPoints=a.mouthStyle==="Pout"?[[-.09,-.4,.56],[0,-.37,.59],[.09,-.4,.56]]:a.mouthStyle==="Open smile"?[[-.11,-.38,.55],[0,-.47,.58],[.11,-.38,.55]]:a.expression==="Confident"?[[-.1,-.4,.56],[0,-.42,.58],[.1,-.4,.56]]:a.expression==="Shy"?[[-.08,-.41,.56],[0,-.44,.58],[.08,-.41,.56]]:[[-.105,-.39,.55],[0,-.43,.58],[.105,-.39,.55]];
    const mouthCurve=new THREE.CatmullRomCurve3(mouthPoints.map(p=>new THREE.Vector3(...p)));head.add(new THREE.Mesh(new THREE.TubeGeometry(mouthCurve,16,.018,8,false),mouthMat));
    if(a.makeup==="Winged liner"){for(const x of [-.29,.29]){const wing=sphere(head,dark,[x+(x<0?-.17:.17),-.02,.51],[.07,.025,.018],16);wing.rotation.z=x<0?.3:-.3;}}
    if(a.accessory==='Round glasses'){for(const x of [-.29,.29]){const ring=new THREE.Mesh(new THREE.TorusGeometry(.19,.018,10,40),dark);ring.position.set(x,-.06,.61);head.add(ring);}const bridge=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.17,12),dark);bridge.rotation.z=Math.PI/2;bridge.position.set(0,-.06,.61);head.add(bridge);}
    if(a.accessory==='Headphones'){const band=new THREE.Mesh(new THREE.TorusGeometry(.76,.055,12,48,Math.PI),mat('#d8b8ef'));band.rotation.z=Math.PI;band.position.set(0,.22,-.03);head.add(band);sphere(head,mat('#d8b8ef'),[-.76,-.08,0],[.13,.25,.16]);sphere(head,mat('#d8b8ef'),[.76,-.08,0],[.13,.25,.16]);}
    if(a.accessory==='Star clips'||a.accessory==='Flower pin'||a.accessory==='Crescent crown'){const pinMat=mat('#f0d18e',.3,.35);sphere(head,pinMat,[.57,.48,.48],[.12,.12,.06],20);}
    if(a.outfitStyle==='Fantasy'||a.outfitStyle==='Elegant'){sphere(group,mat('#e8cf93',.35,.3),[0,-.65,.38],[.28,.07,.04]);}
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
        const rim=new THREE.DirectionalLight('#d8b8ff',1.5);rim.position.set(-4,2,-3);scene.add(rim);
        const floor=new THREE.Mesh(new THREE.CircleGeometry(1.35,48),new THREE.MeshBasicMaterial({color:a.background,transparent:true,opacity:.55}));floor.rotation.x=-Math.PI/2;floor.position.set(0,-2.58,0);scene.add(floor);
        state={scene,camera,renderer,group:null,rotation:0,drag:false,lastX:0,resize:null};threeScenes.set(stage,state);
        const resize=()=>{if(!stage.isConnected)return;const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};
        if(typeof ResizeObserver!=='undefined'){state.resize=new ResizeObserver(resize);state.resize.observe(stage);}else window.addEventListener('resize',resize);
        const activePointers=new Map();let pinchStart=0,pinchZoom=0;
        renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();camera.position.z=Math.max(5.4,Math.min(11.5,camera.position.z+e.deltaY*.008));},{passive:false});
        renderer.domElement.addEventListener('pointerdown',e=>{activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});renderer.domElement.setPointerCapture?.(e.pointerId);if(activePointers.size===1){state.drag=true;state.lastX=e.clientX;}if(activePointers.size===2){const p=[...activePointers.values()];pinchStart=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);pinchZoom=camera.position.z;state.drag=false;}});
        renderer.domElement.addEventListener('pointermove',e=>{if(!activePointers.has(e.pointerId))return;const previous=activePointers.get(e.pointerId);activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(activePointers.size===2){const p=[...activePointers.values()],distance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);if(pinchStart>0)camera.position.z=Math.max(5.4,Math.min(11.5,pinchZoom*pinchStart/Math.max(1,distance)));return;}if(state.drag){state.rotation+=(e.clientX-previous.x)*.012;state.lastX=e.clientX;if(state.group)state.group.rotation.y=state.rotation;}});
        const end=e=>{activePointers.delete(e.pointerId);state.drag=activePointers.size===1;if(state.drag)state.lastX=[...activePointers.values()][0].x;else pinchStart=0;};renderer.domElement.addEventListener('pointerup',end);renderer.domElement.addEventListener('pointercancel',end);
        const animate=()=>{if(!stage.isConnected){state.resize?.disconnect();renderer.dispose();threeScenes.delete(stage);return;}state.frame=requestAnimationFrame(animate);renderer.render(scene,camera);};animate();resize();
        stage.querySelectorAll('[data-3d-view]').forEach(btn=>btn.addEventListener('click',()=>{const view=btn.dataset['3dView'];state.rotation=view==='side'?Math.PI/2:view==='back'?Math.PI:0;if(state.group)state.group.rotation.y=state.rotation;stage.querySelectorAll('[data-3d-view]').forEach(x=>x.classList.toggle('active',x===btn));}));
      }
      if(state.group){state.scene.remove(state.group);state.group.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});}
      state.group=make3DCharacter(THREE,a);state.group.position.y=-.05;state.group.rotation.y=state.rotation;state.scene.add(state.group);
      const floor=state.scene.children.find(o=>o.geometry&&o.geometry.type==='CircleGeometry');if(floor)floor.material.color.set(a.background);
      stage.classList.add('is-3d-ready');
    }).catch(error=>{if(stage.isConnected){const msg=stage.querySelector('.ai-3d-loading');if(msg){msg.outerHTML=avatarSvg(a,280);stage.classList.add('is-3d-fallback');}const note=stage.parentElement?.querySelector('.ai-preview-caption');if(note)note.textContent='2D PREVIEW · 3D ENGINE UNAVAILABLE';}});
  }
  function avatarEditor(a) {
    return '<div class="ai-avatar-studio"><div class="ai-avatar-preview-column"><div class="ai-avatar-stage ai-3d-stage" id="aiAvatarStage"><div class="ai-3d-loading">Loading interactive 3D character…</div><div class="ai-3d-view-controls"><button type="button" data-3d-view="front" class="active">Front</button><button type="button" data-3d-view="side">Side</button><button type="button" data-3d-view="back">Back</button></div></div><div class="ai-preview-caption"><span>LIVE PREVIEW</span><span>✦ YOUR ORIGINAL CHARACTER</span></div></div><div class="ai-avatar-controls"><div class="ai-studio-heading"><span class="ai-step">CHARACTER CREATOR · 01</span><h3>Design every detail</h3><p>Choose a look, layer on details and watch your character change instantly.</p></div><div class="ai-editor-section"><h4>Face & features</h4>'+choiceTiles("Face shape","faceShape",avatarChoices.faceShape,a.faceShape)+choiceTiles("Eye design","eyeStyle",avatarChoices.eyeStyle,a.eyeStyle)+choiceTiles("Brows","brows",avatarChoices.brows,a.brows)+choiceTiles("Nose","noseStyle",avatarChoices.noseStyle,a.noseStyle)+choiceTiles("Mouth","mouthStyle",avatarChoices.mouthStyle,a.mouthStyle)+choiceTiles("Expression","expression",avatarChoices.expression,a.expression)+choiceTiles("Body proportions","bodyType",avatarChoices.bodyType,a.bodyType)+'</div><div class="ai-editor-section"><h4>Hair & styling</h4>'+choiceTiles("Hairstyle","hairStyle",avatarChoices.hairStyle,a.hairStyle)+colorField("Hair colour","hair",palettes.hair,a.hair)+'</div><div class="ai-editor-section"><h4>Outfit & extras</h4>'+choiceTiles("Outfit style","outfitStyle",avatarChoices.outfitStyle,a.outfitStyle)+choiceTiles("Accessory","accessory",avatarChoices.accessory,a.accessory)+choiceTiles("Makeup","makeup",avatarChoices.makeup,a.makeup)+colorField("Outfit colour","outfit",palettes.outfit,a.outfit)+'</div><div class="ai-editor-section ai-editor-colours"><h4>Finishing touches</h4>'+colorField("Skin tone","skin",palettes.skin,a.skin)+colorField("Eye colour","eyes",palettes.eyes,a.eyes)+colorField("Scene","background",palettes.bg,a.background)+'</div><label class="ai-image-url">Or use your own avatar image (HTTPS URL)<input name="avatarUrl" type="url" maxlength="1000" placeholder="https://…"></label></div></div>';
  }
  function bindAvatarEditor(host, initial) {
    const update=()=>{
      const form=host.querySelector(".ai-avatar-controls"); if(!form)return;
      const a={...initial}; new FormData(form).forEach((v,k)=>{if(k!=="avatarUrl")a[k]=v;});
      const stage=host.querySelector("#aiAvatarStage"); if(stage)update3DAvatar(stage,a);
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
    const a={...initial}; const allowed=["hairStyle","faceShape","eyeStyle","brows","expression","noseStyle","mouthStyle","bodyType","outfitStyle","accessory","makeup","skin","hair","eyes","outfit","background"]; new FormData(form).forEach((v,k)=>{if(allowed.includes(k))a[k]=v;}); return a;
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
    root().querySelector("#aiChat").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,message=form.elements.message.value.trim();if(!message)return;const send=form.querySelector("button");send.disabled=true;send.textContent="Sending…";try{await api("/api/ai-companion/chat",{method:"POST",body:{message}});await load();}catch(error){fail(error);send.disabled=false;send.textContent="Send ↗";}};
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