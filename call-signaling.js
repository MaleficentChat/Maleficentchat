"use strict";

// Authenticated one-to-one WebRTC call signalling. Media stays peer-to-peer;
// this server only routes invitations and SDP/ICE messages.
function registerCallSignaling({io,findUser,privateMessagesBlocked}){
  const getRtcConfig=()=>{
    const urls=String(process.env.TURN_URLS||"").split(",").map(value=>value.trim()).filter(Boolean);
    const username=String(process.env.TURN_USERNAME||"").trim();
    const credential=String(process.env.TURN_CREDENTIAL||"").trim();
    const turnServers=urls.length&&username&&credential?[{urls,username,credential}]:[];
    return {iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"},...turnServers],turnEnabled:turnServers.length>0};
  };
  const calls=new Map();
  const userCall=new Map();
  const room=id=>"call:"+id;
  const userRoom=id=>"user:"+id;
  const clean=(call,reason)=>{
    if(!call||!calls.has(call.id))return;
    calls.delete(call.id);
    clearTimeout(call.expiry);
    for(const id of [call.from,call.to]){
      if(userCall.get(String(id))===call.id)userCall.delete(String(id));
      const sockets=io.sockets.adapter.rooms.get(userRoom(id));
      if(sockets)for(const socketId of sockets){const peer=io.sockets.sockets.get(socketId);if(peer)peer.leave(room(call.id));}
      io.to(userRoom(id)).emit("call:ended",{callId:call.id,reason:reason||"ended"});
    }
  };
  io.on("connection",socket=>{
    socket.on("rtc:config",(_payload,callback)=>{
      const ack=typeof callback==="function"?callback:()=>{};
      if(!findUser(socket.data.userId)){ack({ok:false,error:"Please log in before requesting call configuration."});return;}
      ack({ok:true,...getRtcConfig()});
    });
    socket.on("call:invite",(payload,acknowledge)=>{
      const ack=typeof acknowledge==="function"?acknowledge:()=>{};
      const caller=findUser(socket.data.userId);
      const target=findUser(payload&&payload.to);
      const mode=payload&&payload.mode==="video"?"video":"audio";
      if(!caller){ack({ok:false,error:"Please log in before making a call."});return;}
      if(!target||String(target.id)===String(caller.id)){ack({ok:false,error:"Choose another valid user."});return;}
      if(privateMessagesBlocked(caller,target)){ack({ok:false,error:"Calls are unavailable between these accounts."});return;}
      if(userCall.has(String(caller.id))){ack({ok:false,error:"You are already in a call."});return;}
      if(userCall.has(String(target.id))){ack({ok:false,error:"That user is already in a call."});return;}
      const targetSockets=io.sockets.adapter.rooms.get(userRoom(target.id));
      if(!targetSockets||!targetSockets.size){ack({ok:false,error:"That user is offline."});return;}
      const callId=require("crypto").randomUUID();
      const call={id:callId,from:String(caller.id),to:String(target.id),mode,status:"ringing",createdAt:Date.now(),expiry:null};
      calls.set(callId,call);userCall.set(call.from,callId);userCall.set(call.to,callId);
      call.expiry=setTimeout(()=>clean(call,"no-answer"),35000);
      io.to(userRoom(call.to)).emit("call:incoming",{callId,from:call.from,fromName:caller.displayName||caller.username,mode});
      ack({ok:true,callId,mode});
    });

    socket.on("call:respond",(payload,acknowledge)=>{
      const ack=typeof acknowledge==="function"?acknowledge:()=>{};
      const user=findUser(socket.data.userId),call=calls.get(String(payload&&payload.callId||""));
      if(!user||!call||call.status!=="ringing"||String(call.to)!==String(user.id)){ack({ok:false,error:"This call invitation is no longer available."});return;}
      if(payload&&payload.accept===true){
        clearTimeout(call.expiry);call.status="active";
        for(const id of [call.from,call.to]){
          const sockets=io.sockets.adapter.rooms.get(userRoom(id));
          if(sockets)for(const socketId of sockets){const peer=io.sockets.sockets.get(socketId);if(peer)peer.join(room(call.id));}
        }
        io.to(userRoom(call.from)).emit("call:accepted",{callId:call.id,peerId:call.to,mode:call.mode});
        io.to(userRoom(call.to)).emit("call:accepted",{callId:call.id,peerId:call.from,mode:call.mode});
        ack({ok:true});
      }else{
        clean(call,"declined");ack({ok:true});
      }
    });

    socket.on("call:signal",payload=>{
      const user=findUser(socket.data.userId),call=calls.get(String(payload&&payload.callId||""));
      if(!user||!call||call.status!=="active"||![call.from,call.to].includes(String(user.id)))return;
      if(!socket.rooms.has(room(call.id)))return;
      const signal=payload&&payload.signal;
      if(!signal||typeof signal!=="object")return;
      const type=String(signal.type||"");
      if(!["offer","answer","candidate"].includes(type))return;
      const encoded=JSON.stringify(signal);
      if(encoded.length>12000)return;
      socket.to(room(call.id)).emit("call:signal",{callId:call.id,signal});
    });

    socket.on("call:end",payload=>{
      const user=findUser(socket.data.userId),call=calls.get(String(payload&&payload.callId||""));
      if(!user||!call||![call.from,call.to].includes(String(user.id)))return;
      clean(call,"ended");
    });

    socket.on("disconnect",()=>{
      const userId=String(socket.data.userId||"");
      const callId=userCall.get(userId),call=calls.get(callId);
      if(!call)return;
      setTimeout(()=>{
        const remaining=io.sockets.adapter.rooms.get(userRoom(userId));
        if(!remaining||!remaining.size)clean(call,"disconnected");
      },250);
    });
  });

  // Room-scoped group voice and Spotify listening rooms. Voice uses a small
  // peer mesh (maximum six members); the server only relays authenticated SDP/ICE.
  const groupVoiceRooms=new Map();
  const musicRooms=new Map();
  const roomForSocket=socket=>{
    const user=findUser(socket.data.userId),roomId=String(socket.data.roomId||"");
    return user&&roomId&&socket.rooms.has("room:"+roomId)?{user,roomId}:null;
  };
  const voiceRoomName=id=>"group-voice:"+id;
  const leaveVoice=(socket,notify=true)=>{
    const userId=String(socket.data.userId||"");
    for(const [roomId,session] of groupVoiceRooms){
      if(!session.members.has(userId))continue;
      session.members.delete(userId);socket.leave(voiceRoomName(roomId));
      if(notify)io.to(voiceRoomName(roomId)).emit("group-voice:peer-left",{userId});
      if(!session.members.size)groupVoiceRooms.delete(roomId);
    }
  };
  io.on("connection",socket=>{
    const ackOf=fn=>typeof fn==="function"?fn:()=>{};
    socket.on("group-voice:join",(payload,callback)=>{
      const ack=ackOf(callback),ctx=roomForSocket(socket);
      if(!ctx){ack({ok:false,error:"Join an accessible chat room before starting group voice."});return;}
      const requested=String(payload&&payload.roomId||ctx.roomId);
      if(requested!==ctx.roomId){ack({ok:false,error:"Group voice is only available in your current chat room."});return;}
      let session=groupVoiceRooms.get(ctx.roomId);
      if(!session){session={members:new Map(),createdAt:Date.now()};groupVoiceRooms.set(ctx.roomId,session);}
      const uid=String(ctx.user.id);
      if(session.members.has(uid)){ack({ok:true,participants:[...session.members.values()].filter(x=>x.userId!==uid),limit:6});return;}
      if(session.members.size>=6){ack({ok:false,error:"This voice room is full (maximum 6 participants)."});return;}
      const participants=[...session.members.values()];
      session.members.set(uid,{userId:uid,username:ctx.user.username,displayName:ctx.user.displayName||ctx.user.username,avatar:ctx.user.avatar||""});
      socket.join(voiceRoomName(ctx.roomId));
      socket.to(voiceRoomName(ctx.roomId)).emit("group-voice:peer-joined",{userId:uid,username:ctx.user.username,displayName:ctx.user.displayName||ctx.user.username,avatar:ctx.user.avatar||""});
      ack({ok:true,participants,limit:6});
      io.to(voiceRoomName(ctx.roomId)).emit("group-voice:count",{count:session.members.size});
    });
    socket.on("group-voice:signal",payload=>{
      const ctx=roomForSocket(socket),roomId=String(payload&&payload.roomId||""),toId=String(payload&&payload.toId||""),signal=payload&&payload.signal;
      const session=groupVoiceRooms.get(roomId),fromId=String(ctx?.user.id||"");
      if(!ctx||ctx.roomId!==roomId||!session||!session.members.has(fromId)||!session.members.has(toId)||!signal||typeof signal!=="object")return;
      if(!["offer","answer","candidate"].includes(String(signal.type||""))||JSON.stringify(signal).length>16000)return;
      io.to(voiceRoomName(roomId)).emit("group-voice:signal",{roomId,fromId,toId,signal});
    });
    socket.on("group-voice:leave",()=>leaveVoice(socket));
    socket.on("music-room:get",(_payload,callback)=>{
      const ack=ackOf(callback),ctx=roomForSocket(socket);
      if(!ctx){ack({ok:false,error:"Join a chat room first."});return;}
      const state=musicRooms.get(ctx.roomId)||{queue:[],current:null,updatedAt:0};
      ack({ok:true,...state});
    });
    socket.on("music-room:add",(payload,callback)=>{
      const ack=ackOf(callback),ctx=roomForSocket(socket);
      if(!ctx){ack({ok:false,error:"Join a chat room first."});return;}
      const raw=String(payload&&payload.spotify||"").trim().slice(0,500);
      const match=raw.match(/(?:open\.spotify\.com\/(track|album|playlist|episode|show)\/|spotify:(track|album|playlist|episode|show):)([A-Za-z0-9]{10,32})/i);
      if(!match){ack({ok:false,error:"Paste a valid Spotify track, album, playlist, episode or show link."});return;}
      const kind=String(match[1]||match[2]).toLowerCase(),spotifyId=match[3];
      const spotify="spotify:"+kind+":"+spotifyId;
      let state=musicRooms.get(ctx.roomId);
      if(!state)state={queue:[],current:null,updatedAt:0};
      if(state.queue.some(item=>item.spotify===spotify)){ack({ok:false,error:"That Spotify item is already in the room queue."});return;}
      if(state.queue.length>=40){ack({ok:false,error:"The room queue is full (40 items)."});return;}
      const item={id:require("crypto").randomUUID(),spotify,kind,spotifyId,title:String(payload&&payload.title||"Spotify "+kind).trim().slice(0,120),addedBy:String(ctx.user.displayName||ctx.user.username).slice(0,48),userId:String(ctx.user.id),addedAt:Date.now()};
      state.queue.push(item);state.updatedAt=Date.now();musicRooms.set(ctx.roomId,state);
      io.to("room:"+ctx.roomId).emit("music-room:updated",state);ack({ok:true,item,state});
    });
    socket.on("music-room:remove",(payload,callback)=>{
      const ack=ackOf(callback),ctx=roomForSocket(socket);
      if(!ctx){ack({ok:false,error:"Join a chat room first."});return;}
      const state=musicRooms.get(ctx.roomId);if(!state){ack({ok:false,error:"The room queue is empty."});return;}
      const item=state.queue.find(x=>x.id===String(payload&&payload.id||""));
      if(!item){ack({ok:false,error:"Queue item not found."});return;}
      if(item.userId!==String(ctx.user.id)&&!["MODERATOR","ADMIN","SUPERADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"].includes(String(ctx.user.rank||"").toUpperCase())){ack({ok:false,error:"You can remove only your own queue items."});return;}
      state.queue=state.queue.filter(x=>x.id!==item.id);if(state.current?.id===item.id)state.current=null;state.updatedAt=Date.now();
      musicRooms.set(ctx.roomId,state);io.to("room:"+ctx.roomId).emit("music-room:updated",state);ack({ok:true,state});
    });
    socket.on("music-room:play",(payload,callback)=>{
      const ack=ackOf(callback),ctx=roomForSocket(socket);
      if(!ctx){ack({ok:false,error:"Join a chat room first."});return;}
      const state=musicRooms.get(ctx.roomId);const item=state?.queue.find(x=>x.id===String(payload&&payload.id||""));
      if(!state||!item){ack({ok:false,error:"Choose an item from the room queue."});return;}
      state.current=item;state.updatedAt=Date.now();musicRooms.set(ctx.roomId,state);
      io.to("room:"+ctx.roomId).emit("music-room:playing",{item,by:ctx.user.displayName||ctx.user.username,updatedAt:state.updatedAt});
      ack({ok:true,item});
    });
    socket.on("disconnect",()=>leaveVoice(socket));
  });

}
module.exports={registerCallSignaling};
