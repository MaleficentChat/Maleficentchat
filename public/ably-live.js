
/* Ably Chat realtime transport for public rooms. The backend remains authoritative. */
(()=>{
  let chatClient=null,realtimeClient=null,activeRoom=null,activeRoomName=null,subscription=null,seen=new Set(),connecting=null,activeUserId=null,pendingDMPeerId=null;
  let activeDMRoom=null,activeDMName=null,dmMessageSubscription=null,presenceSubscription=null;
  const enabled=()=>!!(window.Ably&&window.Ably.Realtime&&window.AblyChat&&window.AblyChat.ChatClient);
  async function getClient(){
    if(chatClient)return chatClient;
    if(connecting)return connecting;
    if(!enabled())throw new Error("Ably Chat browser SDK did not load.");
    connecting=(async()=>{
      const realtime=new Ably.Realtime({
        authCallback:async(_params,callback)=>{
          try{
            const tokenUrl="/api/ably-token"+(pendingDMPeerId?"?dm="+encodeURIComponent(pendingDMPeerId):"");
            const response=await fetch(tokenUrl,{method:"GET",credentials:"same-origin",cache:"no-store",headers:{"Accept":"application/json"}});
            if(!response.ok)throw new Error("Ably authentication failed ("+response.status+").");
            const tokenRequest=await response.json();
            callback(null,tokenRequest);
          }catch(error){callback(error,null);}
        },
        disconnectedRetryTimeout:15000,
        suspendedRetryTimeout:30000
      });
      realtimeClient=realtime;
      const client=new AblyChat.ChatClient(realtime,{logLevel:"error"});
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error("Timed out connecting to Ably.")),15000);
        realtime.connection.once("connected",()=>{clearTimeout(timeout);resolve();});
        realtime.connection.once("failed",state=>{clearTimeout(timeout);reject(state?.reason||new Error("Ably connection failed."));});
      });
      chatClient=client;
      return client;
    })().finally(()=>{connecting=null;});
    return connecting;
  }
  async function setUser(userId){
    const next=String(userId||"");
    if(activeUserId&&next&&activeUserId!==next)await close();
    activeUserId=next;
  }
  async function leaveRoom(){
    if(activeRoom){try{subscription?.unsubscribe?.();presenceSubscription?.unsubscribe?.();await activeRoom.presence.leave({userId:activeUserId}).catch(()=>{});await activeRoom.detach();}catch{}}
    activeRoom=null;activeRoomName=null;subscription=null;
  }
  async function joinRoom(roomId){
    if(!roomId)return;
    const id=String(roomId),name="mc-room-"+id;
    if(activeRoomName===name&&activeRoom)return;
    await leaveRoom();
    const client=await getClient();
    const room=await client.rooms.get(name);
    subscription=room.messages.subscribe(event=>{
      const message=event?.message?.metadata?.maleficentChatMessage;
      if(!message||String(message.roomId)!==id||!message.id)return;
      const key=String(message.id);
      if(seen.has(key))return;
      seen.add(key);if(seen.size>1500)seen=new Set(Array.from(seen).slice(-750));
      window.dispatchEvent(new CustomEvent("mc:ably-message",{detail:message}));
    });
    presenceSubscription=room.presence.subscribe(event=>{
      window.dispatchEvent(new CustomEvent("mc:ably-presence",{detail:{roomId:id,type:event.type,userId:String(event.member?.clientId||"").replace(/^mc-user-/,""),data:event.member?.data||{}}}));
    });
    await room.attach();
    await room.presence.enter({userId:activeUserId});
    activeRoom=room;activeRoomName=name;
    room.onDiscontinuity?.(()=>{
      window.dispatchEvent(new CustomEvent("mc:ably-discontinuity",{detail:{roomId:id}}));
    });
  }
  async function leaveDM(){
    if(activeDMRoom){
      try{dmMessageSubscription?.unsubscribe?.();await activeDMRoom.detach();}catch{}
    }
    activeDMRoom=null;activeDMName=null;dmMessageSubscription=null;
  }
  async function joinDM(peerId){
    if(!peerId||!activeUserId)return;
    const pair=[""+activeUserId,""+peerId].sort(),name="mc-dm-"+pair.join("-");
    if(activeDMName===name&&activeDMRoom)return;
    await leaveDM();
    const hadClient=!!chatClient;
    pendingDMPeerId=String(peerId);
    let client;
    try{
      client=await getClient();
      if(hadClient&&realtimeClient)await realtimeClient.auth.authorize();
    }finally{pendingDMPeerId=null;}
    const room=await client.rooms.get(name);
    dmMessageSubscription=room.messages.subscribe(event=>{
      const message=event?.message?.metadata?.maleficentChatDM;
      if(!message)return;
      const key=String(message.id||"");
      if(key&&seen.has("dm:"+key))return;
      if(key){seen.add("dm:"+key);if(seen.size>1500)seen=new Set(Array.from(seen).slice(-750));}
      window.dispatchEvent(new CustomEvent("mc:ably-dm",{detail:message}));
    });
    await room.attach();
    activeDMRoom=room;activeDMName=name;
  }
  async function close(){
    await leaveRoom();
    await leaveDM();
    if(chatClient){try{await chatClient.dispose();}catch{}chatClient=null;realtimeClient=null;}
    connecting=null;activeUserId=null;seen.clear();
  }
  window.MaleficentAbly={
    setUser,
    joinRoom,
    leaveRoom,
    joinDM,
    leaveDM,
    get status(){return chatClient?.connection?.status||"not-connected";},
    close
  };
})();
