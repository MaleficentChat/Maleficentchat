/* Midnight Calls — authenticated one-to-one WebRTC UI. */
(function(){
  if(window.__midnightCallsLoaded)return;
  window.__midnightCallsLoaded=true;
  const style=document.createElement("link");style.rel="stylesheet";style.href="/calls.css?v=1";document.head.appendChild(style);
  const root=document.createElement("div");root.id="midnightCallsRoot";root.innerHTML=`
    <button class="mc-call-launch" id="mcCallLaunch" type="button" aria-label="Open Midnight Calls">☎</button>
    <section class="mc-call-panel" id="mcCallPanel" hidden aria-label="Midnight Calls">
      <header><div><small>MIDNIGHT NETWORK</small><h2>☎ Midnight Calls</h2></div><button type="button" id="mcCallClose" aria-label="Close">×</button></header>
      <div class="mc-call-start" id="mcCallStart">
        <label for="mcCallTarget">Call username</label><input id="mcCallTarget" maxlength="24" autocomplete="off" placeholder="Enter their username">
        <label for="mcCallMode">Call type</label><select id="mcCallMode"><option value="audio">Voice call</option><option value="video">Video call</option></select>
        <button class="mc-call-primary" id="mcCallStartBtn" type="button">Start call</button>
        <p class="mc-call-note">Calls require both users to be online. Your browser will ask for microphone or camera access.</p>
      </div>
      <div class="mc-call-status" id="mcCallStatus" hidden></div>
      <div class="mc-call-media" id="mcCallMedia" hidden><video id="mcCallRemote" autoplay playsinline></video><video id="mcCallLocal" autoplay muted playsinline></video></div>
      <div class="mc-call-controls" id="mcCallControls" hidden>
        <button type="button" id="mcCallMute">Mute</button><button type="button" id="mcCallCamera">Camera off</button><button type="button" id="mcCallHangup" class="mc-call-danger">End call</button>
      </div>
      <div class="mc-call-incoming" id="mcCallIncoming" hidden><b id="mcCallIncomingText">Incoming call</b><div><button type="button" id="mcCallAccept" class="mc-call-primary">Accept</button><button type="button" id="mcCallDecline" class="mc-call-danger">Decline</button></div></div>
    </section>`;
  document.body.appendChild(root);
  const $=id=>document.getElementById(id);
  const panel=$("mcCallPanel"),startBox=$("mcCallStart"),status=$("mcCallStatus"),media=$("mcCallMedia"),controls=$("mcCallControls"),incoming=$("mcCallIncoming");
  let socket=null,authed=false,activeCall=null,localStream=null,peer=null,pendingIncoming=null,pendingCandidates=[],muted=false,cameraOff=false;
  const rtcConfig={iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]};
  function show(){panel.hidden=false;$("mcCallTarget").focus();}
  function resetUI(message){
    if(peer){peer.ontrack=null;peer.onicecandidate=null;peer.close();peer=null;}pendingCandidates=[];
    if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
    $("mcCallRemote").srcObject=null;$("mcCallLocal").srcObject=null;
    activeCall=null;pendingIncoming=null;muted=false;cameraOff=false;
    startBox.hidden=false;media.hidden=true;controls.hidden=true;incoming.hidden=true;status.hidden=!message;
    status.textContent=message||"";$("mcCallMute").textContent="Mute";$("mcCallCamera").textContent="Camera off";
  }
  function say(message){status.hidden=false;status.textContent=message;}
  function authSocket(){
    if(!socket||!socket.connected)return;
    let token="";try{token=localStorage.getItem("mc_token")||"";}catch{}
    if(!token){authed=false;return;}
    socket.emit("auth",token,result=>{authed=!!result?.ok;if(!authed&&result?.error)console.warn("Calls auth:",result.error);});
  }
  function ensureSocket(){
    if(socket)return;
    if(typeof window.io!=="function"){say("Live calling is unavailable right now.");return;}
    socket=window.io();socket.on("connect",authSocket);socket.on("disconnect",()=>{authed=false;if(activeCall)resetUI("Connection lost. The call has ended.");});
    socket.on("call:incoming",data=>{
      if(activeCall||pendingIncoming){socket.emit("call:respond",{callId:data.callId,accept:false});return;}
      pendingIncoming=data;show();startBox.hidden=true;incoming.hidden=false;status.hidden=true;
      $("mcCallIncomingText").textContent=(data.fromName||"Someone")+" is calling you ("+(data.mode==="video"?"video":"voice")+")";
    });
    socket.on("call:accepted",async data=>{
      if(!activeCall||activeCall.callId!==data.callId)return;
      activeCall.peerId=data.peerId;startBox.hidden=true;incoming.hidden=true;media.hidden=false;controls.hidden=false;
      try{
        localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:activeCall.mode==="video"});
        $("mcCallLocal").srcObject=localStream;$("mcCallLocal").hidden=activeCall.mode!=="video";
        peer=new RTCPeerConnection(rtcConfig);localStream.getTracks().forEach(track=>peer.addTrack(track,localStream));
        peer.ontrack=event=>{$("mcCallRemote").srcObject=event.streams[0];};
        pendingCandidates=[];peer.onicecandidate=event=>{if(event.candidate)socket.emit("call:signal",{callId:activeCall.callId,signal:{type:"candidate",candidate:event.candidate}});};
        if(activeCall.initiator){const offer=await peer.createOffer();await peer.setLocalDescription(offer);socket.emit("call:signal",{callId:activeCall.callId,signal:{type:"offer",sdp:offer.sdp}});}
        say("Connected · "+(activeCall.mode==="video"?"Video call":"Voice call"));
      }catch(error){say("Could not access your microphone or camera: "+(error.message||"permission denied"));socket.emit("call:end",{callId:activeCall.callId});}
    });
    socket.on("call:signal",async data=>{
      if(!activeCall||activeCall.callId!==data.callId)return;
      try{
        const signal=data.signal;
        if(signal.type==="offer"){
          if(!peer){
            localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:activeCall.mode==="video"});
            $("mcCallLocal").srcObject=localStream;$("mcCallLocal").hidden=activeCall.mode!=="video";
            peer=new RTCPeerConnection(rtcConfig);localStream.getTracks().forEach(track=>peer.addTrack(track,localStream));
            peer.ontrack=event=>{$("mcCallRemote").srcObject=event.streams[0];};
            peer.onicecandidate=event=>{if(event.candidate)socket.emit("call:signal",{callId:activeCall.callId,signal:{type:"candidate",candidate:event.candidate}});};
          }
          await peer.setRemoteDescription({type:"offer",sdp:signal.sdp});for(const candidate of pendingCandidates.splice(0)){await peer.addIceCandidate(candidate);}const answer=await peer.createAnswer();await peer.setLocalDescription(answer);socket.emit("call:signal",{callId:activeCall.callId,signal:{type:"answer",sdp:answer.sdp}});
        }else if(signal.type==="answer"&&peer){await peer.setRemoteDescription({type:"answer",sdp:signal.sdp});for(const candidate of pendingCandidates.splice(0)){await peer.addIceCandidate(candidate);}}
        else if(signal.type==="candidate"&&peer&&signal.candidate){if(peer.remoteDescription)await peer.addIceCandidate(signal.candidate);else pendingCandidates.push(signal.candidate);}
      }catch(error){say("Call connection error: "+(error.message||"please try again"));socket.emit("call:end",{callId:activeCall.callId});}
    });
    socket.on("call:ended",data=>{if(activeCall?.callId===data.callId||pendingIncoming?.callId===data.callId)resetUI(data.reason==="declined"?"Call declined.":data.reason==="no-answer"?"No answer.":"Call ended.");});
    if(socket.connected)authSocket();
  }
  $("mcCallLaunch").addEventListener("click",()=>{show();ensureSocket();});
  $("mcCallClose").addEventListener("click",()=>{panel.hidden=true;});
  $("mcCallStartBtn").addEventListener("click",()=>{
    ensureSocket();if(!authed){say("Please wait for your account to connect, then try again.");authSocket();return;}
    const to=$("mcCallTarget").value.trim();if(!to){say("Enter a username first.");return;}
    const mode=$("mcCallMode").value;
    $("mcCallStartBtn").disabled=true;
    socket.emit("call:invite",{to,mode},result=>{
      $("mcCallStartBtn").disabled=false;
      if(!result?.ok){say(result?.error||"Could not start the call.");return;}
      activeCall={callId:result.callId,mode,initiator:true};startBox.hidden=true;say("Calling "+to+"… waiting for them to answer.");
    });
  });
  $("mcCallAccept").addEventListener("click",()=>{
    if(!pendingIncoming||!authed)return;
    const call=pendingIncoming;activeCall={callId:call.callId,mode:call.mode,initiator:false};pendingIncoming=null;
    socket.emit("call:respond",{callId:call.callId,accept:true},result=>{if(!result?.ok)resetUI(result?.error||"Could not accept the call.");});
  });
  $("mcCallDecline").addEventListener("click",()=>{if(pendingIncoming)socket.emit("call:respond",{callId:pendingIncoming.callId,accept:false});resetUI("Call declined.");});
  $("mcCallHangup").addEventListener("click",()=>{if(activeCall&&socket)socket.emit("call:end",{callId:activeCall.callId});resetUI("Call ended.");});
  $("mcCallMute").addEventListener("click",()=>{muted=!muted;(localStream?.getAudioTracks()||[]).forEach(t=>t.enabled=!muted);$("mcCallMute").textContent=muted?"Unmute":"Mute";});
  $("mcCallCamera").addEventListener("click",()=>{cameraOff=!cameraOff;(localStream?.getVideoTracks()||[]).forEach(t=>t.enabled=!cameraOff);$("mcCallCamera").textContent=cameraOff?"Camera on":"Camera off";});
  ensureSocket();setInterval(()=>{if(socket&&!authed)authSocket();},1500);
})();