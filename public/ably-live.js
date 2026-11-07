
/* Ably Chat realtime transport for public rooms. The backend remains authoritative. */
(()=>{
  let chatClient=null,activeRoom=null,activeRoomName=null,subscription=null,seen=new Set(),connecting=null;
  const enabled=()=>!!(window.Ably&&window.Ably.Realtime&&window.AblyChat&&window.AblyChat.ChatClient);
  async function getClient(){
    if(chatClient)return chatClient;
    if(connecting)return connecting;
    if(!enabled())throw new Error("Ably Chat browser SDK did not load.");
    connecting=(async()=>{
      const realtime=new Ably.Realtime({
        authCallback:async(_params,callback)=>{
          try{
            const response=await fetch("/api/ably-token",{method:"GET",credentials:"same-origin",cache:"no-store",headers:{"Accept":"application/json"}});
            if(!response.ok)throw new Error("Ably authentication failed ("+response.status+").");
            const tokenRequest=await response.json();
            callback(null,tokenRequest);
          }catch(error){callback(error,null);}
        },
        disconnectedRetryTimeout:15000,
        suspendedRetryTimeout:30000
      });
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
  async function joinRoom(roomId){
    if(!roomId)return;
    const id=String(roomId),name="mc-room-"+id;
    if(activeRoomName===name&&activeRoom)return;
    if(activeRoom){
      try{subscription?.unsubscribe?.();await activeRoom.detach();}catch{}
      activeRoom=null;subscription=null;activeRoomName=null;
    }
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
    await room.attach();
    activeRoom=room;activeRoomName=name;
    room.onDiscontinuity?.(()=>{
      window.dispatchEvent(new CustomEvent("mc:ably-discontinuity",{detail:{roomId:id}}));
    });
  }
  window.MaleficentAbly={
    joinRoom,
    get status(){return chatClient?.connection?.status||"not-connected";},
    close:async()=>{
      try{subscription?.unsubscribe?.();if(activeRoom)await activeRoom.detach();}catch{}
      activeRoom=null;activeRoomName=null;subscription=null;
      if(chatClient){await chatClient.dispose();chatClient=null;}
    }
  };
})();
