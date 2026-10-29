const $ = id => document.getElementById(id);

// Some embedded login browsers deny access to the localStorage property itself.
// Keep an in-memory fallback so storage restrictions never prevent login requests.
const memoryStorage = new Map();
const safeStorage = {
  getItem(key) {
    try { const value = window.localStorage.getItem(key); if (value !== null) return value; } catch {}
    return memoryStorage.has(key) ? memoryStorage.get(key) : null;
  },
  setItem(key, value) {
    const text = String(value);
    memoryStorage.set(key, text);
    try { window.localStorage.setItem(key, text); } catch {}
  },
  removeItem(key) {
    memoryStorage.delete(key);
    try { window.localStorage.removeItem(key); } catch {}
  }
};

let state = {
  user: null,
  rooms: [],
  currentRoom: null,
  replyTo: null,
  messageExpiry: 0,

  // Private-message quote
 dmReplyTo: null,
dmReplyUser: null,
dmReplyAuthor: null,
dmReplyText: null,

  socket: null,
  view: "rooms",
  featurePermissions: {},
  featureGrants: {},
  roomListMode: "all",
  userPermissions: {}
};

const rankIcon = {
  MEMBER: "⚡",
  VIP: "💎",
  PREMIUM: "🏅",
  ROYAL: "⚜️",
  MOD: "🛡️",
  ADMIN: "⭐",
  SUPER_ADMIN: "🌟",
  COMMISSOR: "👻",
  INSTRUCTOR: "⚔️",
  COOWNER: "🦉",
  OWNER: "👑",
  DEVELOPER: "🛠️"
};

const rankOrder = {
  MEMBER: 0,
  VIP: 1,
  PREMIUM: 2,
  ROYAL: 3,
  MOD: 4,
  ADMIN: 5,
  SUPER_ADMIN: 6,
  COMMISSOR: 7,
  INSTRUCTOR: 8,
  COOWNER: 9,
  OWNER: 10,
  DEVELOPER: 11
};

const ranks = Object.keys(rankOrder);

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

const fmt = t => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

const rank = r =>
  `<span class="rank">${rankIcon[r] || "⚡"} ${esc(r)}</span>`;

async function api(url, opt = {}) {
  const headers = { ...(opt.headers || {}) };

  if (!(opt.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const token=safeStorage.getItem("mc_token");
  if(token) headers["x-auth-token"]=token;
  // Attach the room access token to every room-scoped API call that needs it,
  // including YouTube sharing. Previously the token was only sent for messages
  // and pinned messages, so the YouTube endpoint always rejected the request.
  const roomMatch=String(url).match(/\/api\/rooms\/(\d+)(?:\/|$)/);
  if(roomMatch){try{const roomAccess=JSON.parse(safeStorage.getItem('mc_room_join')||'null');if(roomAccess?.roomId===roomMatch[1]&&roomAccess.joinToken)headers['x-room-join-token']=roomAccess.joinToken;}catch{}}
  const res = await fetch(url, {
    ...opt,
    headers,
    credentials: "same-origin"
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw Error(body.error || "Request failed");
  }

  return body;
}

function toast(text) {
  $("toast").textContent = text;
  $("toast").style.display = "block";

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    $("toast").style.display = "none";
  }, 2800);
}

function closeModal() {
  $("modal").classList.add("hidden");
}

function modal(html) {
  $("modalBody").innerHTML = html;
  $("modal").classList.remove("hidden");
}

function avatar(u, cls = "avatar") {
  const name = u?.displayName || u?.username || "?";

  return `
    <div class="${cls}">
      ${
        u?.avatar
          ? `<img src="${esc(u.avatar)}" alt="">`
          : esc(name.slice(0, 1).toUpperCase())
      }
    </div>
  `;
}

function can(requiredRank) {
  if (!state.user) return false;
  return (rankOrder[state.user.rank] ?? -1) >= (rankOrder[requiredRank] ?? 999);
}

function canAccessStaffTarget(user){
  if(!state.user||!user||String(state.user.id)===String(user.id))return false;
  const actorRank=String(state.user.rank||"").toUpperCase(),targetRank=String(user.rank||"").toUpperCase();
  if(targetRank==="DEVELOPER"||user.username==="Maleficent")return false;
  return (rankOrder[targetRank]??999)<(rankOrder[actorRank]??-1);
}
function canFeature(key){
  if(!state.user) return false;
  const roomRole=String(state.currentRoomRole||'USER').toUpperCase();
  const roomOwnedFeature={
    edit_room:roomRole==='ROOM_OWNER'&&Array.isArray(state.featureGrants?.room_edit_own)&&state.featureGrants.room_edit_own.length>0,
    edit_rooms:roomRole==='ROOM_OWNER'&&Array.isArray(state.featureGrants?.room_edit_own)&&state.featureGrants.room_edit_own.length>0,
    delete_room:roomRole==='ROOM_OWNER'&&Array.isArray(state.featureGrants?.room_edit_own)&&state.featureGrants.room_edit_own.length>0,
    delete_rooms:roomRole==='ROOM_OWNER'&&Array.isArray(state.featureGrants?.room_edit_own)&&state.featureGrants.room_edit_own.length>0,
    clear_room:roomRole==='ROOM_OWNER'&&Array.isArray(state.featureGrants?.room_clear_own)&&state.featureGrants.room_clear_own.length>0,
    delete_message:roomRole==='ROOM_OWNER'&&Array.isArray(state.featureGrants?.room_delete_messages)&&state.featureGrants.room_delete_messages.length>0
  };
  if(roomOwnedFeature[key])return true;
  if(String(state.user.rank).toUpperCase()==='DEVELOPER') return true;
  if(state.user.username==='Maleficent'&&state.user.rank==='OWNER') return true;
  const permissionMap={create_room:'can_create_rooms',create_rooms:'can_create_rooms',edit_room:'can_edit_rooms',edit_rooms:'can_edit_rooms',delete_room:'can_delete_rooms',delete_rooms:'can_delete_rooms',profile_note:'can_add_notes',manage_staff_accounts:'can_edit_usernames',account_modifications:'can_manage_profiles',manage_profiles:'can_manage_profiles',edit_email:'can_edit_emails',share_gold:'can_share_gold',delete_message:'can_delete_messages'};
  const permission=state.userPermissions?.[permissionMap[key]||key];if(permission)return !!permission.granted;
  const grantedRanks=state.featureGrants?.[key];
  if(Array.isArray(grantedRanks))return grantedRanks.includes(String(state.user.rank||'').toUpperCase());
  const required=state.featurePermissions?.[key];
  return required ? can(required) : false;
}

/* ---------------- AUTH ---------------- */

function setAuthMode(login) {
  $("tabLogin").classList.toggle("active", login);
  $("tabRegister").classList.toggle("active", !login);

  document
    .querySelectorAll(".register-only")
    .forEach(el => el.classList.toggle("hidden", login));

  if ($("confirmPassword")) $("confirmPassword").classList.toggle("hidden", login);
  if ($("passwordStrength")) $("passwordStrength").classList.toggle("hidden", login);
  [$("displayName"),$("registerEmail"),$("dateOfBirth"),$("gender"),$("confirmPassword")].forEach(el=>{if(el) el.required=!login;});
  if($("dateOfBirth"))$("dateOfBirth").max=new Date().toISOString().slice(0,10);

  $("authSubmit").textContent = login ? "Login" : "Register";
  $("authMsg").textContent = "";
}

$("tabLogin").onclick = () => setAuthMode(true);
$("tabRegister").onclick = () => setAuthMode(false);

async function browserDeviceFingerprint(){
  const canvas=document.createElement('canvas');
  canvas.width=220;canvas.height=40;
  const ctx=canvas.getContext('2d');
  if(ctx){ctx.textBaseline='top';ctx.font='14px Arial';ctx.fillStyle='#f60';ctx.fillRect(10,5,100,20);ctx.fillStyle='#069';ctx.fillText('Maleficent Chat device',2,2);}
  const material=[navigator.userAgent,screen.width,Intl.DateTimeFormat().resolvedOptions().timeZone,canvas.toDataURL()||''].join('|');
  if(globalThis.crypto?.subtle){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  return btoa(unescape(encodeURIComponent(material))).slice(0,2000);
}

if ($("password")) $("password").addEventListener("input",()=>{
  if ($("tabRegister").classList.contains("active")) {
    const p=$("password").value; let score=0;
    if(p.length>=8)score++; if(/[A-Z]/.test(p))score++; if(/[0-9]/.test(p))score++; if(/[^A-Za-z0-9]/.test(p))score++;
    $("passwordStrength").textContent="Password strength: "+(["Weak","Fair","Good","Strong","Very strong"][score]);
  }
});

$("authForm").onsubmit = async e => {
  e.preventDefault();

  try {
    const login =
      $("tabLogin").classList.contains("active");

    const result = await api(
      login ? "/api/login" : "/api/register",
      {
        method: "POST",
        body: JSON.stringify({
          username: $("username").value.trim(),
          displayName: $("displayName").value.trim(),
          email: $("registerEmail")?.value.trim(),
          dateOfBirth: $("dateOfBirth")?.value,
          gender: $("gender")?.value,
          password: $("password").value,
          confirmPassword: $("confirmPassword")?.value,
          deviceFingerprint: login ? undefined : await browserDeviceFingerprint()
        })
      }
    );

    if (result.token) safeStorage.setItem("mc_token", result.token);
    state.user = result.user;
    const boot = await api("/api/bootstrap");
    state.featurePermissions = boot.featurePermissions || {};
    state.featureGrants = boot.settings?.feature_grants || {};
    state.userPermissions = boot.userPermissions || {};

    await start();
  } catch (error) {
    $("authMsg").textContent = error.message;
    if(/you have been banned/i.test(String(error.message||""))){showBanLock(String(error.message).replace(/^.*you have been banned\s*/i,"").replace(/^[:.\-]\s*/,"")||"Community rules");}
  }
};

$("logout").onclick = async () => {
  try {
    await api("/api/logout", {
      method: "POST"
    });
  } finally {
    safeStorage.removeItem("mc_token");
    location.reload();
  }
};

let actionLockTimer=null;
function showKickLock(until,reason="Community rules"){
  const box=$("actionLock"); if(!box)return;
  if(actionLockTimer)clearTimeout(actionLockTimer);
  box.dataset.lockType="kick";
  const safeReason=esc(reason||"Community rules");
  const refresh=()=>{
    const remaining=Number(until||0)-Date.now();
    if(remaining<=0){clearActionLock();return;}
    const total=Math.floor(remaining/1000);
    const days=Math.floor(total/86400),hours=Math.floor((total%86400)/3600),minutes=Math.floor((total%3600)/60),seconds=total%60;
    const pad=n=>String(n).padStart(2,"0");
    box.innerHTML=`<div class="action-lock-card action-lock-full"><div class="action-lock-icon">⛔</div><h1>You have been kicked</h1><h2>Reason</h2><p class="action-lock-reason">${safeReason}</p><div class="action-lock-countdown-label">You can return in</div><div class="action-lock-countdown">${days}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}</div><small>Days : Hours : Minutes : Seconds</small></div>`;
    box.classList.remove("hidden");
    actionLockTimer=setTimeout(refresh,1000);
  };refresh();
}
function showBanLock(reason="Community rules"){
  const box=$("actionLock");if(!box)return;
  if(actionLockTimer)clearTimeout(actionLockTimer);
  box.dataset.lockType="ban";
  box.innerHTML=`<div class="action-lock-card action-lock-full"><div class="action-lock-icon">🚫</div><h1>You have been banned</h1><h2>Reason</h2><p class="action-lock-reason">${esc(reason||"Community rules")}</p></div>`;
  box.classList.remove("hidden");
}
function clearActionLock(){if(actionLockTimer)clearTimeout(actionLockTimer);actionLockTimer=null;const box=$("actionLock");if(box){box.classList.add("hidden");box.innerHTML="";box.dataset.lockType="";}}

/* ---------------- START ---------------- */

/* ---------------- START ---------------- */

async function start() {
  $("auth").classList.add("hidden");
  $("app").classList.remove("hidden");

  updateNav();
  applyTheme(state.user?.settings?.theme||'obsidian');
  applyUserAppearance();
  if(state.user?.banned) showBanLock(state.user.banReason||"Community rules"); else if(state.user?.kickedUntil&&state.user.kickedUntil>Date.now()) showKickLock(state.user.kickedUntil,state.user.kickReason||"Community rules"); else clearActionLock();
  applyUserAppearance();

  if (state.socket) {
    try {
      state.socket.disconnect();
    } catch {}
  }

  state.socket = io();
  state.socket.on("room:theme",data=>{if(!data?.roomId||!data?.theme)return;const room=state.rooms.find(r=>String(r.id)===String(data.roomId));if(room)room.roomTheme=data.theme;if(String(state.currentRoom)===String(data.roomId))applyRoomTheme(data.theme);});
  state.socket.on("gold:update",data=>{ if(state.user&&data?.gold!==undefined){state.user.gold=data.gold; updateNav();}});

  state.socket.on("connect", () => {
    loadNotifications();
    if (state.user) {
      state.socket.emit("auth", {token:safeStorage.getItem("mc_token")||""});
    }

    if (state.currentRoom) {
      try{const access=JSON.parse(safeStorage.getItem('mc_room_join')||'null');if(access?.roomId===String(state.currentRoom))state.socket.emit("join-room",access);}catch{}
    }
  });
  state.socket.on("room-error",d=>toast(d?.error||"Could not join room."));
  state.socket.on("dm-typing",d=>{
    if(String(d?.userId||"")!==String(state.dmUserId))return;
    const status=$("dmTypingStatus");
    if(!status||!state.dmUserId)return;
    status.textContent=d?.typing?((typeof d.user==="string"?d.user:"Someone")+" is typing…"):"Quote a message to reply · Attach photos or files";
  });

  state.socket.on('rooms_updated', async()=>{try{await loadRooms();renderRooms();}catch{}});
  state.socket.on('connect',()=>{loadRooms().catch(()=>{});});

  state.socket.on("presence", async () => {
    if (state.view === "rooms") {
      try { await loadRooms(); } catch {}
      renderRooms();
    }
    renderOnline(onlinePanelTab);
  });

  state.socket.on("message", message => {
    if (String(message.roomId) === String(state.currentRoom)) {
      appendMessage(message);
    }
  });

  state.socket.on("system-message", notice => {
    if(!notice.roomId || notice.roomId===state.currentRoom) appendMessage({...notice,system:true});
  });
  state.socket.on("gravity:invite", invite => window.GravityRun && window.GravityRun.showInvite(invite));

  state.socket.on("message:update", message => {
    const element =
      document.querySelector(`[data-mid="${message.id}"]`);

    if (element) {
      element.outerHTML = messageHTML(message);
    }
  });

  state.socket.on("message:delete", data => {
    const element =
      document.querySelector(`[data-mid="${data.id}"]`);

    if (element) {
      element.remove();
    }
  });

  state.socket.on("room:kicked", data => {
    if(String(data?.roomId)!==String(state.currentRoom))return;
    state.messages=[];
    if($("messages"))$("messages").innerHTML="";
    toast("You were removed from this room. Reason: "+String(data?.reason||"Room rules"));
    const main=state.rooms.find(r=>/^main room$/i.test(String(r.name||"")));
    if(main&&String(main.id)!==String(state.currentRoom))joinRoom(main.id).catch(()=>{});
  });
  state.socket.on("room:clear", () => {
    if (state.currentRoom) {
      state.messages=(state.messages||[]).filter(m=>String(m.roomId)!==String(state.currentRoom));
      $("messages").innerHTML = "";
      toast("Room cleared by staff.");
    }
  });
  state.socket.on("site:messages-cleared",()=>{state.messages=[];if($("messages"))$("messages").innerHTML="";if(state.dmUserId)openDM(state.dmUserId);if(state.currentRoom)toast("Owner cleared all site chat messages.");});

  state.socket.on("typing", data => {
    $("typing").textContent =
      data.typing
        ? `${esc(data.user)} is typing…`
        : "";
  });

  state.socket.on("notification", () => {
    loadNotifications();
  });
  state.socket.on("room:announcement",()=>{if(state.currentRoom)loadRoomAnnouncements(state.currentRoom)});
  state.socket.on("room:announcement-delete",()=>{if(state.currentRoom)loadRoomAnnouncements(state.currentRoom)});
  state.socket.on("kick-lock", data => showKickLock(data?.until,data?.reason));
  state.socket.on("ban-lock", data => showBanLock(data?.reason));
  state.socket.on("mute-notice", data => {
    const message=String(data?.message||("You have been muted for "+Math.max(1,Number(data?.minutes)||1)+" minutes"));
    modal(`<div class="warning-popup"><div class="warning-title">🔇 Muted</div><div class="warning-reason">${esc(message)}</div>${data?.reason?'<p class="muted">Reason: '+esc(data.reason)+'</p>':''}<button class="primary" onclick="closeModal()">OK</button></div>`);
    loadNotifications();
  });
  state.socket.on("warning-popup", data => {
    modal(`<div class="warning-popup"><div class="warning-title">Warning ⚠️</div><div class="warning-reason">${esc(data?.reason||"Please review the community rules.")}</div><button class="primary" onclick="closeModal()">I understand</button></div>`);
    loadNotifications();
  });
  state.socket.on("news", () => {
    if(state.view==="news") loadNews();
  });

  state.socket.on("dm", message => {
    if (
      state.dmUserId &&
      message &&
      (message.from === state.dmUserId || message.to === state.dmUserId)
    ) {
      openDM(state.dmUserId);
    } else {
      toast("New private message");
    }
  });

  await loadRooms();

  // Always enter Main Room after login. Retry the authoritative room list/join
  // while the session and seeded rooms settle; do not switch to an old room.
  const findMainRoom=()=>state.rooms.find(room=>room.isDefault) ||
    state.rooms.find(room=>String(room.name||"").trim().toLowerCase()==="main room");
  let mainRoom=findMainRoom();
  let joined=false;
  await renderView();
  for(let attempt=0;attempt<4&&!joined;attempt++){
    if(!mainRoom||attempt>0){
      try{
        const latest=await api("/api/rooms");
        state.rooms=sanitizeRoomList(latest.rooms);
        state.roomListMode="all";
        renderRooms();
        mainRoom=findMainRoom();
      }catch(e){
        if(attempt===3)toast("Could not load Main Room: "+e.message);
      }
    }
    if(mainRoom)joined=await joinRoom(String(mainRoom.id));
    if(!joined&&attempt<3)await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
  if(!joined)toast("Main Room could not open automatically. Please open Rooms and try again.");
  await loadNotifications();
}

async function bootstrap() {
  try {
    const data = await api("/api/bootstrap");

    if (data.user) {
      state.user = data.user;
      state.featurePermissions = data.featurePermissions || {};
      state.featureGrants = data.settings?.feature_grants || {};
      state.userPermissions = data.userPermissions || {};
      await start();
    }
  } catch {
    /* Not logged in */
  }
}

/* ---------------- NAVIGATION ---------------- */

function updateNav() {
  if (!state.user) return;

  $("meMini").innerHTML = `
    ${avatar(state.user)}
    <div class="me-mini-copy"><b>${esc(state.user.displayName)}</b><small>${rank(state.user.rank)} · Lv ${state.user.level || 1}</small></div>
  `;

  if ($("topProfile")) {
    $("topProfile").innerHTML = avatar(state.user, "top-avatar");
  }

  document
    .querySelectorAll(".staff-only")
    .forEach(el =>
      el.classList.toggle("hidden", !can("MOD")&&!canFeature("view_staff_dashboard"))
    );
  const reportButton=$("topFlag");
  if(reportButton) reportButton.classList.toggle("hidden", !can("MOD")&&!canFeature("view_staff_dashboard"));

  document
    .querySelectorAll(".owner-only")
    .forEach(el =>
      el.classList.toggle(
        "hidden",
        !(
          (String(state.user.rank).toUpperCase() === "DEVELOPER" || (state.user.rank === "OWNER" && state.user.username === "Maleficent"))
        )
      )
    );

  document
    .querySelectorAll(".admin-only")
    .forEach(el =>
      el.classList.toggle("hidden", !can("ADMIN"))
    );

  document
    .querySelectorAll(".coowner-only")
    .forEach(el =>
      el.classList.toggle("hidden", !canFeature("create_room"))
    );
}

document
  .querySelectorAll(".nav[data-view]")
  .forEach(button => {
    button.onclick = async () => {
      state.view = button.dataset.view;

      document
        .querySelectorAll(".nav[data-view]")
        .forEach(x =>
          x.classList.toggle(
            "active",
            x.dataset.view === state.view
          )
        );

      await renderView();

      $("sidebar").classList.remove("open");
    };
  });

async function renderView() {
  document
    .querySelectorAll(".view")
    .forEach(v => v.classList.add("hidden"));

  const id =
    `view${state.view[0].toUpperCase()}${state.view.slice(1)}`;

  const view = $(id);

  if (!view) return;

  view.classList.remove("hidden");

  switch (state.view) {
    case "rooms":
      // Re-fetch the authoritative room list whenever the Rooms view opens.
      // This recovers default rooms if the first login request ran before DB seeding completed.
      return loadRooms();

    case "users":
      return loadUsers();

    case "friends":
      return loadFriends();

    case "dms":
      return loadDMList();

    case "news":
      return loadNews();
    case "wall":
      return loadWall();

    case "suggestions":
      return loadSuggestions();

    case "suggestions":
      return loadSuggestions();
    case "games":
      return window.GravityRun && window.GravityRun.render();
    case "shop":
      return loadRankShop();

    case "rules":
      return loadCommunityRules();

    case "leaderboard":
      return loadLeaderboard();

    case "saved":
      return loadSavedMessages();

    case "search":
      return loadSearchRooms();

    case "profile":
      return loadProfile(state.user);

    case "settings":
      return loadSettings();

    case "staffApplications":
      return loadStaffApplication();

    case "staff":
      return loadStaff();

    case "owner":
      return loadOwner();
  }
}

$("mobileMenu").onclick = () => {
  $("sidebar").classList.toggle("open");
};
const chatToolsToggle=$("chatToolsToggle");
if(chatToolsToggle) chatToolsToggle.onclick=()=>$("chatToolsDrawer")?.classList.toggle("open");

if ($("backRooms")) {
  $("backRooms").onclick = () => {
    $("viewRooms").classList.remove("chatting");
    $("chatWrap").classList.add("hidden");
    renderRooms();
  };
}

// Floating mobile quick actions reuse the existing, tested room and People controls.
$("floatingRoomsBtn")?.addEventListener("click",()=> $("backRooms")?.click());
$("floatingPeopleBtn")?.addEventListener("click",()=>{
  const panel=$("onlinePanel");
  if(!panel)return;
  panel.classList.toggle("mobile-open");
  if(panel.classList.contains("mobile-open"))renderOnline();
});

if ($("topMessages")) $("topMessages").onclick = () => toggleMessagesDropdown();
if ($("topFriends")) $("topFriends").onclick = () => toggleFriendsDropdown();
if ($("topNotifications")) $("topNotifications").onclick = () => { $("topFriendsDropdown")?.classList.add("hidden"); $("topMessagesDropdown")?.classList.add("hidden"); $("reportDropdown")?.classList.add("hidden"); toggleNotificationDropdown(); };
if ($("topFlag")) $("topFlag").onclick = () => { $("topFriendsDropdown")?.classList.add("hidden"); $("topMessagesDropdown")?.classList.add("hidden"); $("notificationDropdown")?.classList.add("hidden"); toggleReportDropdown(); };
if ($("topProfile")) $("topProfile").onclick = () => {
  const box=$("topProfileDropdown");if(!box)return;
  const opening=box.classList.contains("hidden");
  ["topMessagesDropdown","topFriendsDropdown","notificationDropdown","reportDropdown"].forEach(id=>$(id)?.classList.add("hidden"));
  box.classList.toggle("hidden",!opening);
};
document.addEventListener("click",e=>{if(!e.target.closest("#topProfile")&&!e.target.closest("#topProfileDropdown"))$("topProfileDropdown")?.classList.add("hidden");});
function openMyProfileFromHeader(){ $("topProfileDropdown")?.classList.add("hidden"); state.view="profile"; document.querySelectorAll(".nav[data-view]").forEach(x=>x.classList.toggle("active",x.dataset.view==="profile")); renderView(); }
function openHeaderChatOptions(){
  $("topProfileDropdown")?.classList.add("hidden");const s=state.user?.settings||{};
  modal('<div class="header-chat-options"><h2>💬 Chat options</h2><p class="muted">Quick chat customization without leaving the room.</p><label>Message text size<select id="quickChatSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label><label>Chat font<select id="quickChatFont"><option>Inter</option><option>Georgia</option><option>Monospace</option><option>Arial</option><option>Trebuchet MS</option></select></label><label>Bubble color<input type="color" id="quickBubbleColor"></label><label>Display-name color<input type="color" id="quickUsernameColor"></label><label class="quick-chat-check"><input type="checkbox" id="quickCompact"> Compact chat spacing</label><button class="primary" id="quickChatSave">Save chat options</button></div>');
  $("quickChatSize").value=s.fontSize||"medium";$("quickChatFont").value=s.chatFont||"Inter";$("quickBubbleColor").value=s.bubbleColor||"#33244f";$("quickUsernameColor").value=s.usernameColor||"#9b5cff";$("quickCompact").checked=!!s.compactMode;
  $("quickChatSave").onclick=async()=>{const p={fontSize:$("quickChatSize").value,chatFont:$("quickChatFont").value,bubbleColor:$("quickBubbleColor").value,usernameColor:$("quickUsernameColor").value,compactMode:$("quickCompact").checked};try{const d=await api("/api/settings",{method:"PUT",body:JSON.stringify(p)});state.user.settings={...(state.user.settings||{}),...(d.settings||p)};applyTheme(state.user.settings.theme||"obsidian");renderMessages();closeModal();toast("Chat options saved.");}catch(e){toast(e.message)}};
}

async function loadSuggestions(){
  const list=$('suggestionsList'),form=$('suggestionForm');
  if(!list||!form)return;
  const developer=String(state.user?.username||'').toLowerCase()==='maleficent'||String(state.user?.rank||'').toUpperCase()==='DEVELOPER';
  try{
    const data=await api('/api/suggestions');
    const items=data.suggestions||[];
    list.innerHTML=items.length?items.map(s=>{
      const status=String(s.status||'Pending');
      const statusClass=status==='Rejected'?'suggestion-status-rejected':status==='Feature added'?'suggestion-status-added':status==='Approved'?'suggestion-status-approved':'suggestion-status-pending';
      return '<article class="card suggestion-card"><div class="news-card-top"><div><h3>'+esc(s.category||'Suggestion')+'</h3><div class="muted">'+(developer?'@'+esc(s.username||'Unknown')+' · ':'')+esc(fmt(s.created_at||s.createdAt))+'</div></div><span class="pill '+statusClass+'">'+esc(status)+'</span></div><p class="suggestion-description">'+esc(s.description||'')+'</p>'+(s.review_note?'<p class="muted">Developer note: '+esc(s.review_note)+'</p>':'')+(developer?'<div class="toolbar suggestion-actions"><button type="button" data-suggestion-status="Rejected" data-suggestion-id="'+esc(s.id)+'">Rejected</button><button type="button" data-suggestion-status="Feature added" data-suggestion-id="'+esc(s.id)+'">Feature added</button><button type="button" data-suggestion-status="Approved" data-suggestion-id="'+esc(s.id)+'">Approved</button></div>':'')+'</article>';
    }).join(''):'<div class="card"><p class="muted">'+(developer?'No suggestions have been submitted yet.':'You have not submitted any suggestions yet.')+'</p></div>';
    form.classList.toggle('hidden',developer);
    form.onsubmit=async e=>{
      e.preventDefault();
      const category=$('suggestionCategory')?.value||'',description=($('suggestionDescription')?.value||'').trim();
      if(!description){toast('Please describe your suggestion.');return;}
      const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
      try{await api('/api/suggestions',{method:'POST',body:JSON.stringify({category,description})});$('suggestionDescription').value='';toast('Suggestion submitted to the Developer.');await loadSuggestions();}
      catch(err){toast(err.message||'Could not submit suggestion.');}
      finally{if(button)button.disabled=false;}
    };
    list.querySelectorAll('[data-suggestion-status]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try{await api('/api/suggestions/'+encodeURIComponent(button.dataset.suggestionId),{method:'PATCH',body:JSON.stringify({status:button.dataset.suggestionStatus})});toast('Suggestion status updated and user notified.');await loadSuggestions();}
      catch(err){toast(err.message||'Could not update suggestion.');}
      finally{button.disabled=false;}
    });
  }catch(e){list.innerHTML='<div class="card"><p class="error">'+esc(e.message||'Could not load suggestions.')+'</p></div>';}
}

async function loadSuggestions(){
  const list=$('suggestionsList'),form=$('suggestionForm');
  if(!list||!form)return;
  const developer=String(state.user?.username||'').toLowerCase()==='maleficent'||String(state.user?.rank||'').toUpperCase()==='DEVELOPER';
  try{
    const data=await api('/api/suggestions');
    const items=data.suggestions||[];
    list.innerHTML=items.length?items.map(x=>'<article class="card"><div class="news-card-top"><div><h3>'+esc(x.category)+'</h3><div class="muted">'+(developer?'@'+esc(x.username||'Unknown')+' · ':'')+esc(fmt(x.created_at))+'</div></div><span class="pill">'+esc(x.status||'Pending')+'</span></div><p>'+esc(x.description||'')+'</p>'+(developer?'<div class="toolbar"><button data-suggestion-status="Rejected" data-suggestion-id="'+esc(x.id)+'">Rejected</button><button data-suggestion-status="Feature added" data-suggestion-id="'+esc(x.id)+'">Feature added</button><button data-suggestion-status="Approved" data-suggestion-id="'+esc(x.id)+'">Approved</button></div>':'')+'</article>').join(''):'<div class="card"><p class="muted">No suggestions yet.</p></div>';
    form.classList.toggle('hidden',developer);
    form.onsubmit=async e=>{e.preventDefault();const description=$('suggestionDescription').value.trim(),category=$('suggestionCategory').value;if(!description){toast('Please describe your suggestion.');return;}try{await api('/api/suggestions',{method:'POST',body:JSON.stringify({category,description})});$('suggestionDescription').value='';toast('Suggestion submitted to the Developer.');await loadSuggestions();}catch(err){toast(err.message||'Could not submit suggestion.');}};
    list.querySelectorAll('[data-suggestion-status]').forEach(b=>b.onclick=async()=>{try{await api('/api/suggestions/'+encodeURIComponent(b.dataset.suggestionId),{method:'PATCH',body:JSON.stringify({status:b.dataset.suggestionStatus})});toast('Status updated; the user has been notified.');await loadSuggestions();}catch(err){toast(err.message||'Could not update status.');}});
  }catch(e){list.innerHTML='<div class="card"><p class="error">'+esc(e.message||'Could not load suggestions.')+'</p></div>';}
}

async function loadWall(){
  try {
    const d=await api('/api/wall'),feed=$('wallFeed'); if(!feed)return;
    const emojis=['👍','❤️','😂','😮','🔥','👏'];
    feed.innerHTML=(d.posts||[]).map(p=>{
      const rx=p.reactions&&typeof p.reactions==='object'?p.reactions:{};
      return `<article class="card wall-post social-feed-card" data-wall-id="${esc(p.id)}">
        <div class="news-card-top"><div class="social-author"><div class="social-author-avatar">${p.avatar?`<img src="${esc(p.avatar)}" alt="">`:'👤'}</div><div><h3>@${esc(p.username||'Unknown')}</h3><div class="muted">${esc(p.rank||'Member')} · ${fmt(p.created_at)}</div></div></div><button class="social-more" data-wall-more="${esc(p.id)}" aria-label="Post options">•••</button></div>
        <div class="news-body wall-content">${esc(p.content||'')}${p.media_url?(String(p.media_url).match(/\.(mp4|webm|ogg)(\?|$)/i)?`<video class="wall-media" controls src="${esc(p.media_url)}"></video>`:`<img class="wall-media" src="${esc(p.media_url)}" alt="Wall upload">`):''}</div>
        <div class="social-reaction-summary">${emojis.map(e=>`<span>${e} <b>${(Array.isArray(rx[e])?rx[e]:[]).length}</b></span>`).join('')}<button class="social-comments-shortcut" data-wall-comments="${esc(p.id)}">${Number(p.comment_count||0)} 💬</button></div>
        <div class="news-actions social-reaction-actions">${emojis.map(e=>{const us=Array.isArray(rx[e])?rx[e].map(String):[];return `<button class="mini ${us.includes(String(state.user?.id))?'reacted':''}" type="button" data-wall-reaction="${esc(e)}" data-wall-id="${esc(p.id)}">${e} <b>${us.length}</b></button>`}).join('')}<button class="mini" data-wall-comments="${esc(p.id)}">💬 Comments</button></div>
        <div class="social-post-options hidden" id="wallOptions-${esc(p.id)}"><button type="button" data-wall-report="${esc(p.id)}">⚑ Report</button>${state.user?.username==='Maleficent'?`<button type="button" data-wall-pin="${esc(p.id)}">📌 Pin post</button>`:''}</div>
        <div class="wall-comments hidden" id="wallComments-${esc(p.id)}"></div>
      </article>`;
    }).join('')||'<p class="muted">No wall posts yet.</p>';
    document.querySelectorAll('[data-wall-more]').forEach(b=>b.onclick=()=> $('wallOptions-'+b.dataset.wallMore)?.classList.toggle('hidden'));
    document.querySelectorAll('[data-wall-reaction]').forEach(b=>b.onclick=async()=>{try{await api('/api/wall/'+encodeURIComponent(b.dataset.wallId)+'/reaction',{method:'POST',body:JSON.stringify({emoji:b.dataset.wallReaction})});await loadWall()}catch(e){toast(e.message||'Could not send reaction.')}});
    document.querySelectorAll('[data-wall-report]').forEach(b=>b.onclick=async()=>{try{await api('/api/wall/'+encodeURIComponent(b.dataset.wallReport)+'/report',{method:'POST',body:JSON.stringify({reason:'Reported by community member'})});toast('Wall post reported.')}catch(e){toast(e.message)}});
    document.querySelectorAll('[data-wall-pin]').forEach(b=>b.onclick=async()=>{try{await api('/api/wall/'+encodeURIComponent(b.dataset.wallPin)+'/pin',{method:'POST'});toast('Post pinned.');await loadWall()}catch(e){toast(e.message)}});
    document.querySelectorAll('[data-wall-comments]').forEach(b=>b.onclick=async()=>{const id=b.dataset.wallComments,box=$('wallComments-'+id);if(!box)return;box.classList.toggle('hidden');if(!box.classList.contains('hidden'))try{const d=await api('/api/wall/'+encodeURIComponent(id)+'/comments');box.innerHTML=(d.comments||[]).map(v=>`<div class="news-comment"><div class="news-comment-main"><div class="news-comment-head"><b>@${esc(v.username)}</b><small>${esc(v.rank||'Member')}</small></div><div class="news-comment-text">${esc(v.content)}</div></div></div>`).join('')+`<form class="wall-comment-form news-comment-form"><input placeholder="Write a comment…" maxlength="1000" required><button class="mini">Send</button></form>`;box.querySelector('form').onsubmit=async e=>{e.preventDefault();const input=e.currentTarget.querySelector('input');try{await api('/api/wall/'+encodeURIComponent(id)+'/comments',{method:'POST',body:JSON.stringify({content:input.value})});await loadWall();$('wallComments-'+id)?.classList.remove('hidden')}catch(err){toast(err.message)}}}catch(e){toast(e.message)}});
  } catch(e){toast(e.message||'Could not load Friends Wall.')}
}
if($('newWallPost'))$('newWallPost').onclick=async()=>{
  modal(`<h2>New Wall Post</h2><textarea id="wallPostText" maxlength="5000" placeholder="Write something for your friends…"></textarea><input id="wallPostFile" type="file" accept="image/*,video/*"><div id="wallPreview" class="media-preview"></div><button class="primary" id="wallPostSend">Upload & Publish</button>`);
  $('wallPostFile').onchange=()=>{const f=$('wallPostFile').files?.[0],box=$('wallPreview');if(!f){box.innerHTML='';return}const u=URL.createObjectURL(f);box.innerHTML=f.type.startsWith('video/')?`<video controls src="${u}"></video>`:`<img src="${u}">`;};
  $('wallPostSend').onclick=async()=>{try{const fd=new FormData();fd.append('content',$('wallPostText').value);const f=$('wallPostFile').files?.[0];if(f)fd.append('file',f);const token=safeStorage.getItem("mc_token"); const headers=token?{"x-auth-token":token}:{}; const r=await fetch('/api/wall/post',{method:'POST',body:fd,headers,credentials:'same-origin'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Could not publish wall post.');closeModal();loadWall()}catch(e){toast(e.message)}};
};

async function loadRankShop(){
  const d=await api('/api/shop'); const c=$('rankShop'); if(!c)return;
  const canBuyVip=String(state.user?.rank||'').toUpperCase()==='MEMBER';
  c.innerHTML=`<div class="panel shop-item"><div class="shop-icon">🏅</div><h3>Premium — $3 lifetime</h3><p>No payment details are collected here. Send a request to the owner.</p><button class="primary" id="requestPremium">Request Premium</button></div>${canBuyVip?d.vip.map(v=>`<div class="panel shop-item"><div class="shop-icon">💎</div><h3>VIP — ${v.label}</h3><p>${v.price} gold</p><button class="mini" data-vip-plan="${v.label.includes('7')?'7':v.label.includes('month')&&v.label.includes('3')?'90':v.label.includes('year')?'365':'30'}">${v.price} gold</button></div>`).join(''):'<div class="panel shop-item"><div class="shop-icon">💎</div><h3>VIP</h3><p>Higher ranks cannot buy VIP</p></div>'}`;
  $('requestPremium').onclick=async()=>{try{await api('/api/shop/premium/request',{method:'POST'});toast('Premium request sent to owner.')}catch(e){toast(e.message)}};
  document.querySelectorAll('[data-vip-plan]').forEach(b=>b.onclick=async()=>{try{const d=await api('/api/shop/vip',{method:'POST',body:JSON.stringify({plan:b.dataset.vipPlan})});state.user.gold=d.gold;toast('VIP activated.');updateNav();loadRankShop()}catch(e){toast(e.message)}});
}

async function loadGoldEconomy(){
  const root=$('goldEconomyRoot'); if(!root)return;
  try{
    const data=await api('/api/economy/catalog');
    const balance=$('economyGoldBalance'); if(balance)balance.textContent=Number(data.gold||0).toLocaleString();
    const inventoryIds=new Set((data.inventory||[]).map(x=>x.id));
    const categoryLabel={frame:'Profile Frames',theme:'Profile Themes',badge:'Collectible Badges'};
    const items=(data.items||[]).map(item=>{
      const owned=inventoryIds.has(item.id);
      const equipped=(data.inventory||[]).some(x=>x.id===item.id&&x.equipped);
      return `<article class="cosmetic-card ${owned?'is-owned':''}"><div class="cosmetic-icon">${esc(item.icon)}</div><div class="cosmetic-copy"><small>${esc(categoryLabel[item.category]||'Cosmetic')}</small><b>${esc(item.name)}</b><p>${esc(item.description||'')}</p></div><div class="cosmetic-actions">${owned?(equipped?'<span class="cosmetic-equipped">✓ Equipped</span>':`<button class="mini" data-equip-cosmetic="${esc(item.id)}">Equip</button>`):`<b class="cosmetic-price">🪙 ${Number(item.price).toLocaleString()}</b><button class="primary" data-buy-cosmetic="${esc(item.id)}">Buy</button>`}</div></article>`;
    }).join('');
    const inventory=(data.inventory||[]).length?`<div class="economy-subhead"><b>🎒 Your collection</b><span class="muted">${data.inventory.length} owned</span></div><div class="cosmetic-inventory">${data.inventory.map(item=>`<span class="cosmetic-chip ${item.equipped?'equipped':''}">${esc(item.icon)} ${esc(item.name)} ${item.equipped?'✓':''}</span>`).join('')}</div>`:'<p class="muted">Your collection is empty. Purchase a cosmetic to start it.</p>';
    const history=(data.transactions||[]).slice(0,8);
    root.innerHTML=`<div class="cosmetic-grid">${items||'<p class="muted">No cosmetics are available yet.</p>'}</div><div class="economy-inventory-panel">${inventory}</div><details class="economy-history"><summary>🧾 Recent Gold purchases</summary>${history.length?history.map(t=>`<div class="economy-history-row"><span>${esc(t.description||t.type)}</span><b class="${Number(t.amount)<0?'gold-negative':'gold-positive'}">${Number(t.amount)>0?'+':''}${Number(t.amount).toLocaleString()} Gold</b><small>${esc(new Date(t.time).toLocaleString())}</small></div>`).join(''):'<p class="muted">Your Gold purchase history will appear here.</p>'}</details>`;
    root.querySelectorAll('[data-buy-cosmetic]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{const result=await api('/api/economy/purchase',{method:'POST',body:JSON.stringify({itemId:button.dataset.buyCosmetic})});if(state.user)state.user.gold=result.gold;updateNav();toast('Purchased '+result.item.name+'!');await loadGoldEconomy();}
      catch(error){toast(error.message);button.disabled=false;}
    }));
    root.querySelectorAll('[data-equip-cosmetic]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{const result=await api('/api/economy/equip',{method:'POST',body:JSON.stringify({itemId:button.dataset.equipCosmetic})});if(state.user)state.user.equippedCosmetics=result.equippedCosmetics||[];toast('Cosmetic equipped.');await loadGoldEconomy();if(state.view==='profile')await loadProfile(state.user);}
      catch(error){toast(error.message);button.disabled=false;}
    }));
  }catch(error){root.innerHTML=`<p class="muted">Could not load the Gold Boutique: ${esc(error.message)}</p><button class="mini" id="retryGoldEconomy">Retry</button>`;$('retryGoldEconomy')?.addEventListener('click',loadGoldEconomy);}
}

async function claimDailyReward(){try{const r=await api('/api/daily/claim',{method:'POST'});state.user.gold=r.gold;state.user.xp=r.xp;updateNav();const b=document.querySelector('[data-daily-reward]');if(b){b.disabled=true;b.querySelector('small').textContent='Already claimed today';}toast(`🎁 Daily reward: +${r.amount} gold, +${r.xpAmount} XP · Streak ${r.streak}`);return r;}catch(e){toast(e.message)}}

async function openGifPicker(){
  const cost=Number(state.gifCost||10);
  modal(`<div class="gif-picker"><h2>GIFs · 🪙 ${cost} gold each</h2><input id="gifSearch" placeholder="Search GIFs…"><div id="gifResults" class="gif-results"><p class="muted">Search for a GIF or choose a suggestion.</p></div><p class="muted">Your balance: 🪙 ${Number(state.user?.gold||0)}</p></div>`);
  const search=async()=>{const q=$('gifSearch').value.trim();try{const d=await api('/api/gifs/search?q='+encodeURIComponent(q));state.gifCost=Number(d.cost??state.gifCost??10);$('gifResults').innerHTML=(d.results||[]).map(g=>`<button class="gif-choice" data-gif-url="${esc(g.url)}"><img src="${esc(g.preview||g.url)}" alt="GIF"><span>${esc(g.title||'GIF')}</span></button>`).join('')||'<p class="muted">No GIFs found. Try another search.</p>';document.querySelectorAll('[data-gif-url]').forEach(b=>b.onclick=async()=>{try{const r=await api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/gif`,{method:'POST',body:JSON.stringify({url:b.dataset.gifUrl})});if(state.user)state.user.gold=r.gold;const history=await api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/messages`);state.messages=history.messages||[];$("messages").innerHTML=state.messages.map(messageHTML).join("");$("messages").scrollTop=$("messages").scrollHeight;closeModal();toast("GIF sent successfully.");}catch(e){toast(e.message)}});}catch(e){toast(e.message)}};
  $('gifSearch').oninput=search; await search();
}

document.getElementById("chatGifBtn")?.addEventListener("click",()=>{if(!state.currentRoom){toast("Join a room before sending a GIF.");return;}openGifPicker();});


/* ---------------- ROOMS ---------------- */

/* Defensive room-list cleanup: never display the retired age-split defaults, even if an older server response is cached. */
function sanitizeRoomList(input) {
  const rooms = Array.isArray(input) ? input : [];
  const seenMain = new Set();
  return rooms.filter(room => {
    const name = String(room?.name || "").trim().replace(/^🏠\s*/, "");
    const normalized = name.toLowerCase().replace(/\s+/g, " ");
    // Retire the two old age-split rooms, even if whitespace/case varies.
    if (/^main room\s*[12]\b/i.test(normalized)) return false;
    // Keep only one canonical Main Room.
    if (normalized === "main room") {
      if (seenMain.has("main room")) return false;
      seenMain.add("main room");
      return true;
    }
    return true;
  }).map(room => {
    const name = String(room?.name || "").trim().replace(/^🏠\s*/, "");
    return { ...room, isDefault: name.toLowerCase() === "main room" };
  });
}

async function loadRooms() {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await api("/api/rooms");
      state.rooms = sanitizeRoomList(data.rooms);
      // The room endpoint is the source of truth; always display all available rooms on initial load.
      if (state.rooms.length) {
        state.roomListMode = "all";
        break;
      }
      const boot = await api("/api/bootstrap");
      if (Array.isArray(boot.rooms) && boot.rooms.length) {
        state.rooms = sanitizeRoomList(boot.rooms);
        break;
      }
    } catch (e) {
      lastError = e;
      try {
        const boot = await api("/api/bootstrap");
        state.rooms = sanitizeRoomList(boot.rooms);
        if (state.rooms.length) break;
      } catch (_) {}
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
  }
  renderRooms();
  if (!state.rooms.length && lastError) toast("Rooms could not load: " + lastError.message);
  requestAnimationFrame(()=>renderRooms());
  if (!state.rooms.length) {
    setTimeout(async()=>{try{const retry=await api("/api/rooms");if(Array.isArray(retry.rooms)&&retry.rooms.length){state.rooms=sanitizeRoomList(retry.rooms);state.roomListMode="all";renderRooms();}}catch(e){console.warn("Room list retry failed:",e.message)}},1500);
  }
}

function joinedRoomIds(){
  try{return new Set(JSON.parse(safeStorage.getItem('mc_my_rooms_'+(state.user?.id||'guest'))||'[]').map(String));}catch{return new Set();}
}
function rememberMyRoom(id){
  const ids=joinedRoomIds();ids.add(String(id));safeStorage.setItem('mc_my_rooms_'+(state.user?.id||'guest'),JSON.stringify([...ids]));
  safeStorage.setItem('mc_last_room_'+(state.user?.id||'guest'),String(id));
}
function setRoomListMode(mode){
  state.roomListMode=mode==='mine'?'mine':'all';
  $('allRoomsBtn')?.classList.toggle('active',state.roomListMode==='all');
  $('myRoomsBtn')?.classList.toggle('active',state.roomListMode==='mine');
  renderRooms();
}
$('allRoomsBtn')?.addEventListener('click',()=>setRoomListMode('all'));
$('myRoomsBtn')?.addEventListener('click',()=>setRoomListMode('mine'));
function renderRooms() {
  const search=(($('roomSearch')?.value)||'').trim().toLowerCase();
  const visited=joinedRoomIds();
  const allRooms=Array.isArray(state.rooms)?state.rooms:[];
  const rooms=allRooms.filter(room=>{
    if(state.roomListMode==='mine'&&String(room.ownerId)!==String(state.user?.id)&&!visited.has(String(room.id)))return false;
    const hay=[room.name,room.description,room.category].join(' ').toLowerCase();
    return !search || hay.includes(search);
  });
  $('rooms').innerHTML=rooms.map(room=>{
    const locked=room.locked??!!room.passwordHash;
    const count=Number(room.onlineCount||0);
    const isProtectedMainRoom = !!room.isDefault || /^main room$/i.test(String(room.name||"").trim());
    const canManage = !isProtectedMainRoom && (canFeature("edit_room") || canFeature("delete_room") || room.ownerId===state.user?.id);
    return `
      <article class="room room-list-card ${state.currentRoom===room.id?'selected':''}">
        <button class="room-open" onclick="joinRoom('${esc(room.id)}')">
          <span class="room-icon-wrap">${esc(room.icon||'💬')}</span>
          <span class="room-main">
            <span class="room-title-row"><strong>${esc(room.name)}</strong>${locked?'<span class="room-lock">🔒</span>':''}</span>
            <span class="room-desc">${esc(room.description||'No description has been written for this room')}</span>
            <span class="room-subrow"><span>${esc(room.category||'Community')}</span><span>•</span><span>${esc(room.rankRequired||'MEMBER')}+</span>${room.announcement?'<span>• 📌 announcement</span>':''}<span>• Ages ${Number(room.minAge??0)}–${Number(room.maxAge??99)}</span></span>
          </span>
          <span class="room-count"><strong>${count}</strong><span>♟</span></span>
        </button>
        ${canManage && room.id!=="main" ? `<div class="room-list-actions">
          <button class="mini" type="button" onclick="event.stopPropagation();editRoomById('${esc(room.id)}')">✏️ Edit</button>
          ${canFeature("delete_room")?`<button class="mini danger" type="button" onclick="event.stopPropagation();deleteRoomById('${esc(room.id)}')">🗑️ Delete</button>`:""}
        </div>` : ""}
      </article>`;
  }).join('') || (search
    ? '<div class="room-empty"><div>🔎</div><b>No matching rooms</b><span>Try a different search.</span><button class="mini" type="button" onclick="document.getElementById(\'roomSearch\').value=\'\';renderRooms()">Clear search</button></div>'
    : state.roomListMode==='mine'
      ? '<div class="room-empty"><div>🏠</div><b>No rooms in My rooms yet</b><span>Choose All rooms to see available rooms.</span><button class="mini" type="button" onclick="setRoomListMode(\'all\')">Show all rooms</button></div>'
      : '<div class="room-empty"><div>🏠</div><b>Rooms are not loading yet</b><span>Retry loading the room list. If this continues, check the server logs and database connection.</span><button class="primary" type="button" onclick="loadRooms()">↻ Reload rooms</button></div>');
  renderRoomQuickNav();
}

function renderRoomQuickNav() {
  const nav = $('roomQuickNav');
  if (!nav) return;
  const rooms = Array.isArray(state.rooms) ? state.rooms : [];
  if (!rooms.length) {
    nav.innerHTML = '<span class="room-quick-empty">Loading rooms…</span>';
    return;
  }
  nav.innerHTML = rooms.map(room => {
    const id = String(room.id);
    const selected = String(state.currentRoom || '') === id;
    return `<button type="button" class="room-quick-chip ${selected ? 'active' : ''}" data-quick-room-id="${esc(id)}" aria-current="${selected ? 'page' : 'false'}"><span>${esc(room.icon || '💬')}</span><span>${esc(room.name || 'Room')}</span>${room.locked || room.passwordHash ? '<span class="room-quick-lock">🔒</span>' : ''}</button>`;
  }).join('');
  nav.querySelectorAll('[data-quick-room-id]').forEach(button => {
    button.addEventListener('click', () => joinRoom(String(button.dataset.quickRoomId)));
  });
}
function editRoomById(id){ state.currentRoom=id; editRoom(); }
async function deleteRoomById(id){
  if(!confirm("Delete this room? This removes its messages too."))return;
  try{
    await api(`/api/rooms/${encodeURIComponent(id)}`,{method:"DELETE"});
    if(state.currentRoom===id){
      if(state.socket)state.socket.emit("leave-room",id);
      state.currentRoom=null;
      $("chatWrap").classList.add("hidden");
    }
    await loadRooms(); renderRooms(); toast("Room deleted.");
  }catch(e){toast(e.message)}
}

$("roomSearch").oninput = renderRooms;

async function loadRoomAnnouncements(roomId){
  try{const r=await api(`/api/rooms/${encodeURIComponent(roomId)}/announcements`); const items=r.announcements||[]; const el=$("announcement"); if(!items.length){el.classList.toggle('hidden',true);return;} el.classList.remove('hidden'); el.innerHTML=`<div class="room-announcement-feed"><b>📢 Room announcements</b>${items.slice(0,3).map(n=>`<div class="room-announcement-item"><div><b>@${esc(n.username)}</b> · ${fmt(n.time)} ${canFeature('edit_room')?`<button class="mini danger announcement-delete" data-announcement="${esc(n.id)}">🗑 Delete</button>`:''}</div><div>${formatMentions(n.text)}</div></div>`).join('')}</div>`; el.querySelectorAll('.announcement-delete').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this announcement?'))return;try{await api(`/api/rooms/${encodeURIComponent(roomId)}/announcements/${encodeURIComponent(b.dataset.announcement)}`,{method:'DELETE'});toast('Announcement deleted.');loadRoomAnnouncements(roomId)}catch(e){toast(e.message)}});}catch(e){console.warn(e)}
}
function postRoomAnnouncement(){
  const text=prompt('Share an announcement in this room:',''); if(!text?.trim()) return;
  api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/announcements`,{method:'POST',body:JSON.stringify({text:text.trim()})}).then(()=>{toast('Room announcement shared.');loadRoomAnnouncements(state.currentRoom)}).catch(e=>toast(e.message));
}

async function joinRoom(id) {
  const room =
    state.rooms.find(r => String(r.id) === String(id));

  if (!room) return false;
  id=String(room.id);

  try {
    let password = "";

    const locked =
      room.locked ??
      !!room.passwordHash;

    if (locked) {
      password =
        prompt("Room password:") || "";
    }

    const access=await api(`/api/rooms/${id}/join`, {
      method: "POST",
      body: JSON.stringify({ password })
    });

    if (
      state.currentRoom &&
      state.socket
    ) {
      state.socket.emit(
        "leave-room",
        state.currentRoom
      );
    }

    const staffInfo=await api(`/api/rooms/${encodeURIComponent(id)}/staff`).catch(()=>({myRole:'USER'}));
    state.currentRoom = id;
    const activeRoomTheme=state.rooms.find(r=>String(r.id)===String(id));applyRoomTheme(activeRoomTheme?.roomTheme||"obsidian");
    state.currentRoomRole=staffInfo.myRole||'USER';
    rememberMyRoom(id);

    safeStorage.setItem('mc_room_join',JSON.stringify({roomId:String(id),joinToken:access.joinToken}));
    if (state.socket) state.socket.emit("join-room", {roomId:String(id),joinToken:access.joinToken});

    $("chatWrap").classList.remove("hidden");
    $("viewRooms").classList.add("chatting");

    $("roomName").textContent =
      `${room.icon || "💬"} ${room.name}`;

    $("roomDesc").textContent =
      room.description || "";

    $("announcement").textContent = room.announcement || "";
    $("announcement").classList.toggle("hidden", !room.announcement);
    await loadRoomAnnouncements(id);

   const data =
  await api(`/api/rooms/${id}/messages`);

state.messages = data.messages || [];

$("messages").innerHTML =
  state.messages
    .map(messageHTML)
    .join("");

    $("messages").scrollTop =
      $("messages").scrollHeight;

    renderOnline();
    renderRooms();
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

let onlinePanelTab="online";
let onlinePanelCache=[];

function isStaffUser(user){
  return ["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"].includes(user.rank);
}

let onlineSortMode="online-rank";

async function renderOnline(tab=onlinePanelTab,searchQuery=""){
  onlinePanelTab=tab;
  try{
    const data=await api("/api/users");
    onlinePanelCache=data.users||[];
    // Room roles are only badges in the user list; global ranks remain the
    // authority for message headers and the rest of the site.
    let roomRoleByUser={};
    if(state.currentRoom){
      try{
        const roomStaff=await api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/staff`);
        for(const item of (roomStaff.staff||[])){
          if(item.user?.id) roomRoleByUser[String(item.user.id)]=item.role;
        }
      }catch{}
    }
    const roomRoleIcon={ROOM_MODERATOR:"🛡️",ROOM_ADMIN:"👑",ROOM_OWNER:"🎩"};
    const roomRoleLabel={ROOM_MODERATOR:"Room Moderator",ROOM_ADMIN:"Room Admin",ROOM_OWNER:"Room Owner"};
    const online=onlinePanelCache.filter(u=>u.online&&!u.invisible);
    const friendsData=await api("/api/friends").catch(()=>({users:[]}));
    const friendIds=new Set((friendsData.users||[]).map(u=>u.id));
    const offline=onlinePanelCache.filter(u=>!u.online&&!u.invisible);
    let list=[];
    let title="Online";

    if(tab==="all"){ list=onlinePanelCache; title="All users"; }
    else if(tab==="offline"){ list=offline; title="Offline users"; }
    else if(tab==="staff"){ list=onlinePanelCache.filter(isStaffUser); title="Site staff"; }
    else if(tab==="roomstaff"){list=onlinePanelCache.filter(u=>!!roomRoleByUser[String(u.id)]);title="Room staff";}
    else if(tab==="recent"){list=[...onlinePanelCache].filter(u=>u.lastActive).sort((a,b)=>Number(b.lastActive)-Number(a.lastActive)).slice(0,30);title="Recently active";}
    else if(tab==="friends"){ list=onlinePanelCache.filter(u=>friendIds.has(u.id)); title="Friends"; }
    else if(tab==="search"){
      const needle=searchQuery.trim().toLowerCase();
      list=onlinePanelCache.filter(u=>u.username.toLowerCase().includes(needle));
      title=`Search · ${needle||"all usernames"}`;
    } else { list=online; title="Online"; }

    if(onlineSortMode==="global-rank")list.sort((a,b)=>(rankOrder[b.rank]??-1)-(rankOrder[a.rank]??-1)||a.username.localeCompare(b.username));
    else if(onlineSortMode==="room-rank")list.sort((a,b)=>(({ROOM_ADMIN:3,ROOM_MODERATOR:2,ROOM_OWNER:4}[roomRoleByUser[String(b.id)]||"USER"]||0)-({ROOM_ADMIN:3,ROOM_MODERATOR:2,ROOM_OWNER:4}[roomRoleByUser[String(a.id)]||"USER"]||0))||a.username.localeCompare(b.username));
    else if(onlineSortMode==="recent")list.sort((a,b)=>Number(b.lastActive||0)-Number(a.lastActive||0));
    else list.sort((a,b)=>(Number(b.online)-Number(a.online))||((rankOrder[b.rank]??-1)-(rankOrder[a.rank]??-1))||a.username.localeCompare(b.username));

    const count=online.length;
    $("onlinePanelTitle").innerHTML=`${esc(title)} <span class="online-badge">${count}</span>`;
    $("onlineUsers").innerHTML=`${tab==="search"?'<input id="onlineUsernameSearch" type="search" placeholder="Search username…" autocomplete="off">':''}<div class="online-status-control"><label for="myCustomStatus">My status</label><select id="myCustomStatus"><option>Available</option><option>Busy</option><option>Away</option><option>Do Not Disturb</option></select></div>${tab==="search"?'<div class="online-status-control"><label for="onlineSortMode">Sort users</label><select id="onlineSortMode"><option value="online-rank">Online status</option><option value="global-rank">Global rank</option><option value="room-rank">Room rank</option><option value="recent">Recently active</option></select></div>':''}<div class="online-user-grid">${list.map(user=>`
      <div class="online-user ${user.online?'is-online':'is-offline'}" onclick="openQuickUserCard('${esc(user.id)}')">
        ${avatar(user)}
        <div class="online-user-copy">
          <b>${esc(user.displayName)}</b>
          <small>@${esc(user.username)} ${invisibleDot(user)}${user.invisible?"":" · "+(user.customStatus||(user.online?"Available":"Away"))}</small>
          <span class="room-user-rank" title="${esc(roomRoleLabel[roomRoleByUser[String(user.id)]]||user.rank||'Member')}">${roomRoleByUser[String(user.id)] ? (roomRoleIcon[roomRoleByUser[String(user.id)]]||'✨') : (rankIcon[String(user.rank||'MEMBER').toUpperCase()]||'⚡')} ${esc(roomRoleLabel[roomRoleByUser[String(user.id)]]||String(user.rank||'MEMBER').replaceAll('_',' '))}</span>
        </div>
        <span class="status ${!user.invisible&&user.online?'on':''}"></span>
      </div>
    `).join("") || `<div class="online-empty"><div>${tab==="staff"?"🛡️":tab==="friends"?"💜":"👥"}</div><b>No users here</b><span>Try another tab.</span></div>`}</div>`;
    const sortSelect=$("onlineSortMode");if(sortSelect){sortSelect.value=onlineSortMode;sortSelect.onchange=()=>{onlineSortMode=sortSelect.value;renderOnline(onlinePanelTab);};}
    const statusSelect=$("myCustomStatus");if(statusSelect){statusSelect.value=state.user?.customStatus||"Available";statusSelect.onchange=async()=>{try{const result=await api("/api/me/status",{method:"POST",body:JSON.stringify({status:statusSelect.value})});state.user.customStatus=result.status;toast("Status updated.");await renderOnline(onlinePanelTab);}catch(e){toast(e.message||"Could not update status.");}};}
    const searchInput=$("onlineUsernameSearch");if(searchInput){searchInput.value=searchQuery;searchInput.oninput=()=>{const value=searchInput.value;renderOnline("search",value).then(()=>{const next=$("onlineUsernameSearch");if(next){next.focus();next.setSelectionRange(value.length,value.length);}});};}

    $("onlineCount").textContent=`${count} online`;
    document.querySelectorAll("#onlineTabs [data-online-tab]").forEach(b=>b.classList.toggle("active",b.dataset.onlineTab===onlinePanelTab));
  }catch{}
}

function openOnlinePanelMenu(){
  modal(`<h2>People panel</h2><p class="muted">Switch between online users, offline users, everyone, staff, recently active users, friends and search.</p><div class="toolbar"><button class="mini" onclick="renderOnline('online');closeModal()">Online</button><button class="mini" onclick="renderOnline('offline');closeModal()">Offline</button><button class="mini" onclick="renderOnline('all');closeModal()">All users</button><button class="mini" onclick="renderOnline('staff');closeModal()">Staff</button><button class="mini" onclick="renderOnline('recent');closeModal()">Recently active</button><button class="mini" onclick="renderOnline('friends');closeModal()">Friends</button></div>`);
}


$("closeOnlinePanel")?.addEventListener("click",()=>{
  $("onlinePanel")?.classList.remove("mobile-open");
});
$("openOnlinePanel")?.addEventListener("click",()=>{
  const panel=$("onlinePanel");
  if(!panel)return;
  panel.classList.toggle("mobile-open");
  if(panel.classList.contains("mobile-open"))renderOnline();
});

document.querySelectorAll("#onlineTabs [data-online-tab]").forEach(btn=>{
  btn.addEventListener("click",()=>renderOnline(btn.dataset.onlineTab));
});

/* ---------------- MESSAGES ---------------- */

function formatMentions(text){
  const raw=esc(text||'');
  return raw.replace(/(^|\s)@([A-Za-z0-9_]{3,24})/g,(m,p,n)=>{
    const known=[...(state.mentionUsers||[]),{username:'Aurora'},{username:'Stefan'}].some(u=>u.username.toLowerCase()===n.toLowerCase());
    return known ? `${p}<span class="mention-blue">@${n}</span>` : m;
  });
}

function messageHTML(message) {
  if(message.system){
    return `<div class="system-message" data-mid="${esc(message.id)}"><span>✦</span><b>${esc(message.text||'')}</b><small>${fmt(message.time)}</small></div>`;
  }
  const user = {
    id: message.userId,
    username: message.username,
    displayName: message.displayName,
    rank: message.rank,
    avatar: message.avatar || ""
  };

  let attachment = "";

  // YouTube shares are stored as message.youtube, not message.attachment.
  // Render the embedded player for the message shape returned by the server.
  if (message.youtube?.videoId) {
    const videoId = String(message.youtube.videoId);
    if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      attachment = `<div class="youtube-message"><iframe src="https://www.youtube-nocookie.com/embed/${esc(videoId)}" title="${esc(message.youtube.title||"YouTube video")}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
    }
  }

  if (message.attachment) {
    if(message.attachment.type==='video/youtube' && message.attachment.videoId){
      attachment=`<div class="youtube-message"><iframe src="https://www.youtube.com/embed/${esc(message.attachment.videoId)}" title="${esc(message.attachment.name||'YouTube video')}" loading="lazy" allowfullscreen></iframe></div>`;
    } else if (
      message.attachment.type &&
      message.attachment.type.startsWith("image/")
    ) {
      attachment = `
        <img
          src="${esc(message.attachment.url)}"
          alt="Attachment"
          class="message-image"
        >
      `;
    } else {
      attachment = `
        <audio
          controls
          src="${esc(message.attachment.url)}"
        ></audio>
      `;
    }
  }

  const reactionData = message.reactions && typeof message.reactions === "object" ? message.reactions : {};
  const reactions = Object.entries(reactionData)
      .map(([emoji, value]) => [emoji, Array.isArray(value) ? value.map(String) : (Number(value)>0 ? Array.from({length:Math.min(Number(value),100)},(_,i)=>"legacy-"+i) : [])])
      .filter(([, users]) => users.length)
      .map(([emoji, users]) => `
        <button class="mini reaction-chip ${users.includes(String(state.user?.id)) ? "reacted" : ""}" type="button"
          aria-label="${esc(emoji)} reaction, ${users.length} reactions"
          onclick="reactMsg('${esc(message.id)}','${esc(emoji)}')">${emoji} ${users.length}</button>
      `).join("");

  return `
    <div
      class="msg ${message.userId===state.user?.id?"mine":"theirs"}"
      data-mid="${esc(message.id)}"
    >
      <button class="message-avatar-button" onclick="openQuickUserCard('${esc(user.id)}')" title="Quick profile actions">${avatar(user)}</button>

      <div class="msg-body">

        <div class="msg-top">
          <span class="msg-time-side">${fmt(message.time)}${message.edited ? " · edited" : ""}</span>
          <button class="message-author tag-author" type="button" title="Tag @${esc(message.username)}" onclick="tagUserFromMessage('${esc(message.username)}')" style="color:${esc(message.usernameColor||state.user?.settings?.usernameColor||'var(--username-color)')}">${esc(message.displayName)}</button>
          <span class="message-rank-floating" title="${esc(message.rank||"MEMBER")}">${rankIcon[String(message.rank||"MEMBER").toUpperCase()]||"⚡"} ${esc(String(message.rank||"MEMBER").replaceAll("_"," "))}</span>
        </div>

       ${
  message.replyTo
    ? (() => {
        const quoted =
          state.messages.find(
            m => m.id === message.replyTo
          );

        if (!quoted) {
          return `
            <div class="quoted">
              <div class="quoted-label">
                ↪ Replying to a message
              </div>
            </div>
          `;
        }

        return `
          <div
            class="quoted"
            onclick="jumpToMessage('${esc(quoted.id)}')"
          >
            <div class="quoted-label">
              ↪ ${esc(quoted.displayName || quoted.username || "User")}
            </div>

            <div class="quoted-text">
              ${
                quoted.text
                  ? esc(quoted.text)
                  : quoted.attachment
                    ? "📎 Attachment"
                    : "Message"
              }
            </div>
          </div>
        `;
      })()
    : ""
}

        ${message.type === "gif" && message.gifUrl ? `<a class="chat-gif" href="${esc(message.gifUrl)}" target="_blank" rel="noopener"><img src="${esc(message.gifUrl)}" alt="GIF" loading="lazy"></a>` : ""}
        ${
          message.text && message.type !== "gif"
            ? `<div class="msg-text">${formatMentions(message.text)}</div>`
            : ""
        }

        ${attachment}

        ${
          message.forwardedFrom
            ? `<div class="muted">
                 ↗ forwarded
               </div>`
            : ""
        }

        ${
          message.pinned
            ? `<div class="pinned">
                 📌 Pinned message
               </div>`
            : ""
        }
        <div class="msg-actions">
          <button class="message-more-button" type="button" aria-label="Message actions" title="Message actions" onclick="event.stopPropagation();toggleMessageMenu('${esc(message.id)}')">⋯</button>
          <div class="message-actions-menu hidden" id="message-menu-${esc(message.id)}" role="menu" aria-label="Message actions">
            <button class="message-menu-item" role="menuitem" onclick="replyMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">↩</span><span><b>Quote</b><small>Reply to this message</small></span></button>
            <button class="message-menu-item" role="menuitem" onclick="hideMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">◉</span><span><b>Hide</b><small>Hide from my screen</small></span></button>
            <button class="message-menu-item" role="menuitem" onclick="reportMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">!</span><span><b>Report</b><small>Report this content</small></span></button>
            <button class="message-menu-item" role="menuitem" onclick="toggleReactionPicker('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">☺</span><span><b>React</b><small>Add an emoji reaction</small></span></button>
            <button class="message-menu-item" role="menuitem" onclick="saveMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">♧</span><span><b>Save</b><small>Keep in saved messages</small></span></button>
            ${message.text ? `<button class="message-menu-item" role="menuitem" onclick="copyMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">▢</span><span><b>Copy text</b><small>Copy message to clipboard</small></span></button>` : ""}
            ${
              message.userId === state.user.id
              ? `<button class="message-menu-item" role="menuitem" onclick="editMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">✎</span><span><b>Edit</b><small>Change your message</small></span></button>`
              : ""
            }
            ${
              (message.userId === state.user.id || can("delete_message"))
              ? `<button class="message-menu-item danger" role="menuitem" onclick="deleteMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">×</span><span><b>Delete</b><small>Remove this message</small></span></button>`
              : ""
            }
            ${
              canFeature("pin_message")
              ? `<button class="message-menu-item" role="menuitem" onclick="pinMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">⌖</span><span><b>${message.pinned ? "Unpin" : "Pin"}</b><small>${message.pinned ? "Remove from pinned messages" : "Pin for the room"}</small></span></button>`
              : ""
            }
          </div>
        </div>

        <div class="reaction">
          ${reactions}
          <div class="reaction-picker hidden" id="reactionPicker-${esc(message.id)}">${['❤️','😂','😭','😮','🔥','👏','👍','👎','🥰','🎉'].map(e=>`<button type="button" onclick="reactMsg('${esc(message.id)}','${e}').finally(()=>toggleReactionPicker('${esc(message.id)}'))">${e}</button>`).join('')}</div>
        </div>

      </div>
    </div>
  `;
}

function tagUserFromMessage(username){
  if(!username) return;
  const input=$("message");
  if(!input) return;
  const value=input.value||"";
  const sep=value && !/[\s]$/.test(value)?" ":"";
  input.value=value+sep+"@"+username+" ";
  input.focus();
  input.dispatchEvent(new Event("input"));
}


function hiddenRoomMessageIds(){
  try{return JSON.parse(localStorage.getItem("maleficent_hidden_room_messages")||"[]")}catch{return []}
}
function hideMsg(id){
  const ids=hiddenRoomMessageIds();
  if(!ids.includes(String(id)))ids.push(String(id));
  try{localStorage.setItem("maleficent_hidden_room_messages",JSON.stringify(ids))}catch{}
  document.querySelector(`.msg[data-mid="${CSS.escape(String(id))}"]`)?.remove();
  toast("Message hidden from your screen.");
}
async function copyMsg(id){
  const message=(state.messages||[]).find(m=>String(m.id)===String(id));
  if(!message?.text){toast("This message has no text to copy.");return}
  try{
    await navigator.clipboard.writeText(message.text);
    toast("Message copied.");
  }catch{
    const area=document.createElement("textarea");area.value=message.text;area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();
    try{document.execCommand("copy");toast("Message copied.")}catch{toast("Could not copy this message.")}finally{area.remove()}
  }
}

function closeMessageMenus(){
  document.querySelectorAll(".message-actions-menu").forEach(m=>m.classList.add("hidden"));
}
function toggleMessageMenu(id){
  const menu=$(`message-menu-${id}`);
  if(!menu) return;
  const wasHidden=menu.classList.contains("hidden");
  closeMessageMenus();
  if(wasHidden) menu.classList.remove("hidden");
}
document.addEventListener("click",e=>{
  const msg=e.target instanceof Element?e.target.closest(".msg[data-mid]"):null;
  if(!msg||e.target.closest("button,a,input,textarea,audio,video,iframe,.message-actions-menu,.reaction-picker,.quoted"))return;
  const menu=msg.querySelector(".message-actions-menu");
  if(!menu)return;
  const wasHidden=menu.classList.contains("hidden");
  closeMessageMenus();
  if(wasHidden)menu.classList.remove("hidden");
});
document.addEventListener("click",e=>{
  // A tap on a message must not be treated as an outside click immediately
  // after the message-action menu has been opened by the delegated handler.
  if(!e.target.closest(".msg-actions,.msg[data-mid]")) closeMessageMenus();
});

function showStefanOptions(){
  if(!state.currentRoom) return;
  const canClear=canFeature("clear_room");
  const canEdit=canFeature("edit_room");
  const canDelete=canFeature("delete_room");
  const options=[
    canClear ? `<button class="stefan-option" onclick="clearRoom();closeStefanCard()">🧹 Clear room</button>` : "",
    `<button class="stefan-option" onclick="postRoomAnnouncement();closeStefanCard()">📢 Announcement</button>`,
    `<button class="stefan-option" onclick="showPinnedMessages();closeStefanCard()">📌 Pinned messages</button>`,
    `<button class="stefan-option" onclick="showInvite();closeStefanCard()">🔗 Invite link</button>`,
    `<button class="stefan-option" onclick="openCommandGuide();closeStefanCard()">⌘ Command Guide</button>`,
    canEdit ? `<button class="stefan-option" onclick="editRoom();closeStefanCard()">✏️ Edit room</button>` : "",
    canDelete ? `<button class="stefan-option danger" onclick="deleteRoom();closeStefanCard()">🗑️ Delete room</button>` : ""
  ].filter(Boolean).join("");
  const id="stefan-options-"+Date.now();
  $("messages").insertAdjacentHTML("beforeend",`
    <div class="stefan-card" id="${id}">
      <div class="stefan-card-head"><span>🧛‍♂️ <b>Stefan</b></span><button class="mini" onclick="closeStefanCard('${id}')">×</button></div>
      <div class="muted stefan-sub">Main Room tools · available according to your feature permissions</div>
      <div class="stefan-options">${options}</div>
    </div>`);
  $("messages").scrollTop=$("messages").scrollHeight;
}
function closeStefanCard(id){
  if(id){ document.getElementById(id)?.remove(); return; }
  document.querySelectorAll(".stefan-card").forEach(x=>x.remove());
}

function appendMessage(message) {
  if (
    document.querySelector(
      `[data-mid="${message.id}"]`
    )
  ) {
    return;
  }

  state.messages.push(message);

  $("messages").insertAdjacentHTML(
    "beforeend",
    messageHTML(message)
  );

  $("messages").scrollTop =
    $("messages").scrollHeight;
  if(message.expiresAt){
    const remaining=Number(message.expiresAt)-Date.now();
    if(remaining<=0){
      document.querySelector(`[data-mid="${message.id}"]`)?.remove();
    }else{
      setTimeout(()=>{
        document.querySelector(`[data-mid="${message.id}"]`)?.remove();
      },Math.min(remaining,2147483647));
    }
  }
}

async function togglePresenceMode(mode){
  if(!["OWNER","DEVELOPER"].includes(String(state.user?.rank||"").toUpperCase())){toast("Only Owner and Developer can use presence modes.");return;}
  const active = mode==="ghost" ? !!state.user?.hideMode : mode==="dead" ? !!state.user?.deadMode : !!state.user?.invisible;
  const enable = !active;
  try{
    // First clear other modes so each button always produces one predictable state.
    if(mode!=="ghost") await api("/api/me/hide-mode",{method:"POST",body:JSON.stringify({enabled:false})});
    if(mode!=="dead") await api("/api/me/dead-mode",{method:"POST",body:JSON.stringify({enabled:false})});
    if(mode!=="invisible") await api("/api/me/invisible",{method:"POST",body:JSON.stringify({enabled:false})});
    let result;
    if(mode==="ghost") result=await api("/api/me/hide-mode",{method:"POST",body:JSON.stringify({enabled:enable})});
    else if(mode==="dead") result=await api("/api/me/dead-mode",{method:"POST",body:JSON.stringify({enabled:enable})});
    else result=await api("/api/me/invisible",{method:"POST",body:JSON.stringify({enabled:enable})});
    state.user.hideMode=!!result.hideMode;
    state.user.deadMode=!!result.deadMode;
    state.user.invisible=!!result.invisible;
    closeModal();
    toast((enable?"Enabled ":"Disabled ")+({ghost:"👻 Ghost Mode",dead:"💀 Dead Mode",invisible:"😈 Invisible Mode"}[mode])+".");
    updateNav();
    await loadUsers().catch(()=>{});
    await renderOnline(onlinePanelTab).catch(()=>{});
  }catch(error){toast(error.message||"Could not update presence mode.");}
}

function openPresenceModes(){
  if(!["OWNER","DEVELOPER"].includes(String(state.user?.rank||"").toUpperCase())){toast("Only Owner and Developer can use presence modes.");return;}
  modal(`<div class="mode-control-panel" style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:420px;min-width:0;box-sizing:border-box;padding:14px">
    <h2 style="margin:0;font-size:18px;line-height:1.25">🕶️ Presence Modes</h2>
    <p class="muted" style="margin:0;font-size:13px;line-height:1.5;white-space:normal;overflow-wrap:anywhere">Select one mode. Read the description before applying it.</p>
    <label class="mode-control-row" style="display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:10px;width:100%;min-width:0;box-sizing:border-box;padding:10px;border:1px solid var(--border-color,#393244);border-radius:10px;white-space:normal">
      <input type="checkbox" id="modePopupHide" style="margin:3px 0 0" ${state.user?.hideMode&&!state.user?.deadMode?'checked':''}>
      <span style="display:block;min-width:0;white-space:normal;overflow-wrap:anywhere"><b style="display:block;margin-bottom:4px">👻 Ghost Mode</b><small style="display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.45">Hides your account from public user lists, search, profile access, and presence. You can still chat normally; every room message you send appears as Aurora.</small></span>
    </label>
    <label class="mode-control-row" style="display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:10px;width:100%;min-width:0;box-sizing:border-box;padding:10px;border:1px solid var(--border-color,#393244);border-radius:10px;white-space:normal">
      <input type="checkbox" id="modePopupDead" style="margin:3px 0 0" ${state.user?.deadMode?'checked':''}>
      <span style="display:block;min-width:0;white-space:normal;overflow-wrap:anywhere"><b style="display:block;margin-bottom:4px">💀 Dead Mode</b><small style="display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.45">Your account stays visible and works normally, but Aurora will not announce when you join a room.</small></span>
    </label>
    <label class="mode-control-row" style="display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:10px;width:100%;min-width:0;box-sizing:border-box;padding:10px;border:1px solid var(--border-color,#393244);border-radius:10px;white-space:normal">
      <input type="checkbox" id="modePopupInvisible" style="margin:3px 0 0" ${state.user?.invisible&&!state.user?.deadMode?'checked':''}>
      <span style="display:block;min-width:0;white-space:normal;overflow-wrap:anywhere"><b style="display:block;margin-bottom:4px">😈 Invisible Mode</b><small style="display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.45">Hides your online presence from regular users. Staff with sufficient permissions can still identify you as invisible.</small></span>
    </label>
    <p class="muted" id="modePopupStatus" aria-live="polite" style="font-size:12px;line-height:1.4;min-height:14px;margin:0;overflow-wrap:anywhere"></p>
    <div class="toolbar" style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="primary" id="applyModePopup">Apply mode</button><button type="button" class="mini" onclick="closeModal()">Cancel</button></div>
  </div>`);
  const hide=$("modePopupHide"),dead=$("modePopupDead"),invisible=$("modePopupInvisible"),apply=$("applyModePopup");
  const boxes=[hide,dead,invisible].filter(Boolean);
  boxes.forEach(box=>box.addEventListener("change",()=>{if(box.checked)boxes.filter(other=>other!==box).forEach(other=>other.checked=false);}));
  apply?.addEventListener("click",async()=>{
    const status=$("modePopupStatus");apply.disabled=true;if(status)status.textContent="Saving…";
    try{
      let result;
      if(dead.checked){
        await api("/api/me/hide-mode",{method:"POST",body:JSON.stringify({enabled:false})});
        await api("/api/me/invisible",{method:"POST",body:JSON.stringify({enabled:false})});
        result=await api("/api/me/dead-mode",{method:"POST",body:JSON.stringify({enabled:true})});
      }else{
        await api("/api/me/dead-mode",{method:"POST",body:JSON.stringify({enabled:false})});
        if(hide.checked){
          await api("/api/me/invisible",{method:"POST",body:JSON.stringify({enabled:false})});
          result=await api("/api/me/hide-mode",{method:"POST",body:JSON.stringify({enabled:true})});
        }else if(invisible.checked){
          await api("/api/me/hide-mode",{method:"POST",body:JSON.stringify({enabled:false})});
          result=await api("/api/me/invisible",{method:"POST",body:JSON.stringify({enabled:true})});
        }else{
          await api("/api/me/hide-mode",{method:"POST",body:JSON.stringify({enabled:false})});
          result=await api("/api/me/invisible",{method:"POST",body:JSON.stringify({enabled:false})});
        }
      }
      state.user.hideMode=!!result.hideMode;state.user.deadMode=!!result.deadMode;state.user.invisible=!!result.invisible||!!result.deadMode;
      closeModal();toast("Presence mode updated.");updateNav();await loadUsers().catch(()=>{});await renderOnline(onlinePanelTab).catch(()=>{});
    }catch(error){if(status)status.textContent=error.message||"Could not update modes.";toast(error.message||"Could not update modes.");apply.disabled=false;}
  });
}
function openDoodleComposer(){
  if(!state.currentRoom){toast('Join the Main Room before sending a doodle.');return;}
  modal(`<div class="doodle-modal"><div class="doodle-head"><h2>🖌️ Doodle</h2><button type="button" class="mini" id="doodleClose">×</button></div>
    <div class="doodle-tools"><button type="button" id="doodlePen">🖌️ Pen</button><button type="button" id="doodleEraser">🧽 Eraser</button><label>Color <input type="color" id="doodleColor" value="#111111"></label><label>Size <input type="range" id="doodleSize" min="2" max="24" value="5"></label><button type="button" id="doodleUndo">↶ Undo</button><button type="button" id="doodleClear">🗑 Clear</button></div>
    <canvas id="doodleCanvas" width="900" height="620" aria-label="Draw your doodle here"></canvas>
    <div class="doodle-footer"><span class="muted">Your drawing will be sent to the current room.</span><button type="button" class="primary" id="doodleSend">➤ Send to Main Chat</button></div></div>`);
  const canvas=$('doodleCanvas'),ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  let drawing=false,erase=false,color='#111111',size=5,history=[];
  const snapshot=()=>{try{history.push(ctx.getImageData(0,0,canvas.width,canvas.height));if(history.length>20)history.shift()}catch{}};
  snapshot();
  const point=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}};
  canvas.onpointerdown=e=>{e.preventDefault();drawing=true;canvas.setPointerCapture?.(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=erase?'#ffffff':color;ctx.lineWidth=size;ctx.lineTo(p.x+.01,p.y+.01);ctx.stroke();};
  canvas.onpointermove=e=>{if(!drawing)return;const p=point(e);ctx.strokeStyle=erase?'#ffffff':color;ctx.lineWidth=size;ctx.lineTo(p.x,p.y);ctx.stroke();};
  const finish=()=>{if(drawing){drawing=false;snapshot()}};canvas.onpointerup=finish;canvas.onpointercancel=finish;
  $('doodlePen').onclick=()=>erase=false;$('doodleEraser').onclick=()=>erase=true;$('doodleColor').oninput=e=>{color=e.target.value;erase=false};$('doodleSize').oninput=e=>size=Number(e.target.value);
  $('doodleUndo').onclick=()=>{if(history.length>1){history.pop();ctx.putImageData(history[history.length-1],0,0)}};
  $('doodleClear').onclick=()=>{ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);snapshot()};
  $('doodleClose').onclick=closeModal;
  $('doodleSend').onclick=async()=>{const btn=$('doodleSend');btn.disabled=true;btn.textContent='Sending…';try{
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not export the doodle.')),'image/png'));
    const file=new File([blob],'maleficent-doodle.png',{type:'image/png'}),form=new FormData();form.append('text','');form.append('file',file);
    const data=await api('/api/rooms/'+encodeURIComponent(state.currentRoom)+'/messages',{method:'POST',body:form});
    if(data.message&&String(data.message.roomId)===String(state.currentRoom))appendMessage(data.message);
    closeModal();toast('Doodle sent to the room!');
  }catch(e){btn.disabled=false;btn.textContent='➤ Send to Main Chat';toast(e.message||'Could not send doodle.')}};
}
$('doodleBtn')?.addEventListener('click',openDoodleComposer);


const composer=$("composer");
if(composer && !composer.dataset.submitBound){
  composer.dataset.submitBound="true";
  composer.addEventListener("submit",async e=>{
    e.preventDefault();
    if(!state.user){toast("Your session is not ready. Please log in again.");return;}
    if(!state.currentRoom){toast("Join a room before sending a message.");return;}
    const input=$("message"),fileInput=$("file"),sendButton=composer.querySelector(".send");
    const textValue=(input?.value||"").trim(),file=fileInput?.files?.[0];
    // /mode is a local command: open the presence-mode controls instead of posting it as chat text.
    if(/^\/mode(?:\s|$)/i.test(textValue)){
      if(input)input.value="";
      openPresenceModes();
      return;
    }
    if(!textValue&&!file){input?.focus();return;}
    const form=new FormData();
    form.append("text",textValue);
    if(file)form.append("file",file);
    if(state.replyTo)form.append("replyTo",String(state.replyTo));
    if(sendButton){sendButton.disabled=true;sendButton.textContent="Sending…";}
    try{
      const result=await api("/api/rooms/"+encodeURIComponent(state.currentRoom)+"/messages",{method:"POST",body:form});
      if(result.message)appendMessage(result.message);
      if(input)input.value="";
      if(fileInput)fileInput.value="";
      const fileName=$("fileName");if(fileName)fileName.textContent="";
      if(state.replyTo!==null&&typeof cancelReply==="function")cancelReply();
      input?.focus();
    }catch(error){
      toast(error.message||"Could not send message.");
      if(String(error.message||"").toLowerCase().includes("login required")){
        // Preserve the typed message and do not silently navigate away.
        toast("Your login session expired. Please log in again.");
      }
    }finally{
      if(sendButton){sendButton.disabled=false;sendButton.textContent="Send";}
    }
  });
}

$("message").oninput = () => {
  if (
    state.socket &&
    state.currentRoom
  ) {
    state.socket.emit("typing", {
      roomId: state.currentRoom,
      user: state.user.displayName,
      typing:
        $("message").value.length > 0
    });
  }
};



function replyMsg(id) {
  if (!state.user) {
    toast("Please login first.");
    return;
  }

  const message = state.messages?.find(
    m => String(m.id) === String(id)
  );

  if (!message) {
    toast("Original message could not be found.");
    return;
  }

  state.replyTo = message.id;

  const author =
    message.displayName ||
    message.username ||
    "User";

  const preview =
    message.text ||
    (message.attachment
      ? "📎 Attachment"
      : "Message");

  $("replyBar").innerHTML = `
    <div class="replybar-content">
      <div>
        <strong>↪ Replying to ${esc(author)}</strong>
        <div class="reply-preview">
          ${esc(preview)}
        </div>
      </div>

      <button
        type="button"
        class="reply-cancel"
        onclick="cancelReply()"
      >
        ✕
      </button>
    </div>
  `;

  $("replyBar").classList.remove("hidden");

  $("message").focus();
}


// Double-click (desktop) or double-tap (touch) a message bubble to quote it.
(function enableMessageDoubleTapQuote(){
  let lastTouch = { id: null, time: 0 };
  document.addEventListener("pointerup", event => {
    if(event.pointerType !== "touch") return;
    const target=event.target;
    if(!(target instanceof Element) || target.closest("button,a,input,textarea,audio,video,iframe,.msg-actions,.message-actions-menu")) return;
    const msg=target.closest(".msg[data-mid]");
    if(!msg || !target.closest(".msg-text,.message-image,.chat-gif,.quoted,.msg-body")) return;
    const id=msg.dataset.mid, now=Date.now();
    if(lastTouch.id===id && now-lastTouch.time<360){
      lastTouch={id:null,time:0};
      replyMsg(id);
    }else lastTouch={id,time:now};
  }, {passive:true});
  document.addEventListener("dblclick", event => {
    const target=event.target;
    if(!(target instanceof Element) || target.closest("button,a,input,textarea,audio,video,iframe,.msg-actions,.message-actions-menu")) return;
    const msg=target.closest(".msg[data-mid]");
    if(!msg || !target.closest(".msg-text,.message-image,.chat-gif,.quoted,.msg-body")) return;
    replyMsg(msg.dataset.mid);
  });
})();

function cancelReply() {
  state.replyTo = null;

  $("replyBar").innerHTML = "";

  $("replyBar").classList.add(
    "hidden"
  );
}

function jumpToMessage(id) {
  const element =
    document.querySelector(
      `[data-mid="${CSS.escape(id)}"]`
    );

  if (!element) {
    return;
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  element.classList.add(
    "quote-highlight"
  );

  setTimeout(() => {
    element.classList.remove(
      "quote-highlight"
    );
  }, 1500);
}

async function editMsg(id) {
  const element =
    document.querySelector(
      `[data-mid="${id}"] .msg-text`
    );

  if (!element) return;

  const text =
    element.textContent;

  const updated =
    prompt("Edit message:", text);

  if (updated === null) return;

  try {
    await api(`/api/messages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        text: updated
      })
    });
  } catch (error) {
    toast(error.message);
  }
}

async function deleteMsg(id) {
  if (!confirm("Delete this message?")) {
    return;
  }

  try {
    await api(`/api/messages/${id}`, {
      method: "DELETE"
    });

    const element =
      document.querySelector(
        `[data-mid="${id}"]`
      );

    if (element) {
      element.remove();
    }
  } catch (error) {
    toast(error.message);
  }
}

async function reactMsg(id, emoji) {
  try {
    const result = await api(
      `/api/messages/${encodeURIComponent(id)}/reaction`,
      {
        method: "POST",
        body: JSON.stringify({ emoji })
      }
    );
    // Update this browser immediately from the server-confirmed reaction,
    // even if the Socket.IO update arrives late or the socket reconnects.
    if (result.message) {
      const message = result.message;
      const messages = state.messages || [];
      const index = messages.findIndex(item => String(item.id) === String(message.id));
      if (index >= 0) messages[index] = message;
      else messages.push(message);
      state.messages = messages;
      const element = document.querySelector(`[data-mid="${CSS.escape(String(message.id))}"]`);
      if (element) element.outerHTML = messageHTML(message);
    }
  } catch (error) {
    toast(error.message || "Could not send reaction.");
  }
}

async function pinMsg(id) {
  try {
    await api(
      `/api/messages/${id}/pin`,
      {
        method: "POST"
      }
    );
  } catch (error) {
    toast(error.message);
  }
}

async function saveMsg(id) {
  try {
    const data =
      await api(
        `/api/messages/${id}/save`,
        {
          method: "POST"
        }
      );

    toast(data.saved ? "Message saved" : "Removed from saved");
    if(state.view==='saved') await loadSavedMessages();
  } catch (error) {
    toast(error.message);
  }
}

async function reportMsg(id) {
  const reason =
    prompt(
      "Reason for report:",
      "Rule breaking message"
    );

  if (reason === null) return;

  try {
    await api(
      `/api/messages/${id}/report`,
      {
        method: "POST",
        body: JSON.stringify({
          category: "Other",
          reason
        })
      }
    );

    toast("Report submitted.");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- USERS ---------------- */

function getUserAge(user){
  const raw=user?.birthDate||user?.dateOfBirth||user?.birth_date;
  if(!raw)return null;
  const date=new Date(raw);
  if(Number.isNaN(date.getTime()))return null;
  const now=new Date();
  let age=now.getFullYear()-date.getFullYear();
  if(now.getMonth()<date.getMonth()||(now.getMonth()===date.getMonth()&&now.getDate()<date.getDate()))age--;
  return age>=0&&age<=120?age:null;
}
async function loadUsers() {
  try {
    const query=$("userSearch")?.value.trim()||"";
    const data=await api(`/api/users?q=${encodeURIComponent(query)}`);
    state.roomRankByUser={};
    if(state.currentRoom){
      try{const roomStaff=await api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/staff`);for(const item of (roomStaff.staff||[])){if(item.user?.id)state.roomRankByUser[String(item.user.id)]=item.role;}}catch{}
    }
    const selectedRank=$("userRankFilter")?.value||"";
    const selectedGender=$("userGenderFilter")?.value||"";
    const countryQuery=($("userCountryFilter")?.value||"").trim().toLowerCase();
    const minRaw=$("userAgeMin")?.value, maxRaw=$("userAgeMax")?.value;
    const minAge=minRaw===""||minRaw==null?null:Number(minRaw),maxAge=maxRaw===""||maxRaw==null?null:Number(maxRaw);
    let filtered=(data.users||[]).filter(user=>{
      if(selectedRank&&String(user.rank||"").toUpperCase()!==selectedRank)return false;
      if(selectedGender&&String(user.gender||"").toLowerCase()!==selectedGender.toLowerCase())return false;
      if(countryQuery&&!String(user.location||"").toLowerCase().includes(countryQuery))return false;
      const age=getUserAge(user);
      if(minAge!==null&&(age===null||age<minAge))return false;
      if(maxAge!==null&&(age===null||age>maxAge))return false;
      return true;
    });
    const sortBy=$("userSortBy")?.value||"default";
    const rankValue=u=>rankOrder[String(u.rank||"").toUpperCase()]??-1;
    filtered.sort((a,b)=>{
      if(sortBy==="rank")return rankValue(b)-rankValue(a)||a.username.localeCompare(b.username);
      if(sortBy==="age-asc")return (getUserAge(a)??999)-(getUserAge(b)??999)||a.username.localeCompare(b.username);
      if(sortBy==="age-desc")return (getUserAge(b)??-1)-(getUserAge(a)??-1)||a.username.localeCompare(b.username);
      if(sortBy==="name")return a.username.localeCompare(b.username);
      if(sortBy==="country")return String(a.location||"").localeCompare(String(b.location||""))||a.username.localeCompare(b.username);
      if(sortBy==="newest")return (new Date(b.createdAt||0).getTime()||0)-(new Date(a.createdAt||0).getTime()||0);
      if(sortBy==="active")return (Number(b.lastActive||b.lastSeen||0)||new Date(b.lastActive||b.lastSeen||0).getTime()||0)-(Number(a.lastActive||a.lastSeen||0)||new Date(a.lastActive||a.lastSeen||0).getTime()||0);
      return (Number(b.online)-Number(a.online))||rankValue(b)-rankValue(a)||a.username.localeCompare(b.username);
    });
    const invisible=filtered.filter(user=>user.invisible);
    const online=filtered.filter(user=>user.online&&!user.invisible);
    const offline=filtered.filter(user=>!user.online&&!user.invisible);
    $("users").innerHTML=`${online.length?`<section class="user-presence-section"><h3>🟢 Online users <small>${online.length}</small></h3><div class="user-grid">${online.map(userCard).join("")}</div></section>`:""}${offline.length?`<section class="user-presence-section"><h3>⚪ Offline users <small>${offline.length}</small></h3><div class="user-grid">${offline.map(userCard).join("")}</div></section>`:""}${invisible.length?`<section class="user-presence-section"><h3>🟢 Invisible mode <small>${invisible.length}</small></h3><div class="user-grid">${invisible.map(userCard).join("")}</div></section>`:""}`||`<div class="room-empty"><div>🔎</div><b>No users match these filters</b><span>Try changing the rank, age, gender or location.</span></div>`;
  } catch(error){toast(error.message);}
}
$("userSearch").oninput=()=>loadUsers();
["userRankFilter","userGenderFilter","userAgeMin","userAgeMax","userCountryFilter","userSortBy"].forEach(id=>$ (id)?.addEventListener("input",()=>loadUsers()));
["userRankFilter","userGenderFilter","userSortBy"].forEach(id=>$ (id)?.addEventListener("change",()=>loadUsers()));
$("resetUserFilters")?.addEventListener("click",()=>{
  ["userSearch","userCountryFilter","userAgeMin","userAgeMax"].forEach(id=>{if($(id))$(id).value="";});
  ["userRankFilter","userGenderFilter"].forEach(id=>{if($(id))$(id).value="";});
  if($("userSortBy"))$("userSortBy").value="default";
  loadUsers();
});
function invisibleDot(user){return user?.invisible?'<i class="invisible-staff-dot" title="Invisible mode active"></i>':'';}
function invisibleToggleMarkup(user,compact=false){
  if(String(user?.id)!==String(state.user?.id)||!canFeature("invisible_mode"))return "";
  const enabled=!!user.invisible;
  return `<button type="button" class="mini invisible-mode-toggle" title="${enabled?"Turn invisible mode off":"Turn invisible mode on"}" aria-label="Toggle invisible mode" onclick="toggleInvisibleMode(event)">${enabled?"😈":"👿"}${compact?"":" "+(enabled?"Invisible on":"Invisible off")}</button>`;
}
async function toggleInvisibleMode(event){
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if(!canFeature("invisible_mode")){toast("Your rank has not been granted invisible mode.");return;}
  const enabled=!state.user?.invisible;
  try{
    const result=await api("/api/me/invisible",{method:"POST",body:JSON.stringify({enabled})});
    state.user.invisible=!!result.invisible;
    toast(state.user.invisible?"Invisible mode enabled. Staff can still see you.":"Invisible mode disabled.");
    await Promise.all([loadUsers().catch(()=>{}),renderOnline(onlinePanelTab).catch(()=>{})]);
  }catch(error){toast(error.message||"Could not change invisible mode.");}
}

function userCard(user) {
  const displayName = user.displayName || user.username || "User";
  const onlineNow = !!(user.online || user.isOnline || user.status === "online");
  return `
    <article class="user-card instagram-user-card horizontal-user-card" role="button" tabindex="0"
      onclick="openQuickUserCard('${esc(user.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openQuickUserCard('${esc(user.id)}')}"
      aria-label="Open actions for ${esc(displayName)}">
      <span class="instagram-avatar-ring">${avatar(user)}</span>
      <span class="horizontal-user-details">
        <b class="instagram-user-name">${esc(displayName)}</b>
        <small class="instagram-user-handle">@${esc(user.username)} ${invisibleDot(user)}</small>
        <span class="instagram-user-rank">${({ROOM_MODERATOR:"🛡️ Room Moderator",ROOM_ADMIN:"👑 Room Admin",ROOM_OWNER:"🎩 Room Owner"})[state.roomRankByUser?.[String(user.id)]] ? esc(({ROOM_MODERATOR:"🛡️ Room Moderator",ROOM_ADMIN:"👑 Room Admin",ROOM_OWNER:"🎩 Room Owner"})[state.roomRankByUser[String(user.id)]]) : rank(user.rank)}</span>
        <span class="instagram-user-meta"><span class="instagram-presence-dot ${onlineNow ? "is-online" : ""}"></span>${onlineNow ? "Online" : "Member"} <span>·</span> Lv ${Number(user.level || 1)}</span>
      </span>
      <span class="horizontal-user-chevron" aria-hidden="true">›</span>
    </article>
  `;
}

async function openQuickUserCard(id){
  // Render immediately from chat data so the card still opens if an older
  // deployed server does not yet expose the profile endpoint.
  const message=(state.messages||[]).find(m=>String(m.userId)===String(id));
  const localUser=message?{
    id:message.userId,username:message.username,displayName:message.displayName,
    rank:message.rank,avatar:message.avatar||"",level:message.level||1,
    age:message.age,gender:message.gender,countryFlag:message.countryFlag||message.flag||""
  }:null;
  let user=localUser, data={likedByMe:false,profileLikes:0};
  try{
    const response=await api(`/api/users/${encodeURIComponent(id)}/profile`);
    if(response.user){user={...localUser,...response.user};data=response;}
  }catch(error){
    if(!user){toast(error.message);return;}
  }
  if(!user){toast("User details are not available in this chat.");return;}
  const isSelf=String(user.id)===String(state.user.id);
  const countryFlag=user.countryFlag||user.flag||"";
  modal(`<div class="quick-user-card">
    <div class="quick-user-top"><span class="quick-user-level">⭐ ${Number(user.level||1)}</span><button class="quick-user-close" onclick="closeModal()" aria-label="Close">×</button>
    <div class="quick-user-avatar">${avatar(user)}</div><h2>${esc(user.displayName||user.username)}</h2>
    <p>${esc(user.age?user.age+" years":(user.dateOfBirth?"Member":""))}${user.gender?" · "+esc(user.gender):""}</p>${countryFlag?`<div class="quick-user-flag">${esc(countryFlag)}</div>`:""}
    <small>@${esc(user.username)}</small></div>
    <button class="quick-user-row" id="quickViewProfile"><span>👤</span><b>View profile</b><i>›</i></button>
    ${!isSelf?`<button class="quick-user-row" id="quickPrivate"><span>🟢</span><b>Private</b><i>›</i></button><button class="quick-user-row" id="quickAction"><span>✔️</span><b>Action</b><i>›</i></button>`:`<button class="quick-user-row" id="quickAction"><span>⚙️</span><b>Account actions</b><i>›</i></button>`}
  </div>`);
  $('quickViewProfile')?.addEventListener('click',()=>{closeModal();openUser(user.id)});
  $('quickPrivate')?.addEventListener('click',()=>{closeModal();openDM(user.id)});
  $('quickAction')?.addEventListener('click',()=>{closeModal();openProfileActionDrawer(user,data)});
}

async function openUser(id) {
  try {
    const data = await api(`/api/users/${encodeURIComponent(id)}/profile`);
    const user=data.user;
    try { const nr=await api(`/api/friends/${encodeURIComponent(id)}/nickname`); user._nickname=nr.nickname||nr.nicknameFromOther||''; } catch {} if(!user) return;
    renderUserProfileModal(user,data);
  } catch(error){ toast(error.message); }
}

function renderUserProfileModal(user,data={}){
  // Resolve equipped cosmetics locally for the viewed user's profile. These variables
  // previously existed only inside loadProfile(), causing a ReferenceError here.
  const cosmetics=Array.isArray(user.equippedCosmetics)?user.equippedCosmetics:[];
  const frame=cosmetics.find(x=>x.category==='frame');
  const profileBadge=cosmetics.find(x=>x.category==='badge');
  const memberSince=user.createdAt?new Date(user.createdAt).toLocaleDateString():'Unknown';
  const lastSeen=user.privacy?.lastSeen!==false&&user.lastSeen?new Date(user.lastSeen).toLocaleString():'Hidden';
  const bannerStyle=user.banner?`style="background-image:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.78)),url('${esc(user.banner)}')"`:'';
  const isSelf=user.id===state.user.id;
  const liked=!!data.likedByMe;
  modal(`<div class="profile-modal">
    <div class="profile-banner" ${bannerStyle}>
      <div class="profile-stats"><span class="profile-stat">⭐ ${user.level||1}</span><span class="profile-stat">XP ${user.xp||0}</span><span class="profile-stat">❤️ ${user.profileLikes||data.profileLikes||0}</span><button class="mini profile-hamburger" id="profileMenuBtn" title="Profile actions">☰</button>${!isSelf && (state.user?.username==="Maleficent" || canFeature("staff_rank_assignment")) ? `<button class="mini profile-rank-btn" id="profileRankBtn">🏅 Rank</button>` : ""}</div>
      <div class="equipped-profile-frame ${frame?esc(frame.id):''}" title="${frame?esc(frame.name):'Profile avatar'}">${avatar(user,'big-avatar')}</div>
      <div class="profile-rank">${rank(user.rank)}${user.verified?' · ✓ Verified':''}${profileBadge?` <span class="equipped-profile-badge" title="${esc(profileBadge.name)}">${esc(profileBadge.icon)} ${esc(profileBadge.name)}</span>`:''}</div>
      <div class="profile-name">${esc(user.displayName)}${user._nickname?` <span class="nickname-badge">“${esc(user._nickname)}”</span>`:''}</div>
      <div class="profile-handle">@${esc(user.username)}</div>
    </div>
    <div class="profile-tabs">
      <button class="profile-tab active" data-tab="info">Account</button>
      <button class="profile-tab" data-tab="about">About Me</button>
      <button class="profile-tab" data-tab="friends">Friends</button>
      <button class="profile-tab" data-tab="more">More</button>
    </div>
    <div id="profileTabContent" class="profile-info"></div>
  </div>`);
  const renderTab=(tab)=>{
    document.querySelectorAll('.profile-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    const box=$('profileTabContent');
    if(tab==='info') box.innerHTML=`
      <div class="profile-info-row"><b>👤 Username</b><span>@${esc(user.username)}</span></div>
      <div class="profile-info-row"><b>🏅 Rank</b><span>${rank(user.rank)}</span></div>
      <div class="profile-info-row"><b>⭐ Level</b><span>${user.level||1} · ${user.xp||0} XP · 🪙 ${user.gold||0}</span></div>
      <div class="profile-info-row"><b>📅 Member since</b><span>${esc(memberSince)}</span></div>
      <div class="profile-info-row"><b>🏠 Status</b><span>${user.online?'Online':'Offline'}</span></div>
      <div class="profile-info-row"><b>◉ Last seen</b><span>${esc(lastSeen)}</span></div>
      <div class="profile-actions"><button class="mini" id="profileAchievementsBtn">🏆 Achievements</button>${!isSelf&&canFeature('profile_note')?`<button class="mini" id="profileNoteBtn">📝 Add Note <span id="profileNoteDot" style="display:none">●</span></button>`:''}<div class="profile-action-hint">Tap ☰ above for profile actions.</div></div>`;
    else if(tab==='about') box.innerHTML=`<div class="about-card"><h3>About Me</h3><p>${esc(user.bio||'This user has not written an About Me yet.')}</p>${user.pronouns?`<div class="profile-info-row"><b>Pronouns</b><span>${esc(user.pronouns)}</span></div>`:''}${user.interests?.length?`<div class="tag-list">${user.interests.map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div>`:''}${isSelf?`<button class="primary" id="editAboutBtn">✏️ Edit About Me</button>`:''}</div>`;
    else if(tab==='friends') box.innerHTML=`<div class="about-card"><h3>Friends</h3><p class="muted">Friends and social connections for @${esc(user.username)}.</p><div class="profile-info-row"><b>👥 Friends</b><span>${user.friendsCount||0}</span></div><button class="mini" id="viewFriendsBtn">Open Friends</button></div>`;
    else box.innerHTML=`<div class="about-card"><div class="profile-info-row"><b>📝 About</b><span>${esc(user.bio||'No About Me')}</span></div><div class="profile-info-row"><b>📜 Username history</b><span>${(user.usernameHistory||[]).length} changes</span></div><div class="profile-info-row"><b>🔗 Profile ID</b><span>${esc(user.id)}</span></div>${can('MOD')&&canAccessStaffTarget(user)?`<div class="toolbar"><button class="mini" id="profileHistoryBtn">📜 Staff action history</button><button class="mini" id="profileIpInsightsBtn">🔎 View insights</button></div><div id="profileHistoryBox"></div>`:''}<div class="profile-actions">${!isSelf?'<button class="mini danger" id="profileReportBtn">⚑ Report user</button>':''}</div></div>`;
    if(tab==='more' && can('MOD')) $('profileHistoryBtn')?.addEventListener('click',()=>showUserActionHistory(user.id));
    if(tab==='more' && can('MOD') && !isSelf) $('profileIpInsightsBtn')?.addEventListener('click',()=>showIpInsights(user));
    if(tab==='info'&&!isSelf&&canFeature('profile_note'))api(`/api/staff/user/${encodeURIComponent(user.id)}/note`).then(n=>{if($('profileNoteDot'))$('profileNoteDot').style.display=n.hasNote?'inline-block':'none';}).catch(()=>{});
    wireProfileTabActions();
  };
  function wireProfileTabActions(){
    $('profileAchievementsBtn')?.addEventListener('click',()=>showAchievements(user));
    $('profileNoteBtn')?.addEventListener('click',()=>staffProfileNoteModal(user));
    $('selfAchievementsBtn')?.addEventListener('click',()=>showAchievements(user));
    $('profileLikeBtn')?.addEventListener('click',async()=>{try{const r=await api(`/api/users/${user.id}/like`,{method:'POST'});data.likedByMe=r.liked;user.profileLikes=r.likes;$('profileLikeBtn').innerHTML=`${r.liked?'❤️ Unlike':'❤️ Like'} <span id="likeCount">${r.likes}</span>`;document.querySelector('.profile-stats .profile-stat:last-child').textContent=`❤️ ${r.likes}`;}catch(e){toast(e.message)}});
    $('profileMessageBtn')?.addEventListener('click',()=>{closeModal();openDM(user.id);});
    $('profileFriendBtn')?.addEventListener('click',async()=>{if(data.friendship==='ACCEPTED'){toast('Already friends.');return;}try{await friend(user.id);data.friendship='PENDING';renderTab('info');}catch(e){}});
    $('profileBlockBtn')?.addEventListener('click',async()=>{await block(user.id);closeModal();});
    $('profileGoldBtn')?.addEventListener('click',()=>shareGoldModal(user));
    $('profileNicknameBtn')?.addEventListener('click',()=>nicknameModal(user));
    $('profileModerateBtn')?.addEventListener('click',()=>moderate(user.id));
    $('profileStaffAccountBtn')?.addEventListener('click',()=>staffAccountModal(user));
    $('profileMenuBtn')?.addEventListener('click',()=>openProfileActionDrawer(user,data));
    $('profileRankBtn')?.addEventListener('click',()=>rankFromProfile(user));
    $('editProfileFromModal')?.addEventListener('click',()=>{closeModal();state.view='profile';renderView();});
    $('editAboutBtn')?.addEventListener('click',()=>{modal(`<h2>Edit About Me</h2><textarea id="aboutEdit" rows="7">${esc(state.user.bio||'')}</textarea><div class="toolbar"><button class="primary" id="saveAbout">Save</button></div>`);$('saveAbout').onclick=async()=>{try{const r=await api('/api/profile',{method:'PUT',body:JSON.stringify({bio:$('aboutEdit').value})});state.user=r.user;closeModal();toast('About Me saved.');}catch(e){toast(e.message)}};});
    $('viewFriendsBtn')?.addEventListener('click',()=>{closeModal();state.view='friends';renderView();});
    $('profileReportBtn')?.addEventListener('click',()=>{const reason=prompt('Why are you reporting this user?','Rule breaking behavior');if(reason)api('/api/reports',{method:'POST',body:JSON.stringify({target:user.id,reason})}).then(()=>toast('Report submitted.')).catch(e=>toast(e.message));});
  }
  document.querySelectorAll('.profile-tab').forEach(b=>b.addEventListener('click',()=>renderTab(b.dataset.tab)));
  renderTab('info');
}

async function friend(id) {
  try {
    await api(
      `/api/friends/${id}/request`,
      {
        method: "POST"
      }
    );

    toast("Friend request sent.");
  } catch (error) {
    toast(error.message);
  }
}

async function block(id) {
  try {
    await api(
      `/api/users/${id}/block`,
      {
        method: "POST"
      }
    );

    toast("User blocked.");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- FRIENDS ---------------- */

async function loadFriends() {
  try {
    const data=await api("/api/friends");
    const friends=data.users||[], incoming=data.incoming||[], outgoing=data.outgoing||[];
    $("friends").innerHTML=`
      <div class="social-summary">
        <div><b>${friends.length}</b><span>Friends</span></div>
        <div><b>${incoming.length}</b><span>Requests</span></div>
        <div><b>${outgoing.length}</b><span>Pending</span></div>
      </div>
      ${incoming.length?`<section class="card social-section"><div class="section-title"><h3>Incoming requests</h3></div>${incoming.map(u=>`
        <div class="friend-row">${avatar(u)}<div class="friend-copy"><b>${esc(u.displayName)}</b><small>@${esc(u.username)} · ${rank(u.rank)}</small></div><div class="toolbar"><button class="mini primary" onclick="acceptFriend('${esc(u.id)}')">Accept</button><button class="mini danger" onclick="removeFriend('${esc(u.id)}')">Decline</button></div></div>`).join("")}</section>`:""}
      <section class="card social-section"><div class="section-title"><h3>Your friends</h3><button class="mini" onclick="state.view='users';document.querySelectorAll('.nav[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view==='users'));renderView()">Find people</button></div>
      ${friends.map(u=>`<div class="friend-row">${avatar(u)}<div class="friend-copy"><b>${esc(u.displayName)}</b><small>@${esc(u.username)} · ${u.online?"Online":"Offline"} · ${rank(u.rank)}</small></div><div class="toolbar"><button class="mini" onclick="openUser('${esc(u.id)}')">Profile</button><button class="mini" onclick="openDM('${esc(u.id)}')">Message</button><button class="mini danger" onclick="removeFriend('${esc(u.id)}')">Remove</button></div></div>`).join("")||`<div class="room-empty"><div>💜</div><b>No friends yet</b><span>Add people from the Users panel.</span></div>`}</section>
      ${outgoing.length?`<section class="card social-section"><div class="section-title"><h3>Pending requests</h3></div>${outgoing.map(u=>`<div class="friend-row">${avatar(u)}<div class="friend-copy"><b>${esc(u.displayName)}</b><small>@${esc(u.username)} · Waiting for response</small></div><button class="mini danger" onclick="removeFriend('${esc(u.id)}')">Cancel</button></div>`).join("")}</section>`:""}
    `;
  } catch (error) { toast(error.message); }
}

async function acceptFriend(id){
  try{await api(`/api/friends/${encodeURIComponent(id)}/accept`,{method:"POST"});toast("Friend request accepted.");await loadFriends();if(state.currentRoom)renderOnline("friends");}catch(e){toast(e.message)}
}
async function removeFriend(id){
  if(!confirm("Remove this friendship/request?")) return;
  try{await api(`/api/friends/${encodeURIComponent(id)}`,{method:"DELETE"});toast("Updated.");await loadFriends();if(state.currentRoom)renderOnline("friends");}catch(e){toast(e.message)}
}

/* ---------------- PRIVATE MESSAGES ---------------- */

function dmPrefs(){try{return JSON.parse(safeStorage.getItem("mc_dm_prefs_"+String(state.user?.id||"guest"))||"{}")}catch{return {}}}
function saveDMPrefs(p){safeStorage.setItem("mc_dm_prefs_"+String(state.user?.id||"guest"),JSON.stringify(p))}
function dmSetPref(kind,id,value){const p=dmPrefs();p[kind]=p[kind]||{};if(value)p[kind][String(id)]=true;else delete p[kind][String(id)];saveDMPrefs(p)}
async function loadDMList() {
  try {
    const data=await api("/api/dm/conversations");
    const conversations=data.conversations||[];
    const privateNicknames=(await api('/api/private-nicknames').catch(()=>({nicknames:{}}))).nicknames||{};
    const prefs=dmPrefs();
    const activeTab=safeStorage.getItem("mc_dm_tab_"+String(state.user?.id||""))||"all";
    const card=c=>{
      const id=String(c.user.id),nick=privateNicknames[id],name=nick||c.user.displayName||c.user.username;
      const last=c.lastMessage||{},preview=last.attachment?"📎 Attachment":(last.text||"Start a conversation");
      const unread=Number(c.unreadCount||0),pinned=!!prefs.pinned?.[id],archived=!!prefs.archived?.[id],muted=!!prefs.muted?.[id];
      return `<div class="user-card dm-contact-card dm-inbox-card ${pinned?'dm-is-pinned':''}" data-dm-user="${esc(id)}">
        ${avatar(c.user)}<div class="dm-contact-copy"><div class="dm-inbox-title"><b>${esc(name)}</b>${unread?'<span class="dm-unread-badge">'+unread+'</span>':''}</div>
        <small>@${esc(c.user.username)} ${c.user.online?'<i class="is-online"></i>':''}</small><small class="dm-preview">${esc(preview).slice(0,90)}</small>
        </div><div class="dm-inbox-actions"><button class="mini" data-dm-pref="pinned" data-id="${esc(id)}" title="Pin conversation">${pinned?'📌':'＋'}</button><button class="mini" data-dm-pref="muted" data-id="${esc(id)}" title="Mute notifications">${muted?'🔕':'🔔'}</button><button class="mini" data-dm-pref="archived" data-id="${esc(id)}" title="Archive conversation">${archived?'↩':'▣'}</button><button class="primary" onclick="openDM('${esc(id)}')">Chat</button></div>
      </div>`;
    };
    const searchBox='<div class="dm-inbox-toolbar"><input id="dmInboxSearch" placeholder="Search conversations…" autocomplete="off"><div class="dm-inbox-tabs">'+[['all','All'],['unread','Unread'],['pinned','Pinned'],['archived','Archived']].map(([v,l])=>'<button class="mini '+(activeTab===v?'active':'')+'" data-dm-tab="'+v+'">'+l+'</button>').join('')+'</div></div>';
    const render=()=>{
      const q=($("dmInboxSearch")?.value||"").trim().toLowerCase(),p=dmPrefs();
      let rows=conversations.filter(c=>{const id=String(c.user.id),name=(privateNicknames[id]||c.user.displayName||c.user.username)+" "+c.user.username,unread=Number(c.unreadCount||0)>0,pinned=!!p.pinned?.[id],archived=!!p.archived?.[id];
        if(activeTab==="unread"&&!unread)return false;if(activeTab==="pinned"&&!pinned)return false;if(activeTab==="archived"&&!archived)return false;if(activeTab!=="archived"&&activeTab!=="all"&&archived)return false;
        return name.toLowerCase().includes(q)||(c.lastMessage?.text||"").toLowerCase().includes(q);
      });
      rows.sort((a,b)=>Number(!!p.pinned?.[String(b.user.id)])-Number(!!p.pinned?.[String(a.user.id)]));
      const list=rows.map(card).join('');
      $("dmList").innerHTML=searchBox+'<div class="dm-inbox-list">'+(list||'<p class="muted dm-empty">No conversations here yet.</p>')+'</div>';
      $("dmInboxSearch").value=q;
      $("dmInboxSearch").addEventListener("input",()=>{const val=$("dmInboxSearch").value;render();const el=$("dmInboxSearch");el.focus();el.setSelectionRange(val.length,val.length)});
      document.querySelectorAll("[data-dm-tab]").forEach(btn=>btn.addEventListener("click",()=>{safeStorage.setItem("mc_dm_tab_"+String(state.user?.id||""),btn.dataset.dmTab);loadDMList()}));
      document.querySelectorAll("[data-dm-pref]").forEach(btn=>btn.addEventListener("click",()=>{const kind=btn.dataset.dmPref,id=btn.dataset.id,p=dmPrefs();dmSetPref(kind,id,!p[kind]?.[id]);loadDMList()}));
    };
    render();
    const search=async()=>{const q=$("dmUserSearch").value.trim();if(!q){$("dmSearchResults").innerHTML='';return;}const u=await api(`/api/users?q=${encodeURIComponent(q)}`);$("dmSearchResults").innerHTML=(u.users||[]).filter(x=>x.id!==state.user.id&&x.username.toLowerCase().includes(q.toLowerCase())).map(x=>`<div class="user-card">${avatar(x)}<div style="flex:1"><b>${esc(x.displayName)}</b><small>@${esc(x.username)}</small></div><button class="primary" onclick="openDM('${esc(x.id)}')">Chat</button></div>`).join('')||'<p class="muted">No matching username.</p>';};
    if($("dmSearchBtn"))$("dmSearchBtn").onclick=search;
    if($("dmUserSearch"))$("dmUserSearch").onkeydown=e=>{if(e.key==='Enter')search()};
  } catch (error) { toast(error.message); }
}

function dmMessageHTML(message, messages, user) {
  const quoted = message.replyTo
    ? messages.find(m => String(m.id) === String(message.replyTo))
    : null;

  const quoteAuthor = quoted
    ? (quoted.from === state.user.id ? "You" : user.displayName)
    : null;

  const quoteText = quoted
    ? (quoted.text || (quoted.attachment ? "📎 Attachment" : "Message"))
    : null;

  return `
    <div
      class="msg dm-msg ${message.from === state.user.id ? "mine" : "theirs"}"
      data-dmid="${esc(message.id)}"
    >
      <div class="msg-body">
        <div class="msg-top">
          <b class="message-author" style="color:${esc(user.settings?.usernameColor||'var(--username-color)')}">${message.from === state.user.id ? "You" : esc(user.displayName)}</b>
          <span class="msg-time">
            ${fmt(message.time)}
            ${message.read ? " · read" : " · delivered"}
          </span>
        </div>

        ${
          message.replyTo
            ? `
              <div
                class="quoted dm-quoted"
                onclick="jumpToDMMessage('${esc(message.replyTo)}')"
                title="Jump to original message"
              >
                <div class="quoted-label">
                  ↪ ${esc(quoteAuthor || "Original message")}
                </div>
                <div class="quoted-text">
                  ${esc(quoteText || "Original message is no longer visible")}
                </div>
              </div>
            `
            : ""
        }

        ${
          message.text && !message.youtube?.videoId
            ? `<div class="msg-text">${esc(message.text)}</div>`
            : ""
        }

        ${
          message.attachment
            ? `
              <a
                href="${esc(message.attachment.url)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                📎 ${esc(message.attachment.name || "Attachment")}
              </a>
            `
            : ""
        }

        <div class="msg-actions">
          <button
            type="button"
            class="mini"
            onclick="replyDMMsg('${esc(message.id)}','${esc(user.id)}')"
          >
            Quote
          </button>
        </div>
      </div>
    </div>
  `;
}

async function openDM(id) {
  try {
    const users = await api("/api/users");
    const user = (users.users || []).find(x => String(x.id) === String(id));

    if (!user) {
      toast("User not found.");
      return;
    }

    state.dmUserId = id;

    const data = await api(`/api/dm/${id}`);
    const messages = data.messages || [];
    state.dmMessages = messages;

    const nickData=(await api('/api/private-nicknames').catch(()=>({nicknames:{}}))).nicknames||{};
    const privateNickname=nickData[String(user.id)]||'';
    modal(`
      <div class="dm-chat-header">
        <div class="dm-chat-person">${avatar(user)}<div class="dm-chat-person-copy"><h2>${esc(privateNickname||user.displayName)}</h2><span>@${esc(user.username)} · <i class="${user.online?'is-online':'is-offline'}"></i> ${user.online?'Online':'Offline'}</span></div></div>
        <div class="dm-chat-actions"><button type="button" class="mini dm-settings-toggle" id="dmChatSettingsBtn" title="Conversation settings" aria-expanded="false">⚙️</button><button type="button" class="mini" id="dmCloseBtn" title="Close conversation">×</button><div class="dm-settings-menu hidden" id="dmChatSettingsMenu">
<button type="button" data-dm-action="nickname">✏️ <span><b>Nickname</b><small>Set a private nickname</small></span></button>
<button type="button" data-dm-action="ignore">🚫 <span><b>Ignore</b><small>Block this user</small></span></button>
<button type="button" data-dm-action="mute">🔕 <span><b>Mute</b><small>Mute conversation notifications</small></span></button>
<button type="button" data-dm-action="archive">▣ <span><b>Archive</b><small>Move conversation to Archived</small></span></button>
<button type="button" data-dm-action="report">⚑ <span><b>Report</b><small>Report this conversation</small></span></button></div></div>
      </div>
      <div class="dm-message-search"><span>⌕</span><input id="dmMessageSearch" placeholder="Search in this conversation…" autocomplete="off"><small id="dmSearchCount">${messages.length} messages</small></div>
      <div class="dm-conversation-tools"><span>🔒 Private conversation</span><span id="dmTypingStatus" aria-live="polite">Quote a message to reply · Attach photos or files</span></div>
      <div
        id="dmMessages"
        class="messages dm-message-list"
        style="height:45vh"
      >
        ${
          messages.length
            ? messages.map(message => dmMessageHTML(message, messages, user)).join("")
            : `<p class="muted">No private messages yet.</p>`
        }
      </div>

      ${
        state.dmReplyTo
          ? `
            <div class="dm-replybar">
              <div class="dm-reply-content">
                <div>
                  <strong>
                    ↪ Replying to ${esc(state.dmReplyAuthor || user.displayName)}
                  </strong>
                  <div class="dm-reply-preview">
                    ${esc(state.dmReplyText || "Original message")}
                  </div>
                </div>
                <button
                  type="button"
                  class="mini danger"
                  onclick="cancelDMReply()"
                >
                  ✕
                </button>
              </div>
            </div>
          `
          : ""
      }

      <div class="dm-quick-replies" aria-label="Quick emoji">
        <button type="button" data-dm-emoji="❤️">❤️</button><button type="button" data-dm-emoji="😂">😂</button><button type="button" data-dm-emoji="😭">😭</button><button type="button" data-dm-emoji="✨">✨</button><button type="button" data-dm-emoji="👍">👍</button>
      </div>
      <form id="dmForm" class="composer dm-composer">
        <label class="dm-upload-btn" title="Attach photo, audio, video or file">📎
          <input id="dmFile" type="file" accept="image/*,audio/*,video/*,.pdf,.txt" hidden>
        </label>
        <span id="dmFileName" class="muted dm-file-name"></span>
        <input id="dmText" placeholder="Write a private message…" maxlength="4000" autocomplete="off">
        <button class="send" type="submit">Send ↗</button>
      </form>
    `);

    const dmTargetId=String(user.id),dmSettings=$('dmChatSettingsMenu'),dmSettingsBtn=$('dmChatSettingsBtn');
    dmSettingsBtn?.addEventListener('click',()=>{dmSettings?.classList.toggle('hidden');dmSettingsBtn.setAttribute('aria-expanded',String(!dmSettings?.classList.contains('hidden')));});
    $('dmCloseBtn')?.addEventListener('click',closeModal);
    dmSettings?.querySelectorAll('[data-dm-action]').forEach(btn=>btn.addEventListener('click',async()=>{
      const action=btn.dataset.dmAction;dmSettings.classList.add('hidden');
      if(action==='nickname'){modal(`<h2>Set nickname for this user</h2><p class="muted">Only you can see this nickname. Their username and account identity stay unchanged.</p><input id="privateNicknameInput" maxlength="50" value="${esc(privateNickname)}" placeholder="Private nickname"><div class="toolbar"><button class="primary" id="savePrivateNicknameBtn">Save</button></div>`);$('savePrivateNicknameBtn').onclick=async()=>{try{await api('/api/private-nickname',{method:'POST',body:JSON.stringify({targetId:user.id,nickname:$('privateNicknameInput').value.trim()})});closeModal();openDM(user.id);}catch(e){toast(e.message)}};return;}
      if(action==='ignore'){try{await block(user.id);closeModal();toast('User ignored.');}catch(e){toast(e.message)}return;}
      if(action==='mute'){const muted=!!dmPrefs().muted?.[dmTargetId];dmSetPref('muted',dmTargetId,!muted);toast(muted?'Conversation unmuted.':'Conversation muted.');return;}
      if(action==='archive'){const archived=!!dmPrefs().archived?.[dmTargetId];dmSetPref('archived',dmTargetId,!archived);closeModal();toast(archived?'Conversation unarchived.':'Conversation archived.');return;}
      if(action==='report'){const reason=prompt('Reason for reporting this private conversation:','Inappropriate private message');if(reason===null)return;try{await api('/api/report',{method:'POST',body:JSON.stringify({reportedUserId:user.id,conversationWithId:state.user.id,reason})});toast('Report submitted.');}catch(e){toast(e.message)}}
    }));
    const box = $("dmMessages");
    if (box) box.scrollTop = box.scrollHeight;
    const dmSearch=$("dmMessageSearch");
    dmSearch?.addEventListener("input",()=>{
      const q=dmSearch.value.trim().toLowerCase();
      let visible=0;
      box?.querySelectorAll(".dm-msg").forEach(node=>{
        const match=!q||node.textContent.toLowerCase().includes(q);
        node.hidden=!match;
        if(match) visible++;
      });
      if($("dmSearchCount")) $("dmSearchCount").textContent=q?(`${visible} match${visible===1?"":"es"}`):(`${messages.length} messages`);
    });
    document.querySelectorAll("[data-dm-emoji]").forEach(button=>button.addEventListener("click",()=>{
      const input=$("dmText"); if(!input)return;
      const start=input.selectionStart??input.value.length, end=input.selectionEnd??input.value.length, emoji=button.dataset.dmEmoji;
      input.value=input.value.slice(0,start)+emoji+input.value.slice(end);
      input.focus(); input.setSelectionRange(start+emoji.length,start+emoji.length);
    }));

    try {
      await api(`/api/dm/${id}/read`, { method: "POST" });
    } catch {}

    $("dmFile")?.addEventListener("change",()=>{
      const f=$("dmFile").files?.[0];
      if($("dmFileName")) $("dmFileName").textContent=f?`📎 ${f.name}`:"";
    });

    const draftKey="mc_dm_draft_"+String(state.user?.id||"")+"_"+String(id);
    const dmInput=$("dmText");
    if(dmInput){dmInput.value=safeStorage.getItem(draftKey)||"";dmInput.addEventListener("input",()=>{if(dmInput.value)safeStorage.setItem(draftKey,dmInput.value);else safeStorage.removeItem(draftKey);if(state.socket?.connected)state.socket.emit("dm-typing",{userId:id,user:state.user?.displayName||state.user?.username,typing:!!dmInput.value.trim()});});}
    $("dmForm").onsubmit = async e => {
      e.preventDefault();
      const input = $("dmText");
      const file = $("dmFile")?.files?.[0];
      const text = input.value.trim();
      if (!text && !file) return;
      try {
        const fd = new FormData();
        fd.append("text", text);
        if (state.dmReplyTo) fd.append("replyTo", state.dmReplyTo);
        if (file) fd.append("file", file);
        await api(`/api/dm/${encodeURIComponent(id)}`, {method:"POST",body:fd});
        input.value=""; safeStorage.removeItem(draftKey); if(state.socket?.connected)state.socket.emit("dm-typing",{userId:id,user:state.user?.displayName||state.user?.username,typing:false}); if($("dmFile")) $("dmFile").value=""; if($("dmFileName")) $("dmFileName").textContent="";
        state.dmReplyTo=null; state.dmReplyUser=null; state.dmReplyAuthor=null; state.dmReplyText=null;
        await openDM(id);
      } catch(error){ toast(error.message); }
    };
    $("reportDmBtn")?.addEventListener("click",async()=>{const reason=prompt("Reason for reporting this private conversation:","Inappropriate private message");if(reason===null)return;try{await api("/api/report",{method:"POST",body:JSON.stringify({reportedUserId:id,conversationWithId:state.user.id,reason})});toast("Report submitted.");}catch(e){toast(e.message)}});
    $("dmText")?.focus();
  } catch (error) {
    toast(error.message);
  }
}

function replyDMMsg(messageId, userId) {
  const message = state.dmMessages?.find(
    m => String(m.id) === String(messageId)
  );

  if (!message) {
    toast("Original message is no longer available.");
    return;
  }

  state.dmReplyTo = message.id;
  state.dmReplyUser = userId;
  state.dmReplyAuthor =
    message.from === state.user.id
      ? "You"
      : ((state.dmMessages.find(m => m.from === message.from)?.displayName) || "User");
  state.dmReplyText =
    message.text ||
    (message.attachment ? "📎 Attachment" : "Message");

  openDM(userId);
}

function cancelDMReply() {
  const userId = state.dmReplyUser || state.dmUserId;

  state.dmReplyTo = null;
  state.dmReplyUser = null;
  state.dmReplyAuthor = null;
  state.dmReplyText = null;

  if (userId) {
    openDM(userId);
  }
}

function jumpToDMMessage(id) {
  const element = document.querySelector(
    `[data-dmid="${CSS.escape(String(id))}"]`
  );

  if (!element) {
    toast("Original message is no longer visible.");
    return;
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  element.classList.add("quote-highlight");

  setTimeout(() => {
    element.classList.remove("quote-highlight");
  }, 1400);
}

/* ---------------- SAVED / SEARCH ---------------- */

function messageResultHTML(message,opts={}){
  const room=state.rooms.find(r=>r.id===message.roomId);
  const text=message.deletedSnapshot?.text ?? message.text ?? '';
  return `<article class="card search-result" data-result-id="${esc(message.id)}">
    <div class="search-result-head">
      ${avatar(message)}
      <div><b>${esc(message.displayName||message.username||'Unknown')}</b> <span class="muted">@${esc(message.username||'')}</span><div class="muted">${esc(room?.name||message.roomId||'Unknown room')} · ${fmt(message.time)}</div></div>
    </div>
    <div class="search-result-text">${esc(text||'(no text)')}</div>
    ${message.attachment?.url?`<div class="muted">📎 ${esc(message.attachment.name||message.attachment.type||'Attachment')}</div>`:''}
    <div class="toolbar">${!opts.saved?`<button class="mini" onclick="openResultMessage('${esc(message.id)}','${esc(message.roomId||'')}')">Open message</button>`:''}${opts.saved?`<button class="mini danger" onclick="saveMsg('${esc(message.id)}')">Remove saved</button>`:''}</div>
  </article>`;
}

async function loadSavedMessages(){
  try{
    const data=await api('/api/saved-messages');
    const messages=data.messages||[];
    $('saved').innerHTML=messages.length?messages.map(m=>messageResultHTML(m,{saved:true})).join(''):`<div class="room-empty"><div>🔖</div><b>No saved messages yet</b><span>Use the 🔖 button on any message to save it here.</span></div>`;
  }catch(e){toast(e.message)}
}

async function loadSearchRooms(){
  try{
    const data=await api('/api/rooms');
    const rooms=data.rooms||[];
    const sel=$('sr');
    const old=sel.value;
    sel.innerHTML='<option value="">All rooms</option>'+rooms.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
    sel.value=old;
  }catch(e){toast(e.message)}
}

$('searchForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const q=encodeURIComponent($('sq').value.trim());
    const author=encodeURIComponent($('sa').value.trim());
    const roomId=encodeURIComponent($('sr').value);
    const data=await api(`/api/search/messages?q=${q}&author=${author}&roomId=${roomId}`);
    const messages=data.messages||[];
    $('searchResults').innerHTML=messages.length?messages.map(m=>messageResultHTML(m)).join(''):`<div class="room-empty"><div>🔎</div><b>No matching messages</b><span>Try a different keyword, author or room.</span></div>`;
  }catch(e){toast(e.message)}
};

async function openResultMessage(id,roomId){
  try{
    if(roomId){
      await joinRoom(roomId);
      const el=document.querySelector(`[data-mid="${CSS.escape(String(id))}"]`);
      if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('quote-highlight');setTimeout(()=>el.classList.remove('quote-highlight'),1400);}
    }else{
      toast('Room information is unavailable for this message.');
    }
  }catch(e){toast(e.message)}
}


/* ---------------- NEWS ---------------- */

async function loadNews() {
  try {
    const data=await api("/api/news");
    $("news").innerHTML=(data.news||[]).map(n=>{
      const comments=n.comments||[], rx=n.reactions||{};
      const reactionKeys=[["👍","like"],["👎","dislike"],["💗","love"],["😆","laugh"]];
      const reactions=reactionKeys.map(([emoji,legacy])=>{const users=Array.isArray(rx[emoji])?rx[emoji]:[];const old=Number(rx[legacy]||rx[legacy+'s']||0);return [emoji,users.length||old,users.map(String).includes(String(state.user?.id))]});
      return `<article class="card news-card social-feed-card" data-news-id="${esc(n.id)}">
        <div class="news-card-top"><div class="social-author"><div class="social-author-avatar">${n.avatar?`<img src="${esc(n.avatar)}" alt="">`:'📰'}</div><div><h3>${esc(n.author||'Maleficent Chat')}</h3><div class="muted">${fmt(n.time)}</div></div></div><button class="social-more" data-news-more="${esc(n.id)}" aria-label="Post options">•••</button></div>
        <div class="news-body">${esc(n.title? n.title+'\\n\\n'+n.body : n.body)}</div>
        ${n.attachment?.type?.startsWith('image/')?`<img class="news-attachment" src="${esc(n.attachment.url)}" alt="News photo">`:''}
        <div class="social-reaction-summary">${reactions.map(([emoji,count])=>`<span>${emoji} <b>${count}</b></span>`).join('')}<button class="social-comments-shortcut" onclick="openNewsComments('${esc(n.id)}')">${comments.length} 💬</button></div>
        <div class="news-actions social-reaction-actions">${reactions.map(([emoji,count,reacted])=>`<button class="mini ${reacted?'reacted':''}" type="button" data-news-reaction="${emoji}" data-news-id="${esc(n.id)}">${emoji} <b>${count}</b></button>`).join('')}<button class="mini" onclick="openNewsComments('${esc(n.id)}')">💬 <b>${comments.length}</b></button>${canFeature('delete_news')?`<button class="mini danger" onclick="deleteNews('${esc(n.id)}')">🗑 Delete</button>`:""}</div>
        <div class="social-post-options hidden" id="newsOptions-${esc(n.id)}"><button type="button" data-news-report="${esc(n.id)}">⚑ Report</button></div>
      </article>`;
    }).join("")||`<div class="room-empty"><div>📰</div><b>No news yet</b><span>Community announcements will appear here.</span></div>`;
    document.querySelectorAll('[data-news-more]').forEach(b=>b.onclick=()=>{$('newsOptions-'+b.dataset.newsMore)?.classList.toggle('hidden')});
    document.querySelectorAll('[data-news-report]').forEach(b=>b.onclick=async()=>{const id=b.dataset.newsReport;try{await api('/api/news/'+encodeURIComponent(id)+'/report',{method:'POST',body:JSON.stringify({reason:'Reported by community member'})});toast('Report submitted.')}catch(e){toast(e.message||'Reporting is unavailable for this post.')}});
    document.querySelectorAll('[data-news-reaction]').forEach(b=>b.onclick=async()=>{try{await api('/api/news/'+encodeURIComponent(b.dataset.newsId)+'/reaction',{method:'POST',body:JSON.stringify({emoji:b.dataset.newsReaction})});await loadNews()}catch(e){toast(e.message||'Could not send reaction.')}});
  } catch (error) { toast(error.message); }
}


// News publishing — explicitly wired here so the control keeps working after
// the redesigned News view is rendered/re-rendered.
function openPublishNews(){
  if(!canFeature('publish_news')){ toast('You do not have permission to publish news.'); return; }
  modal(`<div class="publish-news-modal">
    <h2>📰 Publish News</h2>
    <form id="newsForm">
      <input id="nt" maxlength="120" placeholder="News title" required>
      <textarea id="nb" rows="9" maxlength="3000" placeholder="Write your announcement…" required></textarea><label class="field-label">Optional photo</label><input id="nphoto" type="file" accept="image/*">
      <div class="toolbar"><button class="primary" type="submit">Publish news</button></div>
    </form>
  </div>`);
  $('newsForm').onsubmit=async e=>{
    e.preventDefault();
    const title=$('nt').value.trim(), body=$('nb').value.trim();
    if(!title||!body) return;
    try{
      const form=new FormData(); form.append('title',title); form.append('body',body);
      const photo=$('nphoto')?.files?.[0]; if(photo) form.append('file',photo);
      const token=safeStorage.getItem("mc_token"); const headers=token?{"x-auth-token":token}:{}; const resp=await fetch('/api/news',{method:'POST',body:form,headers,credentials:'same-origin'}); const result=await resp.json().catch(()=>({}));
      if(!resp.ok) throw Error(result.error||'Failed to publish news.');
      closeModal();
      await loadNews();
      toast('News published successfully.');
    }catch(err){toast(err.message);}
  };
}

if($('publishNews')) $('publishNews').onclick=openPublishNews;

async function openNewsComments(id){
  try{
    const n=(await api("/api/news")).news.find(x=>x.id===id);
    if(!n) return;
    const data=await api(`/api/news/${encodeURIComponent(id)}/comments`);
    const render=comments=>(comments||[]).map(c=>`<div class="news-comment">
      ${avatar({displayName:c.displayName,username:c.username,avatar:c.avatar})}
      <div class="news-comment-main"><div><b>${esc(c.displayName||c.username)}</b> ${rank(c.rank)} <span class="muted">${fmt(c.time)}</span></div><p>${esc(c.text)}</p></div>
      ${(c.userId===state.user.id||can("MOD"))?`<button class="mini danger" onclick="deleteNewsComment('${esc(id)}','${esc(c.id)}')">×</button>`:""}
    </div>`).join("")||`<div class="news-empty-comments">No comments yet. Be the first to comment.</div>`;
    modal(`<div class="comments-modal"><div class="comments-modal-head"><div><h2>${esc(n.title)}</h2><p class="muted">Join the conversation</p></div><span class="news-count">💬 ${(data.comments||[]).length}</span></div><div class="comments-list" id="commentsList">${render(data.comments)}</div><form id="commentForm" class="comment-form"><input id="commentText" maxlength="1000" placeholder="Type your comment" required><button class="primary">Post</button></form></div>`);
    $("commentForm").onsubmit=async e=>{
      e.preventDefault();
      const text=$("commentText").value.trim(); if(!text)return;
      try{await api(`/api/news/${encodeURIComponent(id)}/comments`,{method:"POST",body:JSON.stringify({text})});$("commentText").value="";const r=await api(`/api/news/${encodeURIComponent(id)}/comments`);$("commentsList").innerHTML=render(r.comments);await loadNews();}catch(err){toast(err.message)}
    };
  }catch(e){toast(e.message)}
}
async function deleteNews(id){
  if(!canFeature('delete_news')){toast('You do not have permission to delete news.');return;}
  if(!confirm('Delete this news post?')) return;
  try{await api(`/api/news/${encodeURIComponent(id)}`,{method:'DELETE'});toast('News deleted successfully.');await loadNews();}catch(e){toast(e.message)}
}
async function deleteNewsComment(newsId,commentId){
  try{await api(`/api/news/${encodeURIComponent(newsId)}/comments/${encodeURIComponent(commentId)}`,{method:"DELETE"});toast("Comment deleted.");await openNewsComments(newsId);await loadNews();}catch(e){toast(e.message)}
}

/* ---------------- LEADERBOARD ---------------- */

async function loadLeaderboard() {
  try {
    const data =
      await api("/api/leaderboard");

    const users =
      data.users || [];

    $("leaderboard").innerHTML = `
      <div class="card">

        <h3>Top XP</h3>

        ${
          users.map((user, i) => `
            <div class="user-card">

              <b>#${i + 1}</b>

              ${avatar(user)}

              <div style="flex:1">
                <b>${esc(user.displayName)}</b>
                ${rank(user.rank)}
              </div>

              <b>
                Lv ${user.level || 1}
                · ${user.xp || 0} XP
              </b>

            </div>
          `).join("")
        }

      </div>

      <div class="card">

        <h3>Gold</h3>

        ${
          users
            .slice()
            .sort(
              (a, b) =>
                (b.gold || 0) -
                (a.gold || 0)
            )
            .map(user => `
              <div class="user-card">

                ${avatar(user)}

                <div style="flex:1">
                  ${esc(user.displayName)}
                </div>

                <b>
                  🪙 ${user.gold || 0}
                </b>

              </div>
            `)
            .join("")
        }

      </div>
    `;
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- PROFILE ---------------- */

async function staffProfileNoteModal(user){try{const d=await api('/api/staff/user/'+encodeURIComponent(user.id)+'/note');const note=d.note||'';modal('<div class="staff-note-modal"><h2>📝 Staff Profile Note</h2><p class="muted">Confidential staff-only context for @'+esc(user.username)+'. Do not record passwords or unnecessary sensitive personal information.</p>'+(note?'<article class="staff-note-entry"><div class="staff-note-entry-head"><b>Latest note</b><span class="muted">'+esc(d.updatedAt?new Date(d.updatedAt).toLocaleString():'Date unavailable')+'</span></div><div class="staff-note-author">Added by <b>@'+esc(d.updatedBy||'Unknown staff member')+'</b></div><p class="staff-note-message">'+esc(note)+'</p></article>':'<div class="staff-note-empty">No staff note has been added for this account.</div>')+'<label>Add a new note<textarea id="staffProfileNote" rows="5" maxlength="4000" placeholder="Write clear, factual staff context…"></textarea></label><div class="toolbar"><button class="primary" id="saveStaffProfileNote">Add note</button><button class="mini" type="button" onclick="closeModal()">Close</button></div></div>');$('saveStaffProfileNote').onclick=async()=>{const value=$('staffProfileNote').value.trim();if(!value){toast('Write a note before saving.');return;}try{await api('/api/staff/user/'+encodeURIComponent(user.id)+'/note',{method:'PATCH',body:JSON.stringify({note:value})});closeModal();toast('Staff note added.');}catch(e){toast(e.message)}};}catch(e){toast(e.message)}}

function staffAccountModal(user){
  if((!can('MOD')&&!canFeature('manage_staff_accounts'))||!canAccessStaffTarget(user)){toast('You can only access staff controls for accounts ranked below you.');return;}
  const allowed=ranks.filter((r,i)=>i<=rankOrder.MOD && i<rankOrder[state.user.rank]);
  modal(`<h2>⚙️ Staff account controls</h2><p class='muted'>Edit @${esc(user.username)}. Permissions are controlled by Owner Space.</p><div class='card'><b>Registration details</b><p>Date of birth: ${esc(user.dateOfBirth||user.birthDate||'Not provided')}<br>Gender: ${esc(user.gender||'Not provided')}<br>Joined: ${user.createdAt?new Date(user.createdAt).toLocaleDateString():'Unknown'}</p></div><label>Username<input id='staffUsername' value='${esc(user.username)}'></label><label>Rank<select id='staffRank'>${allowed.map(r=>`<option value='${r}' ${r===user.rank?'selected':''}>${r}</option>`).join('')}</select></label><div class='toolbar'><button class='primary' id='saveStaffAccount'>Save changes</button>${canFeature('change_password')?`<button class='mini' id='staffChangePassword'>Change password</button>`:''}${canFeature('edit_email')?`<button class='mini' id='staffEditEmail'>Edit Email</button>`:''}${canFeature('account_modifications')?`<button class='mini primary' id='staffAccountModifications'>Account modifications</button>`:''}</div>`);
  $('staffAccountModifications')?.addEventListener('click',()=>staffAccountModificationModal(user));
  $('saveStaffAccount').onclick=async()=>{try{await api('/api/staff/user/'+encodeURIComponent(user.id)+'/account',{method:'PATCH',body:JSON.stringify({username:$('staffUsername').value.trim()})});await api('/api/staff/user/'+encodeURIComponent(user.id)+'/rank',{method:'PATCH',body:JSON.stringify({rank:$('staffRank').value})});closeModal();toast('Staff account updated.');}catch(e){toast(e.message)}};
  $('staffChangePassword')?.addEventListener('click',()=>{
    modal(`<h2>Change password for @${esc(user.username)}</h2><p class='muted'>The existing password is never shown.</p><input id='staffNewPassword' type='password' minlength='8' placeholder='New password'><button class='primary' id='saveStaffPassword'>Set new password</button>`);
    $('saveStaffPassword').onclick=async()=>{try{await api(`/api/staff/user/${encodeURIComponent(user.id)}/password`,{method:'PATCH',body:JSON.stringify({password:$('staffNewPassword').value})});closeModal();toast('Password changed.');}catch(e){toast(e.message)}};
  });
  $('staffEditEmail')?.addEventListener('click',async()=>{
    try{const currentEmail=await api(`/api/staff/user/${encodeURIComponent(user.id)}/email-history`);modal(`<h2>Edit email for @${esc(user.username)}</h2><label>Email<input id='staffNewEmail' type='email' value='${esc(currentEmail.email||'')}' placeholder='Email address' required></label><button class='primary' id='saveStaffEmail'>Save</button>`);$('saveStaffEmail').onclick=async()=>{try{await api('/api/admin/edit-email',{method:'PUT',body:JSON.stringify({userId:user.id,newEmail:$('staffNewEmail').value})});closeModal();toast('Email updated.');}catch(e){toast(e.message)}};}catch(e){toast(e.message)}
  });
}

async function staffAccountModificationModal(user){
  if(!canFeature('account_modifications')){toast('Account modifications have not been granted to your account.');return;}
  let emailData=null;
  if(canFeature('edit_email'))emailData=await api(`/api/staff/user/${encodeURIComponent(user.id)}/email-history`).catch(()=>null);
  const dob=user.dateOfBirth||user.birthDate||user.birth_date||'';
  modal(`<div class='account-modification-modal'><h2>🛠️ Account modifications</h2><p class='muted'>Update profile details for @${esc(user.username)}.</p><div class='account-avatar-editor'><div class='account-avatar-preview'>${user.avatar?`<img src='${esc(user.avatar)}' alt='Profile picture'>`:'<span>👤</span>'}</div><label>Profile picture<input id='staffProfileAvatar' type='file' accept='image/png,image/jpeg,image/gif,image/webp,image/avif'></label><button class='mini danger' type='button' id='removeStaffAvatar'>Remove picture</button></div><form id='staffProfileModForm' class='account-modification-form'><label>Display name<input id='staffDisplayName' maxlength='32' value='${esc(user.displayName||'')}' required></label><label>Date of birth<input id='staffBirthDate' type='date' value='${esc(dob)}'></label><label>Gender<input id='staffGender' maxlength='50' value='${esc(user.gender||'')}'></label>${emailData?`<label>Registration email<input id='staffProfileEmail' type='email' value='${esc(emailData.email||'')}'></label>`:''}<label>Mood<input id='staffMood' maxlength='80' value='${esc(user.mood||'')}' placeholder='Current mood'></label><label>About me<textarea id='staffBio' maxlength='500' rows='4'>${esc(user.bio||'')}</textarea></label><label>Pronouns<input id='staffPronouns' maxlength='60' value='${esc(user.pronouns||'')}'></label><label>Birthday<input id='staffBirthday' maxlength='40' value='${esc(user.birthday||'')}'></label><label>Location<input id='staffLocation' maxlength='120' value='${esc(user.location||'')}'></label><label>Website<input id='staffWebsite' maxlength='240' value='${esc(user.website||'')}' placeholder='https://…'></label><label>Profile background image URL<input id='staffBanner' maxlength='500' value='${esc(user.banner||'')}' placeholder='https://…'></label><div class='toolbar'><button class='primary' type='submit'>Save account changes</button></div></form></div>`);
  $('removeStaffAvatar').onclick=async()=>{try{const d=await api(`/api/staff/user/${encodeURIComponent(user.id)}/avatar`,{method:'DELETE'});user.avatar=d.user?.avatar||'';closeModal();toast('Profile picture removed.');}catch(e){toast(e.message)}};
  $('staffProfileModForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const file=$('staffProfileAvatar').files?.[0];
      if(file){const fd=new FormData();fd.append('file',file);const d=await api(`/api/staff/user/${encodeURIComponent(user.id)}/avatar`,{method:'POST',body:fd});user.avatar=d.user?.avatar||'';}
      const changes={displayName:$('staffDisplayName').value.trim(),birthDate:$('staffBirthDate').value,gender:$('staffGender').value.trim(),mood:$('staffMood').value.trim(),bio:$('staffBio').value.trim(),pronouns:$('staffPronouns').value.trim(),birthday:$('staffBirthday').value.trim(),location:$('staffLocation').value.trim(),website:$('staffWebsite').value.trim(),banner:$('staffBanner').value.trim()};
      if(emailData)changes.email=$('staffProfileEmail').value.trim();
      const d=await api(`/api/staff/user/${encodeURIComponent(user.id)}/profile`,{method:'PATCH',body:JSON.stringify(changes)});
      Object.assign(user,d.user||{});closeModal();toast('Account modifications saved.');
    }catch(e){toast(e.message)}
  };
}

function rankFromProfile(user){
  const isOwner=String(state.user?.rank||"").toUpperCase()==="DEVELOPER" || (state.user?.username==="Maleficent" && state.user?.rank==="OWNER");
  const isStaff=canFeature("staff_rank_assignment");
  if(!isOwner && !isStaff){toast("You do not have permission to change ranks.");return;}
  if(user.username==="Maleficent" && !isOwner){toast("The permanent owner is protected.");return;}
  const allowed=isOwner ? ranks : ranks.filter(r=>rankOrder[r]<=rankOrder.MOD && rankOrder[r]<rankOrder[state.user.rank]);
  modal(`<h2>🏅 Change rank for @${esc(user.username)}</h2><p class="muted">${isOwner?"Owner control: you may assign any rank, including OWNER.":"Staff control: you may assign MOD or below only."}</p><select id="profileRankSelect">${allowed.map(r=>`<option value="${r}" ${r===user.rank?'selected':''}>${rankIcon[r]||''} ${r}</option>`).join('')}</select><div class="toolbar"><button class="primary" id="saveProfileRank">Save rank</button></div>`);
  $('saveProfileRank').onclick=async()=>{
    try{
      const endpoint=isOwner?`/api/owner/user/${encodeURIComponent(user.id)}/rank`:`/api/staff/user/${encodeURIComponent(user.id)}/rank`;
      const r=await api(endpoint,{method:"PATCH",body:JSON.stringify({rank:$('profileRankSelect').value})});
      closeModal(); toast(`@${user.username} is now ${r.user.rank}.`);
    }catch(e){toast(e.message)}
  };
}

function nicknameModal(user){
  modal(`<h2>Personalized nickname</h2><p class="muted">Only you and @${esc(user.username)} can see this nickname.</p><input id="nicknameInput" maxlength="40" placeholder="Nickname"><div class="toolbar"><button class="primary" id="saveNickname">Save</button><button class="mini danger" id="removeNickname">Remove</button></div>`);
  api('/api/friends/'+encodeURIComponent(user.id)+'/nickname').then(r=>$('nicknameInput').value=r.nickname||'');
  $('saveNickname').onclick=async()=>{try{await api('/api/friends/'+encodeURIComponent(user.id)+'/nickname',{method:'PUT',body:JSON.stringify({nickname:$('nicknameInput').value.trim()})});closeModal();toast('Nickname saved.');}catch(e){toast(e.message)}};
  $('removeNickname').onclick=async()=>{try{await api('/api/friends/'+encodeURIComponent(user.id)+'/nickname',{method:'DELETE'});closeModal();toast('Nickname removed.');}catch(e){toast(e.message)}};
}
function shareGoldModal(user){
  modal(`<h2>🪙 Share gold</h2><p class="muted">Your gold: ${state.user.gold||0}</p><input id="goldAmount" type="number" min="1" max="${Math.max(1,state.user.gold||1)}" placeholder="Amount"><button class="primary" id="sendGoldBtn">Send gold</button>`);
  $('sendGoldBtn').onclick=async()=>{try{const r=await api('/api/users/'+encodeURIComponent(user.id)+'/gold/share',{method:'POST',body:JSON.stringify({amount:Number($('goldAmount').value)})});state.user.gold=r.remainingGold;updateNav();closeModal();toast('Gold sent.');}catch(e){toast(e.message)}};
}


function renderAchievementBadges(user){ return '<button class="mini" id="profileAchievementsBtn">🏆 Achievements</button>'; }
async function showAchievements(user){try{const d=await api('/api/achievements/'+encodeURIComponent(user.id));modal(`<div class="achievement-modal"><h2>🏆 Achievements</h2><div class="stack achievement-scroll">${(d.achievements||[]).map(x=>`<div class="hub-row"><span style="font-size:1.5rem">${esc(x.icon||'🏆')}</span><div style="flex:1"><b>${esc(x.name)}</b><small class="muted">${fmt(x.earned_at)}</small></div></div>`).join('')||'<p class="muted">No achievements earned yet.</p>'}</div></div>`);}catch(e){toast(e.message)}}

async function openProfileActionDrawer(user,data={}){
  const isSelf=String(user.id)===String(state.user.id);
  if(isSelf){modal(`<div class="profile-drawer"><h2>Account actions</h2><button class="quick-user-row" id="drawerEdit">✏️ Edit profile</button><button class="quick-user-row" id="drawerBlocked">🚫 Blocked users</button></div>`);$('drawerEdit')?.addEventListener('click',()=>{closeModal();state.view='profile';renderView()});$('drawerBlocked')?.addEventListener('click',showBlockedUsers);return;}
  const prefs=dmPrefs(),id=String(user.id),muted=!!prefs.muted?.[id],archived=!!prefs.archived?.[id],blocked=(state.user.blocked||[]).map(String).includes(id);
  modal(`<div class="profile-drawer quick-action-menu"><h2>Actions · @${esc(user.username||'user')}</h2>
    <button class="quick-user-row" id="drawerPM"><span>💬</span><b>Private message</b><i>›</i></button>
    <button class="quick-user-row" id="drawerLikeProfile"><span>❤️</span><b>Like profile</b><i>›</i></button>
    <button class="quick-user-row" id="drawerAddFriend"><span>👥</span><b>Add friend</b><i>›</i></button>
    <button class="quick-user-row" id="drawerBlock"><span>🚫</span><b>Block</b><i>›</i></button>
    <button class="quick-user-row" id="drawerStaffModification"><span>🛠️</span><b>Staff modification</b><i>›</i></button>
    <button class="quick-user-row" id="drawerWallet"><span>🪙</span><b>Share wallet</b><i>›</i></button>
    <button class="quick-user-row" id="drawerGiveRank"><span>🏅</span><b>Give rank</b><i>›</i></button>
    <button class="quick-user-row" id="drawerRoomRank"><span>✨</span><b>Room rank</b><i>›</i></button>
    <button class="quick-user-row" id="drawerRoomModerate"><span>🛡️</span><b>Room moderation</b><i>›</i></button>
    <button class="quick-user-row" id="drawerModerateUser"><span>🛡️</span><b>Moderate user</b><i>›</i></button>
    <button class="quick-user-row" id="drawerStaffAccount"><span>⚙️</span><b>Staff account</b><i>›</i></button>
    <button class="quick-user-row" id="drawerUserHistory"><span>📜</span><b>User history</b><i>›</i></button>
    <button class="quick-user-row" id="drawerNickname"><span>✏️</span><b>Nickname</b><i>›</i></button>
    <button class="quick-user-row" id="drawerReport"><span>⚑</span><b>Report user</b><i>›</i></button>
  </div>`);
  $('drawerPM')?.addEventListener('click',()=>{closeModal();openDM(id)});
  $('drawerLikeProfile')?.addEventListener('click',async()=>{try{const r=await api(`/api/users/${encodeURIComponent(id)}/like`,{method:'POST'});closeModal();toast(r.liked?'Profile liked.':'Like removed.');}catch(e){toast(e.message)}});
  $('drawerAddFriend')?.addEventListener('click',async()=>{try{await friend(id);closeModal();}catch(e){toast(e.message)}});
  $('drawerBlock')?.addEventListener('click',async()=>{try{await block(id);closeModal();}catch(e){toast(e.message)}});
  $('drawerStaffModification')?.addEventListener('click',()=>staffAccountModificationModal(user));
  $('drawerWallet')?.addEventListener('click',()=>shareGoldModal(user));
  $('drawerGiveRank')?.addEventListener('click',()=>rankFromProfile(user));
  $('drawerRoomRank')?.addEventListener('click',()=>roomRankModal(user));
  $('drawerRoomModerate')?.addEventListener('click',()=>roomModerationModal(user));
  $('drawerModerateUser')?.addEventListener('click',()=>moderate(id));
  $('drawerStaffAccount')?.addEventListener('click',()=>staffAccountModal(user));
  $('drawerUserHistory')?.addEventListener('click',()=>showUserActionHistory(id));
  $('drawerNickname')?.addEventListener('click',async()=>{const current=(await api('/api/private-nicknames').catch(()=>({nicknames:{}}))).nicknames||{};const value=prompt('Private nickname for @'+(user.username||'user')+' (only you can see it):',current[id]||'');if(value===null)return;try{await api('/api/private-nickname',{method:'POST',body:JSON.stringify({targetId:id,nickname:value.trim()})});closeModal();toast(value.trim()?'Private nickname saved.':'Private nickname cleared.');}catch(e){toast(e.message)}});
  $('drawerReport')?.addEventListener('click',async()=>{const reason=prompt('Why are you reporting this user?','Rule-breaking behavior');if(reason===null)return;try{await api('/api/report',{method:'POST',body:JSON.stringify({reportedUserId:id,reason})});closeModal();toast('Report submitted.');}catch(e){toast(e.message)}});
}
async function roomModerationModal(user){
  const room=state.rooms.find(r=>String(r.id)===String(state.currentRoom));
  if(!room){toast('Join a room first.');return;}
  modal(`<h2>🛡️ Room moderation</h2><p class="muted">Action applies to @${esc(user.username)} in <b>${esc(room.name)}</b> only.</p>
    <label>Action<select id="roomModAction"><option value="MUTE">Mute in room</option><option value="BLOCK">Block from room</option><option value="KICK">Remove from room for 1 minute</option><option value="UNBLOCK">Unblock from room</option></select></label>
    <label>Mute duration (minutes)<input id="roomModMinutes" type="number" min="1" max="60" value="5"></label>
    <label>Reason<textarea id="roomModReason" maxlength="240" placeholder="Explain the room rule violation"></textarea></label>
    <button class="primary" id="submitRoomMod">Apply action</button>`);
  $('submitRoomMod').onclick=async()=>{const action=$('roomModAction').value,reason=$('roomModReason').value.trim();if(!reason){toast('Please provide a reason.');return;}try{await api(`/api/rooms/${encodeURIComponent(room.id)}/staff-action`,{method:'POST',body:JSON.stringify({userId:user.id,action,minutes:Number($('roomModMinutes').value)||5,reason})});closeModal();toast('Room moderation action recorded.');}catch(e){toast(e.message)}};
}
async function editCurrentRoomRules(){const room=state.rooms.find(r=>String(r.id)===String(state.currentRoom));if(!room)return toast("Join a room first.");try{const d=await api("/api/rooms/"+encodeURIComponent(room.id)+"/rules");const rules=prompt("Room rules for "+room.name,d.rules||"");if(rules===null)return;await api("/api/rooms/"+encodeURIComponent(room.id)+"/rules",{method:"PUT",body:JSON.stringify({rules})});toast("Room rules saved.");}catch(e){toast(e.message);}}
async function viewCurrentRoomModerationLog(){const room=state.rooms.find(r=>String(r.id)===String(state.currentRoom));if(!room)return toast("Join a room first.");try{const d=await api("/api/rooms/"+encodeURIComponent(room.id)+"/moderation-log");const rows=(d.logs||[]).map(x=>esc(x.action||"ACTION")+" · "+esc(x.actorUsername||"Staff")+" → "+esc(x.targetUsername||"User")+" · "+fmt(x.time)+" · "+esc(x.reason||x.role||"")).join("\n");alert(room.name+" moderation log\n\n"+(rows||"No room moderation actions recorded."));}catch(e){toast(e.message);}}
async function roomRankModal(user){
  const room=state.rooms.find(r=>String(r.id)===String(state.currentRoom));
  if(!room){toast('Join a room first.');return;}
  const roleOptions=[['USER','User'],['ROOM_MODERATOR','🛡️ Room Moderator'],['ROOM_ADMIN','👑 Room Admin']];
  let current='USER';
  try{const d=await api(`/api/rooms/${encodeURIComponent(room.id)}/staff`);current=d.staff?.find(x=>String(x.user.id)===String(user.id))?.role||'USER';}catch(e){toast(e.message);return;}
  modal(`<h2>✨ Room rank</h2><p class="muted">Set @${esc(user.username)}'s rank in <b>${esc(room.name)}</b> only. Their global rank is unchanged.</p><label>Room rank<select id="roomRankChoice">${roleOptions.map(([v,label])=>`<option value="${v}" ${current===v?'selected':''}>${label}</option>`).join('')}</select></label><button class="primary" id="saveRoomRank">Save room rank</button>`);
  $('saveRoomRank').onclick=async()=>{try{const role=$('roomRankChoice').value;await api(`/api/rooms/${encodeURIComponent(room.id)}/staff/${encodeURIComponent(user.id)}`,{method:'PUT',body:JSON.stringify({role})});closeModal();toast('Room rank updated.');await loadRooms();}catch(e){toast(e.message)}};
}
async function showBlockedUsers(){
  try{const r=await api('/api/users/blocked'); modal(`<h2>🚫 Blocked users</h2><div class="stack">${(r.users||[]).map(u=>`<div class="card blocked-user-row">${avatar(u)}<div><b>${esc(u.displayName)}</b><small>@${esc(u.username)}</small></div><button class="mini" onclick="unblockFromList('${esc(u.id)}')">Unblock</button></div>`).join('')||'<p class="muted">You have not blocked anyone.</p>'}</div>`);}catch(e){toast(e.message)}}
async function unblockFromList(id){try{await api(`/api/users/${id}/block`,{method:'DELETE'});showBlockedUsers();toast('User unblocked.')}catch(e){toast(e.message)}}

async function loadProfile(user){
  if(!user) return;
  const cosmetics=Array.isArray(user.equippedCosmetics)?user.equippedCosmetics:[];
  const frame=cosmetics.find(x=>x.category==='frame');
  const profileTheme=cosmetics.find(x=>x.category==='theme');
  const profileBadge=cosmetics.find(x=>x.category==='badge');
  const banner=user.banner?`style="background-image:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.72)),url('${esc(user.banner)}')"`:'';
  $('profile').innerHTML=`<div class="my-profile-wrap"><div class="profile-settings-card ${profileTheme?esc(profileTheme.id):''}">
    <div class="profile-settings-head" ${banner}>
      <div class="profile-settings-top"><span>⭐ ${user.level||1}</span><span>❤️ ${user.profileLikes||0}</span><button class="mini" onclick="uploadAvatar()">📷</button><button class="mini" onclick="editProfileInfo()" title="Edit profile">✏️</button><button class="mini" id="myProfileMenuBtn" title="More">☰</button></div>
      ${avatar(user,'big-avatar')}
      <div class="profile-rank">${rank(user.rank)}${user.verified?' · ✓ Verified':''}</div>
      <div class="profile-name" style="color:${esc(user.profileColor||user.settings?.usernameColor||'')}" >${esc(user.displayName)}</div><div class="profile-handle">@${esc(user.username)}${user.pronouns?` · ${esc(user.pronouns)}`:''}</div><div class="profile-extra">${user.mood?`<span>☻ ${esc(user.mood)}</span>`:''}${user.relationship?`<span>♥ ${esc(user.relationship)}</span>`:''}${user.location?`<span>📍 ${esc(user.location)}</span>`:''}${user.website?`<span>🔗 ${esc(user.website)}</span>`:''}</div>
      <button class="mini" onclick="uploadBanner()">🎵 Add music / banner</button>
    </div>
    <button class="mini" id="selfAchievementsBtn">🏆 Achievements</button>
    <div class="settings-tabs"><button class="settings-tab active" data-st="account">Account</button><button class="settings-tab" data-st="more">More</button></div>
    <div id="myProfileSettings"></div>
  </div></div>`;
  const content=$('myProfileSettings');
  api('/api/daily/status').then(d=>{const b=document.querySelector('[data-daily-reward]');if(b){b.disabled=!!d.claimed;b.querySelector('small').textContent=d.claimed?'Already claimed today':`Claim ${25} gold + ${15} XP once per day`;}}).catch(()=>{});
  const render=(tab)=>{
    document.querySelectorAll('.settings-tab').forEach(b=>b.classList.toggle('active',b.dataset.st===tab));
    if(tab==='account'){content.innerHTML=`<div class="settings-list">
      <button class="settings-row" onclick="editProfileInfo()"><span>🪪</span><b>Edit info</b><small>Display name, pronouns and profile details</small><strong>›</strong></button>
      <button class="settings-row" onclick="editRelationship()"><span>♥</span><b>Edit relationship</b><small>${esc(user.relationship||'Not set')}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editUsername()"><span>✎</span><b>Edit username</b><small>@${esc(user.username)}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editAboutMe()"><span>?</span><b>Edit about me</b><small>${esc(user.bio||'Not set')}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editMood()"><span>☻</span><b>Edit mood</b><small>${esc(user.mood||'Not set')}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editEmail()"><span>✉</span><b>Edit email</b><small>Email is optional</small><strong>›</strong></button><button class="settings-row" onclick="showBlockedUsers()"><span>🚫</span><b>Blocked users</b><small>View and unblock people you blocked</small><strong>›</strong></button>
      <button class="settings-row" onclick="changePasswordModal()"><span>🔑</span><b>Change password</b><small>Update your login password</small><strong>›</strong></button><button class="settings-row" data-daily-reward onclick="claimDailyReward()"><span>🎁</span><b>Daily Gold and XP Reward</b><small>Claim once per day</small><strong>›</strong></button>
    </div>`;}else{content.innerHTML=`<div class="settings-list">
      <button class="settings-row" onclick="privacyModal()"><span>🔒</span><b>Privacy</b><small>Control status and last-seen visibility</small><strong>›</strong></button>
      <button class="settings-row" onclick="uploadAvatar()"><span>🖼️</span><b>Edit photos</b><small>Profile photo and banner</small><strong>›</strong></button>
      <button class="settings-row" onclick="usernameHistory()"><span>📜</span><b>Username history</b><small>${(user.usernameHistory||[]).length} recorded changes</small><strong>›</strong></button>
      <button class="settings-row danger-row" onclick="deleteAccount()"><span>⊘</span><b>Delete account</b><small>This action is permanent</small><strong>›</strong></button>
    </div>`;}
  };
  document.querySelectorAll('.settings-tab').forEach(b=>b.addEventListener('click',()=>render(b.dataset.st))); $('myProfileMenuBtn')?.addEventListener('click',()=>openProfileActionDrawer(state.user,{})); render('account');
}

async function saveMyProfile(fields,message){try{const r=await api('/api/profile',{method:'PUT',body:JSON.stringify(fields)});state.user=r.user;closeModal();updateNav();await loadProfile(state.user);toast(message||'Saved.');}catch(e){toast(e.message)}}
function editProfileInfo(){modal(`<h2>Edit info</h2><input id="piName" value="${esc(state.user.displayName)}" placeholder="Display name"><input id="piPronouns" value="${esc(state.user.pronouns||'')}" placeholder="Pronouns"><input id="piLocation" value="${esc(state.user.location||'')}" placeholder="Location"><input id="piWebsite" value="${esc(state.user.website||'')}" placeholder="Website"><input id="piInterests" value="${esc((state.user.interests||[]).join(', '))}" placeholder="Interests, separated by commas"><button class="primary" id="savePI">Save</button>`);$('savePI').onclick=()=>saveMyProfile({displayName:$('piName').value.trim(),pronouns:$('piPronouns').value.trim(),location:$('piLocation').value.trim(),website:$('piWebsite').value.trim(),interests:$('piInterests').value.split(',').map(x=>x.trim()).filter(Boolean)},'Info saved.');}
function editRelationship(){modal(`<h2>Edit relationship</h2><select id="rel"><option value="">Not set</option><option>Single</option><option>In a relationship</option><option>Complicated</option><option>Prefer not to say</option></select><button class="primary" id="saveRel">Save</button>`);$('rel').value=state.user.relationship||'';$('saveRel').onclick=()=>saveMyProfile({relationship:$('rel').value},'Relationship saved.');}
function editUsername(){modal(`<h2>Edit username</h2><input id="newUsername" maxlength="24" value="${esc(state.user.username)}"><p class="muted">3–24 letters, numbers and underscores.</p><button class="primary" id="saveUsername">Save</button>`);$('saveUsername').onclick=()=>saveMyProfile({username:$('newUsername').value.trim()},'Username saved.');}
function editAboutMe(){modal(`<h2>Edit about me</h2><textarea id="aboutMeEdit" rows="7" maxlength="500">${esc(state.user.bio||'')}</textarea><button class="primary" id="saveAboutMe">Save</button>`);$('saveAboutMe').onclick=()=>saveMyProfile({bio:$('aboutMeEdit').value},'About Me saved.');}
function editMood(){modal(`<h2>Edit mood</h2><input id="moodEdit" maxlength="120" value="${esc(state.user.mood||'')}" placeholder="How are you feeling?"><button class="primary" id="saveMood">Save</button>`);$('saveMood').onclick=()=>saveMyProfile({mood:$('moodEdit').value.trim()},'Mood saved.');}
function editProfileStyle(){
  const u=state.user||{};
  modal(`<h2>✨ Profile appearance</h2>
    <p class="muted">Personalize your profile card. Changes are saved to your account.</p>
    <label>Display name color<input id="profileColorEdit" type="color" value="${/^#[0-9a-f]{6}$/i.test(u.profileColor||'')?u.profileColor:'#00bfae'}"></label>
    <label>Profile theme<select id="profileThemeEdit"><option value="obsidian">Obsidian</option><option value="midnight">Midnight</option><option value="rose">Rose</option><option value="emerald">Emerald</option></select></label>
    <label>Profile badge text<input id="profileBadgeEdit" maxlength="32" value="${esc(u.badge||'')}" placeholder="e.g. Artist, Gamer"></label>
    <label>Pronouns / status<input id="profilePronounsEdit" maxlength="40" value="${esc(u.pronouns||'')}" placeholder="Pronouns (optional)"></label>
    <label>Profile background image URL<input id="profileBannerEdit" maxlength="500" value="${esc(u.banner||'')}" placeholder="https://…"></label>
    <button class="primary" id="saveProfileStyle">Save appearance</button>`);
  $('profileThemeEdit').value=['obsidian','midnight','rose','emerald'].includes(u.theme)?u.theme:'obsidian';
  $('saveProfileStyle').onclick=()=>saveMyProfile({profileColor:$('profileColorEdit').value,theme:$('profileThemeEdit').value,badge:$('profileBadgeEdit').value.trim(),pronouns:$('profilePronounsEdit').value.trim(),banner:$('profileBannerEdit').value.trim()},'Profile appearance saved.');
}

async function editEmail(){try{const r=await api('/api/me/email');modal(`<h2>Edit email</h2><p class="muted">Email is optional. It is not required on the registration screen.</p><input id="emailEdit" type="email" value="${esc(r.email||'')}" placeholder="Email address"><div class="toolbar"><button class="primary" id="saveEmail">Save</button></div>`);$('saveEmail').onclick=async()=>{try{await api('/api/me/email',{method:'PUT',body:JSON.stringify({email:$('emailEdit').value.trim()})});closeModal();toast('Email saved.');}catch(e){toast(e.message)}}}catch(e){toast(e.message)}}
function changePasswordModal(){modal(`<h2>Change password</h2><input id="oldPassword" type="password" placeholder="Current password"><input id="newPassword" type="password" placeholder="New password (8+ characters)"><button class="primary" id="savePassword">Change password</button>`);$('savePassword').onclick=async()=>{try{await api('/api/password/change',{method:'POST',body:JSON.stringify({currentPassword:$('oldPassword').value,newPassword:$('newPassword').value})});closeModal();toast('Password changed.');}catch(e){toast(e.message)}}}

function uploadAvatar() {
  const hasAvatar=!!state.user?.avatar;
  modal(`
    <h2>Profile photo</h2>
    <p class="muted">Upload a new photo or remove your current profile picture.</p>
    ${hasAvatar?`<div class="photo-preview">${avatar(state.user,'big-avatar')}</div>`:''}
    <input type="file" id="av" accept="image/*">
    <div class="toolbar">
      <button class="primary" type="button" onclick="sendUpload('/api/me/avatar','av')">Upload</button>
      ${hasAvatar?`<button class="mini danger" type="button" onclick="deleteAvatar()">🗑 Delete profile picture</button>`:''}
      
    </div>
  `);
}

async function deleteAvatar(){
  if(!confirm('Delete your profile picture?')) return;
  try{
    const data=await api('/api/me/avatar',{method:'DELETE'});
    state.user=data.user;
    closeModal();
    updateNav();
    await loadProfile(state.user);
    toast('Profile picture deleted.');
  }catch(e){toast(e.message)}
}

function uploadBanner() {
  modal(`
    <h2>Profile banner</h2>

    <input
      type="file"
      id="bn"
      accept="image/*"
    >

    <button
      class="primary"
      onclick="sendUpload('/api/me/banner','bn')"
    >
      Upload
    </button>
  `);
}

async function sendUpload(url, id) {
  const file = $(id).files[0];

  if (!file) {
    toast("Choose a file first.");
    return;
  }

  const form = new FormData();

  form.append("file", file);

  try {
    const response =
      await fetch(url, {
        method: "POST",
        body: form,
        credentials: "same-origin"
      });

    const data =
      await response.json()
        .catch(() => ({}));

    if (!response.ok) {
      throw Error(
        data.error || "Upload failed."
      );
    }

    state.user = data.user;

    closeModal();

    updateNav();

    await loadProfile(
      state.user
    );

    toast("Uploaded successfully.");
  } catch (error) {
    toast(error.message);
  }
}

function privacyModal() {
  modal(`
    <h2>Privacy</h2>

    <p class="muted">
      Privacy settings control
      online-status and last-seen visibility.
    </p>

    <button
      class="primary"
      onclick="closeModal()"
    >
      Done
    </button>
  `);
}

function usernameHistory() {
  modal(`
    <h2>Username change history</h2>

    <pre>${esc(
      JSON.stringify(
        state.user.usernameHistory || [],
        null,
        2
      )
    )}</pre>
  `);
}

async function deleteAccount() {
  if (
    !confirm(
      "Permanently delete your account?"
    )
  ) {
    return;
  }

  try {
    await api("/api/me", {
      method: "DELETE"
    });

    location.reload();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- MODERATION ---------------- */

async function moderate(id) {
  try {
    const d=await api(`/api/users/${encodeURIComponent(id)}/profile`);const target=d.user||{};
    const actions=['WARN','MUTE','KICK','BAN'].map(action=>`<button class="mini" onclick="doModerate('${esc(id)}','${action}')">${action}</button>`).join('');
    const revokes=[target.mutedUntil&&target.mutedUntil>Date.now()?`<button class="mini danger" onclick="doModerate('${esc(id)}','REVOKE_MUTE')">Revoke mute</button>`:'',target.kickedUntil&&target.kickedUntil>Date.now()?`<button class="mini danger" onclick="doModerate('${esc(id)}','REVOKE_KICK')">Revoke kick</button>`:'',target.banned?`<button class="mini danger" onclick="doModerate('${esc(id)}','REVOKE_BAN')">Revoke ban</button>`:''].join('');
    modal(`<h2>Moderation · @${esc(target.username||'user')}</h2><p>Select an action. Revoke actions appear only while the restriction is active.</p><div class="toolbar">${actions}${revokes}</div><input id="modReason" placeholder="Reason"><input id="modMinutes" type="number" min="1" placeholder="Minutes (mute/kick)">`);
  }catch(e){toast(e.message)}
}

async function doModerate(id, action) {
  try {
    await api(
      `/api/moderation/${action.toLowerCase()}`,
      {
        method: "POST",
        body: JSON.stringify({
          userId: id,
          reason:
            $("modReason")?.value || "",
          minutes:
            $("modMinutes")?.value || ""
        })
      }
    );

    closeModal();

    toast("Moderation action applied.");
  } catch (error) {
    toast(error.message);
  }
}

function auditActionLabel(action) {
  const labels = { FEATURE_ACCESS_BULK_SAVE:"Feature permissions updated", INVISIBLE_MODE:"Invisible mode changed", LOGIN:"User logged in", LOGOUT:"User logged out", USER_REGISTER:"New account registered", REGISTER:"New account registered", GOLD_SHARE:"Gold transferred", GOLD_TRANSFER:"Gold transferred", USER_BAN:"User banned", BAN:"User banned", USER_UNBAN:"User unbanned", UNBAN:"User unbanned", USER_MUTE:"User muted", MUTE:"User muted", USER_KICK:"User kicked", KICK:"User kicked", MESSAGE_DELETE:"Chat message deleted", DELETE_MESSAGE:"Chat message deleted", ROOM_CLEAR:"Room messages cleared", ROOM_CREATE:"Room created", ROOM_DELETE:"Room deleted", REPORT_RESOLVE:"Report resolved", RANK_CHANGE:"Account rank changed", ACCOUNT_MODIFY:"Account details changed", SETTINGS_UPDATE:"Site settings updated" };
  const key = String(action || "EVENT").toUpperCase();
  return labels[key] || key.toLowerCase().replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
function formatAuditDetail(value) {
  if (value == null || value === "") return '<span class="audit-detail-empty">No extra details recorded</span>';
  let parsed = value;
  if (typeof value === "string") { try { parsed = JSON.parse(value); } catch (_) { return '<div class="audit-detail-text">' + esc(value) + '</div>'; } }
  if (typeof parsed !== "object" || parsed === null) {
    if (typeof parsed === "boolean") return '<span class="audit-detail-value">' + (parsed ? "Enabled" : "Disabled") + '</span>';
    return '<div class="audit-detail-text">' + esc(String(parsed)) + '</div>';
  }
  const entries = Array.isArray(parsed) ? [["items", parsed]] : Object.entries(parsed);
  if (!entries.length) return '<span class="audit-detail-empty">No additional details recorded</span>';
  const pretty = key => String(key).replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase());
  return '<div class="audit-detail-list">' + entries.map(([key, val]) => {
    const label = pretty(key);
    if (Array.isArray(val)) {
      if (key.toLowerCase() === "features" || val.some(item => item && typeof item === "object" && (item.key || item.minimumRank || item.minimum_rank))) {
        const items = val.map(item => {
          if (!item || typeof item !== "object") return '<li>' + esc(String(item)) + '</li>';
          const name = item.key || item.name || item.feature || "Feature";
          const rankValue = item.minimumRank || item.minimum_rank || item.rank || "";
          return '<li><span>' + esc(pretty(name)) + '</span>' + (rankValue ? '<small>Minimum rank: ' + esc(pretty(rankValue)) + '</small>' : '') + '</li>';
        }).join("");
        return '<div class="audit-detail-item audit-feature-group"><b>' + esc(label) + ' (' + val.length + ')</b><ul class="audit-feature-list">' + items + '</ul></div>';
      }
      return '<div class="audit-detail-item"><b>' + esc(label) + ':</b> ' + esc(val.map(item => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ")) + '</div>';
    }
    if (val && typeof val === "object") return '<div class="audit-detail-item"><b>' + esc(label) + ':</b><div class="audit-detail-nested">' + Object.entries(val).map(([k,v]) => '<div><span>' + esc(pretty(k)) + '</span><b>' + esc(v == null || v === "" ? "—" : typeof v === "boolean" ? (v ? "Enabled" : "Disabled") : String(v)) + '</b></div>').join("") + '</div></div>';
    const display = typeof val === "boolean" ? (val ? "Enabled" : "Disabled") : val == null || val === "" ? "—" : String(val);
    return '<div class="audit-detail-item"><b>' + esc(label) + ':</b> ' + esc(display) + '</div>';
  }).join("") + '</div>';
}
function renderAuditRow(x) {
  const raw = x.reason == null || x.reason === "" ? null : x.reason;
  const actor = x.actorUsername || x.actor || "System", target = x.target || "Site", when = x.time ? fmt(x.time) : "Time unavailable";
  const details = raw == null ? '<span class="audit-detail-empty">No extra details recorded</span>' : formatAuditDetail(raw);
  return '<article class="system-audit-row"><div class="system-audit-heading"><b>' + esc(auditActionLabel(x.action)) + '</b><span class="audit-source">' + esc(String(x.source || "system").replace(/[_-]+/g, " ")) + '</span></div>' +
    '<div class="system-audit-meta"><span><small>ACTOR</small><b>' + esc(actor) + '</b></span><span><small>TARGET</small><b>' + esc(target) + '</b></span><span><small>DATE & TIME</small><b>' + esc(when) + '</b></span></div>' +
    '<details class="audit-evidence-details"><summary>View details</summary><div class="audit-evidence-content">' + details +
    (raw != null ? '<details class="audit-raw-details"><summary>View raw evidence</summary><pre>' + esc(typeof raw === "string" ? raw : JSON.stringify(raw, null, 2)) + '</pre></details>' : '') + '</div></details></article>';
}


/* ---------------- STAFF APPLICATION ---------------- */
async function loadStaffApplication(){
  const root=$("staffApplicationFormRoot"); if(!root)return;
  root.innerHTML='<section class="card staff-application-card"><p class="muted">Loading your application…</p></section>';
  try{
    const data=await api('/api/staff-applications/mine');
    const existing=data.application;
    const locked=!!existing&&['PENDING','APPROVED'].includes(String(existing.status).toUpperCase());
    const rankOptions=['MOD','ADMIN','SUPER_ADMIN','COMMISSOR','COOWNER'];
    root.innerHTML=`<section class="card staff-application-card">
      <div class="staff-application-heading"><span class="staff-application-icon">🛡️</span><div><h3>Join the Staff Team</h3><p class="muted">Answer every question thoughtfully. Staff applications are reviewed by the team.</p></div></div>
      ${existing?`<div class="staff-application-status"><b>Latest application: ${esc(existing.status||'PENDING')}</b><span>${esc(existing.status==='REJECTED'?'You may submit a new application.':existing.status==='APPROVED'?'Your application was approved.':'Your application is waiting for review.')}</span></div>`:''}
      ${locked?'<p class="muted">You already have an application awaiting review or have been approved. You cannot submit another right now.</p>':`
      <form id="staffApplicationForm" class="staff-application-form">
        <label>1. Which rank are you applying for?
          <select id="staffAppRank" required><option value="">Choose a rank</option>${rankOptions.map(r=>`<option value="${r}">${r.replace(/_/g,' ')}</option>`).join('')}</select>
        </label>
        <label>2. How much time can you stay active each day?
          <input id="staffAppActivity" maxlength="180" placeholder="e.g. 2–3 hours daily, mostly evenings" required>
        </label>
        <label>3. Why should we choose you for this role?
          <textarea id="staffAppWhy" rows="5" maxlength="2500" placeholder="Tell us about your strengths, judgement and how you would help the community…" required></textarea>
        </label>
        <label>4. Do you have past moderation experience?
          <textarea id="staffAppExperience" rows="4" maxlength="2000" placeholder="Describe previous roles, responsibilities, or write “No previous experience”." required></textarea>
        </label>
        <button class="primary" type="submit">Submit Staff Application</button>
        <p id="staffAppMessage" class="muted" aria-live="polite"></p>
      </form>`}
    </section>`;
    $('staffApplicationForm')?.addEventListener('submit',async e=>{
      e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]'),message=$('staffAppMessage');
      button.disabled=true;message.textContent='Submitting…';
      try{await api('/api/staff-applications',{method:'POST',body:JSON.stringify({requestedRank:$('staffAppRank').value,activity:$('staffAppActivity').value.trim(),reason:$('staffAppWhy').value.trim(),experience:$('staffAppExperience').value.trim()})});toast('Staff application submitted.');await loadStaffApplication();}
      catch(err){message.textContent=err.message||'Could not submit your application.';button.disabled=false;}
    });
  }catch(e){root.innerHTML='<section class="card"><p class="error">'+esc(e.message||'Could not load staff application.')+'</p></section>';}
}

/* ---------------- STAFF ---------------- */


async function renderStaffApplications(){
  try{
  // Staff applications: compact applicant rows with a separate full-form viewer.
  const staffApps=await api('/api/staff/applications').catch(()=>({applications:[]}));
  const appRows=staffApps.applications||[];
  const appList=$('staffApplicationsList'),appCount=$('staffApplicationCount');
  if(appCount)appCount.textContent=String(appRows.filter(x=>x.status==='PENDING').length)+' pending · '+appRows.length+' total';
  if(appList)appList.innerHTML=appRows.map(x=>`<div class="staff-application-row"><div class="staff-application-user"><div class="staff-application-avatar">${esc((x.displayName||x.username||'?').slice(0,1).toUpperCase())}</div><div><b>${esc(x.displayName||x.username)}</b><div class="muted">@${esc(x.username)} · ${esc(x.requestedRank.replace(/_/g,' '))}</div><small class="staff-application-status-text">${esc(x.status)} · ${fmt(x.createdAt)}</small></div></div><button class="mini primary" type="button" data-staff-app-form="${esc(x.id)}">Form</button></div>`).join('')||'<p class="muted">No staff applications yet.</p>';
  appList?.querySelectorAll('[data-staff-app-form]').forEach(btn=>btn.onclick=()=>{
    const x=appRows.find(v=>String(v.id)===String(btn.dataset.staffAppForm));if(!x)return;
    modal(`<div class="staff-application-review"><h2>📝 Staff Application</h2><p class="muted">@${esc(x.username)} · Submitted ${fmt(x.createdAt)} · Status: ${esc(x.status)}</p>
    <div class="staff-application-answer"><small>REQUESTED RANK</small><b>${esc(x.requestedRank.replace(/_/g,' '))}</b></div>
    <div class="staff-application-answer"><small>DAILY ACTIVE TIME</small><p>${esc(x.activity)}</p></div>
    <div class="staff-application-answer"><small>WHY SHOULD WE HIRE YOU?</small><p>${esc(x.reason)}</p></div>
    <div class="staff-application-answer"><small>PAST MODERATION EXPERIENCE</small><p>${esc(x.experience)}</p></div>
    ${x.status==='PENDING'?'<label>Rank to grant<select id="staffAppGrantRank"><option value="MOD">Moderator</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option><option value="COMMISSOR">Commissor</option><option value="COOWNER">Co-owner</option></select></label><div class="toolbar staff-application-review-actions"><button class="mini danger" id="staffAppReject">Reject</button><button class="primary" id="staffAppGrant">Grant Rank</button></div><p id="staffAppReviewMessage" class="muted"></p>':'<p class="muted">This application has already been reviewed.</p>'}
    </div>`);
    $('staffAppReject')?.addEventListener('click',async()=>{const b=$('staffAppReject');b.disabled=true;try{await api('/api/staff/applications/'+encodeURIComponent(x.id)+'/reject',{method:'POST'});closeModal();toast('Application rejected.');await loadStaff();}catch(e){$('staffAppReviewMessage').textContent=e.message;b.disabled=false;}});
    $('staffAppGrant')?.addEventListener('click',async()=>{const b=$('staffAppGrant');b.disabled=true;try{await api('/api/staff/applications/'+encodeURIComponent(x.id)+'/grant',{method:'POST',body:JSON.stringify({rank:$('staffAppGrantRank').value})});closeModal();toast('Rank granted and application approved.');await loadStaff();}catch(e){$('staffAppReviewMessage').textContent=e.message;b.disabled=false;}});
  });
  }catch(e){const list=$('staffApplicationsList');if(list)list.innerHTML='<p class="muted">'+esc(e.message||'Could not load applications.')+'</p>';}
}

async function loadStaff() {
  try {
    const data=await api('/api/staff/dashboard');
    const bootstrapData=await api('/api/bootstrap');
    const filterWords=await api('/api/staff/filter-word');
    const systemCenter=await api('/api/staff/system-center').catch(()=>null);
    const canUseAdminPanel=['ADMIN','SUPER_ADMIN','COMMISSOR','COOWNER','OWNER','DEVELOPER'].includes(String(state.user?.rank||'').toUpperCase());



    $('staff').innerHTML=`
      ${(state.user?.username==='Maleficent'||String(state.user?.rank).toUpperCase()==='DEVELOPER') ? '<section class="card ip-inspection-card"><div><h3>🔎 IP Inspection</h3><p class="muted">Owner/Developer only · Registered email, recorded IP history and approximate network details.</p></div><form id="ipInspectionForm" class="ip-inspection-form"><input id="ipInspectionSearch" placeholder="Type @ or a username to find an account" maxlength="100" autocomplete="off"><button class="primary" type="submit">Inspect</button></form><div id="ipInspectionSuggestions" class="ip-inspection-suggestions" hidden></div><p class="muted ip-inspection-note">IP and network information is sensitive. Location is approximate. Lookups use IP Info with ipapi.co as a fallback.</p><div id="ipInspectionResults"><p class="muted">Search for an account to inspect its recorded IP history.</p></div></section>' : ''}
      <details class="filter-words-details staff-applications-dropdown" id="staffApplicationsDropdown"><summary>📝 Staff Applications <span class="staff-app-count" id="staffApplicationCount">Loading…</span></summary><div class="staff-applications-content" id="staffApplicationsList"><p class="muted">Loading applications…</p></div></details>
      <details class="filter-words-details system-notifications-dropdown" id="systemNotificationsDropdown">
        <summary>🔔 System Notifications</summary>
        <div class="system-notifications-content">
          <p class="muted">Send an announcement or important update as a notification to everyone or to accounts of a selected rank.</p>
          <form id="systemNotificationForm" class="system-notification-form">
            <label>Notification title<input id="systemNotificationTitle" maxlength="100" required placeholder="e.g. Scheduled maintenance"></label>
            <label>Recipient rank<select id="systemNotificationRank" required>
              <option value="ALL">All users</option><option value="MEMBER">Member</option><option value="VIP">VIP</option><option value="PREMIUM">Premium</option><option value="MOD">Moderator</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option><option value="COMMISSOR">Commissor</option><option value="COOWNER">Co-owner</option><option value="OWNER">Owner</option><option value="DEVELOPER">Developer</option>
            </select></label>
            <label>Recipient range<select id="systemNotificationRange" required><option value="EXACT">Selected rank only</option><option value="AND_ABOVE">Selected rank and above</option><option value="AND_BELOW">Selected rank and below</option></select></label>
            <p class="muted">“Above” includes the selected rank and every higher rank. “Below” includes the selected rank and every lower rank.</p>
            <label>Announcement / details<textarea id="systemNotificationMessage" maxlength="2000" rows="4" required placeholder="Write the announcement or details to send…"></textarea></label>
            <div class="toolbar"><button class="primary" id="sendSystemNotification" type="submit">📣 Send notification</button><span id="systemNotificationStatus" class="muted" aria-live="polite"></span></div>
          </form>
        </div>
      </details>
      <div class="grid2">
        <div class="card"><h3>Statistics</h3><p>Users: ${data.stats.users}<br>Online: ${data.stats.online}<br>Messages: ${data.stats.messages}<br>Open reports: ${data.stats.reportsOpen}</p></div>
        <div class="card"><h3>Filtered words</h3><button class="mini" onclick="addFilterWord()">＋ Add word</button><details class="filter-words-details"><summary>Filter words (${(filterWords.words||[]).length})</summary><div class="filter-word-list">${(filterWords.words||[]).map(w=>`<div class="filter-word-row"><code>${esc(w)}</code><button class="mini danger" onclick="deleteFilterWord(decodeURIComponent('${encodeURIComponent(w)}'))">×</button></div>`).join('')||'<span class="muted">No filter words configured.</span>'}</div></details><p class="muted">Link filter: ${bootstrapData.settings?.linkFilter?'ON':'OFF'}</p></div>
      </div>

      
      <div class="card"><h3>Reports</h3>
        ${(data.reports||[]).filter(report=>report.status==='OPEN').map(report=>{
          const snap=report.messageSnapshot||{};
          return `<div class="report-card"><div class="report-main"><div><b>${esc(report.category||(report.conversationUserId?"Private message report":report.messageId?"Message report":"Profile report"))}</b> · ${esc(report.status)}</div><div><b>Reported by:</b> @${esc(report.reporterUsername||findUserName(report.reporter)||'Unknown')}</div><div class="report-target"><b>Report made on:</b> @${esc(report.reportedUserUsername||snap.username||'Unknown')} ${esc(report.reportedUserRank||snap.rank||'')}</div>${report.conversationUserId?`<div class="report-message"><b>Private conversation:</b> @${esc(report.conversationUsername||findUserName(report.conversationUserId)||"Conversation participant")}<p class="muted">Open the evidence viewer to inspect the reported conversation.</p></div>`:""}<div class="report-message"><b>Reported content:</b><br>${snap.text?`<div>${esc(snap.text)}</div>`:''}${snap.attachment?.type?.startsWith('image/')?`<img class="reported-image" src="${esc(snap.attachment.url)}" alt="Reported photo">`:snap.attachment?`<a href="${esc(snap.attachment.url)}" target="_blank" rel="noopener">Open reported attachment</a>`:''}</div><div class="muted">Time: ${fmt(report.time)}</div><div class="muted">Reason: ${esc(report.reason||'No reason supplied')}</div></div><div class="toolbar"><button class="mini" data-assign-report="${esc(report.id)}">👤 Assign staff</button>${report.conversationUserId?`<button class="mini primary" onclick="viewPrivateMessageReport('${esc(report.id)}')">🔒 View private messages</button>`:''}${report.reportedUserId?`<button class="mini" onclick="moderate('${esc(report.reportedUserId)}')">⚙ Moderate user</button>`:''}${report.messageId?`<button class="mini danger" onclick="deleteReportedMessage('${esc(report.messageId)}')">🗑 Delete message</button>`:''}${report.status!=='RESOLVED'?`<button class="mini" onclick="resolveReport('${esc(report.id)}')">Resolve</button>`:''}</div></div>`;
        }).join('')||'<p class="muted">No reports.</p>'}
      </div>
    `;
    document.querySelectorAll("[data-assign-report]").forEach(button=>button.onclick=()=>assignReport(button.dataset.assignReport));
    await renderStaffApplications();
    $('systemNotificationForm')?.addEventListener('submit',async e=>{
      e.preventDefault();
      const button=$('sendSystemNotification'),status=$('systemNotificationStatus');
      const title=$('systemNotificationTitle')?.value.trim()||'';
      const message=$('systemNotificationMessage')?.value.trim()||'';
      const targetRank=$('systemNotificationRank')?.value||'ALL';
      const targetRange=$('systemNotificationRange')?.value||'EXACT';
      if(!title||!message){if(status)status.textContent='Enter a title and message.';return;}
      const rangeLabel=targetRank==='ALL'?'all users':(targetRank.replace(/_/g,' ')+(targetRange==='AND_ABOVE'?' and higher ranks':targetRange==='AND_BELOW'?' and lower ranks':''));
      if(!confirm('Send this notification to '+rangeLabel+'?'))return;
      button.disabled=true;if(status)status.textContent='Sending…';
      try{
        const result=await api('/api/staff/system-notifications',{method:'POST',body:JSON.stringify({title,message,targetRank,targetRange})});
        if(status)status.textContent='Sent to '+result.sent+' account'+(result.sent===1?'':'s')+'.';
        $('systemNotificationTitle').value='';$('systemNotificationMessage').value='';
        toast('System notification sent to '+result.sent+' account'+(result.sent===1?'':'s')+'.');
      }catch(err){if(status)status.textContent=err.message||'Could not send notification.';toast(err.message||'Could not send notification.');}
      finally{button.disabled=false;}
    });
    const ipSearch=$('ipInspectionSearch'), ipSuggestions=$('ipInspectionSuggestions');
    let ipSuggestTimer;
    ipSearch?.addEventListener('input',()=>{
      clearTimeout(ipSuggestTimer);
      const term=(ipSearch.value||'').trim().replace(/^@/,'');
      if(!ipSuggestions)return;
      if(!term){ipSuggestions.hidden=true;ipSuggestions.innerHTML='';return;}
      ipSuggestTimer=setTimeout(async()=>{
        try{
          const d=await api('/api/staff/ip-inspection/users?q='+encodeURIComponent(term));
          const users=d.users||[];
          ipSuggestions.innerHTML=users.length?users.map(u=>'<button type="button" class="ip-inspection-suggestion" data-ip-user="'+esc(u.username)+'"><b>@'+esc(u.username)+'</b><small>'+esc(u.email||'No email recorded')+'</small></button>').join(''):'<div class="muted ip-suggestion-empty">No matching accounts</div>';
          ipSuggestions.hidden=false;
        }catch(e){ipSuggestions.innerHTML='<div class="muted ip-suggestion-empty">'+esc(e.message||'Could not load accounts')+'</div>';ipSuggestions.hidden=false;}
      },180);
    });
    ipSuggestions?.addEventListener('click',e=>{const btn=e.target.closest('[data-ip-user]');if(!btn)return;ipSearch.value='@'+btn.dataset.ipUser;ipSuggestions.hidden=true;loadIpInspection(btn.dataset.ipUser);});
    ipSearch?.addEventListener('focus',()=>{if(ipSearch.value.trim())ipSearch.dispatchEvent(new Event('input'));});
    $('ipInspectionForm')?.addEventListener('submit',e=>{e.preventDefault();loadIpInspection((ipSearch?.value||'').trim().replace(/^@/,''));});

    $('refreshSystemCenter')?.addEventListener('click',()=>loadStaff());
    $('showAllAuditRows')?.addEventListener('click',async()=>{try{const d=await api('/api/staff/system-center/audit');const target=$('systemAuditRows');target.innerHTML=(d.audit||[]).map(renderAuditRow).join('')||'<p class="muted">No audit events recorded.</p>';if($('systemAuditSearch'))$('systemAuditSearch').value='';}catch(err){toast(err.message);}});
    $('staffAdminSearchForm')?.addEventListener('submit',async e=>{
      e.preventDefault();const target=$('staffAdminUsers');target.innerHTML='<p class="muted">Searching…</p>';
      try{const d=await api('/api/staff/admin/users?q='+encodeURIComponent(($('staffAdminSearch').value||'').trim()));
      target.innerHTML=(d.users||[]).map(u=>`<div class="user-card system-admin-user" data-admin-user="${esc(u.id)}"><div style="flex:1;min-width:0"><b>${esc(u.displayName||u.username)}</b> @${esc(u.username)}<div class="muted">${esc(u.rank)} · ${u.online?'Online':'Offline'} ${u.banned?'· BANNED':''}</div></div><select class="system-admin-action"><option>WARN</option><option>MUTE</option><option>KICK</option><option>BAN</option></select><label class="system-admin-duration-label">Duration (min)<input class="system-admin-duration" type="number" min="1" max="10080" value="10" aria-label="Duration minutes"></label><input class="system-admin-reason" maxlength="240" placeholder="Reason"><button class="mini primary system-admin-apply">Apply</button></div>`).join('')||'<p class="muted">No matching accounts.</p>';
      target.querySelectorAll('[data-admin-user]').forEach(row=>{const select=row.querySelector('.system-admin-action'),input=row.querySelector('.system-admin-duration'),label=row.querySelector('.system-admin-duration-label');const sync=()=>{const needed=['MUTE','KICK'].includes(select.value);input.disabled=!needed;label.firstChild.nodeValue=needed?'Duration (min)':'No duration needed';};select.addEventListener('change',sync);sync();});
      target.querySelectorAll('.system-admin-apply').forEach(btn=>btn.onclick=async()=>{const row=btn.closest('[data-admin-user]'),action=row.querySelector('.system-admin-action').value,needsDuration=['MUTE','KICK'].includes(action),minutes=Number(row.querySelector('.system-admin-duration').value),reason=row.querySelector('.system-admin-reason').value.trim();if(!reason){toast('Enter a reason.');return;}if(needsDuration&&(!Number.isFinite(minutes)||minutes<1||minutes>10080)){toast('Duration must be 1–10080 minutes for mute/kick.');return;}btn.disabled=true;try{await api('/api/moderation/'+action,{method:'POST',body:JSON.stringify({userId:row.dataset.adminUser,minutes:needsDuration?minutes:0,reason})});toast(action+' applied.');await loadStaff();}catch(err){toast(err.message);btn.disabled=false;}});
      }catch(err){target.innerHTML='<p class="muted">'+esc(err.message)+'</p>';}
    });
    $('systemAuditSearchForm')?.addEventListener('submit',async e=>{e.preventDefault();const target=$('systemAuditRows');target.innerHTML='<p class="muted">Loading…</p>';try{const d=await api('/api/staff/system-center/audit?q='+encodeURIComponent(($('systemAuditSearch').value||'').trim()));target.innerHTML=(d.audit||[]).map(renderAuditRow).join('')||'<p class="muted">No matches.</p>';}catch(err){target.innerHTML='<p class="muted">'+esc(err.message)+'</p>';}});
    const renderActiveActions=()=>{
      const filter=$("staffActionFilter")?.value||"";
      const rows=(data.activeActions||[]).filter(x=>!filter||(filter==="BANNED"&&x.banned)||(filter==="MUTED"&&x.mutedUntil)||(filter==="KICKED"&&x.kickedUntil));
      $("activeActionUsers").innerHTML=rows.map(x=>`<div class="user-card"><div style="flex:1"><b>${esc(x.displayName)}</b> @${esc(x.username)}<div class="muted">${rank(x.rank)} · ${x.banned?"Banned":x.kickedUntil?"Kicked until "+fmt(x.kickedUntil):"Muted until "+fmt(x.mutedUntil)}</div><div class="muted">${esc(x.reason||"")}</div></div><button class="mini" onclick="openUser('${esc(x.id)}')">Open</button></div>`).join("")||'<p class="muted">No users currently have this action.</p>';
    };
    $("staffActionFilter").onchange=renderActiveActions;
    renderActiveActions();
  }catch(e){toast(e.message)}
}

async function loadIpInspection(query=''){
  const results=$('ipInspectionResults'); if(!results)return;
  results.innerHTML='<p class="muted">Loading IP history and approximate network details…</p>';
  try{
    const d=await api('/api/staff/ip-inspection?q='+encodeURIComponent(query));
    const rows=d.records||[], matches=d.sameIpAccounts||[];
    if(!rows.length){results.innerHTML='<p class="muted">No accounts matched that search.</p>';return;}
    const rowHtml=rows.map(r=>{
      const n=r.network||{};
      const location=[n.city,n.region,n.country].filter(Boolean).join(', ');
      const network=[n.networkProvider,n.asn,n.organization&&n.organization!==n.networkProvider?n.organization:''].filter(Boolean).join(' · ');
      const technical=[n.timezone?'TZ: '+n.timezone:'',n.coordinates?'Approx. coordinates: '+n.coordinates:'',n.hostname?'Host: '+n.hostname:''].filter(Boolean).join(' · ');
      return '<tr><td><b>@'+esc(r.username||'Unknown')+'</b><small>'+esc(r.email||'No email recorded')+'</small><small>Registered: '+(r.registered_at?fmt(new Date(r.registered_at).getTime()):'Unknown')+'</small></td><td><code>'+esc(r.ip_address||'Unavailable')+'</code></td><td>'+esc(location||'Unavailable')+(n.networkType?'<small>'+esc(n.networkType)+'</small>':'')+'</td><td>'+esc(network||'Unavailable')+'</td><td>'+esc(technical||'Unavailable')+'</td><td><span class="ip-lookup-status">'+esc(n.lookupStatus||'Unavailable')+'</span>'+(n.lookupSource?'<small>Source: '+esc(n.lookupSource)+'</small>':'')+'</td><td>'+esc(r.event_type||'No event')+'<small>'+(r.recorded_at?fmt(new Date(r.recorded_at).getTime()):'No IP event recorded')+'</small></td><td class="ip-user-agent">'+esc(r.user_agent||'Unavailable')+'</td></tr>';
    }).join('');
    const matchRows=matches.map(r=>{
      const n=r.network||{};
      return '<tr><td><b>@'+esc(r.username||'Unknown')+'</b><small>'+esc(r.email||'No email recorded')+'</small><small>Registered: '+(r.created_at?fmt(new Date(r.created_at).getTime()):'Unknown')+'</small></td><td><code>'+esc(r.ip_address||'Unavailable')+'</code></td><td>'+esc([n.city,n.region,n.country].filter(Boolean).join(', ')||'Unavailable')+'</td><td>'+esc([n.networkProvider,n.asn,n.organization&&n.organization!==n.networkProvider?n.organization:''].filter(Boolean).join(' · ')||'Unavailable')+'</td><td>'+esc(r.event_type||'login')+'<small>'+(r.recorded_at?fmt(new Date(r.recorded_at).getTime()):'Unknown')+'</small></td></tr>';
    }).join('');
    const sameIpSection='<section class="about-card" style="margin-top:16px"><h3>🔗 Accounts with matching IP addresses ('+matches.length+')</h3><p class="muted">Accounts below have at least one recorded IP address matching an account in the search results. A shared IP can be caused by shared Wi-Fi, schools, workplaces, mobile carriers or VPNs; it does not prove the same person owns the accounts.</p>'+(matches.length?'<div class="ip-inspection-table-wrap"><table class="ip-inspection-table"><thead><tr><th>Matching account</th><th>Matching IP</th><th>Approx. location</th><th>ISP / ASN</th><th>Event / time</th></tr></thead><tbody>'+matchRows+'</tbody></table></div>':'<p class="muted">No other accounts with matching recorded IP addresses were found.</p>')+'</section>';
    const vpnUsers=d.vpnAccounts||[];
    const vpnSection='<section class="about-card vpn-using-section" style="margin-top:16px"><h3>🛡️ VPN using ('+vpnUsers.length+')</h3><p class="muted">Accounts with VPN/proxy provider flags or network-name signals in the IP history currently shown. Detection is approximate: some VPNs will not be detected, and hosting networks can be false positives.</p>'+(vpnUsers.length?'<div class="ip-inspection-table-wrap"><table class="ip-inspection-table"><thead><tr><th>Account</th><th>Rank</th><th>Network / country</th><th>Detection signal</th><th>Event / time</th></tr></thead><tbody>'+vpnUsers.map(u=>'<tr><td><b>@'+esc(u.username)+'</b></td><td>'+esc(u.rank||'Unknown')+'</td><td>'+esc([u.networkProvider,u.country].filter(Boolean).join(' · ')||'Unavailable')+'</td><td>'+esc((u.signals||[]).join(', ')||u.method||'Possible VPN / proxy')+'</td><td>'+esc(u.event_type||'Unknown')+'<small>'+(u.recorded_at?fmt(new Date(u.recorded_at).getTime()):'Unknown')+'</small></td></tr>').join('')+'</tbody></table></div>':'<p class="muted">No VPN/proxy signals were detected in the IP records loaded for this search.</p>')+'</section>';
    results.innerHTML=sameIpSection+vpnSection+'<div class="ip-inspection-table-wrap" style="margin-top:16px"><table class="ip-inspection-table"><thead><tr><th>Account / email</th><th>IP address</th><th>Approx. location</th><th>ISP / ASN / organization</th><th>Timezone / coordinates / host</th><th>Lookup status</th><th>Event / time</th><th>Browser</th></tr></thead><tbody>'+rowHtml+'</tbody></table></div><p class="muted">'+esc(d.geolocationNote||'IP location is approximate and may be unavailable.')+'</p>';
  }catch(e){results.innerHTML='<p class="muted">'+esc(e.message||'Could not load IP history.')+'</p>';}
}
async function showIpInsights(user){
  modal('<div class="about-card"><h2>🔎 Account insights</h2><p class="muted">Loading shared-IP matches and username history…</p></div>');
  try{
    const d=await api('/api/staff/user/'+encodeURIComponent(user.id)+'/ip-insights');
    const fmtDate=value=>value?fmt(new Date(value).getTime()):'Unknown';
    const history=d.user?.usernameHistory||[];
    const historyHtml=history.length?history.map(h=>'<div class="profile-info-row"><b>@'+esc(h.from||'Unknown')+' → @'+esc(h.to||'Unknown')+'</b><span>'+esc(fmtDate(h.time))+(h.changedBy?' · changed by @'+esc(h.changedBy):'')+'</span></div>').join(''):'<p class="muted">No previous username changes are recorded.</p>';
    const matches=d.matches||[];
    const matchHtml=matches.length?matches.map(m=>{
      const names=(m.usernameHistory||[]).length?m.usernameHistory.map(h=>'<small>@'+esc(h.from||'Unknown')+' → @'+esc(h.to||'Unknown')+' · '+esc(fmtDate(h.time))+'</small>').join(''):'<small>No previous usernames recorded</small>';
      return '<div class="about-card" style="margin-top:10px"><div class="profile-info-row"><b>👤 @'+esc(m.username)+'</b><span>Registered '+esc(fmtDate(m.registeredAt))+'</span></div><div class="profile-info-row"><b>Shared-IP events</b><span>'+esc(m.sharedIpEvents)+'</span></div><div style="margin-top:8px"><b>📜 Previous usernames</b>'+names+'</div></div>';
    }).join(''):'<p class="muted">No other accounts with a matching recorded IP were found.</p>';
    modal('<div class="profile-drawer"><h2>🔎 View insights · @'+esc(d.user?.username||user.username)+'</h2><div class="about-card"><div class="profile-info-row"><b>📅 Registration date</b><span>'+esc(fmtDate(d.user?.registeredAt))+'</span></div><h3>📜 Previous usernames</h3>'+historyHtml+'</div><h3 style="margin-top:16px">🔗 Accounts with matching IP ('+matches.length+')</h3>'+matchHtml+'<p class="muted" style="margin-top:12px">'+esc(d.note||'IP matches are not proof of common ownership.')+'</p><div class="toolbar"><button class="primary" id="closeIpInsights">Close</button></div></div>');
    $('closeIpInsights')?.addEventListener('click',closeModal);
  }catch(e){modal('<div class="about-card"><h2>🔎 Account insights</h2><p class="muted">'+esc(e.message||'Could not load insights.')+'</p><button class="primary" id="closeIpInsightsError">Close</button></div>');$('closeIpInsightsError')?.addEventListener('click',closeModal);}
}

function findUserName(id){
  return state.allUsers?.find(u=>u.id===id)?.username || (id?String(id).slice(0,12):'Unknown');
}
function logDetails(log){
  if(!log?.meta) return '';
  if(log.action==='MESSAGE_DELETE') return log.meta.text||log.meta.deletedSnapshot?.text||'';
  if(log.action==='NEWS_DELETE') return log.meta.title||'';
  if(log.action==='FEATURE_PERMISSION_CHANGE') return `${log.meta.rank||''}`;
  return typeof log.meta==='string'?log.meta:JSON.stringify(log.meta);
}

async function deleteReportedMessage(id){
  if(!confirm('Delete the reported message?')) return;
  try{await api(`/api/messages/${encodeURIComponent(id)}`,{method:'DELETE'});toast('Reported message deleted.');await loadStaff();}catch(e){toast(e.message)}}

async function addFilterWord() {
  const word =
    prompt(
      "Word or phrase to auto-filter:"
    );

  if (!word) return;

  try {
    await api(
      "/api/staff/filter-word",
      {
        method: "POST",
        body: JSON.stringify({ word })
      }
    );

    toast("Filter word added.");

    await loadStaff();
  } catch (error) {
    toast(error.message);
  }
}

async function deleteFilterWord(word){
  if(!confirm(`Delete filter word "${word}"?`)) return;
  try{await api('/api/staff/filter-word',{method:'DELETE',body:JSON.stringify({word})});toast('Filter word deleted.');await loadStaff();}catch(e){toast(e.message)}}

async function viewPrivateMessageReport(id){
  try{
    const data=await api("/api/staff/reports/"+encodeURIComponent(id)+"/private-messages");
    const messages=Array.isArray(data.messages)?data.messages:[],report=data.report||{};
    const messageText=m=>m.text||m.message||m.content||m.body||m.messageText||"Message content unavailable";
    const senderName=m=>m.senderUsername||m.sender_username||m.username||m.senderName||(String(m.senderId||m.sender_id||m.from||"")===String(report.reportedUserId)?report.reportedUserUsername:String(m.senderId||m.sender_id||m.from||"")===String(report.conversationUserId)?report.conversationUsername:"")||m.sender||"Conversation participant";
    const stamp=m=>{const v=m.time||m.createdAt||m.created_at;return v?fmt(v):"Time not recorded";};
    const rows=[...messages].sort((a,b)=>Number(a.time||a.createdAt||a.created_at||0)-Number(b.time||b.createdAt||b.created_at||0)).map(m=>'<article class="private-report-message"><div><b>@'+esc(senderName(m)) + '</b><time>'+esc(stamp(m))+'</time></div><p>'+esc(messageText(m))+'</p>'+(m.attachment&&m.attachment.url?'<a href="'+esc(m.attachment.url)+'" target="_blank" rel="noopener">Open attachment</a>':'')+'</article>').join("");
    modal('<div class="private-report-modal"><div class="section-title"><div><h2>🔒 Reported private-message evidence</h2><p class="muted">Evidence attached to this report.</p></div></div><div class="private-report-meta"><div><small>Reported by</small><b>@'+esc(report.reporterUsername||"Unknown")+'</b></div><div><small>Reported account</small><b>@'+esc(report.reportedUserUsername||"Unknown")+'</b></div><div><small>Reason</small><b>'+esc(report.reason||"No reason supplied")+'</b></div></div><div class="private-report-transcript">'+(rows||'<p class="muted">No message snapshots were saved with this report.</p>')+'</div></div>');
  }catch(e){toast(e.message||"Could not load private-message evidence.");}
}
async function resolveReport(id) {
  const resolutionNote=prompt("Add a resolution note (optional):","Reviewed by staff.");
  if(resolutionNote===null)return;
  try {
    await api(`/api/staff/reports/${encodeURIComponent(id)}/resolve`,{method:"POST",body:JSON.stringify({status:"RESOLVED",resolutionNote})});
    toast("Report resolved and note saved.");
    if(state.view==="staff") await loadStaff();
    const box=$("reportDropdown");
    if(box&&!box.classList.contains("hidden")) await toggleReportDropdown(true);
    await loadNotifications();
  } catch (error) { toast(error.message); }
}
async function assignReport(id){
  const username=prompt("Enter the username of the site staff member to assign this report to (you can include @):");
  if(!username)return;
  try{
    await api(`/api/staff/reports/${encodeURIComponent(id)}/assign`,{method:"POST",body:JSON.stringify({username:username.trim().replace(/^@/,"")})});
    toast("Report assigned.");
    if(state.view==="staff")await loadStaff();
  }catch(error){toast(error.message||"Could not assign report.");}
}

async function showUserActionHistory(userId){
  try{
    const r=await api('/api/users/'+encodeURIComponent(userId)+'/action-history');
    const entries=r.history||[];
    const rows=entries.map(h=>'<div class="card user-history-entry"><div class="user-history-entry-copy"><b>'+esc(h.action)+'</b> · '+esc(h.actorUsername||h.actor||'SYSTEM')+'<br><small>'+fmt(h.time)+(h.expiresAt?' · expires '+fmt(h.expiresAt):'')+'</small><br>'+esc(h.reason||'No reason recorded')+'</div><button class="mini danger" type="button" onclick="deleteUserActionHistory(\''+esc(userId)+'\',\''+esc(h.id)+'\')">Delete</button></div>').join('');
    modal('<div class="user-history-modal"><h2>📜 User history</h2><div class="toolbar"><button class="mini danger" type="button" onclick="clearUserActionHistory(\''+esc(userId)+'\')">🧹 Clear History</button></div><p class="muted">Delete removes one selected action. Clear History removes this user’s staff-action history only.</p><div class="stack user-history-entries">'+(rows||'<p class="muted">No user history recorded.</p>')+'</div></div>');
  }catch(e){toast(e.message)}
}
async function deleteUserActionHistory(userId,actionId){
  if(!confirm('Delete this specific history action?'))return;
  try{await api('/api/users/'+encodeURIComponent(userId)+'/action-history/'+encodeURIComponent(actionId),{method:'DELETE'});toast('History action deleted.');await showUserActionHistory(userId)}catch(e){toast(e.message)}
}
async function clearUserActionHistory(userId){
  if(!confirm('Clear all staff-action history for this user? This will not delete their account or chat messages.'))return;
  try{const r=await api('/api/users/'+encodeURIComponent(userId)+'/action-history/clear',{method:'POST'});toast('Cleared '+Number(r.removed||0)+' history action(s).');await showUserActionHistory(userId)}catch(e){toast(e.message)}
}
/* ---------------- OWNER ---------------- */

async function refreshSiteMessages(){
  if(!confirm('This permanently deletes ALL room chat messages and ALL private messages for every user. Accounts, rooms, ranks, gold, settings, reports, and moderation history will remain. Continue?'))return;
  try{
    const result=await api('/api/owner/refresh-site-messages',{method:'POST',body:JSON.stringify({})});
    state.messages=[];
    if($('messages'))$('messages').innerHTML='';
    if($('messages'))$('messages').scrollTop=0;
    if(state.dmUserId){try{await openDM(state.dmUserId);}catch{}}
    toast('Site messages cleared: '+Number(result.roomMessages||0)+' room messages and '+Number(result.privateMessages||0)+' private messages.');
    if(state.view==='owner')loadOwner();
  }catch(e){toast('Could not clear site messages: '+e.message)}
}
async function loadCommunityRules(){
 const host=$('communityRules');if(!host)return;
 const owner=String(state.user?.rank||'').toUpperCase()==='DEVELOPER'||(String(state.user?.rank||'').toUpperCase()==='OWNER'&&state.user?.username==='Maleficent');
 try{
  const data=await api('/api/community-rules');let rules=(data.rules||[]).map(r=>({id:String(r.id),text:String(r.text||'')}));
  let editMode=false;const editing=new Set();const drafts=new Map();
  const render=()=>{
   const toolbar=owner?'<div class="community-rules-toolbar"><div><b>📜 Community Rules</b><p class="muted">Keep the published rules clear and easy to read.</p></div><div class="toolbar"><button type="button" class="mini '+(editMode?'':'primary')+'" id="toggleCommunityRuleEdit">'+(editMode?'✕ Done editing':'✏️ Edit rules')+'</button>'+(editMode?'<button type="button" class="mini primary" id="addCommunityRule">＋ Add rule</button>':'')+'</div></div>':'';
   const cards=rules.map((r,i)=>{const isEditing=editMode&&editing.has(r.id),text=isEditing?(drafts.get(r.id)??r.text):r.text;return '<article class="community-rule-card"><div class="community-rule-head"><h3>MC RULE '+(i+1)+'</h3>'+(editMode?'<div class="toolbar">'+(isEditing?'<button type="button" class="mini primary" data-save-rule="'+esc(r.id)+'">Save</button><button type="button" class="mini" data-cancel-rule="'+esc(r.id)+'">Cancel</button>':'<button type="button" class="mini" data-edit-rule="'+esc(r.id)+'">✏️ Edit</button>')+'<button type="button" class="mini danger" data-remove-rule="'+esc(r.id)+'">Remove</button></div>':'')+'</div>'+(isEditing?'<textarea rows="4" maxlength="2000" data-community-rule="'+esc(r.id)+'" placeholder="Write the rule…">'+esc(text)+'</textarea>':'<p class="community-rule-text">'+(r.text.trim()?esc(r.text):'<span class="muted">This rule is empty. Use Edit rules to add its text.</span>')+'</p>')+'</article>';}).join('');
   host.innerHTML=toolbar+(cards||'<div class="card"><p class="muted">No community rules have been published yet.</p>'+(owner?'<button type="button" class="primary" id="addCommunityRule">＋ Add the first rule</button>':'')+'</div>');
   if(!owner)return;
   $('toggleCommunityRuleEdit')?.addEventListener('click',()=>{editMode=!editMode;editing.clear();drafts.clear();render();});
   $('addCommunityRule')?.addEventListener('click',()=>{const id='draft-'+Date.now()+'-'+Math.random().toString(36).slice(2);rules.push({id,text:''});editMode=true;editing.add(id);drafts.set(id,'');render();host.querySelector('[data-community-rule="'+CSS.escape(id)+'"]')?.focus();});
   host.querySelectorAll('[data-edit-rule]').forEach(btn=>btn.onclick=()=>{const id=btn.dataset.editRule;editing.add(id);drafts.set(id,rules.find(r=>r.id===id)?.text||'');render();});
   host.querySelectorAll('[data-community-rule]').forEach(area=>area.addEventListener('input',()=>drafts.set(area.dataset.communityRule,area.value)));
   host.querySelectorAll('[data-cancel-rule]').forEach(btn=>btn.onclick=()=>{const id=btn.dataset.cancelRule,rule=rules.find(r=>r.id===id);if(id.startsWith('draft-')&&!rule?.text)rules=rules.filter(r=>r.id!==id);editing.delete(id);drafts.delete(id);render();});
   host.querySelectorAll('[data-save-rule]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.saveRule,area=host.querySelector('[data-community-rule="'+CSS.escape(id)+'"]'),text=(area?.value??drafts.get(id)??'').trim();if(!text){toast('Write the rule before saving.');area?.focus();return;}const next=rules.map(r=>r.id===id?{...r,text}:r);btn.disabled=true;btn.textContent='Saving…';try{const out=await api('/api/owner/community-rules',{method:'PUT',body:JSON.stringify({rules:next})});rules=(out.rules||[]).map(r=>({id:String(r.id),text:String(r.text||'')}));editing.clear();drafts.clear();toast('Rule saved.');render();}catch(e){toast(e.message||'Could not save rule.');btn.disabled=false;btn.textContent='Save';}});
   host.querySelectorAll('[data-remove-rule]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.removeRule;if(!confirm('Remove this rule from the published Rules section?'))return;try{const out=await api('/api/owner/community-rules',{method:'PUT',body:JSON.stringify({rules:rules.filter(r=>r.id!==id)})});rules=(out.rules||[]).map(r=>({id:String(r.id),text:String(r.text||'')}));editing.delete(id);drafts.delete(id);toast('Rule removed.');render();}catch(e){toast(e.message||'Could not remove rule.');}});
  };
  render();
 }catch(e){host.innerHTML='<div class="card"><p class="muted">Could not load community rules: '+esc(e.message)+'</p></div>';}
}

async function loadOwner() {
  try {
    const data =
      await api("/api/owner/overview");
    const filterData = await api("/api/filter-words").catch(()=>({words:[],total:0}));
    const premiumRequests = await api("/api/owner/premium-requests").catch(()=>({requests:[]}));

    $("owner").innerHTML = `
      <div class="card">

        <h3>
          Permanent Developer Space
        </h3>

        <p>
          Owner-only controls for
          users, ranks, gold,
          private-message inspection,
          rooms and settings.
        </p>

        <div class="toolbar">

          <button
            class="primary"
            onclick="inspectDMs()"
          >
            Inspect private messages
          </button>
          <button class="mini danger" type="button" onclick="refreshSiteMessages()">🧹 Refresh Site Messages</button>

          <button class="mini" onclick="ownerFeatureGrants()">🧩 Feature granting</button>
          

        </div>

      </div>

      <details class="filter-words-details owner-settings-dropdown owner-audit-dropdown">
        <summary>📜 Audit Logs Management — open to configure event visibility</summary>
        <div class="owner-audit-dropdown-content">
          <div class="card owner-audit-management">
            <h3>📜 Audit Logs Management</h3>
            <p class="muted">Control which event types appear in Staff Dashboard audit logs and choose the minimum rank allowed to view each type.</p>
            <div class="owner-audit-toolbar"><input id="ownerAuditTypeSearch" type="search" placeholder="Search event types…"><button class="mini" type="button" id="ownerAuditAllOn">Turn all on</button><button class="mini" type="button" id="ownerAuditAllOff">Turn all off</button></div>
            <div id="ownerAuditVisibilityRows" class="owner-audit-visibility-list"></div>
            <div class="toolbar"><button class="primary" type="button" id="saveOwnerAuditVisibility">Save Audit Log Settings</button><span class="muted" id="ownerAuditSaveStatus">Unsaved changes stay here until saved.</span></div>
          </div>
        </div>
      </details>

      <div class="card">
        <h3>🚫 Filter Words — Bulk Add</h3>
        <label>Bulk Add - One word per line (ENTER)<textarea id="bulkFilterWords" placeholder="Father\nMother\nHello\nInshalla"></textarea></label>
        <div class="toolbar"><button class="primary" id="addBulkFilter">Add Bulk</button><input type="search" id="filterSearch" placeholder="Search word..."></div>
        <div id="filterCounts">Total: ${filterData.total||0} | Showing: ${filterData.total||0}</div>
        <details class="filter-words-details"><summary>Filter words (${filterData.total||0})</summary><div id="ownerFilterTable">${(filterData.words||[]).map(w=>`<div class="filter-table-row" data-word="${esc(w.word||w)}"><code>${esc(w.word||w)}</code><small>${w.created_at?fmt(w.created_at):''}</small><button class="mini danger" data-filter-delete="${w.id||''}">×</button></div>`).join('')||'<p class="muted">No filter words.</p>'}</div></details>
      </div>

      <div class="card"><h3>💎 Premium Requests</h3>${(premiumRequests.requests||[]).map(r=>`<div class="hub-row"><span>@${esc(r.username||'Unknown')} · ${esc(r.created_at||'')}</span><button class="mini" data-grant-premium="${r.id}">Grant Premium</button><button class="mini danger" data-cancel-premium="${r.user_id||r.id}">Cancel Premium</button></div>`).join('')||'<p class="muted">No requests.</p>'}</div><div class="card owner-settings-card">
        <h3>⚙️ Site Settings</h3>
        <details class="filter-words-details owner-settings-dropdown">
          <summary>Site settings — open to view and manage options</summary>
          <div class="owner-settings-content">
            <div class="owner-settings-grid">
<label>Gold cost per GIF<input id="ownerGifCost" type="number" min="0" value="${Number(data.settings?.gif_cost??10)}"></label><label>Gold per message<input id="ownerGoldPerMessage" type="number" min="0" value="${Number(data.settings?.gold_per_message??data.settings?.goldPerMessage??0)}"></label>
<label>XP per message<input id="ownerXpPerMessage" type="number" min="0" value="${Number(data.settings?.xp_per_message??data.settings?.xpPerMessage??5)}"></label>
<label>Daily XP limit<input id="ownerDailyXp" type="number" min="1" value="${Number(data.settings?.daily_xp_limit??data.settings?.dailyXpLimit??500)}"></label><label>Daily reward gold<input id="ownerDailyRewardGold" type="number" min="0" value="${Number(data.settings?.daily_reward_gold??25)}"></label><label>Daily reward XP<input id="ownerDailyRewardXp" type="number" min="0" value="${Number(data.settings?.daily_reward_xp??15)}"></label>
<label>Filter mute duration (minutes)<input id="ownerFilterDuration" type="number" min="1" value="${Number(data.settings?.filter_mute_duration??data.settings?.filterMuteDurationMinutes??5)}"></label>
</div><b>Filter word affected ranks</b><div class="rank-check-grid">${['MEMBER','VIP','PREMIUM','MOD','ADMIN','SUPER_ADMIN','COMMISSOR','COOWNER','OWNER'].map(r=>`<label><input type="checkbox" data-filter-rank value="${r}" ${(data.settings?.filter_affected_ranks||['MEMBER','VIP','PREMIUM','MOD','ADMIN','SUPER_ADMIN','COMMISSOR','COOWNER','OWNER']).includes(r)?'checked':''}> ${r}</label>`).join('')}</div><button class="primary" onclick="saveOwnerSiteState()">Save Site Settings</button>
          </div>
        </details>
      </div>

      <div class="card owner-user-controls-card">
        <h3>👥 User controls</h3>
        <details class="filter-words-details owner-user-controls-dropdown">
          <summary>User controls — open to manage accounts</summary>
          <div class="owner-user-controls-content">
            <div class="owner-user-search">
              <input id="ownerUserSearch" type="search" placeholder="🔎 Search users by username, display name, or rank…" autocomplete="off" aria-label="Search user controls">
              <span id="ownerUserSearchCount" class="muted">${(data.users||[]).length} users</span>
            </div>
        ${
          (data.users || [])
            .map(user => `
              <div class="user-card owner-user-control-row" data-user-search="${esc([user.username,user.displayName,user.rank,user.id].filter(Boolean).join(" ").toLowerCase())}">

                ${avatar(user)}

                <div style="flex:1">

                  <b>
                    ${esc(user.displayName)}
                  </b>

                  @${esc(user.username)}

                  <br>

                  ${rank(user.rank)}

                  · 🪙 ${user.gold || 0}

                  · Lv ${user.level || 1}

                </div>

                ${user.username === "Maleficent" || String(user.rank).toUpperCase() === "DEVELOPER"
                  ? '<button class="mini" type="button" disabled title="Permanent Developer account is protected">Protected</button>'
                  : '<button class="mini" type="button" onclick="ownerEdit(\''+esc(user.id)+'\')">Manage</button>'}

              </div>
            `)
            .join("")
        }
          </div>
        </details>
      </div>


    `;

    
    
    for(const key of ['multi_account','ban_evasion','spam_flood','vpn_proxy']){const actionSelect=$('sm_'+key+'_action'),durationInput=$('sm_'+key+'_duration'),label=durationInput?.closest('label');const sync=()=>{const needed=['MUTE','KICK'].includes(actionSelect?.value);if(durationInput)durationInput.disabled=!needed;if(label)label.firstChild.nodeValue=needed?'Duration (minutes)':'No duration required';};actionSelect?.addEventListener('change',sync);sync();}
    if($('saveSystemModeration')) $('saveSystemModeration').onclick=async()=>{
      const rules={};
      for(const key of ['multi_account','ban_evasion','spam_flood','vpn_proxy']){
        const action=$('sm_'+key+'_action').value;
        const needsDuration=['MUTE','KICK'].includes(action);
        const duration=needsDuration?Number($('sm_'+key+'_duration').value):0;
        const reason=$('sm_'+key+'_reason').value.trim();
        if(!['WARN','MUTE','KICK','BAN'].includes(action)){toast('Choose a valid action.');return;}
        if(needsDuration&&(!Number.isFinite(duration)||duration<1||duration>10080)){toast('Duration must be between 1 and 10080 minutes for mute/kick.');return;}
        if(!reason){toast('Enter a reason for each System Moderation rule.');return;}
        rules[key]={enabled:$('sm_'+key+'_enabled').checked,action,durationMinutes:needsDuration?duration:0,reason};
      }
      try{await api('/api/owner/settings',{method:'PATCH',body:JSON.stringify({systemModeration:rules})});toast('System Moderation settings saved.');}
      catch(e){toast(e.message);}
    };
    const auditTypes = [
      ["deleted_messages","Deleted messages","MESSAGE_DELETE, DELETE_MESSAGE, MESSAGE_DELETED"],
      ["edited_messages","Edited messages","MESSAGE_EDIT, EDIT_MESSAGE, MESSAGE_UPDATED"],
      ["rank_changes","Rank changes","RANK_CHANGE, USER_RANK, RANK_UPDATE"],
      ["account_changes","Account changes","ACCOUNT_MODIFY, USER_UPDATE, ACCOUNT_UPDATE"],
      ["login_activity","Login / logout activity","LOGIN, LOGOUT"],
      ["invisible_mode","Invisible mode changes","INVISIBLE_MODE"],
      ["feature_permissions","Feature permission changes","FEATURE_ACCESS_BULK_SAVE, FEATURE_ACCESS"],
      ["moderation_actions","Bans, mutes and kicks","BAN, UNBAN, MUTE, KICK, MODERATION"],
      ["reports","Reports and report resolution","REPORT"],
      ["room_changes","Room creation / edits / deletion","ROOM_CREATE, ROOM_EDIT, ROOM_DELETE, ROOM_CLEAR"],
      ["gold_transactions","Gold and currency changes","GOLD, GOLD_SHARE, GOLD_TRANSFER"],
      ["site_settings","Site settings changes","SETTINGS_UPDATE, SITE_SETTINGS"],
      ["private_messages","Private message moderation","PRIVATE_MESSAGE, DM_"],
      ["file_uploads","Uploads and attachments","UPLOAD, ATTACHMENT"],
      ["profile_changes","Profile and avatar changes","PROFILE, AVATAR, BIO"],
      ["staff_actions","Staff dashboard actions","STAFF_"]
    ];
    const auditRanks = ["MEMBER","VIP","PREMIUM","ROYAL","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"];
    const defaultAuditVisibility = Object.fromEntries(auditTypes.map(([key])=>[key,{enabled:true,minimumRank:"ADMIN"}]));
    const auditVisibility = {...defaultAuditVisibility,...(data.settings?.audit_log_visibility||{})};
    const renderOwnerAuditVisibility = (query="") => {
      const host=$("ownerAuditVisibilityRows"); if(!host)return;
      const q=query.trim().toLowerCase();
      host.innerHTML=auditTypes.filter(([key,label,actions])=>!q||(key+" "+label+" "+actions).toLowerCase().includes(q)).map(([key,label,actions])=>{
        const rule={...defaultAuditVisibility[key],...(auditVisibility[key]||{})};
        return '<div class="owner-audit-rule" data-audit-rule="'+esc(key)+'"><div class="owner-audit-rule-main"><b>'+esc(label)+'</b><small>Events: '+esc(actions.split(", ").join(" · "))+'</small></div><label class="owner-audit-toggle"><input type="checkbox" data-audit-enabled="'+esc(key)+'" '+(rule.enabled!==false?'checked':'')+'><span>Visible</span></label><label class="owner-audit-rank-label">Minimum rank<select data-audit-rank="'+esc(key)+'">'+auditRanks.map(rankName=>'<option value="'+rankName+'" '+(String(rule.minimumRank||"ADMIN").toUpperCase()===rankName?'selected':'')+'>'+rankName.replace(/_/g," ")+'</option>').join("")+'</select></label></div>';
      }).join("")||'<p class="muted">No event types match your search.</p>';
      host.querySelectorAll("[data-audit-enabled]").forEach(el=>el.addEventListener("change",()=>{auditVisibility[el.dataset.auditEnabled]={...(auditVisibility[el.dataset.auditEnabled]||{}),enabled:el.checked};$("ownerAuditSaveStatus").textContent="Unsaved changes";}));
      host.querySelectorAll("[data-audit-rank]").forEach(el=>el.addEventListener("change",()=>{auditVisibility[el.dataset.auditRank]={...(auditVisibility[el.dataset.auditRank]||{}),minimumRank:el.value};$("ownerAuditSaveStatus").textContent="Unsaved changes";}));
    };
    renderOwnerAuditVisibility();
    $("ownerAuditTypeSearch")?.addEventListener("input",e=>renderOwnerAuditVisibility(e.target.value));
    $("ownerAuditAllOn")?.addEventListener("click",()=>{auditTypes.forEach(([key])=>auditVisibility[key]={...(auditVisibility[key]||{}),enabled:true});renderOwnerAuditVisibility($("ownerAuditTypeSearch")?.value||"");$("ownerAuditSaveStatus").textContent="Unsaved changes";});
    $("ownerAuditAllOff")?.addEventListener("click",()=>{auditTypes.forEach(([key])=>auditVisibility[key]={...(auditVisibility[key]||{}),enabled:false});renderOwnerAuditVisibility($("ownerAuditTypeSearch")?.value||"");$("ownerAuditSaveStatus").textContent="Unsaved changes";});
    $("saveOwnerAuditVisibility")?.addEventListener("click",async()=>{
      const btn=$("saveOwnerAuditVisibility");btn.disabled=true;
      try{const result=await api("/api/owner/settings",{method:"PATCH",body:JSON.stringify({auditLogVisibility:auditVisibility})});Object.assign(auditVisibility,result.settings?.audit_log_visibility||{});$("ownerAuditSaveStatus").textContent="Saved successfully.";toast("Audit log visibility settings saved.");}
      catch(error){$("ownerAuditSaveStatus").textContent="Save failed: "+(error.message||"Unknown error");toast(error.message||"Could not save audit settings.");}
      finally{btn.disabled=false;}
    });
    if($('ownerUserSearch')) $('ownerUserSearch').oninput=()=>{const q=$('ownerUserSearch').value.trim().toLowerCase();const rows=[...document.querySelectorAll('.owner-user-control-row')];let showing=0;rows.forEach(row=>{const match=(row.dataset.userSearch||'').includes(q);row.style.display=match?'':'none';if(match)showing++});if($('ownerUserSearchCount'))$('ownerUserSearchCount').textContent=q?(`${showing} of ${rows.length} users`):(`${rows.length} users`)};
    if($('addBulkFilter')) $('addBulkFilter').onclick=async()=>{try{await api('/api/filter-words/bulk',{method:'POST',body:JSON.stringify({text:$('bulkFilterWords').value})});$('bulkFilterWords').value='';await loadOwner();}catch(e){toast(e.message)}};
    if($('filterSearch')) $('filterSearch').oninput=()=>{const q=$('filterSearch').value.toLowerCase();const rows=[...document.querySelectorAll('.filter-table-row')];let showing=0;rows.forEach(r=>{const show=r.dataset.word.toLowerCase().includes(q);r.style.display=show?'':'none';if(show)showing++});$('filterCounts').textContent=`Total: ${rows.length} | Showing: ${showing}`};
    document.querySelectorAll('[data-filter-delete]').forEach(b=>b.onclick=async()=>{try{await api('/api/filter-words/'+b.dataset.filterDelete,{method:'DELETE'});loadOwner()}catch(e){toast(e.message)}});
    document.querySelectorAll('[data-grant-premium]').forEach(b=>b.onclick=async()=>{try{await api('/api/owner/premium-requests/'+b.dataset.grantPremium+'/grant',{method:'POST'});toast('Premium granted.');loadOwner()}catch(e){toast(e.message)}}); document.querySelectorAll('[data-cancel-premium]').forEach(b=>b.onclick=async()=>{try{const r=await api('/api/premium/cancel',{method:'POST',body:JSON.stringify({userId:b.dataset.cancelPremium})});b.closest('.hub-row')?.remove();toast('Premium cancelled.');}catch(e){toast(e.message)}});
  } catch (error) {
    toast(error.message);
  }
}

async function ownerEdit(id) {
  try {
    const data =
      await api("/api/owner/overview");

    const user = (data.users || []).find(u => String(u.id) === String(id));
    if (!user) {
      toast("This account could not be found. Refresh Owner Space and try again.");
      return;
    }

    const editableRanks = [
      "MEMBER",
      "VIP",
      "PREMIUM",
      "MOD",
      "ADMIN",
      "SUPER_ADMIN",
      "COMMISSOR",
      "COOWNER",
      "OWNER"
    ];

    modal(`
      <h2>Manage @${esc(user.username)}</h2>
      <p class="muted">${user.username==="Maleficent" ? "Permanent Developer account. Its identity and rank are protected." : "Manage this account’s rank, Gold, XP and level."}</p>

      <p class="muted">Birth date: ${esc(user.birth_date||'—')} · Gender: ${esc(user.gender||'—')}</p>
      <select id="orank">

        ${
          editableRanks
            .map(r => `
              <option
                value="${r}"
                ${
                  r === user.rank
                    ? "selected"
                    : ""
                }
              >
                ${r}
              </option>
            `)
            .join("")
        }

      </select>

      <input id="ogold" type="number" value="${user.gold || 0}" placeholder="Gold">
      <label>XP<input id="oxp" type="number" min="0" value="${Number(user.xp||0)}"></label>
      <label>Level<input id="olevel" type="number" min="1" value="${Number(user.level||1)}"></label>

      <div class="toolbar">

        <button
          class="primary"
          onclick="saveOwnerUser(
            '${esc(user.id)}'
          )"
        >
          Save
        </button>

        ${
          user.username !== "Maleficent"
            ? `
              <button
                class="mini danger"
                onclick="ownerDelete(
                  '${esc(user.id)}'
                )"
              >
                Delete account
              </button>
            `
            : ""
        }

      </div>
    `);
  } catch (error) {
    toast(error.message);
  }
}

async function saveOwnerUser(id) {
  try {
    if(!(id===state.user?.id && state.user?.username==="Maleficent" && state.user?.rank==="OWNER")){
      await api(`/api/owner/user/${id}/rank`,{method:"PATCH",body:JSON.stringify({rank:$("orank").value})});
    }

    await api(
      `/api/owner/user/${id}/gold`,
      {
        method: "PATCH",
        body: JSON.stringify({
          amount: $("ogold").value
        })
      }
    );

    if($("oxp") && $("olevel")) await api(`/api/owner/user/${id}/progress`,{method:"PATCH",body:JSON.stringify({xp:$("oxp").value,level:$("olevel").value})});

    if(id===state.user?.id){const refreshed=await api("/api/me");if(refreshed.user){state.user=refreshed.user;updateNav();}}
    closeModal();
    await loadOwner();
    toast("User updated.");
  } catch (error) {
    toast(error.message);
  }
}

async function ownerDelete(id) {
  if (
    !confirm(
      "Delete this account permanently?"
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/owner/user/${id}`,
      {
        method: "DELETE"
      }
    );

    closeModal();

    await loadOwner();
  } catch (error) {
    toast(error.message);
  }
}

async function inspectDMs(){
  try{
    modal(`<h2>Private-message inspection</h2><p class="muted">Choose an account from the suggestions, or type a username beginning with @. Select a second account to inspect only their conversation.</p><div class="dm-inspection-fields"><div class="dm-inspection-picker"><label for="dmSearch1">Account 1</label><input id="dmSearch1" placeholder="Type @ or username" autocomplete="off"><div id="dmSuggestions1" class="ip-inspection-suggestions" hidden></div></div><div class="dm-inspection-picker"><label for="dmSearch2">Account 2 (optional)</label><input id="dmSearch2" placeholder="Optional: second user" autocomplete="off"><div id="dmSuggestions2" class="ip-inspection-suggestions" hidden></div></div><button class="primary" id="dmSearchBtn">Inspect messages</button></div><div id="ownerDmResults" class="stack"><p class="muted">Select an account and press Inspect messages.</p></div>`);
    const wirePicker=(inputId,suggestId)=>{
      const input=$(inputId),suggestions=$(suggestId);let timer;
      input?.addEventListener('input',()=>{
        clearTimeout(timer);const term=(input.value||'').trim().replace(/^@/,'');
        if(!term){suggestions.hidden=true;suggestions.innerHTML='';return;}
        timer=setTimeout(async()=>{try{
          const d=await api('/api/staff/ip-inspection/users?q='+encodeURIComponent(term));
          const users=d.users||[];
          suggestions.innerHTML=users.length?users.map(u=>'<button type="button" class="ip-inspection-suggestion" data-dm-username="'+esc(u.username)+'"><b>@'+esc(u.username)+'</b><small>'+esc(u.email||'Account')+'</small></button>').join(''):'<div class="muted ip-suggestion-empty">No matching accounts</div>';
          suggestions.hidden=false;
        }catch(e){suggestions.innerHTML='<div class="muted ip-suggestion-empty">'+esc(e.message||'Could not load accounts')+'</div>';suggestions.hidden=false;}},180);
      });
      suggestions?.addEventListener('click',e=>{const option=e.target.closest('[data-dm-username]');if(!option)return;input.value='@'+option.dataset.dmUsername;suggestions.hidden=true;suggestions.innerHTML='';});
      input?.addEventListener('focus',()=>{if(input.value.trim())input.dispatchEvent(new Event('input'));});
    };
    wirePicker('dmSearch1','dmSuggestions1');wirePicker('dmSearch2','dmSuggestions2');
    const load=async()=>{
      const user1=($('dmSearch1').value||'').trim().replace(/^@/,'');
      const user2=($('dmSearch2').value||'').trim().replace(/^@/,'');
      const target=$('ownerDmResults');if(!user1){target.innerHTML='<p class="error">Select or enter the first username.</p>';return;}
      target.innerHTML='<p class="muted">Loading private messages…</p>';
      try{
        const d=await api('/api/admin/private-search',{method:'POST',body:JSON.stringify({user1,user2})});
        const messages=d.messages||[];
        target.innerHTML='<p class="muted">'+messages.length+' message(s) found'+(user2?' between @'+esc(user1)+' and @'+esc(user2):' involving @'+esc(user1))+'.</p>'+
          (messages.map(m=>{
            const body=m.text??m.message??m.data?.text??m.data?.message??m.data?.content??'';
            const attachment=m.attachment||m.data?.attachment;
            return '<div class="card dm-inspection-message"><b>@'+esc(m.sender_username||m.senderUsername||'Unknown')+' → @'+esc(m.receiver_username||m.receiverUsername||'Unknown')+'</b><div class="dm-inspection-body">'+(String(body).trim()?esc(body).replace(/\n/g,'<br>'):'<span class="muted">'+(attachment?'Attachment message (text is empty).':'Message has no text content.')+'</span>')+'</div>'+(attachment?'<div class="muted">📎 '+esc(attachment.name||attachment.type||'Attachment')+'</div>':'')+'<small class="muted">'+esc(fmt(m.created_at||m.time||m.data?.time))+'</small></div>';
          }).join('')||'<p class="muted">No private messages were returned for this account. Confirm the username and try again.</p>');
      }catch(e){target.innerHTML='<p class="error">'+esc(e.message||'Could not inspect private messages.')+'</p>';}
    };
    $('dmSearchBtn').onclick=load;
    $('dmSearch1')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();load();}});
    $('dmSearch2')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();load();}});
  }catch(e){toast(e.message)}
}

async function openBotManagementBot(botId){
  try{
    const d=await api('/api/bots'); const bot=(d.bots||[]).find(x=>String(x.id)===String(botId));
    if(bot){
      modal(`<div class="bot-management"><h2>🤖 ${esc(bot.name)} Management</h2><label>Name<input id="editBotName" value="${esc(bot.name)}"></label><label>Avatar<input id="editBotAvatar" value="${esc(bot.avatar||'')}"></label><label>Auto reply<textarea id="editBotReply">${esc(bot.auto_reply||'')}</textarea></label><label class="check-row"><input id="editBotActive" type="checkbox" ${bot.is_active?'checked':''}> Active</label><div class="toolbar"><button class="primary" id="saveBotEdit">Save</button><button class="mini danger" id="deleteBotEdit">Delete</button></div></div>`);
      $('saveBotEdit').onclick=async()=>{try{await api('/api/bots/'+bot.id,{method:'PUT',body:JSON.stringify({name:$('editBotName').value,avatar:$('editBotAvatar').value,auto_reply:$('editBotReply').value,is_active:$('editBotActive').checked})});closeModal();loadOwner();toast('Bot updated.')}catch(e){toast(e.message)}};
      $('deleteBotEdit').onclick=async()=>{if(!confirm('Delete this bot?'))return;try{await api('/api/bots/'+bot.id,{method:'DELETE'});closeModal();loadOwner();toast('Bot deleted.')}catch(e){toast(e.message)}};
      return;
    }
  }catch(e){toast(e.message)}
}

function openCommandGuide(){
  const groups=[
    {title:"🎲 Fun & games",items:[
      ["/roll [max]","Roll a number from 1 to the maximum (100 by default)."],
      ["/ship @user1 @user2","Generate a playful compatibility percentage for two existing users."],
      ["/8ball question","Ask a question for a random fortune-style answer."],
      ["/hug @user","Send a friendly hug action."],
      ["/slap @user","Send a playful slap action."],
      ["/poke @user","Poke another user playfully."],
      ["/kiss @user","Send a playful kiss action."],
      ["/coinflip","Flip a virtual coin: heads or tails."],
      ["/choose option1, option2","Choose one option randomly; you can also separate options with “or”."],
      ["/fortune","Receive a random fortune."],
      ["/joke","Get a random joke."],
      ["/fact","Get a general-interest fact."]
    ]},
    {title:"🛡️ Room controls",items:[
      ["/lock","Lock the current room. Only staff can send messages until it is unlocked."],
      ["/unlock","Unlock the current room so everyone can send messages again."],
      ["/clear","Clear messages from the current room (subject to your configured rank permission)."]
    ]},
    {title:"✨ Help",items:[["/guide","Open this command guide."]]}
  ];
  const html='<div class="command-guide"><h2>Aurora Command Guide</h2><p class="muted">Enter commands in the room message box. Replace example usernames with real usernames. Some commands require a minimum rank set by the site owner.</p>'+groups.map((group,i)=>'<details class="command-guide-group" '+(i===0?'open':'')+'><summary>'+esc(group.title)+'</summary><div class="command-guide-list">'+group.items.map(item=>'<div class="command-guide-item"><code>'+esc(item[0])+'</code><span>'+esc(item[1])+'</span></div>').join('')+'</div></details>').join('')+'<div class="toolbar"><button class="primary" onclick="closeModal()">Got it</button></div></div>';
  modal(html);
}

async function openBotsManagement(){
  try{const d=await api('/api/bots');modal(`<div class="bot-management"><h2>🤖 Bots Management</h2><p class="muted">Create and manage community bots. Active bots can reply when their configured name is mentioned.</p><div class="card"><h3>➕ Add Bot</h3><input id="newBotName" placeholder="Bot name"><input id="newBotAvatar" placeholder="Avatar URL or emoji"><textarea id="newBotReply" placeholder="Automatic reply text"></textarea><button class="primary" id="addBotBtn">Add Bot</button></div><div class="card"><h3>Current bots</h3><div class="stack">${(d.bots||[]).map(b=>`<div class="hub-row"><span>🤖 <b>${esc(b.name)}</b> · ${b.is_active?'Active':'Disabled'}</span><div class="toolbar"><button class="mini" data-bot-edit="${b.id}">Edit</button><button class="mini" data-bot-toggle="${b.id}">${b.is_active?'Disable':'Enable'}</button><button class="mini danger" data-bot-delete="${b.id}">Delete</button></div></div>`).join('')||'<p class="muted">No bots yet.</p>'}</div></div></div>`);$('addBotBtn').onclick=async()=>{try{const name=$('newBotName').value.trim();if(!name)throw Error('Bot name required.');await api('/api/bots',{method:'POST',body:JSON.stringify({name,avatar:$('newBotAvatar').value,auto_reply:$('newBotReply').value})});openBotsManagement()}catch(e){toast(e.message)}};document.querySelectorAll('[data-bot-edit]').forEach(b=>b.onclick=()=>openBotManagementBot(b.dataset.botEdit));document.querySelectorAll('[data-bot-toggle]').forEach(b=>b.onclick=async()=>{try{await api('/api/bots/'+b.dataset.botToggle+'/toggle',{method:'POST'});openBotsManagement()}catch(e){toast(e.message)}});document.querySelectorAll('[data-bot-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this bot?'))return;try{await api('/api/bots/'+b.dataset.botDelete,{method:'DELETE'});openBotsManagement()}catch(e){toast(e.message)}});}catch(e){toast(e.message)}}

async function saveOwnerSiteState(){
  try{
    await api("/api/settings/save",{method:"POST",body:JSON.stringify({gifCost:$("ownerGifCost")?.value||10,goldPerMessage:$("ownerGoldPerMessage")?.value||0,xpPerMessage:$("ownerXpPerMessage")?.value||5,dailyXpLimit:$("ownerDailyXp")?.value||500,filterAffectedRanks:[...document.querySelectorAll('[data-filter-rank]:checked')].map(x=>x.value),filterMuteDuration:$("ownerFilterDuration")?.value||5,dailyRewardGold:$("ownerDailyRewardGold")?.value||25,dailyRewardXp:$("ownerDailyRewardXp")?.value||15})});
    toast("Site settings saved.");
  }catch(e){toast(e.message)}
}

async function ownerFeatureGrants(){
  try{
    const d=await api('/api/owner/feature-grants');
    const labels={
      send_messages:'Send messages',private_messages:'Private messages',create_rooms:'Create rooms',edit_rooms:'Edit rooms',delete_rooms:'Delete rooms',join_rooms:'Join rooms',delete_own_room:'Delete own room',
      friend_wall_posting:'Post on Friends Wall',wall_commenting:'Comment on Friends Wall',wall_liking:'Like Friends Wall posts',wall_upload:'Upload to Friends Wall',news_posting:'Publish news',
      change_avatar:'Change own avatar',change_bio:'Edit own bio',account_modifications:'Edit other accounts',profile_note:'Staff profile notes',emojis_stickers:'Use emojis and stickers',
      chat_file_upload:'Upload chat files',gif_sending:'Send GIFs',clear_history_button:'Clear personal history',view_online_users:'View online users',
      manage_filter_words:'Manage filtered words',premium_granting:'Grant Premium',reports_management:'Manage reports',moderate_users:'Moderate users',
      bypass_filter_words:'Bypass filtered words',bypass_mute:'Bypass mute',change_password:'Change another user password',edit_email:'Edit another user email',
      manage_xp_level:'Manage XP and levels',invisible_mode:'Invisible mode',share_gold:'Share gold',delete_message:'Delete chat messages',view_ips:'View IP inspection',
      view_emails:'View account emails',manage_ranks:'Manage ranks',manage_settings:'Manage site settings',manage_clubs:'Manage clubs',manage_bots:'Manage bots',
      manage_mal_ai:'Manage Mal AI',manage_aurora:'Manage Aurora bot',manage_feature_lab:'Manage Feature Lab',report_message:'Report messages',
      moderate_user:'Moderate users',clear_room:'Clear room messages',edit_message:'Edit own messages',pin_message:'Pin messages',save_message:'Save messages',
      react_message:'React to messages',use_youtube:'Share YouTube videos and YouTube Music',
      room_announcement:'Post room announcements',view_pinned:'View pinned messages',manage_filters:'Manage filtered words',delete_news:'Delete news',
      manage_staff_accounts:'Manage staff account details',staff_rank_assignment:'Assign staff ranks',manage_gold:'Manage user gold',profile_like:'Like profiles',
      enter_private_club:'Enter private clubs',wall_post:'Friends Wall posting',manage_news:'Manage news'
    };
    const descriptions={
      send_messages:'Send text in public rooms.',private_messages:'Start and reply to private conversations.',create_rooms:'Create new chat rooms.',edit_rooms:'Change room details.',delete_rooms:'Delete rooms.',join_rooms:'Enter rooms.',delete_own_room:'Delete rooms created by this account.',
      friend_wall_posting:'Create posts on the Friends Wall.',wall_commenting:'Comment on wall posts.',wall_liking:'React to wall posts.',wall_upload:'Attach uploads to wall posts.',news_posting:'Publish site news.',
      change_avatar:'Change this account’s avatar.',change_bio:'Edit this account’s bio.',account_modifications:'Edit another user’s account details.',profile_note:'View or add staff notes.',emojis_stickers:'Send emojis and stickers.',
      chat_file_upload:'Attach files in chat.',gif_sending:'Send GIFs.',clear_history_button:'Clear personal chat history.',view_online_users:'View the online user list.',
      manage_filter_words:'Edit blocked-word settings.',premium_granting:'Grant Premium status.',reports_management:'Review and resolve reports.',moderate_users:'Warn, mute, kick or ban users.',
      bypass_filter_words:'Bypass filtered-word restrictions.',bypass_mute:'Bypass mute restrictions.',change_password:'Change another user’s password.',edit_email:'Edit another user’s email address.',
      manage_xp_level:'Change another user’s XP or level.',invisible_mode:'Use invisible presence mode.',share_gold:'Send gold to another user.',delete_message:'Delete chat messages.',
      view_ips:'Access IP inspection details.',view_emails:'View registered email addresses.',manage_ranks:'Change account ranks.',manage_settings:'Change site-wide settings.',
      manage_clubs:'Manage clubs.',manage_bots:'Manage community bots.',manage_mal_ai:'Edit Mal AI commands.',manage_aurora:'Manage Aurora bot.',manage_feature_lab:'Manage Feature Lab.',
      report_message:'Submit reports about messages.',moderate_user:'Access moderation actions.',clear_room:'Clear room messages.',edit_message:'Edit messages you sent.',pin_message:'Pin chat messages.',
      save_message:'Save messages.',react_message:'React to messages.',use_youtube:'Share YouTube videos and YouTube Music.',
      room_announcement:'Post room announcements.',view_pinned:'View pinned messages.',manage_filters:'Manage filtered-word settings.',delete_news:'Delete published news.',
      manage_staff_accounts:'Edit staff account details.',staff_rank_assignment:'Assign eligible staff ranks.',manage_gold:'Adjust user gold.',profile_like:'Like user profiles.',enter_private_club:'Enter private clubs.'
    };
    const categoryFor={
      send_messages:'Chat & media',emojis_stickers:'Chat & media',chat_file_upload:'Chat & media',gif_sending:'Chat & media',private_messages:'Chat & media',edit_message:'Chat & media',pin_message:'Chat & media',save_message:'Chat & media',react_message:'Chat & media',use_youtube:'Chat & media',
      create_rooms:'Rooms',edit_rooms:'Rooms',delete_rooms:'Rooms',join_rooms:'Rooms',delete_own_room:'Rooms',clear_room:'Rooms',room_announcement:'Rooms',view_pinned:'Rooms',
      friend_wall_posting:'Social & community',wall_post:'Social & community',wall_commenting:'Social & community',wall_liking:'Social & community',wall_upload:'Social & community',profile_like:'Social & community',manage_clubs:'Social & community',enter_private_club:'Social & community',share_gold:'Gold & rewards',
      news_posting:'News & content',manage_news:'News & content',delete_news:'News & content',
      change_avatar:'Accounts & profiles',change_bio:'Accounts & profiles',account_modifications:'Accounts & profiles',change_password:'Accounts & profiles',edit_email:'Accounts & profiles',profile_note:'Accounts & profiles',view_emails:'Accounts & profiles',
      view_online_users:'Staff & moderation',manage_filter_words:'Staff & moderation',manage_filters:'Staff & moderation',premium_granting:'Staff & moderation',reports_management:'Staff & moderation',moderate_users:'Staff & moderation',moderate_user:'Staff & moderation',bypass_filter_words:'Staff & moderation',bypass_mute:'Staff & moderation',delete_message:'Staff & moderation',view_ips:'Staff & moderation',manage_staff_accounts:'Staff & moderation',staff_rank_assignment:'Staff & moderation',invisible_mode:'Staff & moderation',
      manage_xp_level:'Owner tools',manage_ranks:'Owner tools',manage_settings:'Owner tools',manage_gold:'Owner tools',manage_bots:'Owner tools',manage_mal_ai:'Owner tools',manage_aurora:'Owner tools',manage_feature_lab:'Owner tools',clear_history_button:'Owner tools'
    };
    const ranks=d.ranks||['MEMBER','VIP','PREMIUM','MOD','ADMIN','SUPER_ADMIN','COMMISSOR','COOWNER','OWNER'];
    const rankLabels={MEMBER:'Member',VIP:'VIP',PREMIUM:'Premium',MOD:'Moderator',ADMIN:'Admin',SUPER_ADMIN:'Super Admin',COMMISSOR:'Commissor',COOWNER:'Co-owner',OWNER:'Owner'};
    const keys=Object.keys(d.features||{}).filter(key=>!['schedule_message','expire_message'].includes(key)), categories={};
    keys.forEach(key=>{const category=categoryFor[key]||'Other site features';if(!categories[category])categories[category]=[];categories[category].push(key);});
    function renderRow(key){
      const allowed=d.grants?.[key]||[], selected=ranks.find(rank=>allowed.includes(rank));
      const name=labels[key]||key.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
      const description=descriptions[key]||'Controls which ranks can use this site feature.';
      return '<div class="feature-grant-row" data-feature-row="'+esc(key)+'" data-feature-search="'+esc((name+' '+key+' '+description).toLowerCase())+'"><div><b>'+esc(name)+'</b><small>'+esc(description)+'</small></div><select data-grant="'+esc(key)+'" aria-label="Minimum rank for '+esc(name)+'"><option value="off" '+(selected?'':'selected')+'>Disabled</option>'+ranks.map(rank=>'<option value="'+rank+'" '+(rank===selected?'selected':'')+'>'+(rankLabels[rank]||rank)+'</option>').join('')+'</select></div>';
    }
    const grouped=Object.entries(categories).map(([name,items])=>'<details class="grant-category" '+(name==='Chat & media'?'open':'')+'><summary>'+esc(name)+' <span class="muted">('+items.length+')</span></summary>'+items.map(renderRow).join('')+'</details>').join('');
    modal('<div class="feature-grant-modal feature-grant-simple"><h2>🧩 Feature Access</h2><p class="muted">Choose the lowest rank allowed to use each feature. That rank and higher ranks will be allowed. Choose Disabled to block the feature for regular ranks. Developer and the protected owner account keep built-in access.</p><label class="feature-grant-search-label">🔎 Find a feature<input id="featureGrantSearch" type="search" placeholder="Search messages, rooms, gold, reports…"></label><div class="feature-grant-summary">'+keys.length+' feature controls · Changes are saved together</div><div id="featureGrantCategories">'+(grouped||'<p class="muted">No feature controls are available.</p>')+'</div><div class="toolbar feature-grant-footer"><button class="primary" id="saveAllFeatureGrants">Save all changes</button><button class="mini" id="closeFeatureGrants">Close</button></div><p class="muted feature-grant-note">These are rank-based permissions. Individual account exceptions are managed separately in User Permissions.</p></div>');
    const search=$('featureGrantSearch');
    search?.addEventListener('input',()=>{
      const query=search.value.trim().toLowerCase();
      document.querySelectorAll('[data-feature-row]').forEach(el=>{el.hidden=!!query&&!el.dataset.featureSearch.includes(query);});
      document.querySelectorAll('#featureGrantCategories .grant-category').forEach(el=>{const visible=el.querySelectorAll('[data-feature-row]:not([hidden])').length;el.hidden=visible===0;if(query&&visible)el.open=true;});
    });
    $('closeFeatureGrants')?.addEventListener('click',()=>$('modal')?.classList.add('hidden'));
    $('saveAllFeatureGrants')?.addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;button.textContent='Saving…';
      try{
        const grants={};document.querySelectorAll('[data-grant]').forEach(select=>{grants[select.dataset.grant]=select.value==='off'?null:select.value;});
        await api('/api/owner/feature-grants',{method:'PUT',body:JSON.stringify({grants})});
        toast('All feature access settings saved.');await ownerFeatureGrants();
      }catch(error){toast(error.message||'Could not save feature access.');button.disabled=false;button.textContent='Save all changes';}
    });
  }catch(error){toast(error.message||'Could not load feature access.');}
}
async function toggleFriendsDropdown(refresh=false){
  const box=$("topFriendsDropdown");if(!box)return;
  if(!refresh&&!box.classList.contains("hidden")){box.classList.add("hidden");return;}
  $("topMessagesDropdown")?.classList.add("hidden");$("notificationDropdown")?.classList.add("hidden");$("reportDropdown")?.classList.add("hidden");
  try{
    const d=await api("/api/friends");
    const incoming=d.incoming||[];
    box.innerHTML=`<div class="notification-dropdown-head"><div><b>💜 Friend requests</b><small class="notification-unread-summary">${incoming.length} pending</small></div></div>${incoming.map(u=>`<div class="report-dropdown-item friend-request-panel-row"><div class="report-dropdown-copy"><b>${esc(u.displayName||u.username)}</b><span>@${esc(u.username)}</span></div><div class="toolbar"><button class="mini primary" data-friend-accept="${esc(u.id)}">Accept</button><button class="mini danger" data-friend-decline="${esc(u.id)}">Decline</button></div></div>`).join("")||'<p class="muted notification-empty">No new friend requests. 💜</p>'}`;
    box.classList.remove("hidden");
    box.querySelectorAll("[data-friend-accept]").forEach(b=>b.onclick=async()=>{b.disabled=true;try{await acceptFriend(b.dataset.friendAccept);await toggleFriendsDropdown(true);await loadNotifications()}catch(e){b.disabled=false;toast(e.message)}});
    box.querySelectorAll("[data-friend-decline]").forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/api/friends/'+encodeURIComponent(b.dataset.friendDecline),{method:'DELETE'});toast('Friend request declined.');await toggleFriendsDropdown(true);await loadNotifications()}catch(e){b.disabled=false;toast(e.message)}});
  }catch(e){box.innerHTML=`<div class="notification-dropdown-head"><b>💜 Friend requests</b></div><p class="muted">${esc(e.message||"Could not load friend requests.")}</p>`;box.classList.remove("hidden");}
}
async function toggleMessagesDropdown(refresh=false){
  const box=$("topMessagesDropdown");if(!box)return;
  if(!refresh&&!box.classList.contains("hidden")){box.classList.add("hidden");return;}
  $("topFriendsDropdown")?.classList.add("hidden");$("notificationDropdown")?.classList.add("hidden");$("reportDropdown")?.classList.add("hidden");
  try{
    const d=await api("/api/dm/conversations");
    const conversations=(d.conversations||[]).sort((a,b)=>Number(b.unreadCount||0)-Number(a.unreadCount||0)).slice(0,10);
    const nicknames=(await api('/api/private-nicknames').catch(()=>({nicknames:{}}))).nicknames||{};
    box.innerHTML=`<div class="notification-dropdown-head"><div><b>✉ Private messages</b><small class="notification-unread-summary">${conversations.reduce((n,x)=>n+Number(x.unreadCount||0),0)} unread</small></div></div>${conversations.map(c=>{const u=c.user||{},id=String(u.id),last=c.lastMessage||{},preview=last.attachment?'📎 Attachment':(last.text||'Start a conversation');return `<button class="notification-dropdown-item dm-header-item ${Number(c.unreadCount||0)?'unread':''}" data-header-dm="${esc(id)}"><b>${esc(nicknames[id]||u.displayName||u.username||'User')} ${Number(c.unreadCount||0)?'<span class="dm-unread-badge">'+Number(c.unreadCount)+'</span>':''}</b><span>@${esc(u.username||'')} · ${esc(preview).slice(0,100)}</span><small>${last.time?fmt(last.time):''}</small></button>`}).join("")||'<p class="muted notification-empty">No private conversations yet.</p>'}`;
    box.classList.remove("hidden");
    box.querySelectorAll("[data-header-dm]").forEach(b=>b.onclick=()=>{box.classList.add("hidden");openDM(b.dataset.headerDm)});
  }catch(e){box.innerHTML=`<div class="notification-dropdown-head"><b>✉ Private messages</b></div><p class="muted">${esc(e.message||"Could not load private messages.")}</p>`;box.classList.remove("hidden");}
}

async function toggleReportDropdown(refresh=false){
  const box=$("reportDropdown"); if(!box)return;
  if(!refresh&&!box.classList.contains("hidden")){box.classList.add("hidden");return;}
  try{
    const d=await api("/api/staff/dashboard");
    const reports=(d.reports||[]).filter(r=>String(r.status||"OPEN").toUpperCase()==="OPEN").slice(0,8);
    box.innerHTML=`<div class="notification-dropdown-head"><div><b>⚑ Reports</b><small class="notification-unread-summary">${reports.length} open</small></div><button class="mini" id="openFullReports">All reports</button></div>${reports.map(r=>{
      const snap=r.messageSnapshot||{};
      const who=r.reportedUserUsername||snap.username||"Unknown";
      const category=r.category||(r.conversationUserId?"Private message":r.messageId?"Message":"Profile");
      return `<div class="report-dropdown-item"><div class="report-dropdown-copy"><b>${esc(category)} · @${esc(who)}</b><span>${esc(snap.text||r.messagePreview||r.reason||"No report text supplied")}</span>${r.conversationUserId?`<small class="report-evidence-hint">🔒 Private-message evidence available</small>`:""}<small>${fmt(r.time)}</small></div><div class="toolbar">${r.conversationUserId?`<button class="mini" data-report-evidence="${esc(r.id)}">View messages</button>`:""}${r.reportedUserId?`<button class="mini" data-report-moderate="${esc(r.reportedUserId)}">Moderate</button>`:""}<button class="mini primary" data-report-resolve="${esc(r.id)}">Resolve</button></div></div>`;
    }).join("")||'<p class="muted notification-empty">No open reports. ✨</p>'}`;
    box.classList.remove("hidden");
    $("openFullReports")?.addEventListener("click",async()=>{box.classList.add("hidden");state.view="staff";document.querySelectorAll(".nav[data-view]").forEach(x=>x.classList.toggle("active",x.dataset.view==="staff"));await renderView();});
    box.querySelectorAll("[data-report-moderate]").forEach(b=>b.onclick=()=>{box.classList.add("hidden");moderate(b.dataset.reportModerate);});
    box.querySelectorAll("[data-report-evidence]").forEach(b=>b.onclick=()=>{box.classList.add("hidden");viewPrivateMessageReport(b.dataset.reportEvidence);});
    box.querySelectorAll("[data-report-resolve]").forEach(b=>b.onclick=async()=>{await resolveReport(b.dataset.reportResolve);});
  }catch(e){box.innerHTML=`<div class="notification-dropdown-head"><b>⚑ Reports</b></div><p class="muted">${esc(e.message||"Reports are available to authorized staff only.")}</p>`;box.classList.remove("hidden");}
}

async function toggleNotificationDropdown(){
  const box=$('notificationDropdown'); if(!box)return;
  if(!box.classList.contains('hidden')){box.classList.add('hidden');return;}
  try{
    const d=await api('/api/notifications');
    const rows=(d.notifications||[]).slice(0,20);
    const unreadCount=rows.filter(n=>!n.read).length;
    box.innerHTML=`<div class="notification-dropdown-head"><div><b>🔔 Notifications</b><small class="notification-unread-summary">${unreadCount} unread</small></div><button class="mini" id="dropdownMarkAll" ${unreadCount?'':'disabled'}>Mark all read</button></div>${rows.map(n=>`<button class="notification-dropdown-item ${n.read?'':'unread'}" data-dropdown-notif="${esc(n.id)}"><b>${esc(n.title||n.type||'Notification')}</b><span>${esc(n.text||n.message||'')}</span><small>${fmt(n.time)}</small></button>`).join('')||'<p class="muted notification-empty">✨ You’re all caught up.</p>'}`;
    box.classList.remove('hidden');
    box.querySelectorAll('[data-dropdown-notif]').forEach(b=>b.onclick=async()=>{
      try{await api('/api/notifications/'+encodeURIComponent(b.dataset.dropdownNotif)+'/read',{method:'PATCH'});b.classList.remove('unread');loadNotifications();toggleNotificationDropdown();}catch(e){toast(e.message)}
    });
    $('dropdownMarkAll')?.addEventListener('click',async e=>{e.stopPropagation();try{await api('/api/notifications/read',{method:'POST'});box.classList.add('hidden');loadNotifications();toast('All notifications marked as read.');}catch(err){toast(err.message)}});
  }catch(e){toast(e.message)}
}

/* ---------------- NOTIFICATIONS ---------------- */

async function loadNotifications() {
  // This runs on a timer and socket reconnects. Do not hit authenticated APIs
  // while the login screen is active, otherwise a logged-out tab spams 401s.
  if (!state.user) return;
  try {
    const [data,unreadData,dm,staffCounts,friendsData]=await Promise.all([
      api("/api/notifications"),
      api("/api/notifications/unread").catch(()=>null),
      api("/api/dm/unread-count").catch(()=>({count:0})),
      api("/api/staff/unread-count").catch(()=>({reports:0,staffNotifications:0,total:0})),
      api("/api/friends").catch(()=>({incoming:[]}))
    ]);
    // Fall back to the main notification response if the unread-only endpoint is unavailable.
    const unread=unreadData?.notifications || (data.notifications||[]).filter(n=>!n.read);
    const notificationStaffCount=unread.filter(n=>["report","moderation","staff"].includes(n.type)).length;
    const reportCount=Math.max(Number(staffCounts.reports||0),notificationStaffCount);
    const counts={dm:Number(dm.count||0),report:reportCount,all:unread.length,friends:(friendsData.incoming||[]).length};
    const setBubble=(id,count)=>{
      const el=$(id);
      if(!el)return;
      el.textContent=count>99?'99+':String(count);
      el.classList.toggle('count-badge',count>0);
      el.style.setProperty('display',count>0?'inline-flex':'none','important');
      el.setAttribute('aria-label',`${count} unread notifications`);
    };
    setBubble("notifDot",counts.all);
    setBubble("topNotifDot",counts.all);
    setBubble("topDmDot",counts.dm);
    setBubble("topFriendDot",counts.friends);
    setBubble("dmDot",counts.dm);
    setBubble("reportDot",counts.report);
    setBubble("topReportDot",counts.report);
    if($("topNotifDot")) $("topNotifDot").classList.toggle("green",counts.all>0);
  } catch(error) {
    console.warn("Notification refresh failed",error);
  }
}
setInterval(()=>{if(state.user)loadNotifications();},5000);
setTimeout(()=>{if(state.user)loadNotifications();},500);

$("notifications").onclick=async()=>{
  try{
    const data=await api("/api/notifications");
    const rows=data.notifications||[];
    modal(`<div class="notification-center"><div class="notification-head"><div><h2>🔔 Notifications</h2><p class="muted">${rows.filter(n=>!n.read).length} unread</p></div><div class="toolbar"><button class="mini" id="markAllNotifications">Mark all read</button><button class="mini danger" id="clearNotifications">Clear all</button></div></div><div class="stack">${rows.map(n=>`<div class="card notification-card ${n.read?'':'unread'}"><div><b>${esc(n.title)}</b><p>${esc(n.text)}</p><small>${fmt(n.time)}</small></div><div class="toolbar"><button class="mini" data-notif-read="${esc(n.id)}">${n.read?'Read':'Mark read'}</button><button class="mini danger" data-notif-delete="${esc(n.id)}">×</button></div></div>`).join("")||'<p class="muted">No notifications.</p>'}</div></div>`);
    document.querySelectorAll('[data-notif-read]').forEach(b=>b.onclick=async()=>{await api('/api/notifications/'+encodeURIComponent(b.dataset.notifRead)+'/read',{method:'PATCH'});b.textContent='Read';b.closest('.notification-card')?.classList.remove('unread');loadNotifications();});
    document.querySelectorAll('[data-notif-delete]').forEach(b=>b.onclick=async()=>{await api('/api/notifications/'+encodeURIComponent(b.dataset.notifDelete),{method:'DELETE'});b.closest('.notification-card')?.remove();loadNotifications();});
    $('markAllNotifications').onclick=async()=>{await api('/api/notifications/read',{method:'POST'});closeModal();loadNotifications();toast('Notifications marked as read.');};
    $('clearNotifications').onclick=async()=>{if(!confirm('Clear all notifications?'))return;await api('/api/notifications',{method:'DELETE'});closeModal();loadNotifications();toast('Notifications cleared.');};
  }catch(e){toast(e.message)}
};

async function showPinnedMessages(){
  try{ const data=await api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/pinned`); const pinned=data.messages||[]; modal(`<h2>📌 Pinned messages</h2><p class="muted">Pinned messages in ${esc(state.rooms.find(r=>r.id===state.currentRoom)?.name||'this room')}.</p><div class="pinned-list">${pinned.map(m=>`<button class="pinned-result" onclick="closeModal();jumpToMessage('${esc(m.id)}')"><b>${esc(m.displayName||m.username)}</b><small>${fmt(m.time)}</small><span>${esc(m.text||'📎 Attachment')}</span></button>`).join('')||'<p class="muted">No pinned messages in this room.</p>'}</div>`); }catch(e){toast(e.message)}
}
async function openYoutubePanel(mode='youtube'){
  modal(`<div class="youtube-panel"><h2>${mode==="music"?"🎵 YouTube Music":"▶️ YouTube"}</h2><p class="muted">Search for a ${mode==="music"?"song or music video":"video"} or paste a YouTube link.</p><div class="toolbar"><input id="ytQuery" placeholder="Search or paste YouTube URL…"><button class="primary" id="ytSearch">Search</button></div><div id="ytResults" class="youtube-results"><p class="muted">Search for a video to share it in this room.</p></div></div>`);
  $('ytSearch').onclick=async()=>{
    const q=$('ytQuery').value.trim();
    if(!q)return;
    // Direct links work even when YouTube search is temporarily unavailable
    // or the deployment has no YouTube Data API key.
    const match=q.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/i);
    if(match){
      const videoId=match[1];
      const title="YouTube video";
      $('ytResults').innerHTML=`<button class="youtube-result" onclick="sendYoutube('${videoId}','${title}',${mode==='music'})"><img src="https://i.ytimg.com/vi/${videoId}/mqdefault.jpg" alt=""><span><b>YouTube video</b><small>Share this video in chat</small></span></button>`;
      return;
    }
    const button=$('ytSearch');button.disabled=true;button.textContent='Searching…';
    try{
      const r=await api('/api/youtube/search?q='+encodeURIComponent(q));
      const results=(r.results||[]).filter(v=>/^[A-Za-z0-9_-]{11}$/.test(String(v.id||'')));
      $('ytResults').innerHTML=results.map(v=>`<button class="youtube-result" onclick="sendYoutube('${esc(v.id)}','${esc(v.title)}',${mode==='music'})"><img src="${esc(v.thumbnail||('https://i.ytimg.com/vi/'+v.id+'/mqdefault.jpg'))}" alt=""><span><b>${esc(v.title)}</b><small>${esc(v.channel||'YouTube')}</small></span></button>`).join('')||`<p class="muted">${esc(r.notice||'No results. Try pasting a YouTube video link instead.')}</p>`;
    }catch(e){toast(e.message||'YouTube search failed. Paste a YouTube video link instead.');}
    finally{button.disabled=false;button.textContent='Search';}
  };
}
async function sendYoutube(videoId,title,music=false){
  try{
    if(!state.currentRoom)throw new Error('Join Main Room before sharing a video.');
    const result=await api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/youtube`,{method:'POST',body:JSON.stringify({videoId,title,music})});
    if(result.message && !document.querySelector(`[data-mid="${CSS.escape(String(result.message.id))}"]`))appendMessage(result.message);
    closeModal();toast('YouTube video shared in chat.');
  }catch(e){toast(e.message||'Could not share this video.')}
}
$("youtubeComposerBtn")?.addEventListener("click",()=>openYoutubePanel("youtube"));
$("youtubeMusicComposerBtn")?.addEventListener("click",()=>openYoutubePanel("music"));

/* ---------------- ROOM MENU ---------------- */

$("roomMenu").onclick = () => {
  const room =
    state.rooms.find(
      r => r.id === state.currentRoom
    );

  if (!room) return;

  modal(`
    <h2>
      ${esc(room.name)}
    </h2>

    <div class="toolbar">

      ${
        canFeature("clear_room") || canFeature("edit_room") || canFeature("delete_room")
          ? `
            ${canFeature("clear_room")?`<button class="mini" onclick="clearRoom()">Clear</button>`:""}

            ${canFeature("edit_room")?`<button class="mini" onclick="editRoom()">Edit room</button>`:""}

            ${canFeature("delete_room")?`<button class="mini danger" onclick="deleteRoom()">Delete room</button>`:""}
          `
          : ""
      }

      <button class="mini" onclick="postRoomAnnouncement()">📢 Room announcement</button>
      <button class="mini" onclick="showPinnedMessages()">📌 Pinned messages</button>
      <button class="mini" onclick="openYoutubePanel()">▶️ YouTube</button>
      <button class="mini" onclick="showInvite()">Invite link</button>
      <button class="mini" onclick="openRoomThemePicker()">🎨 Room Theme</button>
      ${["OWNER","DEVELOPER"].includes(String(state.user?.rank||"").toUpperCase())?`
        <div style="flex-basis:100%;border-top:1px solid var(--border-color,#393244);padding-top:8px;margin-top:4px"><b style="display:block;margin-bottom:7px">🕶️ Presence modes</b><div class="toolbar" style="display:flex;flex-wrap:wrap;gap:6px"><button type="button" class="mini" onclick="togglePresenceMode('ghost')">👻 Ghost Mode</button><button type="button" class="mini" onclick="togglePresenceMode('dead')">💀 Dead Mode</button><button type="button" class="mini" onclick="togglePresenceMode('invisible')">😈 Invisible Mode</button></div><button type="button" class="mini" style="margin-top:7px" onclick="openPresenceModes()">⚙️ Open mode settings</button></div>
      `:""}

    </div>
  `);
};


const ROOM_THEMES = [
{id:"obsidian",name:"Obsidian",emoji:"🌑",bg:"#0b0b14",bubble:"#302342",accent:"#b58cff"},
{id:"midnight",name:"Midnight",emoji:"🌌",bg:"#080d20",bubble:"#17264a",accent:"#7197ff"},
{id:"lavender",name:"Lavender",emoji:"💜",bg:"#171027",bubble:"#4b3268",accent:"#d1a5ff"},
{id:"rose",name:"Rose",emoji:"🌹",bg:"#210f1b",bubble:"#593044",accent:"#ff8fbe"},
{id:"forest",name:"Forest",emoji:"🌲",bg:"#091a16",bubble:"#1b4035",accent:"#69d5a7"},
{id:"sunset",name:"Sunset",emoji:"🌇",bg:"#24120e",bubble:"#653522",accent:"#ffab70"},
{id:"ocean",name:"Ocean",emoji:"🌊",bg:"#071a24",bubble:"#16465a",accent:"#65d9ef"},
{id:"cyberpunk",name:"Cyberpunk",emoji:"⚡",bg:"#10091f",bubble:"#39205a",accent:"#ff4fd8"},
{id:"aurora",name:"Aurora",emoji:"✨",bg:"#071b20",bubble:"#16434a",accent:"#76f0d0"},
{id:"sakura",name:"Sakura",emoji:"🌸",bg:"#21111f",bubble:"#60304f",accent:"#ffa8db"},
{id:"ember",name:"Ember",emoji:"🔥",bg:"#1d100d",bubble:"#51271f",accent:"#ff765e"},
{id:"ice",name:"Ice Palace",emoji:"🧊",bg:"#0b1724",bubble:"#263d52",accent:"#b3e7ff"}
];
function applyRoomTheme(themeId){
 const t=ROOM_THEMES.find(x=>x.id===themeId)||ROOM_THEMES[0],root=$("viewRooms");if(!root)return;
 root.dataset.roomTheme=t.id;root.style.setProperty("--room-theme-bg",t.bg);root.style.setProperty("--room-theme-bubble",t.bubble);root.style.setProperty("--room-theme-accent",t.accent);
}
async function openRoomThemePicker(){
 const room=state.rooms.find(r=>String(r.id)===String(state.currentRoom));if(!room){toast("Join a room first.");return;}
 const selected=room.roomTheme||"obsidian";
 modal(`<div class="room-theme-picker"><h2>🎨 Room Theme</h2><p class="muted">Choose a shared look for this room. Everyone in the room will see the selected theme.</p><div class="room-theme-grid">${ROOM_THEMES.map(t=>`<article class="room-theme-card ${t.id===selected?"selected":""}"><div class="room-theme-preview" style="--preview-bg:${t.bg};--preview-bubble:${t.bubble};--preview-accent:${t.accent}"><span>${t.emoji} ${esc(t.name)}</span><i></i><i></i><b></b></div><div class="room-theme-card-footer"><strong>${esc(t.name)}</strong><button type="button" class="mini" data-apply-room-theme="${t.id}">${t.id===selected?"Selected":"Select"}</button></div></article>`).join("")}</div></div>`);
 document.querySelectorAll("[data-apply-room-theme]").forEach(button=>button.addEventListener("click",async()=>{
  const themeId=button.dataset.applyRoomTheme;button.disabled=true;
  try{await api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/theme`,{method:"PUT",body:JSON.stringify({theme:themeId})});const current=state.rooms.find(r=>String(r.id)===String(state.currentRoom));if(current)current.roomTheme=themeId;applyRoomTheme(themeId);closeModal();toast("Room theme applied.");}
  catch(e){toast(e.message||"Could not apply room theme.");button.disabled=false;}
 }));
}

async function clearRoom() {
  if (!confirm("Clear this room?")) {
    return;
  }

  try {
    const result=await api(
      `/api/rooms/${encodeURIComponent(state.currentRoom)}/clear`,
      {
        method: "POST"
      }
    );
    state.messages=(state.messages||[]).filter(m=>String(m.roomId)!==String(state.currentRoom));
    $("messages").innerHTML="";
    closeModal();
    toast("Room cleared. "+Number(result.removed||0)+" messages removed.");
  } catch (error) {
    toast(error.message);
  }
}

function editRoom() {
  const room =
    state.rooms.find(
      r => r.id === state.currentRoom
    );

  if (!room) return;

  modal(`
    <h2>Edit room</h2>

    <input
      id="rn"
      value="${esc(room.name)}"
      placeholder="Room name"
    >

    <input
      id="ri"
      value="${esc(room.icon || "💬")}"
      placeholder="Icon"
    >

    <textarea
      id="rd"
      placeholder="Description"
    >${esc(room.description || "")}</textarea>

    <input
      id="rc"
      value="${esc(room.category || "Community")}"
      placeholder="Category"
    >

    <input
      id="rs"
      type="number"
      min="0"
      value="${room.slowMode || 0}"
      placeholder="Slow mode"
    >

    <input id="rTopic" value="${esc(room.category || "Community")}" placeholder="Room topic / category">
    <input id="rLimit" type="number" min="2" max="500" value="${Number(room.limit || 100)}" placeholder="Member limit (2–500)">
    <input id="rBanner" value="${esc(room.banner || "")}" placeholder="Room banner image URL (optional)">
    <div class="settings-row"><label for="rPublic">Room visibility</label><select id="rPublic"><option value="true" ${room.public !== false ? "selected" : ""}>Public</option><option value="false" ${room.public === false ? "selected" : ""}>Private</option></select></div>
    <div class="grid2"><label>Minimum age<input id="rMinAge" type="number" min="0" max="120" value="${Number(room.minAge || 0)}"></label><label>Maximum age<input id="rMaxAge" type="number" min="0" max="120" value="${Number(room.maxAge ?? 120)}"></label></div>
    <label>Minimum rank required to join
      <select id="rRankRequired">${["MEMBER","VIP","PREMIUM","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER","DEVELOPER"].map(r=>'<option value="'+r+'" '+(String(room.rankRequired||"MEMBER").toUpperCase()===r?'selected':'')+'>'+({MEMBER:"Member",VIP:"VIP",PREMIUM:"Premium",MOD:"Moderator",ADMIN:"Admin",SUPER_ADMIN:"Super Admin",COMMISSOR:"Commissor",COOWNER:"Co-owner",OWNER:"Owner",DEVELOPER:"Developer"}[r])+'</option>').join("")}</select>
    </label>
    <label>Who can join this room
      <select id="rFriendsOnly"><option value="false" ${room.friendsOnly?'':'selected'}>Everyone who meets the rank requirement</option><option value="true" ${room.friendsOnly?'selected':''}>Friends only (accepted friends)</option></select>
    </label>
    <input id="rp" type="password" placeholder="Set/change password (blank removes)">
    <p class="muted">Room owner: @${esc(room.creator || "Unknown")}. Main Room stays protected.</p>
    <button class="primary" onclick="saveRoom()">Save room identity</button>
  `);
}

async function saveRoom() {
  try {
    await api(
      `/api/rooms/${state.currentRoom}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: $("rn").value,
          icon: $("ri").value,
          description: $("rd").value,
          category: $("rTopic").value.trim() || $("rc").value,
          slowMode: Number($("rs").value || 0),
          limit: Math.max(2, Math.min(500, Number($("rLimit").value || 100))),
          banner: $("rBanner").value.trim(),
          public: $("rPublic").value === "true",
          minAge: Math.max(0, Math.min(120, Number($("rMinAge").value || 0))),
          maxAge: Math.max(0, Math.min(120, Number($("rMaxAge").value || 120))),
          rankRequired: $("rRankRequired").value,
          friendsOnly: $("rFriendsOnly").value === "true",
          password: $("rp").value
        })
      }
    );

    await loadRooms();

    closeModal();

    renderRooms();

    toast("Room updated.");
  } catch (error) {
    toast(error.message);
  }
}

async function deleteRoom() {
  if (!confirm("Delete this room?")) {
    return;
  }

  try {
    await api(
      `/api/rooms/${state.currentRoom}`,
      {
        method: "DELETE"
      }
    );

    if (state.socket) {
      state.socket.emit(
        "leave-room",
        state.currentRoom
      );
    }

    state.currentRoom = null;

    $("chatWrap").classList.add(
      "hidden"
    );

    await loadRooms();

    closeModal();

    renderRooms();
  } catch (error) {
    toast(error.message);
  }
}

function showInvite() {
  const room =
    state.rooms.find(
      r => r.id === state.currentRoom
    );

  if (!room) return;

  modal(`
    <h2>Room invite</h2>

    <input
      value="${location.origin}/?room=${encodeURIComponent(room.id)}"
      readonly
    >
  `);
}

/* ---------------- CREATE ROOM ---------------- */

$("newRoom").onclick = () => {
  modal(`
    <h2>Create room</h2>

    <form id="roomForm">

      <input
        id="rn"
        placeholder="Room name"
        required
      >

      <input
        id="ri"
        placeholder="Icon"
        value="💬"
      >

      <input
        id="rd"
        placeholder="Description"
      >

      <input
        id="rc"
        placeholder="Category"
        value="Community"
      >

      <input
        id="rp"
        placeholder="Password (optional)"
        type="password"
      >

      <select id="rr">

        ${
          [
            "MEMBER",
            "VIP",
            "PREMIUM",
            "MOD",
            "ADMIN",
            "SUPER_ADMIN",
            "COMMISSOR",
            "COOWNER",
            "OWNER",
            "DEVELOPER"
          ]
            .map(r =>
              `<option value="${r}">
                ${r}
              </option>`
            )
            .join("")
        }

      </select>

      <label>Room access
        <select id="rFriendsOnlyCreate">
          <option value="false">Everyone who meets the minimum rank</option>
          <option value="true">Friends only (accepted friends)</option>
        </select>
      </label>

      <input
        id="rl"
        type="number"
        min="1"
        value="100"
        placeholder="Member limit"
      >

      <input
        id="rs"
        type="number"
        min="0"
        value="0"
        placeholder="Slow mode seconds"
      >

      <button class="primary">
        Create room
      </button>

    </form>
  `);

  $("roomForm").onsubmit =
    async e => {
      e.preventDefault();

      try {
        await api("/api/rooms", {
          method: "POST",
          body: JSON.stringify({
            name: $("rn").value,
            icon: $("ri").value,
            description:
              $("rd").value,
            category:
              $("rc").value,
            password:
              $("rp").value,
            rankRequired:
              $("rr").value,
            friendsOnly: $("rFriendsOnlyCreate").value === "true",
            limit:
              $("rl").value,
            slowMode:
              $("rs").value
          })
        });

        await loadRooms();

        closeModal();

        renderRooms();

        toast("Room created.");
      } catch (error) {
        toast(error.message);
      }
    };
};


/* ---------------- V3 SETTINGS / FEATURE CENTER ---------------- */

function applyTheme(theme){
  const allowedThemes=['obsidian','midnight','forest','rose','lavender','sunset','ocean'];
  theme=allowedThemes.includes(String(theme||'').toLowerCase())?String(theme).toLowerCase():'obsidian';
  document.documentElement.dataset.theme=theme;
  document.body.dataset.theme=theme;
  const st=state.user?.settings||{}; document.documentElement.style.setProperty('--username-color',st.usernameColor||'#9b5cff');
  document.documentElement.style.setProperty('--profile-color',state.user?.profileColor||'#9b5cff');
  document.documentElement.style.setProperty('--profile-accent',state.user?.profileAccentColor||st.profileAccentColor||'#ff4fd8'); document.documentElement.style.setProperty('--bubble-color',st.bubbleColor||'#33244f'); document.documentElement.style.setProperty('--chat-font',st.chatFont||'Inter'); document.documentElement.style.setProperty('--chat-size',st.fontSize==='large'?'1.08em':st.fontSize==='small'?'.94em':'1em'); document.documentElement.classList.toggle('compact-chat',!!st.compactMode); document.documentElement.dataset.effects=st.messageEffects||'none';
}

async function loadSettings(){
  const r=await api('/api/settings');
  const s=r.settings||{};
  const np=s.notificationPrefs||{};
  const sessions=(await api('/api/security/sessions').catch(()=>({sessions:[]}))).sessions||[];
  $('settings').innerHTML=`
    <section class="settings-hero"><div class="settings-hero-glow"></div><div class="settings-hero-copy"><span class="settings-eyebrow">MALEFICENT CHAT · CONTROL CENTER</span><h2>Account settings</h2><p>Your account, your privacy, your aesthetic. Make this space yours.</p><div class="settings-hero-tags"><span>✦ Personalize</span><span>♢ Stay secure</span><span>♡ Your choices</span></div></div><div class="settings-hero-emblem">✧</div></section>
    <div class="grid2">
      <div class="panel"><h3>👤 Account</h3><p class="muted">Manage the information connected to your account.</p><div class="settings-list">
        <button class="settings-row" onclick="editProfileInfo()"><span>🪪</span><b>Profile information</b><small>Display name, pronouns and basic details</small><strong>›</strong></button>
        <button class="settings-row" onclick="editAboutMe()"><span>💬</span><b>About Me</b><small>Update your profile description</small><strong>›</strong></button>
        <button class="settings-row" onclick="editProfileStyle()"><span>🎨</span><b>Profile appearance</b><small>Colors, theme, badge, pronouns and background</small><strong>›</strong></button>
        <button class="settings-row" onclick="editEmail()"><span>✉</span><b>Email</b><small>Optional recovery/contact email</small><strong>›</strong></button>
        <button class="settings-row" onclick="changePasswordModal()"><span>🔑</span><b>Change password</b><small>Update your login password</small><strong>›</strong></button>
      </div></div>
      <div class="panel"><h3>🔒 Privacy & visibility</h3><label><input type="checkbox" id="setLastSeen" ${s.lastSeen!==false?'checked':''}> Show last seen</label><label><input type="checkbox" id="setOnline" ${s.online!==false?'checked':''}> Show online status</label><button class="primary" id="savePrivacy">Save privacy</button></div>
    </div>
    <div class="panel"><h3>🎨 Profile colors</h3><p class="muted">Choose extra colors for your profile and profile banner.</p><label>Profile color <input type="color" id="profileColor" value="${esc(state.user.profileColor||'#9b5cff')}"></label><label>Profile accent <input type="color" id="profileAccentColor" value="${esc(s.profileAccentColor||'#ff4fd8')}"></label><button class="primary" id="saveProfileColors">Save profile colors</button></div>
    <div class="panel"><h3>🎨 Appearance</h3><p class="muted">Personalize how Maleficent Chat looks for you.</p><div class="theme-picker">${['obsidian','midnight','forest','rose','lavender','sunset','ocean'].map(t=>`<button type="button" class="theme-chip ${s.theme===t?'active':''}" data-theme-choice="${t}"><span class="theme-dot"></span><b>${t[0].toUpperCase()+t.slice(1)}</b></button>`).join('')}</div><select id="v3Theme" class="hidden"><option>obsidian</option><option>midnight</option><option>forest</option><option>rose</option><option>lavender</option><option>sunset</option><option>ocean</option></select><select id="v3Font"><option value="small">Small text</option><option value="medium">Medium text</option><option value="large">Large text</option></select><label><input type="checkbox" id="v3Compact"> Compact mode</label><label><input type="checkbox" id="v3Motion"> Reduced animation</label><label><input type="checkbox" id="v3Contrast"> High contrast</label><label>Username color <input type="color" id="v3UsernameColor" value="${esc(s.usernameColor||'#9b5cff')}"></label><label>Chat bubble color <input type="color" id="v3BubbleColor" value="${esc(s.bubbleColor||'#33244f')}"></label><label>Chat font <select id="v3ChatFont"><option>Inter</option><option>Georgia</option><option>Monospace</option><option>Arial</option><option>Trebuchet MS</option></select></label><label>Message effects <select id="v3Effects"><option value="none">None</option><option value="soft">Soft glow</option><option value="sparkle">Sparkle</option></select></label><button class="primary" id="saveAppearance">Save appearance</button></div>
    <div class="panel"><h3>🔔 Notifications</h3><p class="muted">Turn off notification types you do not want to receive.</p><label><input type="checkbox" id="nMessages" ${np.messages!==false?'checked':''}> Private messages</label><label><input type="checkbox" id="nMentions" ${np.mentions!==false?'checked':''}> Mentions</label><label><input type="checkbox" id="nReplies" ${np.replies!==false?'checked':''}> Replies</label><label><input type="checkbox" id="nSecurity" ${np.security!==false?'checked':''}> Security alerts</label><label><input type="checkbox" id="nStaff" ${np.staff!==false?'checked':''}> Staff / reports</label><label><input type="checkbox" id="nGamification" ${np.gamification!==false?'checked':''}> Gold / level / achievements</label><label><input type="checkbox" id="nOther" ${np.other!==false?'checked':''}> Other notifications</label><button class="primary" id="saveNotifications">Save notifications</button></div>
    <div class="panel"><h3>🛡️ Security & sessions</h3><p class="muted">${sessions.length} active session record${sessions.length===1?'':'s'}.</p><button class="mini" id="viewLoginHistory">View login history</button><button class="mini danger" id="logoutAllDevices">Log out all other devices</button></div>
<div class="panel danger-panel"><h3>⚠️ Account actions</h3><p class="muted">Deleting your account removes your account and personal conversations permanently.</p><button class="mini danger" onclick="deleteAccount()">Delete my account</button></div>
    <section class="gold-economy-section settings-gold-boutique"><div class="gold-economy-heading"><div><h3>🪙 Gold Boutique</h3><p class="muted">Personalize your profile with frames, themes and collectible badges.</p></div><div class="gold-balance-pill">Balance <b id="economyGoldBalance">—</b> 🪙</div></div><div id="goldEconomyRoot"><p class="muted">Loading cosmetics…</p></div></section>`;
  await loadGoldEconomy();
  $('v3Theme').value=s.theme||'obsidian'; $('v3Font').value=s.fontSize||'medium'; $('v3ChatFont').value=s.chatFont||'Inter'; $('v3Effects').value=s.messageEffects||'none'; $('v3Compact').checked=!!s.compactMode; $('v3Motion').checked=!!s.reducedMotion; $('v3Contrast').checked=!!s.highContrast; applyTheme(s.theme||'obsidian');
  document.querySelectorAll('[data-theme-choice]').forEach(b=>b.onclick=async()=>{ const theme=b.dataset.themeChoice; $('v3Theme').value=theme; applyTheme(theme); document.querySelectorAll('[data-theme-choice]').forEach(x=>x.classList.toggle('active',x===b)); try{const r=await api('/api/settings',{method:'PUT',body:JSON.stringify({theme})});state.user.settings={...(state.user.settings||{}),...(r.settings||{}),theme};state.user.theme=theme;toast(theme[0].toUpperCase()+theme.slice(1)+' theme applied and saved.');}catch(e){toast('Theme preview applied, but saving failed: '+e.message);} });
  $('saveProfileColors').onclick=async()=>{try{const r=await api('/api/profile',{method:'PUT',body:JSON.stringify({profileColor:$('profileColor').value,profileAccentColor:$('profileAccentColor').value})});state.user=r.user;toast('Profile colors saved.');await loadProfile(state.user);}catch(e){toast(e.message)}};
   $('savePrivacy').onclick=async()=>{try{await api('/api/profile',{method:'PUT',body:JSON.stringify({privacy:{lastSeen:$('setLastSeen').checked,online:$('setOnline').checked}})});toast('Privacy saved.');}catch(e){toast(e.message)}};
  $('saveAppearance').onclick=async()=>{try{const payload={theme:$('v3Theme').value,fontSize:$('v3Font').value,compactMode:$('v3Compact').checked,reducedMotion:$('v3Motion').checked,highContrast:$('v3Contrast').checked,usernameColor:$('v3UsernameColor').value,chatFont:$('v3ChatFont').value,messageEffects:$('v3Effects').value,bubbleColor:$('v3BubbleColor').value};const r=await api('/api/settings',{method:'PUT',body:JSON.stringify(payload)});state.user.settings={...(state.user.settings||{}),...(r.settings||payload),theme:payload.theme};applyTheme(state.user.settings.theme);applyUserAppearance();renderMessages();toast('Appearance saved and applied.');}catch(e){toast(e.message)}};
  $('saveNotifications').onclick=async()=>{await api('/api/notifications/preferences',{method:'PUT',body:JSON.stringify({messages:$('nMessages').checked,mentions:$('nMentions').checked,replies:$('nReplies').checked,security:$('nSecurity').checked,staff:$('nStaff').checked,gamification:$('nGamification').checked,other:$('nOther').checked})});toast('Notification preferences saved.');};
  $('viewLoginHistory').onclick=async()=>{const h=await api('/api/security/login-history');modal(`<h2>Login history</h2>${(h.history||[]).map(x=>`<div class="card"><b>${fmt(x.time)}</b><div class="muted">${esc(x.ip||'Unknown device')}</div></div>`).join('')||'<p class="muted">No login history.</p>'}`);};
  $('logoutAllDevices').onclick=async()=>{if(!confirm('Log out all sessions?'))return;try{await api('/api/security/logout-all',{method:'POST'});location.reload();}catch(e){toast(e.message)}};
}



if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/service-worker.js").catch(()=>{}));}

function toggleReactionPicker(id){document.getElementById("reactionPicker-"+id)?.classList.toggle("hidden");}
