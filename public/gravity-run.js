(function(){
  const $ = id => document.getElementById(id);
  let socket = null, current = null, animation = 0, lastSnapshot = 0, countdown = 0, countdownTimer = null;
  let difficulty = 25, selectedMode = "solo", inviteMessageIds = new Set(), lastState = null;
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  function token(){ try{return localStorage.getItem("mc_token")||"";}catch(e){return "";} }
  function ensureSocket(){
    if(socket) return socket;
    if(typeof window.io!=="function") return null;
    socket=window.io();
    socket.on("connect",()=>{const t=token();if(t)socket.emit("auth",{token:t});});
    socket.on("gravity:created",data=>{
      if(!current)return;
      current.gameId=data.gameId;current.hostId=String(data.hostId);current.isHost=true;current.status="waiting";
      renderStatus("Invitation posted in Main Room. Waiting for a player to join…");
    });
    socket.on("gravity:joined",data=>{
      if(!current || String(data.gameId)!==String(current.gameId))return;
      current.gameId=data.gameId;current.hostId=String(data.hostId);current.isHost=String(data.myUserId)===String(data.hostId);
      current.myUserId=String(data.myUserId);current.players=data.players||[];
      current.difficulty=Number(data.difficulty||difficulty);current.status="playing";
      current.state={players:current.players.map((p,i)=>({userId:String(p.userId),username:p.displayName||p.username||("Player "+(i+1)),side:i,progress:0,gravity:i,fall:0,lastHitAt:0})),startedAt:Date.now(),winnerId:null,frame:0};
      lastState=current.state;beginCountdown();
    });
    socket.on("gravity:input",data=>{
      if(!current||!current.isHost||!current.state||String(data.gameId)!==String(current.gameId))return;
      const player=current.state.players.find(p=>String(p.userId)===String(data.playerId));if(player)flipPlayer(player);
    });
    socket.on("gravity:state",data=>{
      if(!current||current.isHost||String(data.gameId)!==String(current.gameId)||!data.state)return;
      current.state=data.state;lastState=data.state;drawGame();
    });
    socket.on("gravity:ended",data=>{
      if(!current||String(data.gameId)!==String(current.gameId))return;
      finishGame(String(data.winnerId)===String(current.myUserId)?"YOU WIN!":(current.mode==="solo"?"TRY AGAIN":"OPPONENT WINS"),false);
    });
    socket.on("gravity:error",data=>{renderStatus(data&&data.error||"Could not connect to the game.");});
    return socket;
  }
  function render(){
    const root=$("gamesRoot");if(!root)return;
    if(current&&current.status==="playing"){renderArena();drawGame();return;}
    if(current&&current.status==="waiting"){renderLobbyWaiting();return;}
    root.innerHTML='<section class="gravity-card"><div class="gravity-hero"><div class="gravity-kicker">MALeficent CHAT ARCADE</div><h1>MALeficent\'s <span>GRAVITY RUN</span></h1><p>Tap to change gravity. Run fast!</p><div class="gravity-preview"><div class="gravity-wall left"></div><div class="gravity-wall right"></div><div class="gravity-orb aurora-orb">✦</div><div class="gravity-orb mal-orb">♟</div><div class="gravity-spark">✧</div></div></div><div class="gravity-setup"><label class="gravity-difficulty"><span>🌿 EASY</span><input id="gravityDifficulty" type="range" min="0" max="100" value="'+difficulty+'"><span>😈 HARD</span></label><div class="gravity-diff-caption" id="gravityDiffCaption">Difficulty: EASY</div><div class="gravity-mode-grid"><button type="button" class="gravity-mode '+(selectedMode==="solo"?"selected":"")+'" id="gravitySolo">🧙 One player <small>Race against the computer</small></button><button type="button" class="gravity-mode '+(selectedMode==="duo"?"selected":"")+'" id="gravityDuo">⚔️ Two players <small>Invite someone from Main Room</small></button></div><div class="gravity-actions"><button class="primary gravity-play" id="gravityPlay">▶ PLAY</button><button class="mini gravity-help" id="gravityHelp">?</button></div><p class="muted gravity-footnote">Controls: tap the red button, tap the arena, or press Space to flip gravity.</p><div id="gravityStatus" class="gravity-status"></div><div id="gravityHelpText" class="gravity-help-text hidden">Run up the thorn castle walls. Flip between left and right to dodge platforms and gates. Reach the top first to win. The higher the difficulty, the faster you run and the tighter the gaps.</div></div></section>';
    $("gravityDifficulty").oninput=e=>{difficulty=Number(e.target.value);$("gravityDiffCaption").textContent="Difficulty: "+(difficulty<35?"EASY":difficulty<70?"NORMAL":"HARD");};
    $("gravitySolo").onclick=()=>{selectedMode="solo";render();};
    $("gravityDuo").onclick=()=>{selectedMode="duo";render();};
    $("gravityHelp").onclick=()=>$("gravityHelpText").classList.toggle("hidden");
    $("gravityPlay").onclick=()=>selectedMode==="solo"?startSolo():startInvite();
    $("gravityDiffCaption").textContent="Difficulty: "+(difficulty<35?"EASY":difficulty<70?"NORMAL":"HARD");
  }
  function renderStatus(text){const el=$("gravityStatus");if(el)el.textContent=text;}
  function renderLobbyWaiting(){
    const root=$("gamesRoot");if(!root)return;
    root.innerHTML='<section class="gravity-card gravity-waiting"><div class="gravity-kicker">MATCHMAKING</div><h2>⚔️ Waiting for your rival…</h2><p>Your Aurora invitation has been posted in Main Room.</p><div class="gravity-pulse"></div><button class="mini" id="gravityCancel">Cancel invitation</button><div id="gravityStatus" class="gravity-status">Share the invite and wait for someone to press Join game.</div></section>';
    $("gravityCancel").onclick=()=>{if(socket&&current&&current.gameId)socket.emit("gravity:leave",{gameId:current.gameId});current=null;render();};
  }
  function startSolo(){
    current={mode:"solo",status:"playing",isHost:true,myUserId:"solo-player",hostId:"solo-player",difficulty:difficulty,gameId:null};
    current.players=[{userId:"solo-player",username:"Aurora",displayName:"Aurora",side:0},{userId:"computer",username:"Maleficent",displayName:"Maleficent",side:1}];
    current.state={players:current.players.map((p,i)=>({userId:p.userId,username:p.displayName,side:i,progress:0,gravity:i,fall:0,lastHitAt:0})),startedAt:Date.now(),winnerId:null,frame:0};
    lastState=current.state;beginCountdown();
  }
  function startInvite(){
    const s=ensureSocket();if(!s){renderStatus("Game connection is unavailable. Refresh the page and try again.");return;}
    current={mode:"duo",status:"creating",isHost:true,myUserId:"",hostId:"",difficulty:difficulty,gameId:null};
    renderLobbyWaiting();
    s.emit("gravity:invite",{difficulty:difficulty});
  }
  function join(gameId){
    const s=ensureSocket();if(!s){alert("Game connection is unavailable. Refresh the page and try again.");return;}
    if(!token()){alert("Please log in first.");return;}
    current={mode:"duo",status:"joining",gameId:String(gameId),difficulty:difficulty,isHost:false};
    const nav=document.querySelector('.nav[data-view="games"]');if(nav)nav.click();
    s.emit("gravity:join",{gameId:String(gameId)});
    renderStatus("Joining the race…");
  }
  function showInvite(invite){
    if(!invite||!invite.gameId||inviteMessageIds.has(String(invite.gameId)))return;
    inviteMessageIds.add(String(invite.gameId));
    const host=esc(invite.hostName||"A player"), gameId=esc(invite.gameId);
    const box=document.createElement("div");box.className="gravity-room-invite";
    box.innerHTML='<div class="gravity-invite-icon">🎮</div><div class="gravity-invite-copy"><b>🤖 Aurora</b><strong>'+host+' has started Maleficent\'s Gravity Run!</strong><small>1v1 Thorn Castle race · Difficulty '+Number(invite.difficulty||0)+'%</small></div><button type="button" class="primary" data-gravity-join="'+gameId+'">▶ Join</button>';
    const messages=document.getElementById("messages");
    if(messages){messages.appendChild(box);messages.scrollTop=messages.scrollHeight;}
    else {const nav=document.querySelector('.nav[data-view="games"]');if(nav)nav.click();setTimeout(()=>{const root=$("gamesRoot");if(root)root.prepend(box);},50);}
  }
  document.addEventListener("click",e=>{
    const btn=e.target.closest("[data-gravity-join]");if(btn){e.preventDefault();join(btn.getAttribute("data-gravity-join"));}
  });
  function beginCountdown(){
    cancelAnimationFrame(animation);renderArena();countdown=3;
    const overlay=$("gravityCountdown");
    if(countdownTimer)clearInterval(countdownTimer);
    if(overlay)overlay.textContent="3";
    countdownTimer=setInterval(()=>{
      countdown--;
      const el=$("gravityCountdown");
      if(countdown>0){if(el)el.textContent=String(countdown);}
      else if(countdown===0){if(el)el.textContent="GO!";}
      else{clearInterval(countdownTimer);countdownTimer=null;if(el)el.textContent="";runFrame();}
    },700);
  }
  function renderArena(){
    const root=$("gamesRoot");if(!root)return;
    root.innerHTML='<section class="gravity-arena-card"><div class="gravity-arena-head"><div><span class="gravity-kicker">THORN CASTLE</span><h2>GRAVITY RUN</h2></div><div class="gravity-score" id="gravityScore">Checkpoint 0 / 4</div></div><div class="gravity-canvas-wrap"><canvas id="gravityCanvas" width="390" height="560" aria-label="Gravity Run game"></canvas><div class="gravity-countdown" id="gravityCountdown">3</div><div class="gravity-winner hidden" id="gravityWinner"></div></div><div class="gravity-arena-controls"><div class="gravity-player-label" id="gravityPlayerLabel">AURORA vs MALEFICENT</div><button id="gravityFlip" class="gravity-flip" aria-label="Flip gravity">↕ FLIP GRAVITY</button></div><p class="muted gravity-footnote">Tap anywhere in the arena or press Space to switch walls.</p><button class="mini" id="gravityExit">Leave game</button></section>';
    $("gravityFlip").onclick=flipMine;
    $("gravityCanvas").onclick=flipMine;
    $("gravityExit").onclick=()=>{if(socket&&current&&current.gameId)socket.emit("gravity:leave",{gameId:current.gameId});cancelAnimationFrame(animation);if(countdownTimer)clearInterval(countdownTimer);current=null;render();};
    $("gravityPlayerLabel").textContent=current.mode==="solo"?"AURORA vs MALEFICENT":(current.isHost?"YOU (AURORA) vs RIVAL":"RIVAL vs YOU");
    drawGame();
  }
  function flipPlayer(p){p.gravity=p.gravity===0?1:0;p.side=p.gravity;p.lastFlip=Date.now();}
  function flipMine(){
    if(!current||current.status!=="playing"||!current.state)return;
    const player=current.state.players.find(p=>String(p.userId)===String(current.myUserId));
    if(current.mode==="solo"&&player){flipPlayer(player);return;}
    if(current.isHost&&player){flipPlayer(player);return;}
    if(socket&&current.gameId)socket.emit("gravity:input",{gameId:current.gameId,action:"flip"});
  }
  function runFrame(){
    if(!current||current.status!=="playing")return;
    if(current.isHost&&current.state){
      const speed=1.25+(Number(current.difficulty||0)/100)*2.1;
      current.state.frame=(current.state.frame||0)+1;
      const players=current.state.players||[];
      players.forEach((p,i)=>{
        if(current.mode==="solo"&&i===1&&current.state.frame%Math.max(20,Math.round(95-current.difficulty*.45))===0)flipPlayer(p);
        p.progress+=speed;
        const obstacleIndex=Math.floor((p.progress+12)/165);
        const obstacleProgress=obstacleIndex*165;
        const obstacleSide=obstacleIndex%2;
        if(obstacleIndex>0&&p.gravity===obstacleSide&&Math.abs(p.progress-obstacleProgress)<5&&Date.now()-(p.lastHitAt||0)>500){
          p.progress=Math.max(0,p.progress-22);p.fall=Date.now();p.lastHitAt=Date.now();
        }
        if(p.progress>=1500&&!current.state.winnerId)current.state.winnerId=p.userId;
      });
      if(current.mode==="solo"&&current.state.winnerId){finishGame(String(current.state.winnerId)===String(current.myUserId)?"AURORA WINS!":"MALEFICENT WINS!",false);return;}
      if(current.mode==="duo"&&current.state.winnerId){
        socket.emit("gravity:end",{gameId:current.gameId,winnerId:current.state.winnerId,reason:"finish"});
        finishGame(String(current.state.winnerId)===String(current.myUserId)?"YOU WIN!":"RIVAL WINS!",false);return;
      }
      const now=Date.now();if(current.mode==="duo"&&current.gameId&&now-lastSnapshot>100){lastSnapshot=now;socket.emit("gravity:state",{gameId:current.gameId,state:current.state});}
    }
    drawGame();animation=requestAnimationFrame(runFrame);
  }
  function drawGame(){
    const canvas=$("gravityCanvas");if(!canvas||!current||!current.state)return;
    const ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height,state=current.state,players=state.players||[];
    const progress=Math.max(0,...players.map(p=>p.progress||0)),night=progress>600;
    const bg=ctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,night?"#07102b":"#153d32");bg.addColorStop(1,night?"#201440":"#071a18");ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    for(let i=0;i<38;i++){const x=(i*67+19)%w,y=(i*97+progress*.35)%h;ctx.fillStyle=night?"rgba(160,190,255,.45)":"rgba(179,255,191,.2)";ctx.fillRect(x,y,2,2);}
    ctx.fillStyle="#16242b";ctx.fillRect(35,0,38,h);ctx.fillRect(w-73,0,38,h);
    ctx.strokeStyle="#5e967b";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(72,0);ctx.lineTo(72,h);ctx.moveTo(w-72,0);ctx.lineTo(w-72,h);ctx.stroke();
    for(let i=1;i<=12;i++){
      const op=i*165,y=480-(op-progress);
      if(y<-30||y>h+20)continue;
      const side=i%2;ctx.fillStyle=night?"#8a648f":"#976341";
      if(side===0)ctx.fillRect(73,y,95,12);else ctx.fillRect(w-168,y,95,12);
      if(i%3===0){ctx.fillStyle="#38424b";ctx.fillRect(166,y-28,58,54);ctx.fillStyle=night?"#9e8bff":"#83e7bd";ctx.fillRect(184,y-8,22,15);}
    }
    ctx.fillStyle="rgba(255,255,255,.8)";ctx.font="bold 13px system-ui";ctx.fillText("CHECKPOINT "+Math.min(4,Math.floor(progress/375))+" / 4",14,25);
    players.forEach((p,i)=>{
      const x=p.gravity===0?112:w-112,y=Math.min(h-42,Math.max(80,480-(p.progress-progress)));
      ctx.fillStyle=i===0?"#29baff":"#ff536c";ctx.beginPath();ctx.arc(x,y,17,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle="#07121b";ctx.beginPath();ctx.arc(x-5,y-3,2,0,Math.PI*2);ctx.arc(x+5,y-3,2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#fff";ctx.font="bold 11px system-ui";ctx.textAlign="center";ctx.fillText(i===0?"AURORA":"MAL",x,y+34);ctx.textAlign="left";
    });
    const score=$("gravityScore");if(score)score.textContent="Checkpoint "+Math.min(4,Math.floor(progress/375))+" / 4";
  }
  function finishGame(text,send){
    if(!current)return;
    cancelAnimationFrame(animation);if(countdownTimer)clearInterval(countdownTimer);
    current.status="finished";
    const winner=$("gravityWinner");if(winner){winner.textContent=text;winner.classList.remove("hidden");}
    const flip=$("gravityFlip");if(flip)flip.disabled=true;
    if(send&&socket&&current.gameId)socket.emit("gravity:end",{gameId:current.gameId,winnerId:current.myUserId,reason:"quit"});
    const root=$("gamesRoot");if(root){const result=document.createElement("div");result.className="gravity-result";result.innerHTML="<h2>"+esc(text)+"</h2><p>🏅 Race complete. Ready for another run?</p><button class='primary' id='gravityAgain'>Play again</button>";root.appendChild(result);$("gravityAgain").onclick=()=>{current=null;render();};}
  }
  document.addEventListener("keydown",e=>{if(e.code==="Space"&&current&&current.status==="playing"&&!/INPUT|TEXTAREA/.test(document.activeElement.tagName)){e.preventDefault();flipMine();}});
  window.GravityRun={render:render,showInvite:showInvite,join:join};
})();