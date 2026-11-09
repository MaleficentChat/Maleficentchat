/* Shared room experiences: small-group voice and YouTube listening queue. */
(()=> {
  if(window.__mcRoomExperiencesLoaded)return;window.__mcRoomExperiencesLoaded=true;
  const $=id=>document.getElementById(id);
  const root=document.createElement("div");root.id="mcRoomExperiences";
  root.innerHTML=`
    <section class="mcre-panel" id="mcrePanel" hidden>
      <header><div><small>LIVE ROOM EXPERIENCES</small><h3 id="mcreTitle">Room Lounge</h3></div><button type="button" id="mcreClose" aria-label="Close">×</button></header>
      <nav><button type="button" class="active" data-tab="voice">🎙 Group Voice</button><button type="button" data-tab="music">▶ YouTube Room</button></nav>
      <div class="mcre-pane" id="mcreVoicePane">
        <p class="mcre-note">Talk together with people in this chat room. Up to 6 people · microphone only.</p>
        <div class="mcre-actions"><button type="button" class="mcre-primary" id="mcreJoinVoice">Join voice room</button><button type="button" id="mcreLeaveVoice" hidden>Leave voice</button><button type="button" id="mcreMute" hidden>Mute mic</button></div>
        <div id="mcreVoiceStatus" class="mcre-status">Not connected to group voice.</div><div id="mcreParticipants" class="mcre-participants"></div><div id="mcreAudio"></div>
      </div>
      <div class="mcre-pane" id="mcreMusicPane" hidden>
        <p class="mcre-note">Find a YouTube video, tap it, and add it to this room’s shared listening queue.</p>
        <button type="button" class="mcre-primary mcre-add-listen" id="mcreOpenPicker">＋ Add to Listen</button>
        <div class="mcre-picker" id="mcrePicker" hidden><div class="mcre-picker-head"><b>Choose a YouTube video</b><button type="button" id="mcrePickerClose" aria-label="Close video picker">×</button></div><div class="mcre-picker-search"><input id="mcreVideoSearch" type="search" placeholder="Search YouTube videos…" maxlength="100"><button type="button" id="mcreVideoSearchBtn">Search</button></div><div id="mcreVideoResults" class="mcre-video-results"><p class="mcre-note">Search for a song, artist, or video.</p></div></div>
        <div id="mcreNowPlaying" class="mcre-now">Nothing selected yet.</div><div id="mcreEmbed"></div>
        <h4>Room queue</h4><div id="mcreQueue" class="mcre-queue"></div>
      </div>
      <div id="mcreError" class="mcre-error" role="status"></div>
    </section>`;
  document.body.appendChild(root);
  const css=document.createElement("link");css.rel="stylesheet";css.href="/room-experiences.css?v=4";document.head.appendChild(css);
  const panel=$("mcrePanel"),voicePane=$("mcreVoicePane"),musicPane=$("mcreMusicPane");
  let socket=null,authed=false,ownUserId="",activeRoom="",localStream=null,joined=false,muted=false,peers=new Map(),peerNames=new Map(),pendingIce=new Map(),musicState={queue:[],current:null};
  let rtc={iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]};
  function refreshRtcConfig(){
    return new Promise(resolve=>{
      if(!socket||!authed){resolve(false);return;}
      socket.emit("rtc:config",{},result=>{
        if(result?.ok&&Array.isArray(result.iceServers)){rtc={iceServers:result.iceServers};resolve(true);}
        else resolve(false);
      });
    });
  }
  function error(message){$("mcreError").textContent=message||"";}
  function status(message){$("mcreVoiceStatus").textContent=message;}
  function token(){try{return localStorage.getItem("mc_token")||"";}catch{return "";}}
  function auth(){
    if(!socket?.connected)return;const t=token();if(!t){authed=false;error("Please log in to use room experiences.");return;}
    socket.emit("auth",t,r=>{authed=!!r?.ok;ownUserId=String(r?.userId||ownUserId);if(!authed)error(r?.error||"Please log in again.");});
  }
  function ensureSocket(){
    if(socket)return true;const ctx=window.__mcRoomContext?.();socket=ctx?.socket||null;
    if(!socket){error("Connect to the chat room first, then reopen Room Lounge.");return false;}
    ownUserId=String(ctx?.userId||"");authed=!!ownUserId;
    socket.on("connect",()=>{authed=!!window.__mcRoomContext?.().userId;if(joined)stopVoice(false);});
    socket.on("disconnect",()=>{authed=false;if(joined)stopVoice(false);});
    socket.on("group-voice:peer-joined",p=>{if(!joined||String(p.userId)===ownUserId)return;peerNames.set(String(p.userId),String(p.displayName||p.username||p.userId));ensurePeer(String(p.userId));renderParticipants();});
    socket.on("group-voice:peer-left",p=>{peerNames.delete(String(p.userId));closePeer(String(p.userId));renderParticipants();});
    socket.on("group-voice:count",p=>{if(joined)status("Connected · "+p.count+" / 6 participants");});
    socket.on("group-voice:signal",async p=>{
      if(!joined||p.roomId!==activeRoom||String(p.toId)!==ownUserId)return;
      const id=String(p.fromId),pc=ensurePeer(id),sig=p.signal;
      try{
        if(sig.type==="offer"){await pc.setRemoteDescription({type:"offer",sdp:sig.sdp});for(const candidate of pendingIce.get(id)||[])await pc.addIceCandidate(candidate);pendingIce.delete(id);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("group-voice:signal",{roomId:activeRoom,toId:id,signal:{type:"answer",sdp:answer.sdp}});}
        else if(sig.type==="answer"){await pc.setRemoteDescription({type:"answer",sdp:sig.sdp});for(const candidate of pendingIce.get(id)||[])await pc.addIceCandidate(candidate);pendingIce.delete(id);}
        else if(sig.type==="candidate"&&sig.candidate){if(pc.remoteDescription)await pc.addIceCandidate(sig.candidate);else{const list=pendingIce.get(id)||[];list.push(sig.candidate);pendingIce.set(id,list);}}
      }catch(e){error("Voice connection issue: "+(e.message||"please retry."));}
    });
    socket.on("music-room:updated",s=>{musicState=s;renderQueue();});
    socket.on("music-room:playing",p=>{musicState.current=p.item;renderNowPlaying(p.item,p.by);});
    if(!authed&&socket.connected)auth();return true;
  }
  function ensurePeer(id){
    if(peers.has(id))return peers.get(id);
    const pc=new RTCPeerConnection(rtc);
    if(localStream)localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
    pc.onicecandidate=e=>{if(e.candidate&&socket)socket.emit("group-voice:signal",{roomId:activeRoom,toId:id,signal:{type:"candidate",candidate:e.candidate.toJSON()}});};
    pc.ontrack=e=>{let audio=$("mcre-audio-"+id);if(!audio){audio=document.createElement("audio");audio.id="mcre-audio-"+id;audio.autoplay=true;audio.playsInline=true;$("mcreAudio").appendChild(audio);}audio.srcObject=e.streams[0];audio.play().catch(()=>{});};
    pc.onconnectionstatechange=()=>{if(["failed","closed","disconnected"].includes(pc.connectionState)&&pc.connectionState!=="disconnected")closePeer(id);};
    peers.set(id,pc);return pc;
  }
  async function offerTo(id){const pc=ensurePeer(id);const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit("group-voice:signal",{roomId:activeRoom,toId:id,signal:{type:"offer",sdp:offer.sdp}});}
  function closePeer(id){const pc=peers.get(id);if(pc){pc.ontrack=null;pc.close();peers.delete(id);}pendingIce.delete(id);const audio=$("mcre-audio-"+id);if(audio){audio.srcObject=null;audio.remove();}}
  function renderParticipants(){
    const box=$("mcreParticipants");box.innerHTML="";
    for(const [id] of peers){const chip=document.createElement("span");chip.className="mcre-person";chip.textContent="● "+(peerNames.get(id)||id);box.appendChild(chip);}
    if(joined){const me=document.createElement("span");me.className="mcre-person self";me.textContent="● You";box.prepend(me);}
  }
  async function joinVoice(){
    error("");if(!ensureSocket())return;if(!authed){auth();error("Connecting your account… try again in a moment.");return;}
    activeRoom=String(window.__mcRoomContext?.().roomId||"");
    if(!activeRoom){error("Open a chat room first.");return;}
    await refreshRtcConfig();
    try{localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});}
    catch(e){error("Microphone permission is needed: "+(e.message||"permission denied"));return;}
    socket.emit("group-voice:join",{roomId:activeRoom},async r=>{
      if(!r?.ok){localStream.getTracks().forEach(t=>t.stop());localStream=null;error(r?.error||"Could not join group voice.");return;}
      joined=true;$("mcreJoinVoice").hidden=true;$("mcreLeaveVoice").hidden=false;$("mcreMute").hidden=false;
      status("Connected · "+(r.participants.length+1)+" / 6 participants");renderParticipants();
      try{for(const p of r.participants||[]){peerNames.set(String(p.userId),String(p.displayName||p.username||p.userId));await offerTo(String(p.userId));}renderParticipants();}catch(e){error("Could not start voice connection: "+(e.message||"retry"));}
    });
  }
  function stopVoice(notify=true){
    if(notify&&socket&&joined)socket.emit("group-voice:leave");
    for(const id of [...peers.keys()])closePeer(id);peerNames.clear();pendingIce.clear();
    if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
    joined=false;muted=false;$("mcreJoinVoice").hidden=false;$("mcreLeaveVoice").hidden=true;$("mcreMute").hidden=true;$("mcreMute").textContent="Mute mic";
    status("Not connected to group voice.");renderParticipants();
  }
  function renderNowPlaying(item,by){
    const now=$("mcreNowPlaying"),embed=$("mcreEmbed");embed.innerHTML="";
    if(!item){now.textContent="Nothing selected yet.";return;}
    now.textContent="Selected by "+(by||"room member")+" · "+item.title;
    const frame=document.createElement("iframe");frame.title="YouTube listening room player";frame.loading="lazy";frame.allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";frame.src="https://www.youtube-nocookie.com/embed/"+encodeURIComponent(item.videoId)+"?playsinline=1&rel=0";frame.width="100%";frame.height="220";frame.style.border="0";frame.style.borderRadius="12px";embed.appendChild(frame);
  }
  function renderQueue(){
    const box=$("mcreQueue");box.innerHTML="";
    (musicState.queue||[]).forEach(item=>{
      const row=document.createElement("div");row.className="mcre-queue-item";
      const label=document.createElement("span");label.textContent=item.title+" · added by "+item.addedBy;
      const play=document.createElement("button");play.textContent="Play";play.onclick=()=>socket.emit("music-room:play",{id:item.id},r=>{if(!r?.ok)error(r?.error||"Could not select track.");});
      const remove=document.createElement("button");remove.textContent="×";remove.title="Remove from queue";remove.onclick=()=>socket.emit("music-room:remove",{id:item.id},r=>{if(!r?.ok)error(r?.error||"Could not remove item.");});
      row.append(label,play,remove);box.appendChild(row);
    });
    if(!(musicState.queue||[]).length){const empty=document.createElement("p");empty.className="mcre-note";empty.textContent="The room queue is empty. Tap Add to Listen to find a YouTube video.";box.appendChild(empty);}
    if(musicState.current)renderNowPlaying(musicState.current);
  }
  function loadMusic(){
    if(!ensureSocket())return;if(!authed){auth();error("Connecting your account… try again in a moment.");return;}
    activeRoom=String(window.currentRoomId||window.activeRoomId||"");if(!activeRoom){error("Open a chat room first.");return;}
    socket.emit("music-room:get",{},r=>{if(r?.ok){musicState=r;renderQueue();}else error(r?.error||"Could not load room music.");});
  }
  function openVideoPicker(){
    $("mcrePicker").hidden=false;$("mcreVideoSearch").focus();
  }
  function closeVideoPicker(){$("mcrePicker").hidden=true;}
  async function searchRoomVideos(){
    const query=$("mcreVideoSearch").value.trim();if(!query)return error("Search for a video first.");
    const results=$("mcreVideoResults"),button=$("mcreVideoSearchBtn");button.disabled=true;button.textContent="Searching…";
    results.innerHTML="";const loading=document.createElement("p");loading.className="mcre-note";loading.textContent="Finding videos…";results.appendChild(loading);
    try{
      const response=await fetch("/api/youtube/search?q="+encodeURIComponent(query),{headers:{Authorization:"Bearer "+token()}});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"YouTube search failed.");
      results.replaceChildren();const videos=(data.results||[]).filter(v=>/^[A-Za-z0-9_-]{11}$/.test(String(v.id||"")));
      if(!videos.length){const empty=document.createElement("p");empty.className="mcre-note";empty.textContent=data.notice||"No videos found. Try another search.";results.appendChild(empty);return;}
      videos.forEach(video=>{
        const pick=document.createElement("button");pick.type="button";pick.className="mcre-video-result";
        const img=document.createElement("img");img.loading="lazy";img.src=video.thumbnail||("https://i.ytimg.com/vi/"+video.id+"/mqdefault.jpg");img.alt="";
        const details=document.createElement("span"),title=document.createElement("b"),channel=document.createElement("small");title.textContent=video.title||"YouTube video";channel.textContent=video.channel||"YouTube";details.append(title,channel);pick.append(img,details);
        pick.onclick=()=>{
          if(!ensureSocket()||!authed){auth();error("Connecting your account… try again in a moment.");return;}
          pick.disabled=true;pick.classList.add("adding");
          socket.emit("music-room:add",{youtubeId:video.id,title:video.title||"YouTube video"},r=>{
            if(!r?.ok){pick.disabled=false;pick.classList.remove("adding");error(r?.error||"Could not add this video.");return;}
            closeVideoPicker();error("");
          });
        };
        results.appendChild(pick);
      });
    }catch(e){results.replaceChildren();const note=document.createElement("p");note.className="mcre-note";note.textContent=e.message||"YouTube search failed.";results.appendChild(note);}
    finally{button.disabled=false;button.textContent="Search";}
  }
  $("mcreOpenPicker").onclick=openVideoPicker;$("mcrePickerClose").onclick=closeVideoPicker;
  $("mcreVideoSearchBtn").onclick=searchRoomVideos;
  $("mcreVideoSearch").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchRoomVideos();}});
  $("mcreJoinVoice").onclick=joinVoice;$("mcreLeaveVoice").onclick=()=>stopVoice(true);
  $("mcreMute").onclick=()=>{muted=!muted;(localStream?.getAudioTracks()||[]).forEach(t=>t.enabled=!muted);$("mcreMute").textContent=muted?"Unmute mic":"Mute mic";};
  $("mcreClose").onclick=()=>{panel.hidden=true;};
  document.querySelectorAll("#mcrePanel [data-tab]").forEach(btn=>btn.onclick=()=>{
    document.querySelectorAll("#mcrePanel [data-tab]").forEach(x=>x.classList.toggle("active",x===btn));
    const music=btn.dataset.tab==="music";voicePane.hidden=music;musicPane.hidden=!music;$("mcreTitle").textContent=music?"YouTube Listening Room":"Group Voice Room";
    if(music)loadMusic();error("");
  });
  function openExperience(tab){
    panel.hidden=false;
    document.querySelector('#mcrePanel [data-tab="'+tab+'"]').click();
    ensureSocket();
  }
  function addLaunchers(){
    const actions=document.querySelector(".mc-online-panel-actions")||document.querySelector("#onlinePanel .panel-head")||document.querySelector("#onlinePanelTitle")?.closest(".panel-head");
    if(!actions||actions.querySelector("#mcreYouTubeLaunch")||actions.querySelector("#mcreVoiceLaunch"))return false;
    const wrap=document.createElement("span");wrap.className="mcre-launch-actions";
    wrap.innerHTML='<button type="button" id="mcreSpotifyLaunch" title="Open Spotify Listening Room">♫ Spotify</button><button type="button" id="mcreVoiceLaunch" title="Open Group Voice Room">🎙 Voice</button>';
    actions.appendChild(wrap);
    $("mcreSpotifyLaunch").onclick=()=>openExperience("music");
    $("mcreVoiceLaunch").onclick=()=>openExperience("voice");
    return true;
  }
  if(!addLaunchers()){const observer=new MutationObserver(()=>{if(addLaunchers())observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),12000);}
  setInterval(()=>{const nowRoom=String(window.__mcRoomContext?.().roomId||"");if(joined&&nowRoom!==activeRoom)stopVoice(true);},1200);
  window.addEventListener("beforeunload",()=>stopVoice(true));
})();