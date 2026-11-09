"use strict";

// Authenticated one-to-one WebRTC call signalling. Media stays peer-to-peer;
// this server only routes invitations and SDP/ICE messages.
function registerCallSignaling({io,findUser,privateMessagesBlocked}){
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
}
module.exports={registerCallSignaling};
