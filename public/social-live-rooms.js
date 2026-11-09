/* Shared room experiences: small-group voice and Spotify queue. */
(()=> {
  if(window.__mcRoomExperiencesLoaded)return;window.__mcRoomExperiencesLoaded=true;
  const $=id=>document.getElementById(id);
  const root=document.createElement("div");root.id="mcRoomExperiences";
  root.innerHTML=`
    <section class="mcre-panel" id="mcrePanel" hidden>
      <header><div><small>LIVE ROOM EXPERIENCES</small><h3 id="mcreTitle">Room Lounge</h3></div><button type="button" id="mcreClose" aria-label="Close">×</button></header>
      <nav><button type="button" class="active" data-tab="voice">🎙 Group Voice</button><button type="button" data-tab="music">♫ Spotify Room</button></nav>
      <div class="mcre-pane" id="mcreVoicePane">
        <p class="mcre-note">Talk together with people in this chat room. Up to 6 people · microphone only.</p>
        <div class="mcre-actions"><button type="button" class="mcre-primary" id="mcreJoinVoice">Join voice room</button><button type="button" id="mcreLeaveVoice" hidden>Leave voice</button><button type="button" id="mcreMute" hidden>Mute mic</button></div>
        <div id="mcreVoiceStatus" class="mcre-status">Not connected to group voice.</div><div id="mcreParticipants" class="mcre-participants"></div><div id="mcreAudio"></div>
      </div>
      <div class="mcre-pane" id="mcreMusicPane" hidden>
        <p class="mcre-note">Share Spotify tracks, albums and playlists with this room. Each listener starts playback in their own Spotify embed.</p>
        <div class="mcre-add"><input id="mcreSpotifyLink" type="url" placeholder="Paste a Spotify link" maxlength="500"><button type="button" id="mcreAddSpotify">Add</button></div>
        <div id="mcreNowPlaying" class="mcre-now">Nothing selected yet.</div><div id="mcreEmbed"></div>
        <h4>Room queue</h4><div id="mcreQueue" class="mcre-queue"></div>
      </div>
      <div id="mcreError" class="mcre-error" role="status"></div>
    </section>`;
  document.body.appendChild(root);
  const css=document.createElement("link");css.rel="stylesheet";css.href="/room-experiences.css?v=1";document.head.appendChild(css);
  const panel=$("mcrePanel"),voicePane=$("mcreVoicePane"),musicPane=$("mcreMusicPane");
  let socket=null,authed=false,ownUserId="",activeRoom="",localStream=null,joined=false,muted=false,peers=new Map(),musicState={queue:[],current:null};
  const rtc={iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]};
  function error(message){$("mcreError").textContent=message||"";}
  function status(message){$("mcreVoiceStatus").textContent=message;}
  function token(){try{return localStorage.getItem("mc_token")||"";}catch{return "";}}
  function auth(){
    if(!socket?.connected)return;const t=token();if(!t){authed=false;error("Please log in to use room experiences.");return;}
    socket.emit("auth",t,r=>{authed=!!r?.ok;ownUserId=String(r?.userId||ownUserId);if(!authed)error(r?.error||"Please log in again.");});
  }
  function ensureSocket(){
    if(socket)return true;if(typeof window.io!=="function"){error("Live room features are unavailable.");return false;}
    socket=window.io();socket.on("connect",auth);socket.on("disconnect",()=>{authed=false;if(joined)stopVoice(false);});
    socket.on("group-voice:peer-joined",p=>{if(!joined||String(p.userId)===ownUserId)return;ensurePeer(String(p.userId));renderParticipants();});
    socket.on("group-voice:peer-left",p=>{closePeer(String(p.userId));renderParticipants();});
    socket.on("group-voice:count",p=>{if(joined)status("Connected · "+p.count+" / 6 participants");});
    socket.on("group-voice:signal",async p=>{
      if(!joined||p.roomId!==activeRoom||String(p.toId)!==String(window.currentUser?.id))return;
      const id=String(p.fromId),pc=ensurePeer(id),sig=p.signal;
      try{
        if(sig.type==="offer"){await pc.setRemoteDescription({type:"offer",sdp:sig.sdp});const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("group-voice:signal",{roomId:activeRoom,toId:id,signal:{type:"answer",sdp:answer.sdp}});}
        else if(sig.type==="answer"){await pc.setRemoteDescription({type:"answer",sdp:sig.sdp});}
        else if(sig.type==="candidate"&&sig.candidate){await pc.addIceCandidate(sig.candidate);}
      }catch(e){error("Voice connection issue: "+(e.message||"please retry."));}
    });
    socket.on("music-room:updated",s=>{musicState=s;renderQueue();});
    socket.on("music-room:playing",p=>{musicState.current=p.item;renderNowPlaying(p.item,p.by);});
    if(socket.connected)auth();return true;
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
  function closePeer(id){const pc=peers.get(id);if(pc){pc.ontrack=null;pc.close();peers.delete(id);}const audio=$("mcre-audio-"+id);if(audio){audio.srcObject=null;audio.remove();}}
  function renderParticipants(){
    const box=$("mcreParticipants");box.innerHTML="";
    for(const [id] of peers){const chip=document.createElement("span");chip.className="mcre-person";chip.textContent="● "+id;box.appendChild(chip);}
    if(joined){const me=document.createElement("span");me.className="mcre-person self";me.textContent="● You";box.prepend(me);}
  }
  async function joinVoice(){
    error("");if(!ensureSocket())return;if(!authed){auth();error("Connecting your account… try again in a moment.");return;}
    activeRoom=String(window.__mcRoomContext?.().roomId||"");
    if(!activeRoom){error("Open a chat room first.");return;}
    try{localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});}
    catch(e){error("Microphone permission is needed: "+(e.message||"permission denied"));return;}
    socket.emit("group-voice:join",{roomId:activeRoom},async r=>{
      if(!r?.ok){localStream.getTracks().forEach(t=>t.stop());localStream=null;error(r?.error||"Could not join group voice.");return;}
      joined=true;$("mcreJoinVoice").hidden=true;$("mcreLeaveVoice").hidden=false;$("mcreMute").hidden=false;
      status("Connected · "+(r.participants.length+1)+" / 6 participants");renderParticipants();
      try{for(const p of r.participants||[])await offerTo(String(p.userId));}catch(e){error("Could not start voice connection: "+(e.message||"retry"));}
    });
  }
  function stopVoice(notify=true){
    if(notify&&socket&&joined)socket.emit("group-voice:leave");
    for(const id of [...peers.keys()])closePeer(id);
    if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
    joined=false;muted=false;$("mcreJoinVoice").hidden=false;$("mcreLeaveVoice").hidden=true;$("mcreMute").hidden=true;$("mcreMute").textContent="Mute mic";
    status("Not connected to group voice.");renderParticipants();
  }
  function renderNowPlaying(item,by){
    const now=$("mcreNowPlaying"),embed=$("mcreEmbed");embed.innerHTML="";
    if(!item){now.textContent="Nothing selected yet.";return;}
    now.textContent="Selected by "+(by||"room member")+" · "+item.title;
    const frame=document.createElement("iframe");frame.title="Spotify room player";frame.loading="lazy";frame.allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";frame.src="https://open.spotify.com/embed/"+encodeURIComponent(item.kind)+"/"+encodeURIComponent(item.spotifyId)+"?utm_source=generator";frame.width="100%";frame.height="152";frame.style.border="0";frame.style.borderRadius="12px";embed.appendChild(frame);
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
    if(!(musicState.queue||[]).length){const empty=document.createElement("p");empty.className="mcre-note";empty.textContent="The room queue is empty. Add a Spotify link above.";box.appendChild(empty);}
    if(musicState.current)renderNowPlaying(musicState.current);
  }
  function loadMusic(){
    if(!ensureSocket())return;if(!authed){auth();error("Connecting your account… try again in a moment.");return;}
    activeRoom=String(window.currentRoomId||window.activeRoomId||"");if(!activeRoom){error("Open a chat room first.");return;}
    socket.emit("music-room:get",{},r=>{if(r?.ok){musicState=r;renderQueue();}else error(r?.error||"Could not load room music.");});
  }
  $("mcreAddSpotify").onclick=()=>{
    const link=$("mcreSpotifyLink").value.trim();if(!link)return error("Paste a Spotify link first.");
    if(!ensureSocket()||!authed){auth();return error("Connecting your account… try again in a moment.");}
    socket.emit("music-room:add",{spotify:link},r=>{if(!r?.ok)error(r?.error||"Could not add Spotify item.");else{$("mcreSpotifyLink").value="";error("");}});
  };
  $("mcreJoinVoice").onclick=joinVoice;$("mcreLeaveVoice").onclick=()=>stopVoice(true);
  $("mcreMute").onclick=()=>{muted=!muted;(localStream?.getAudioTracks()||[]).forEach(t=>t.enabled=!muted);$("mcreMute").textContent=muted?"Unmute mic":"Mute mic";};
  $("mcreClose").onclick=()=>{panel.hidden=true;};
  document.querySelectorAll("#mcrePanel [data-tab]").forEach(btn=>btn.onclick=()=>{
    document.querySelectorAll("#mcrePanel [data-tab]").forEach(x=>x.classList.toggle("active",x===btn));
    const music=btn.dataset.tab==="music";voicePane.hidden=music;musicPane.hidden=!music;$("mcreTitle").textContent=music?"Spotify Listening Room":"Group Voice Room";
    if(music)loadMusic();error("");
  });
  function addLaunchers(){
    const actions=document.querySelector(".mc-online-panel-actions")||document.querySelector("#onlinePanel .panel-head")||document.querySelector("#onlinePanelTitle")?.closest(".panel-head");
    if(!actions||actions.querySelector("#mcreLaunch"))return false;
    const wrap=document.createElement("span");wrap.className="mcre-launch-actions";wrap.innerHTML='<button type="button" id="mcreLaunch" title="Group voice and Spotify room">♫ / 🎙</button>';
    actions.appendChild(wrap);$("mcreLaunch").onclick=()=>{panel.hidden=false;document.querySelector('#mcrePanel [data-tab="voice"]').click();ensureSocket();};return true;
  }
  if(!addLaunchers()){const observer=new MutationObserver(()=>{if(addLaunchers())observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),12000);}
  window.addEventListener("beforeunload",()=>stopVoice(true));
})();