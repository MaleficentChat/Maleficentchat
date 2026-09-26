const $ = id => document.getElementById(id);

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
  featurePermissions: {}
};

const rankIcon = {
  MEMBER: "⚡",
  VIP: "💎",
  PREMIUM: "🏅",
  MOD: "🛡️",
  ADMIN: "⭐",
  SUPER_ADMIN: "🌟",
  COMMISSOR: "👻",
  COOWNER: "🦉",
  OWNER: "👑"
};

const rankOrder = {
  MEMBER: 0,
  VIP: 1,
  PREMIUM: 2,
  MOD: 3,
  ADMIN: 4,
  SUPER_ADMIN: 5,
  COMMISSOR: 6,
  COOWNER: 7,
  OWNER: 8
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
function canFeature(key){
  if(!state.user) return false;
  if(state.user.username==='Maleficent'&&state.user.rank==='OWNER') return true;
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

  $("authSubmit").textContent = login ? "Login" : "Register";
  $("authMsg").textContent = "";
}

$("tabLogin").onclick = () => setAuthMode(true);
$("tabRegister").onclick = () => setAuthMode(false);

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
          confirmPassword: $("confirmPassword")?.value
        })
      }
    );

       state.user = result.user;
    const boot = await api("/api/bootstrap");
    state.featurePermissions = boot.featurePermissions || {};

    await start();
  } catch (error) {
    $("authMsg").textContent = error.message;
  }
};

$("logout").onclick = async () => {
  try {
    await api("/api/logout", {
      method: "POST"
    });
  } finally {
    location.reload();
  }
};

function showKickLock(until){
  const box=$("actionLock"); if(!box)return;
  const refresh=()=>{
    const remaining=Number(until||0)-Date.now();
    if(remaining<=0){box.classList.add("hidden");return;}
    box.innerHTML=`<div class="action-lock-card"><div class="warning-title">⛔ Kicked</div><p>You have been kicked. You will be able to come back after <b>${new Date(until).toLocaleTimeString()}</b>.</p><small>Remaining: ${Math.ceil(remaining/60000)} minute(s)</small></div>`;
    box.classList.remove("hidden");
    setTimeout(refresh,Math.min(30000,remaining));
  }; refresh();
}
function clearActionLock(){ $("actionLock")?.classList.add("hidden"); }

/* ---------------- START ---------------- */

/* ---------------- START ---------------- */

async function start() {
  $("auth").classList.add("hidden");
  $("app").classList.remove("hidden");

  updateNav();
  applyTheme(state.user?.theme||'obsidian');
  applyUserAppearance();
  if(state.user?.kickedUntil&&state.user.kickedUntil>Date.now()) showKickLock(state.user.kickedUntil); else clearActionLock();
  applyUserAppearance();

  if (state.socket) {
    try {
      state.socket.disconnect();
    } catch {}
  }

  state.socket = io();
  state.socket.on("gold:update",data=>{ if(state.user&&data?.gold!==undefined){state.user.gold=data.gold; updateNav();}});

  state.socket.on("connect", () => {
    loadNotifications();
    if (state.user) {
      state.socket.emit("auth", state.user.id);
    }

    if (state.currentRoom) {
      state.socket.emit("join-room", state.currentRoom);
    }
  });

  state.socket.on("presence", async () => {
    if (state.view === "rooms") {
      try { await loadRooms(); } catch {}
      renderRooms();
      renderOnline();
    }
  });

  state.socket.on("message", message => {
    if (message.roomId === state.currentRoom) {
      appendMessage(message);
    }
  });

  state.socket.on("system-message", notice => {
    if(!notice.roomId || notice.roomId===state.currentRoom) appendMessage({...notice,system:true});
  });

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

  state.socket.on("room:clear", () => {
    if (state.currentRoom) {
      $("messages").innerHTML = "";
      toast("Room cleared by staff.");
    }
  });

  state.socket.on("typing", data => {
    $("typing").textContent =
      data.typing
        ? `${esc(data.user)} is typing…`
        : "";
  });

  state.socket.on("notification", () => {
    loadNotifications();
  });
  state.socket.on("scheduled:sent", data => {
    toast(`⏰ Scheduled message sent.`);
    if(state.view==="hub") loadCommunityHub();
  });
  state.socket.on("room:announcement",()=>{if(state.currentRoom)loadRoomAnnouncements(state.currentRoom)});
  state.socket.on("room:announcement-delete",()=>{if(state.currentRoom)loadRoomAnnouncements(state.currentRoom)});
  state.socket.on("kick-lock", data => showKickLock(data?.until));
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
  await renderView();
  await loadNotifications();
}

async function bootstrap() {
  try {
    const data = await api("/api/bootstrap");

    if (data.user) {
      state.user = data.user;
      state.featurePermissions = data.featurePermissions || {};
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
      el.classList.toggle("hidden", !can("MOD"))
    );

  document
    .querySelectorAll(".owner-only")
    .forEach(el =>
      el.classList.toggle(
        "hidden",
        !(
          state.user.rank === "OWNER" &&
          state.user.username === "Maleficent"
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
      return renderRooms();

    case "users":
      return loadUsers();

    case "friends":
      return loadFriends();

    case "dms":
      return loadDMList();
    case "diaval":
      return loadDiaval();

    case "hub":
      return loadCommunityHub();
    case "games":
      return loadGames();

    case "news":
      return loadNews();

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

if ($("topMessages")) $("topMessages").onclick = () => {
  state.view = "dms";
  document.querySelectorAll(".nav[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === "dms"));
  renderView();
};
if ($("topFriends")) $("topFriends").onclick = () => {
  state.view = "friends";
  document.querySelectorAll(".nav[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === "friends"));
  renderView();
};
if ($("topNotifications")) $("topNotifications").onclick = () => $("notifications").click();
if ($("topFlag")) $("topFlag").onclick = async () => {
  if(!can("MOD")) { toast("Reports are available to staff."); return; }
  state.view="staff";
  document.querySelectorAll(".nav[data-view]").forEach(x=>x.classList.toggle("active",x.dataset.view==="staff"));
  await renderView();
};
if ($("topProfile")) $("topProfile").onclick = () => {
  state.view = "profile";
  document.querySelectorAll(".nav[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === "profile"));
  renderView();
};

/* ---------------- ROOMS ---------------- */

async function loadRooms() {
  const data = await api("/api/rooms");
  state.rooms = data.rooms || [];
}

function renderRooms() {
  const search=($('roomSearch').value||'').trim().toLowerCase();
  const rooms=state.rooms.filter(room=>{
    const hay=[room.name,room.description,room.category].join(' ').toLowerCase();
    return !search || hay.includes(search);
  });
  $('rooms').innerHTML=rooms.map(room=>{
    const locked=room.locked??!!room.passwordHash;
    const count=Number(room.onlineCount||0);
    return `
      <div class="room room-list-item ${state.currentRoom===room.id?'selected':''}">
        <button class="room-main-button" onclick="joinRoom('${esc(room.id)}')" aria-label="Enter ${esc(room.name)}">
        <span class="room-icon-wrap">${esc(room.icon||'💬')}</span>
        <span class="room-main">
          <span class="room-title-row"><strong>${esc(room.name)}</strong>${locked?'<span class="room-lock">🔒</span>':''}</span>
          <span class="room-desc">${esc(room.description||'No description has been written for this room')}</span>
          <span class="room-subrow"><span>${esc(room.category||'Community')}</span><span>•</span><span>${esc(room.rankRequired||'MEMBER')}+</span>${room.announcement?'<span>• 📌 announcement</span>':''}</span>
        </span>
        <span class="room-count"><strong>${count}</strong><span>♟</span></span>
        </button>
        ${canFeature('edit_room') && room.id!=='main' ? `<button class="room-edit-button" onclick="event.stopPropagation();openRoomEditor('${esc(room.id)}')" title="Edit room">⚙️</button>` : ''}
      </div>`;
  }).join('') || '<div class="room-empty"><div>🏠</div><b>No rooms found</b><span>Try another search.</span></div>';
}

$("roomSearch").oninput = renderRooms;

async function openRoomEditor(id){
  const room=state.rooms.find(r=>r.id===id);if(!room)return;
  platformModal(`⚙️ Edit Room · ${esc(room.name)}`,`
    <div class="room-editor-grid">
      <label>Name<input id="reName" value="${esc(room.name||'')}"></label>
      <label>Icon<input id="reIcon" value="${esc(room.icon||'💬')}"></label>
      <label>Category<input id="reCategory" value="${esc(room.category||'Community')}"></label>
      <label>Rank required<select id="reRank">${ranks.map(r=>`<option value="${r}" ${r===(room.rankRequired||'MEMBER')?'selected':''}>${rankIcon[r]||''} ${r}+</option>`).join('')}</select></label>
      <label>Member limit<input id="reLimit" type="number" min="1" value="${Number(room.limit||100)}"></label>
      <label>Slow mode (seconds)<input id="reSlow" type="number" min="0" value="${Number(room.slowMode||0)}"></label>
    </div>
    <label>Description<textarea id="reDescription">${esc(room.description||'')}</textarea></label>
    <label>Password <span class="muted">(leave blank to keep current password)</span><input id="rePassword" type="password" placeholder="New password"></label><label class="check-row"><input id="reRemovePassword" type="checkbox"> Remove password protection</label>
    <label>Announcement<textarea id="reAnnouncement">${esc(room.announcement||'')}</textarea></label>
    <label>Banner URL<input id="reBanner" value="${esc(room.banner||'')}" placeholder="Optional image URL"></label>
    <div class="toolbar">
      <button class="primary" id="reSave">💾 Save changes</button>
      <button class="mini danger" id="reDelete">🗑 Delete room</button>
    </div>`);
  $('reSave').onclick=async()=>{
    try{
      const body={name:$('reName').value,icon:$('reIcon').value,category:$('reCategory').value,rankRequired:$('reRank').value,limit:Number($('reLimit').value),slowMode:Number($('reSlow').value),description:$('reDescription').value,announcement:$('reAnnouncement').value,banner:$('reBanner').value};
      if($('reRemovePassword').checked)body.password='';
      else if($('rePassword').value)body.password=$('rePassword').value;
      await api('/api/rooms/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body)});
      closeModal();await loadRooms();renderRooms();toast('Room settings saved.');
    }catch(e){toast(e.message)}
  };
  $('reDelete').onclick=async()=>{
    if(!confirm(`Delete "${room.name}" and its messages?`))return;
    try{await api('/api/rooms/'+encodeURIComponent(id),{method:'DELETE'});closeModal();if(state.currentRoom===id){state.currentRoom='main';await joinRoom('main')}await loadRooms();renderRooms();toast('Room deleted.')}catch(e){toast(e.message)}
  };
}


async function loadRoomAnnouncements(roomId){
  try{const r=await api(`/api/rooms/${encodeURIComponent(roomId)}/announcements`); const items=r.announcements||[]; const el=$("announcement"); if(!items.length){el.classList.toggle('hidden',true);return;} el.classList.remove('hidden'); el.innerHTML=`<div class="room-announcement-feed"><b>📢 Room announcements</b>${items.slice(0,3).map(n=>`<div class="room-announcement-item"><div><b>@${esc(n.username)}</b> · ${fmt(n.time)} ${canFeature('edit_room')?`<button class="mini danger announcement-delete" data-announcement="${esc(n.id)}">🗑 Delete</button>`:''}</div><div>${formatMentions(n.text)}</div></div>`).join('')}</div>`; el.querySelectorAll('.announcement-delete').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this announcement?'))return;try{await api(`/api/rooms/${encodeURIComponent(roomId)}/announcements/${encodeURIComponent(b.dataset.announcement)}`,{method:'DELETE'});toast('Announcement deleted.');loadRoomAnnouncements(roomId)}catch(e){toast(e.message)}});}catch(e){console.warn(e)}
}
function postRoomAnnouncement(){
  const text=prompt('Share an announcement in this room:',''); if(!text?.trim()) return;
  api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/announcements`,{method:'POST',body:JSON.stringify({text:text.trim()})}).then(()=>{toast('Room announcement shared.');loadRoomAnnouncements(state.currentRoom)}).catch(e=>toast(e.message));
}

async function joinRoom(id) {
  const room =
    state.rooms.find(r => r.id === id);

  if (!room) return;

  try {
    let password = "";

    const locked =
      room.locked ??
      !!room.passwordHash;

    if (locked) {
      password =
        prompt("Room password:") || "";
    }

    await api(`/api/rooms/${id}/join`, {
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

    state.currentRoom = id;

    if (state.socket) {
      state.socket.emit("join-room", id);
    }

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
  } catch (error) {
    toast(error.message);
  }
}

let onlinePanelTab="online";
let onlinePanelCache=[];

function isStaffUser(user){
  return ["MOD","ADMIN","SUPER_ADMIN","COMMISSOR","COOWNER","OWNER"].includes(user.rank);
}

async function renderOnline(tab=onlinePanelTab){
  onlinePanelTab=tab;
  try{
    const data=await api("/api/users");
    onlinePanelCache=data.users||[];
    const online=onlinePanelCache.filter(u=>u.online);
    const friendsData=await api("/api/friends").catch(()=>({users:[]}));
    const friendIds=new Set((friendsData.users||[]).map(u=>u.id));
    let list=[];
    let title="Online";

    if(tab==="all"){ list=onlinePanelCache; title="All users"; }
    else if(tab==="staff"){ list=onlinePanelCache.filter(isStaffUser); title="Staff"; }
    else if(tab==="friends"){ list=onlinePanelCache.filter(u=>friendIds.has(u.id)); title="Friends"; }
    else if(tab==="search"){
      const q=prompt("Search username or display name:", "");
      if(q===null){ tab="online"; onlinePanelTab="online"; list=online; title="Online"; }
      else {
        const needle=q.trim().toLowerCase();
        list=onlinePanelCache.filter(u=>(u.username+" "+u.displayName).toLowerCase().includes(needle));
        title=`Search · ${needle||"all"}`;
      }
    } else { list=online; title="Online"; }

    list.sort((a,b)=>(Number(b.online)-Number(a.online))||(rankOrder[b.rank]-rankOrder[a.rank])||a.username.localeCompare(b.username));

    const count=online.length;
    $("onlinePanelTitle").innerHTML=`${esc(title)} <span class="online-badge">${count}</span>`;
    $("onlineUsers").innerHTML=list.map(user=>`
      <div class="online-user ${user.online?'is-online':'is-offline'}" onclick="openUser('${esc(user.id)}')">
        ${avatar(user)}
        <div class="online-user-copy">
          <b>${esc(user.displayName)}</b>
          <small>@${esc(user.username)} · ${user.online?"Online":"Offline"}</small>
          ${rank(user.rank)}
        </div>
        <span class="status ${user.online?'on':''}"></span>
      </div>
    `).join("") || `<div class="online-empty"><div>${tab==="staff"?"🛡️":tab==="friends"?"💜":"👥"}</div><b>No users here</b><span>Try another tab.</span></div>`;

    $("onlineCount").textContent=`${count} online`;
    document.querySelectorAll("#onlineTabs [data-online-tab]").forEach(b=>b.classList.toggle("active",b.dataset.onlineTab===onlinePanelTab));
  }catch{}
}

function openOnlinePanelMenu(){
  modal(`<h2>People panel</h2><p class="muted">Use the tabs to switch between online users, everyone, staff, friends and search.</p><div class="toolbar"><button class="mini" onclick="renderOnline('online');closeModal()">Online</button><button class="mini" onclick="renderOnline('all');closeModal()">All users</button><button class="mini" onclick="renderOnline('staff');closeModal()">Staff</button><button class="mini" onclick="renderOnline('friends');closeModal()">Friends</button></div>`);
}

document.querySelectorAll("#onlineTabs [data-online-tab]").forEach(btn=>{
  btn.addEventListener("click",()=>renderOnline(btn.dataset.onlineTab));
});

/* ---------------- MESSAGES ---------------- */

function formatMentions(text){
  const raw=esc(text||'');
  return raw.replace(/(^|\s)@([A-Za-z0-9_]{3,24})/g,(m,p,n)=>{
    const known=[...(state.mentionUsers||[]),{username:'Aurora'},{username:'Diaval'}].some(u=>u.username.toLowerCase()===n.toLowerCase());
    return known ? `${p}<span class="mention-blue">@${n}</span>` : m;
  });
}

function messageHTML(message) {
  if(message.system){
    return `<div class="system-message" data-mid="${esc(message.id)}"><span>✦</span><b>${esc(message.text||'')}</b><small>${fmt(message.time)}</small></div>`;
  }
  const user = {
    username: message.username,
    displayName: message.displayName,
    rank: message.rank,
    avatar: message.avatar || ""
  };

  let attachment = "";

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

  const reactions =
    Object.entries(message.reactions || {})
      .filter(([, users]) => users.length)
      .map(([emoji, users]) => `
        <button
          class="mini"
          onclick="reactMsg(
            '${esc(message.id)}',
            '${esc(emoji)}'
          )"
        >
          ${emoji} ${users.length}
        </button>
      `)
      .join("");

  return `
    <div
      class="msg"
      data-mid="${esc(message.id)}"
    >
      <button class="message-avatar-button" onclick="openUser('${esc(user.id)}')" title="Open profile">${avatar(user)}</button>

      <div class="msg-body">

        <div class="msg-top">
          <button class="message-author tag-author" type="button" title="Tag @${esc(message.username)}" onclick="tagUserFromMessage('${esc(message.username)}')" style="color:${esc(message.usernameColor||state.user?.settings?.usernameColor||'var(--username-color)')}">${esc(message.displayName)}</button>
          ${rank(message.rank)}

          <span class="msg-time">
            ${fmt(message.time)}
            ${message.edited ? " · edited" : ""}
          </span>
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

        ${
          message.text
            ? `<div class="msg-text">
                 ${formatMentions(message.text)}
               </div>`
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

          <button
            class="mini"
            onclick="replyMsg('${esc(message.id)}')"
          >
            Quote
          </button>
          <button
            class="mini"
            onclick="openThread('${esc(message.id)}')"
          >
            🧵 Thread
          </button>

          <button
            class="mini"
            onclick="reportMsg('${esc(message.id)}')"
          >
            Report
          </button>

          <div class="reaction-picker-wrap">
            <button class="mini" onclick="toggleReactionPicker('${esc(message.id)}')">😊 React</button>
            <div class="reaction-picker hidden" id="reaction-picker-${esc(message.id)}">
              ${['👍','❤️','😂','😮','😢','😡','👏','🔥','🎉','😍','🤔','💯','👀','🙏','💜','✨'].map(e=>`<button type="button" onclick="reactMsg('${esc(message.id)}','${e}');toggleReactionPicker('${esc(message.id)}')">${e}</button>`).join('')}
            </div>
          </div>

          <button
            class="mini"
            onclick="saveMsg('${esc(message.id)}')"
          >
            🔖
          </button>

          ${
            message.userId === state.user.id ||
            can("MOD")
              ? `
                <button
                  class="mini"
                  onclick="editMsg('${esc(message.id)}')"
                >
                  Edit
                </button>

                <button
                  class="mini danger"
                  onclick="deleteMsg('${esc(message.id)}')"
                >
                  Delete
                </button>
              `
              : ""
          }

          ${
            can("MOD")
              ? `
                <button
                  class="mini"
                  onclick="pinMsg('${esc(message.id)}')"
                >
                  ${message.pinned ? "Unpin" : "Pin"}
                </button>
              `
              : ""
          }

        </div>

        <div class="reaction">
          ${reactions}
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
}

$("composer").onsubmit = async e => {
  e.preventDefault();

  if (!state.currentRoom) {
    toast("Join a room first.");
    return;
  }

  const text =
    $("message").value.trim();

  const file =
    $("file").files[0];

  if (!text && !file) return;

  const form = new FormData();

  form.append("text", text);

  if (file) {
    form.append("file", file);
  }

  if (state.replyTo) {
    form.append(
      "replyTo",
      state.replyTo
    );
  }
  if(state.messageExpiry>0) form.append("expiresIn",String(state.messageExpiry));

  try {
    const response =
      await fetch(
        `/api/rooms/${state.currentRoom}/messages`,
        {
          method: "POST",
          body: form,
          credentials: "same-origin"
        }
      );

    const data =
      await response.json()
        .catch(() => ({}));

    if (!response.ok) {
      throw Error(
        data.error || "Could not send message."
      );
    }

    $("message").value = "";
    $("file").value = "";

    state.replyTo = null;
    state.messageExpiry = 0;
    if($("expireBtn")) $("expireBtn").textContent="⏳ 0s";

    $("replyBar").classList.add(
      "hidden"
    );
  } catch (error) {
    toast(error.message);
  }
};
$("attach").onclick = () =>
  $("file").click();

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


async function openThread(messageId){
  try{
    const d=await api('/api/messages/'+encodeURIComponent(messageId)+'/thread');
    modal(`<h2>🧵 Message Thread</h2><div class="thread-root"><b>@${esc(d.root.username)}</b><p>${formatMentions(d.root.text||'📎 Attachment')}</p></div><div id="threadRows" class="lab-list">${(d.replies||[]).map(x=>`<div class="card"><b>@${esc(x.username)}</b> ${formatMentions(x.text||'')}<small>${fmt(x.time)}</small></div>`).join('')||'<p class="muted">No replies yet.</p>'}</div><textarea id="threadText" placeholder="Reply in this thread…"></textarea><button class="primary" id="threadSend">Reply</button>`);
    $("threadSend").onclick=async()=>{const t=$("threadText").value.trim();if(!t)return;await api('/api/messages/'+messageId+'/thread',{method:'POST',body:JSON.stringify({text:t})});closeModal();toast('Thread reply sent.')};
  }catch(e){toast(e.message)}
}
if($("expireBtn")) $("expireBtn").onclick=()=>{
  const options=[0,10,60,3600,86400],i=options.indexOf(state.messageExpiry),next=options[(i+1)%options.length];
  state.messageExpiry=next;
  $("expireBtn").textContent=`⏳ ${next===0?'0s':next<60?next+'s':next<3600?(next/60)+'m':next===3600?'1h':'1d'}`;
  toast(next?`This message will expire after ${$("expireBtn").textContent.replace('⏳ ','')}.`:"Expiring messages disabled.");
};
if($("scheduleBtn")) $("scheduleBtn").onclick=()=>{
  const rooms=(state.rooms||[]).map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  modal(`<h2>⏰ Schedule message</h2><select id="quickSchRoom">${rooms}</select><textarea id="quickSchText" placeholder="Message"></textarea><input id="quickSchWhen" type="datetime-local"><button class="primary" id="quickSchSave">Schedule</button>`);
  $("quickSchSave").onclick=async()=>{try{const when=new Date($("quickSchWhen").value).getTime();if(!Number.isFinite(when)||when<=Date.now())throw Error('Choose a future date and time.');const r=await api('/api/community/scheduled',{method:'POST',body:JSON.stringify({roomId:$("quickSchRoom").value,text:$("quickSchText").value,sendAt:when})});closeModal();toast(`Message scheduled for ${fmt(r.scheduled.sendAt)}.`)}catch(e){toast(e.message)}}};
function setupMentionAutocomplete(){
  const input=$('message'), box=document.createElement('div');
  box.id='mentionSuggestions'; box.className='mention-suggestions';
  input.parentElement.appendChild(box);
  input.addEventListener('input', async ()=>{
    const m=input.value.slice(0,input.selectionStart).match(/(?:^|\s)@([A-Za-z0-9_]*)$/);
    if(!m){box.classList.remove('show');return;}
    try{
      const data=await api('/api/users?q='+encodeURIComponent(m[1]));
      const liveUsers=(data.users||[]).filter(u=>u.online && u.id!==state.user.id);
      const bots=[{id:'bot-aurora',username:'Aurora',displayName:'Aurora',rank:'BOT',online:true,avatar:''},{id:'bot-diaval',username:'Diaval',displayName:'Diaval',rank:'BOT',online:true,avatar:''},{id:'bot-mal',username:'Mal',displayName:'Mal',rank:'BOT',online:true,avatar:''}];
      state.mentionUsers=[...bots,...liveUsers].slice(0,10);
      if(!state.mentionUsers.length){box.classList.remove('show');return;}
      box.innerHTML=state.mentionUsers.map(u=>`<button type="button" data-mention="${esc(u.username)}">${u.rank==='BOT'?`<span class="bot-mention-icon">${u.username==='Aurora'?'🪄':u.username==='Mal'?'🕰️':'🐉'}</span>`:avatar(u)}<span><b>${esc(u.displayName)}</b><small>@${esc(u.username)} · ${u.rank==='BOT'?'AI bot':'Online'}</small></span></button>`).join('');
      box.classList.add('show');
      box.querySelectorAll('[data-mention]').forEach(b=>b.onclick=()=>{
        const before=input.value.slice(0,input.selectionStart), after=input.value.slice(input.selectionStart);
        const next=before.replace(/@([A-Za-z0-9_]*)$/,'@'+b.dataset.mention+' ')+after;
        input.value=next; input.focus(); box.classList.remove('show'); input.dispatchEvent(new Event('input'));
      });
    }catch{box.classList.remove('show');}
  });
  document.addEventListener('click',e=>{if(!box.contains(e.target)&&e.target!==input)box.classList.remove('show');});
}
setupMentionAutocomplete();
let voiceRecorder=null, voiceChunks=[], voiceStream=null;
async function toggleVoiceRecording(){
  const btn=$("voiceBtn");
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){ toast("Voice recording is not supported by this browser."); return; }
  if(voiceRecorder && voiceRecorder.state!=="inactive"){ voiceRecorder.stop(); return; }
  try{
    voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});
    voiceChunks=[];
    const mime=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"audio/webm";
    voiceRecorder=new MediaRecorder(voiceStream,{mimeType:mime});
    voiceRecorder.ondataavailable=e=>{if(e.data?.size)voiceChunks.push(e.data)};
    voiceRecorder.onstop=async()=>{
      voiceStream?.getTracks().forEach(t=>t.stop());
      btn.textContent="🎙️ Voice"; btn.classList.remove("recording");
      const blob=new Blob(voiceChunks,{type:voiceRecorder.mimeType||"audio/webm"});
      if(blob.size<1) return;
      try{
        const fd=new FormData(); fd.append("text",""); fd.append("file",blob,"voice-message.webm");
        const r=await fetch(`/api/rooms/${encodeURIComponent(state.currentRoom)}/messages`,{method:"POST",body:fd,credentials:"same-origin"});
        const d=await r.json().catch(()=>({})); if(!r.ok) throw Error(d.error||"Could not send voice message.");
        toast("Voice message sent.");
      }catch(e){toast(e.message)}
    };
    voiceRecorder.start(); btn.textContent="⏹ Stop"; btn.classList.add("recording"); toast("Recording… press Voice again to send.");
  }catch(e){toast("Microphone permission was not granted.")}
}
$("voiceBtn")?.addEventListener("click",toggleVoiceRecording);


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

function toggleReactionPicker(id){const el=$('reaction-picker-'+id);if(!el)return;document.querySelectorAll('.reaction-picker').forEach(x=>{if(x!==el)x.classList.add('hidden')});el.classList.toggle('hidden');}
async function reactMsg(id, emoji) {
  try {
    await api(
      `/api/messages/${id}/reaction`,
      {
        method: "POST",
        body: JSON.stringify({ emoji })
      }
    );
  } catch (error) {
    toast(error.message);
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

async function loadUsers() {
  try {
    const query =
      $("userSearch").value.trim();

    const data =
      await api(
        `/api/users?q=${encodeURIComponent(query)}`
      );

    const selectedRank=$("userRankFilter")?.value||"";
    $("users").innerHTML =
      (data.users || []).filter(user=>!selectedRank||user.rank===selectedRank)
        .map(userCard)
        .join("") ||
      `<p class="muted">No users found.</p>`;
  } catch (error) {
    toast(error.message);
  }
}

$("userSearch").oninput = () => loadUsers();
$("userRankFilter")?.addEventListener("change",()=>loadUsers());

function userCard(user) {
  return `
    <div class="user-card">

      ${avatar(user)}

      <div style="flex:1">

        <b>${esc(user.displayName)}</b>

        <div class="muted">
          @${esc(user.username)}
        </div>

        ${rank(user.rank)}
        · Lv ${user.level || 1}
        · 🪙 ${user.gold || 0}

      </div>

      <button
        class="mini"
        onclick="openUser('${esc(user.id)}')"
      >
        Open
      </button>

    </div>
  `;
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
  const memberSince=user.createdAt?new Date(user.createdAt).toLocaleDateString():'Unknown';
  const lastSeen=user.privacy?.lastSeen!==false&&user.lastSeen?new Date(user.lastSeen).toLocaleString():'Hidden';
  const bannerStyle=user.banner?`style="background-image:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.78)),url('${esc(user.banner)}')"`:'';
  const isSelf=user.id===state.user.id;
  const liked=!!data.likedByMe;
  modal(`<div class="profile-modal">
    <div class="profile-banner" ${bannerStyle}>
      <div class="profile-stats"><span class="profile-stat">⭐ ${user.level||1}</span><span class="profile-stat">XP ${user.xp||0}</span><span class="profile-stat">❤️ ${user.profileLikes||data.profileLikes||0}</span><button class="mini profile-hamburger" id="profileMenuBtn" title="Profile actions">☰</button>${!isSelf && (state.user?.username==="Maleficent" || canFeature("staff_rank_assignment")) ? `<button class="mini profile-rank-btn" id="profileRankBtn">🏅 Rank</button>` : ""}</div>
      ${avatar(user,'big-avatar')}
      <div class="profile-rank">${rank(user.rank)}${user.verified?' · ✓ Verified':''}</div>
      <div class="profile-name">${esc(user.displayName)}${user._nickname?` <span class="nickname-badge">“${esc(user._nickname)}”</span>`:''}</div>
      <div class="profile-handle">@${esc(user.username)}</div>
    </div>
    <div class="profile-tabs">
      <button class="profile-tab active" data-tab="info">Account</button>
      <button class="profile-tab" data-tab="about">About Me</button>
      <button class="profile-tab" data-tab="friends">Friends</button>
      <button class="profile-tab" data-tab="gifts">Gifts</button>
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
      <div class="profile-actions">
        <div class="profile-achievements">${renderAchievementBadges(user)}</div>
        <div class="profile-action-hint">Tap ☰ above for profile actions.</div>
      </div>`;
    else if(tab==='about') box.innerHTML=`<div class="about-card"><h3>About Me</h3><p>${esc(user.bio||'This user has not written an About Me yet.')}</p>${user.pronouns?`<div class="profile-info-row"><b>Pronouns</b><span>${esc(user.pronouns)}</span></div>`:''}${user.interests?.length?`<div class="tag-list">${user.interests.map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div>`:''}${isSelf?`<button class="primary" id="editAboutBtn">✏️ Edit About Me</button>`:''}</div>`;
    else if(tab==='friends') box.innerHTML=`<div class="about-card"><h3>Friends</h3><p class="muted">Friends and social connections for @${esc(user.username)}.</p><div class="profile-info-row"><b>👥 Friends</b><span>${user.friendsCount||0}</span></div><button class="mini" id="viewFriendsBtn">Open Friends</button></div>`;
    else if(tab==='gifts') box.innerHTML=`<div class="about-card"><div class="gift-head"><div><h3>Virtual Gifts</h3><p class="muted">Send a gift using your in-site gold.</p></div><button class="mini" id="createGiftBtn">＋ Create custom</button></div>${!isSelf?`<div class="gift-balance">Your gold: 🪙 <b>${state.user.gold||0}</b></div><div class="gift-grid" id="giftGrid"><div class="muted">Loading gifts…</div></div>`:`<div class="received-gifts">${(user.giftsReceived||[]).slice(-20).reverse().map(g=>`<span class="received-gift" title="${esc(fmt(g.time))}">${esc(g.icon||'🎁')} ${esc(g.gift||'Gift')}</span>`).join('')||'<p>Your received gifts appear here.</p>'}</div>`}</div>`;
    else box.innerHTML=`<div class="about-card"><div class="profile-info-row"><b>📝 About</b><span>${esc(user.bio||'No About Me')}</span></div><div class="profile-info-row"><b>📜 Username history</b><span>${(user.usernameHistory||[]).length} changes</span></div><div class="profile-info-row"><b>🔗 Profile ID</b><span>${esc(user.id)}</span></div>${can('MOD')?`<div class="toolbar"><button class="mini" id="profileHistoryBtn">📜 Staff action history</button></div><div id="profileHistoryBox"></div>`:''}<div class="profile-actions">${!isSelf?'<button class="mini danger" id="profileReportBtn">⚑ Report user</button>':''}</div></div>`;
    if(tab==='more' && can('MOD')) $('profileHistoryBtn')?.addEventListener('click',async()=>{try{const r=await api(`/api/users/${encodeURIComponent(user.id)}/action-history`);$('profileHistoryBox').innerHTML=(r.history||[]).map(h=>`<div class="card"><b>${esc(h.action)}</b> · ${esc(h.actorUsername||h.actor||'SYSTEM')}<br><span class="muted">${fmt(h.time)}${h.expiresAt?` · expires ${fmt(h.expiresAt)}`:''}</span><br>${esc(h.reason||'No reason recorded')}</div>`).join('')||'<p class="muted">No staff actions recorded.</p>';}catch(e){toast(e.message)}});
    wireProfileTabActions();
  };
  function wireProfileTabActions(){
    $('profileLikeBtn')?.addEventListener('click',async()=>{try{const r=await api(`/api/users/${user.id}/like`,{method:'POST'});data.likedByMe=r.liked;user.profileLikes=r.likes;$('profileLikeBtn').innerHTML=`${r.liked?'❤️ Unlike':'❤️ Like'} <span id="likeCount">${r.likes}</span>`;document.querySelector('.profile-stats .profile-stat:last-child').textContent=`❤️ ${r.likes}`;}catch(e){toast(e.message)}});
    $('profileMessageBtn')?.addEventListener('click',()=>{closeModal();openDM(user.id);});
    $('profileFriendBtn')?.addEventListener('click',async()=>{if(data.friendship==='ACCEPTED'){toast('Already friends.');return;}try{await friend(user.id);data.friendship='PENDING';renderTab('info');}catch(e){}});
    $('profileBlockBtn')?.addEventListener('click',async()=>{await block(user.id);closeModal();});
    $('profileGiftBtn')?.addEventListener('click',()=>renderTab('gifts'));
    $('profileGoldBtn')?.addEventListener('click',()=>shareGoldModal(user));
    $('profileNicknameBtn')?.addEventListener('click',()=>nicknameModal(user));
    $('profileModerateBtn')?.addEventListener('click',()=>moderate(user.id));
    $('profileStaffAccountBtn')?.addEventListener('click',()=>staffAccountModal(user));
    $('profileMenuBtn')?.addEventListener('click',()=>openProfileActionDrawer(user,data));
    $('profileRankBtn')?.addEventListener('click',()=>rankFromProfile(user));
    $('editProfileFromModal')?.addEventListener('click',()=>{closeModal();state.view='profile';renderView();});
    $('editAboutBtn')?.addEventListener('click',()=>{modal(`<h2>Edit About Me</h2><textarea id="aboutEdit" rows="7">${esc(state.user.bio||'')}</textarea><div class="toolbar"><button class="primary" id="saveAbout">Save</button><button class="mini" onclick="closeModal()">Cancel</button></div>`);$('saveAbout').onclick=async()=>{try{const r=await api('/api/profile',{method:'PUT',body:JSON.stringify({bio:$('aboutEdit').value})});state.user=r.user;closeModal();toast('About Me saved.');}catch(e){toast(e.message)}};});
    $('viewFriendsBtn')?.addEventListener('click',()=>{closeModal();state.view='friends';renderView();});
    if(tab==='gifts'){
      $('createGiftBtn')?.addEventListener('click',createCustomGift);
      if(!isSelf){
        api('/api/gifts').then(gd=>{
          const grid=$('giftGrid'); if(!grid)return;
          grid.innerHTML=(gd.gifts||[]).map(g=>`<button class="gift-btn" data-gift="${esc(g.id)}">${g.url?`<img src="${esc(g.url)}" class="gift-preview-img">`:g.type==='text'?`<span class="gift-preview-text">${esc(g.text||'')}</span>`:`<span>${esc(g.icon||'🎁')}</span>`}<b>${esc(g.name)}</b><small>🪙 ${g.cost}</small></button>`).join('')||'<p class="muted">No gifts available.</p>';
          grid.querySelectorAll('.gift-btn').forEach(b=>b.addEventListener('click',async()=>{try{const r=await api(`/api/users/${user.id}/gift`,{method:'POST',body:JSON.stringify({gift:b.dataset.gift})});state.user.gold=r.remainingGold;toast(`${r.gift.icon} ${r.gift.name} sent.`);renderTab('gifts');}catch(e){toast(e.message)}}));
        }).catch(e=>toast(e.message));
      }
    }
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

async function loadDMList() {
  try {
    const data =
      await api("/api/users");

    $("dmList").innerHTML =
      (data.users || [])
        .filter(u => u.id !== state.user.id)
        .map(user => `
          <div class="user-card">

            ${avatar(user)}

            <div style="flex:1">
              <b>${esc(user.displayName)}</b>
              <br>
              ${rank(user.rank)}
            </div>

            <button
              class="primary"
              onclick="openDM('${esc(user.id)}')"
            >
              Chat
            </button>

          </div>
        `)
        .join("") ||
      `<p class="muted">No users available.</p>`;
  } catch (error) {
    toast(error.message);
  }
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
          message.text
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
    const user = (users.users || []).find(x => x.id === id);

    if (!user) {
      toast("User not found.");
      return;
    }

    state.dmUserId = id;

    const data = await api(`/api/dm/${id}`);
    const messages = data.messages || [];
    state.dmMessages = messages;

    modal(`
      <h2>
        Private chat with ${esc(user.displayName)}
      </h2>

      <div
        id="dmMessages"
        class="messages"
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

      <form id="dmForm" class="composer dm-composer">
        <label class="dm-upload-btn" title="Send photo or file">📎
          <input id="dmFile" type="file" accept="image/*,audio/*,video/*,.pdf,.txt" hidden>
        </label>
        <span id="dmFileName" class="muted dm-file-name"></span>
        <input id="dmText" placeholder="Private message…" maxlength="4000" autocomplete="off">
        <button class="send" type="submit">Send</button>
      </form>
    `);

    const box = $("dmMessages");
    if (box) box.scrollTop = box.scrollHeight;

    try {
      await api(`/api/dm/${id}/read`, { method: "POST" });
    } catch {}

    $("dmFile")?.addEventListener("change",()=>{
      const f=$("dmFile").files?.[0];
      if($("dmFileName")) $("dmFileName").textContent=f?`📎 ${f.name}`:"";
    });

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
        const r=await fetch(`/api/dm/${id}`, {method:"POST",body:fd,credentials:"same-origin"});
        const d=await r.json().catch(()=>({}));
        if(!r.ok) throw Error(d.error||"Could not send private message.");
        input.value=""; if($("dmFile")) $("dmFile").value=""; if($("dmFileName")) $("dmFileName").textContent="";
        state.dmReplyTo=null; state.dmReplyUser=null; state.dmReplyAuthor=null; state.dmReplyText=null;
        await openDM(id);
      } catch(error){ toast(error.message); }
    };
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
      const comments=n.comments||[];
      return `<article class="card news-card">
        <div class="news-card-top"><div><h3>${esc(n.title)}</h3><div class="muted">${fmt(n.time)} · @${esc(n.author)}</div></div><span class="news-count">💬 ${comments.length}</span></div>
        <p class="news-body">${esc(n.body)}</p>
        ${n.attachment?.type?.startsWith('image/')?`<img class="news-attachment" src="${esc(n.attachment.url)}" alt="News photo">`:''}
        <div class="news-actions"><button class="mini" onclick="openNewsComments('${esc(n.id)}')">💬 Comments <b>${comments.length}</b></button>${canFeature('delete_news')?`<button class="mini danger" onclick="deleteNews('${esc(n.id)}')">🗑 Delete</button>`:""}</div>
      </article>`;
    }).join("")||`<div class="room-empty"><div>📰</div><b>No news yet</b><span>Community announcements will appear here.</span></div>`;
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
      <div class="toolbar"><button class="primary" type="submit">Publish news</button><button class="mini" type="button" onclick="closeModal()">Cancel</button></div>
    </form>
  </div>`);
  $('newsForm').onsubmit=async e=>{
    e.preventDefault();
    const title=$('nt').value.trim(), body=$('nb').value.trim();
    if(!title||!body) return;
    try{
      const form=new FormData(); form.append('title',title); form.append('body',body);
      const photo=$('nphoto')?.files?.[0]; if(photo) form.append('file',photo);
      const resp=await fetch('/api/news',{method:'POST',body:form,credentials:'same-origin'}); const result=await resp.json().catch(()=>({}));
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

function staffAccountModal(user){
  if(!can('MOD')||user.username==='Maleficent'||user.rank==='OWNER'){toast('This account is protected.');return;}
  const allowed=ranks.filter((r,i)=>i<=rankOrder.MOD && i<rankOrder[state.user.rank]);
  modal(`<h2>⚙️ Staff account controls</h2><p class="muted">Edit @${esc(user.username)}. Staff permissions are controlled by Owner Space.</p><label>Username<input id="staffUsername" value="${esc(user.username)}"></label><label>Email<input id="staffEmail" type="email" value="${esc('')}"></label><label>Rank<select id="staffRank">${allowed.map(r=>`<option ${r===user.rank?'selected':''}>${r}</option>`).join('')}</select></label><div class="toolbar"><button class="primary" id="saveStaffAccount">Save changes</button></div>`);
  api('/api/users/'+encodeURIComponent(user.id)+'/profile').then(r=>{if($('staffEmail'))$('staffEmail').value=r.email||''}).catch(()=>{});
  $('saveStaffAccount').onclick=async()=>{try{await api('/api/staff/user/'+encodeURIComponent(user.id)+'/account',{method:'PATCH',body:JSON.stringify({username:$('staffUsername').value.trim(),email:$('staffEmail').value.trim()})});await api('/api/staff/user/'+encodeURIComponent(user.id)+'/rank',{method:'PATCH',body:JSON.stringify({rank:$('staffRank').value})});closeModal();toast('Staff account updated.');}catch(e){toast(e.message)}};
}
function rankFromProfile(user){
  const isOwner=state.user?.username==="Maleficent" && state.user?.rank==="OWNER";
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

function createCustomGift(){
  modal(`<div class="custom-gift-modal"><h2>✨ Create personalized gift</h2><p class="muted">Create a reusable image gift or text gift for your catalog.</p><div class="gift-create-tabs"><button class="mini active" id="giftPicTab">🖼️ Picture gift</button><button class="mini" id="giftTextTab">✍️ Text gift</button></div><div id="giftCreateBody"><input id="giftName" maxlength="40" placeholder="Gift name"><input id="giftPic" type="file" accept="image/*"><input id="giftCost" type="number" min="1" max="100000" value="10" placeholder="Gold cost"></div><div class="toolbar"><button class="primary" id="saveCustomGift">Create gift</button><button class="mini" onclick="closeModal()">Cancel</button></div></div>`);
  let type='image';
  const body=()=> $('giftCreateBody').innerHTML=type==='image'?`<input id="giftName" maxlength="40" placeholder="Gift name"><input id="giftPic" type="file" accept="image/*"><input id="giftCost" type="number" min="1" max="100000" value="10" placeholder="Gold cost">`:`<input id="giftName" maxlength="40" placeholder="Gift name"><textarea id="giftText" maxlength="180" rows="5" placeholder="Text that will appear as the gift"></textarea><input id="giftCost" type="number" min="1" max="100000" value="10" placeholder="Gold cost">`;
  $('giftPicTab').onclick=()=>{type='image';$('giftPicTab').classList.add('active');$('giftTextTab').classList.remove('active');body()}; $('giftTextTab').onclick=()=>{type='text';$('giftTextTab').classList.add('active');$('giftPicTab').classList.remove('active');body()};
  $('saveCustomGift').onclick=async()=>{try{const fd=new FormData();fd.append('name',$('giftName').value.trim());fd.append('cost',$('giftCost').value);fd.append('type',type);if(type==='text')fd.append('text',$('giftText').value.trim());else {const file=$('giftPic')?.files?.[0];if(!file)throw Error('Choose an image.');fd.append('file',file);} const r=await fetch('/api/gifts/custom',{method:'POST',body:fd,credentials:'same-origin'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||`Could not create gift (${r.status})`);closeModal();toast(`🎁 ${d.gift.name} created successfully.`);try{renderView();}catch{}}catch(e){toast(e.message||'Could not create gift.')}};
}

function renderAchievementBadges(user){
  const goldSent=Number(user.badgesStats?.goldSent||0), xp=Number(user.xp||0), gifts=Number(user.giftsReceived?.length||0), likes=Number(user.profileLikes||0);
  const groups=[['🪙','Gold Trader',goldSent,5000],['⭐','Dedicated Member',xp,1000],['🎁','Gift Keeper',gifts,10],['❤️','Liked Member',likes,10]];
  let html='';
  for(const [icon,name,value,step] of groups){ const tier=Math.min(100,Math.floor(value/step)); if(!tier) continue; html+=`<div class="achievement-group"><b>${icon} ${name}</b><div class="badge-row">${Array.from({length:tier},(_,i)=>`<span class="achievement-badge" title="${esc(name)} ${i+1}">${icon} ${i===99?'★':i+1}</span>`).join('')}</div><small>${value.toLocaleString()} progress</small></div>`; }
  return html||'<div class="muted">No achievement badges earned yet.</div>';
}

async function openProfileActionDrawer(user,data){
  const isSelf=user.id===state.user.id;
  const blocked=(state.user.blocked||[]).includes(user.id);
  modal(`<div class="profile-drawer"><h2>Profile actions</h2><div class="toolbar profile-drawer-list">${!isSelf?`<button class="mini" id="drawerMessage">💬 Private message</button><button class="mini" id="drawerLike">${data.likedByMe?'💔 Unlike':'❤️ Like profile'}</button><button class="mini" id="drawerFriend">👥 Add friend</button><button class="mini" id="drawerBlock">${blocked?'🚫 Unblock':'🚫 Block'}</button><button class="mini" id="drawerGift">🎁 Send gift</button><button class="mini" id="drawerGold">🪙 Share wallet</button>${canFeature('staff_rank_assignment')?`<button class="mini" id="drawerRank">🏅 Give rank</button>`:''}${canFeature('moderate_user')?`<button class="mini" id="drawerModerate">🛡️ Moderate user</button>`:''}${canFeature('manage_staff_accounts')?`<button class="mini" id="drawerStaff">⚙️ Staff account</button>`:''}${can('MOD')?`<button class="mini" id="drawerHistory">📜 User history</button>`:''}`:`<button class="mini" id="drawerEdit">✏️ Edit profile</button><button class="mini" id="drawerBlocked">🚫 Blocked users</button>`}</div></div>`);
  $('drawerMessage')?.addEventListener('click',()=>{closeModal();openDM(user.id)});
  $('drawerLike')?.addEventListener('click',async()=>{try{const r=await api(`/api/users/${user.id}/like`,{method:'POST'});data.likedByMe=r.liked;user.profileLikes=r.likes;closeModal();renderUserProfileModal(user,data);toast(r.liked?'Profile liked.':'Profile like removed.');}catch(e){toast(e.message)}});
  $('drawerRank')?.addEventListener('click',()=>{closeModal();rankFromProfile(user)});
  $('drawerHistory')?.addEventListener('click',async()=>{try{const r=await api(`/api/users/${user.id}/action-history`);modal(`<h2>📜 User history</h2><div class="stack">${(r.history||[]).map(h=>`<div class="card"><b>${esc(h.action)}</b> · ${esc(h.actorUsername||h.actor||'SYSTEM')}<br><small>${fmt(h.time)}${h.expiresAt?` · expires ${fmt(h.expiresAt)}`:''}</small><br>${esc(h.reason||'No reason recorded')}</div>`).join('')||'<p class="muted">No user history recorded.</p>'}</div>`);}catch(e){toast(e.message)}});
  $('drawerFriend')?.addEventListener('click',async()=>{try{await friend(user.id);closeModal();toast('Friend request sent.')}catch(e){toast(e.message)}});
  $('drawerBlock')?.addEventListener('click',async()=>{try{if(blocked) await api(`/api/users/${user.id}/block`,{method:'DELETE'}); else await block(user.id); closeModal(); toast(blocked?'User unblocked.':'User blocked.');}catch(e){toast(e.message)}});
  $('drawerGift')?.addEventListener('click',async()=>{closeModal();renderUserProfileModal(user,data);setTimeout(()=>document.querySelector('.profile-tab[data-tab=\"gifts\"]')?.click(),0);});
  $('drawerGold')?.addEventListener('click',()=>{closeModal();shareGoldModal(user)});
  $('drawerModerate')?.addEventListener('click',()=>{closeModal();moderate(user.id)});
  $('drawerStaff')?.addEventListener('click',()=>{closeModal();staffAccountModal(user)});
  $('drawerEdit')?.addEventListener('click',()=>{closeModal();state.view='profile';renderView()});
  $('drawerBlocked')?.addEventListener('click',showBlockedUsers);
}
async function showBlockedUsers(){
  try{const r=await api('/api/users/blocked'); modal(`<h2>🚫 Blocked users</h2><div class="stack">${(r.users||[]).map(u=>`<div class="card blocked-user-row">${avatar(u)}<div><b>${esc(u.displayName)}</b><small>@${esc(u.username)}</small></div><button class="mini" onclick="unblockFromList('${esc(u.id)}')">Unblock</button></div>`).join('')||'<p class="muted">You have not blocked anyone.</p>'}</div>`);}catch(e){toast(e.message)}}
async function unblockFromList(id){try{await api(`/api/users/${id}/block`,{method:'DELETE'});showBlockedUsers();toast('User unblocked.')}catch(e){toast(e.message)}}

async function loadProfile(user){
  if(!user) return;
  const banner=user.banner?`style="background-image:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.72)),url('${esc(user.banner)}')"`:'';
  $('profile').innerHTML=`<div class="my-profile-wrap"><div class="profile-settings-card">
    <div class="profile-settings-head" ${banner}>
      <div class="profile-settings-top"><span>⭐ ${user.level||1}</span><span>❤️ ${user.profileLikes||0}</span><button class="mini" onclick="uploadAvatar()">📷</button><button class="mini" onclick="editProfileInfo()" title="Edit profile">✏️</button><button class="mini" id="myProfileMenuBtn" title="More">☰</button></div>
      ${avatar(user,'big-avatar')}
      <div class="profile-rank">${rank(user.rank)}${user.verified?' · ✓ Verified':''}</div>
      <div class="profile-name" style="color:${esc(user.profileColor||user.settings?.usernameColor||'')}" >${esc(user.displayName)}</div><div class="profile-handle">@${esc(user.username)}${user.pronouns?` · ${esc(user.pronouns)}`:''}</div><div class="profile-extra">${user.mood?`<span>☻ ${esc(user.mood)}</span>`:''}${user.relationship?`<span>♥ ${esc(user.relationship)}</span>`:''}${user.location?`<span>📍 ${esc(user.location)}</span>`:''}${user.website?`<span>🔗 ${esc(user.website)}</span>`:''}</div>
      <button class="mini" onclick="uploadBanner()">🎵 Add music / banner</button>
    </div>
    <div class="profile-achievements profile-achievements-self"><h3>🏆 Achievement badges</h3>${renderAchievementBadges(user)}</div>
    <div class="settings-tabs"><button class="settings-tab active" data-st="account">Account</button><button class="settings-tab" data-st="more">More</button></div>
    <div id="myProfileSettings"></div>
  </div></div>`;
  const content=$('myProfileSettings');
  const render=(tab)=>{
    document.querySelectorAll('.settings-tab').forEach(b=>b.classList.toggle('active',b.dataset.st===tab));
    if(tab==='account'){content.innerHTML=`<div class="settings-list">
      <button class="settings-row" onclick="editProfileInfo()"><span>🪪</span><b>Edit info</b><small>Display name, pronouns and profile details</small><strong>›</strong></button>
      <button class="settings-row" onclick="editRelationship()"><span>♥</span><b>Edit relationship</b><small>${esc(user.relationship||'Not set')}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editUsername()"><span>✎</span><b>Edit username</b><small>@${esc(user.username)}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editAboutMe()"><span>?</span><b>Edit about me</b><small>${esc(user.bio||'Not set')}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editMood()"><span>☻</span><b>Edit mood</b><small>${esc(user.mood||'Not set')}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editEmail()"><span>✉</span><b>Edit email</b><small>Email is optional</small><strong>›</strong></button><button class="settings-row" onclick="showBlockedUsers()"><span>🚫</span><b>Blocked users</b><small>View and unblock people you blocked</small><strong>›</strong></button>
      <button class="settings-row" onclick="changePasswordModal()"><span>🔑</span><b>Change password</b><small>Update your login password</small><strong>›</strong></button><button class="settings-row" onclick="claimDailyReward()"><span>🎁</span><b>Daily reward</b><small>Claim 25 gold + 15 XP once per day</small><strong>›</strong></button><button class="settings-row" onclick="exportMyData()"><span>📦</span><b>Export my data</b><small>Download your account information as JSON</small><strong>›</strong></button>
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
async function editEmail(){try{const r=await api('/api/me/email');modal(`<h2>Edit email</h2><p class="muted">Email is optional. It is not required on the registration screen.</p><input id="emailEdit" type="email" value="${esc(r.email||'')}" placeholder="Email address"><div class="toolbar"><button class="primary" id="saveEmail">Save</button><button class="mini" onclick="closeModal()">Cancel</button></div>`);$('saveEmail').onclick=async()=>{try{await api('/api/me/email',{method:'PUT',body:JSON.stringify({email:$('emailEdit').value.trim()})});closeModal();toast('Email saved.');}catch(e){toast(e.message)}}}catch(e){toast(e.message)}}
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
      <button class="mini" type="button" onclick="closeModal()">Cancel</button>
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

function moderate(id) {
  modal(`
    <h2>Moderation</h2>

    <p>Select an action.</p>

    <div class="toolbar">

      ${
        [
          "WARN",
          "MUTE",
          "KICK",
          "BAN",
          "UNMUTE",
          "REVOKE_MUTE",
          "REVOKE_BAN",
          "REVOKE_KICK"
        ]
          .map(action => `
            <button
              class="mini"
              onclick="doModerate(
                '${esc(id)}',
                '${action}'
              )"
            >
              ${action}
            </button>
          `)
          .join("")
      }

    </div>

    <input
      id="modReason"
      placeholder="Reason"
    >

    <input
      id="modMinutes"
      type="number"
      min="1"
      placeholder="Minutes"
    >
  `);
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

/* ---------------- STAFF ---------------- */

async function loadStaff() {
  try {
    const data=await api('/api/staff/dashboard');
    const bootstrapData=await api('/api/bootstrap');
    const filterWords=await api('/api/staff/filter-word');
    $('staff').innerHTML=`
      <div class="grid2">
        <div class="card"><h3>Statistics</h3><p>Users: ${data.stats.users}<br>Online: ${data.stats.online}<br>Messages: ${data.stats.messages}<br>Open reports: ${data.stats.reportsOpen}</p></div>
        <div class="card"><h3>Filtered words</h3><button class="mini" onclick="addFilterWord()">＋ Add word</button><div class="filter-word-list">${(filterWords.words||[]).map(w=>`<div class="filter-word-row"><code>${esc(w)}</code><button class="mini danger" onclick="deleteFilterWord(decodeURIComponent('${encodeURIComponent(w)}'))">Delete</button></div>`).join('')||'<span class="muted">No filter words configured.</span>'}</div><p class="muted">Link filter: ${bootstrapData.settings?.linkFilter?'ON':'OFF'}</p></div>
      </div>
      <div class="card active-actions-card"><div class="toolbar"><div><h3>🛡️ Active moderation actions</h3><p class="muted">Only users currently muted, kicked or banned. Warnings are not listed.</p></div><select id="staffActionFilter"><option value="">All actions</option><option value="BANNED">Banned</option><option value="MUTED">Muted</option><option value="KICKED">Kicked</option></select></div><div id="activeActionUsers"></div></div>
      <div class="card"><h3>Reports</h3>
        ${(data.reports||[]).filter(report=>report.status==='OPEN').map(report=>{
          const snap=report.messageSnapshot||{};
          return `<div class="report-card"><div class="report-main"><div><b>${esc(report.category)}</b> · ${esc(report.status)}</div><div><b>Reported by:</b> @${esc(report.reporterUsername||findUserName(report.reporter)||'Unknown')}</div><div class="report-target"><b>Report made on:</b> @${esc(report.reportedUserUsername||snap.username||'Unknown')} ${esc(report.reportedUserRank||snap.rank||'')}</div><div class="report-message"><b>Reported content:</b><br>${snap.text?`<div>${esc(snap.text)}</div>`:''}${snap.attachment?.type?.startsWith('image/')?`<img class="reported-image" src="${esc(snap.attachment.url)}" alt="Reported photo">`:snap.attachment?`<a href="${esc(snap.attachment.url)}" target="_blank" rel="noopener">Open reported attachment</a>`:''}</div><div class="muted">Time: ${fmt(report.time)}</div><div class="muted">Reason: ${esc(report.reason||'No reason supplied')}</div></div><div class="toolbar">${report.reportedUserId?`<button class="mini" onclick="moderate('${esc(report.reportedUserId)}')">⚙ Moderate user</button>`:''}${report.messageId?`<button class="mini danger" onclick="deleteReportedMessage('${esc(report.messageId)}')">🗑 Delete message</button>`:''}${report.status!=='RESOLVED'?`<button class="mini" onclick="resolveReport('${esc(report.id)}')">Resolve</button>`:''}</div></div>`;
        }).join('')||'<p class="muted">No reports.</p>'}
      </div>
      <div class="card"><h3>Deleted media</h3><p class="muted">Photos and other attachments preserved from deleted messages.</p><div class="deleted-media-grid">${(data.logs||[]).filter(log=>log.action==='MESSAGE_DELETE' && log.meta?.attachment?.type?.startsWith('image/')).slice(0,100).map(log=>{const m=log.meta||{};const at=m.attachment;return `<div class="deleted-media-card"><img class="deleted-media-image" src="${esc(at.url)}" alt="Deleted photo"><div><b>@${esc(m.username||'Unknown')}</b><div class="muted">Deleted by @${esc(m.deletedBy||log.actor||'Unknown')} · ${fmt(m.deletedAt||log.time)}</div>${m.text?`<div class="deleted-media-text">${esc(m.text)}</div>`:''}</div></div>`;}).join('')||'<p class="muted">No deleted photos recorded yet.</p>'}</div></div>
      <div class="card"><h3>Audit log</h3><div class="table-wrap"><table class="table"><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr>${(data.logs||[]).slice(0,100).map(log=>`<tr><td>${fmt(log.time)}</td><td>${esc(log.actor)}</td><td>${esc(log.action)}</td><td>${esc(logDetails(log))}</td></tr>`).join('')}</table></div></div>`;
    const renderActiveActions=()=>{
      const filter=$("staffActionFilter")?.value||"";
      const rows=(data.activeActions||[]).filter(x=>!filter||(filter==="BANNED"&&x.banned)||(filter==="MUTED"&&x.mutedUntil)||(filter==="KICKED"&&x.kickedUntil));
      $("activeActionUsers").innerHTML=rows.map(x=>`<div class="user-card"><div style="flex:1"><b>${esc(x.displayName)}</b> @${esc(x.username)}<div class="muted">${rank(x.rank)} · ${x.banned?"Banned":x.kickedUntil?"Kicked until "+fmt(x.kickedUntil):"Muted until "+fmt(x.mutedUntil)}</div><div class="muted">${esc(x.reason||"")}</div></div><button class="mini" onclick="openUser('${esc(x.id)}')">Open</button></div>`).join("")||'<p class="muted">No users currently have this action.</p>';
    };
    $("staffActionFilter").onchange=renderActiveActions;
    renderActiveActions();
  }catch(e){toast(e.message)}
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

async function resolveReport(id) {
  try {
    await api(
      `/api/staff/reports/${id}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({
          status: "RESOLVED"
        })
      }
    );

    await loadStaff();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- OWNER ---------------- */

async function loadOwner() {
  try {
    const data =
      await api("/api/owner/overview");

    $("owner").innerHTML = `
      <div class="card">

        <h3>
          Permanent Owner Space
        </h3>

        <p>
          Owner-only controls for
          users, ranks, gold, passwords,
          private-message inspection,
          rooms, settings and audit logs.
        </p>

        <div class="toolbar">

          <button
            class="primary"
            onclick="inspectDMs()"
          >
            Inspect private messages
          </button>

          <button
            class="mini"
            onclick="ownerSettings()"
          >
            Site settings
          </button>

          <button class="mini" onclick="ownerFeatureGrants()">🧩 Feature granting</button>
          <button class="mini" onclick="openAuroraManager()">🪄 Aurora management</button>
          <button class="mini" onclick="openDiavalManager()">🐉 Diaval management</button>
          <button class="mini" onclick="openMalAIManager()">🖤 Mal management</button>

        </div>

      </div>

      <div class="card owner-settings-card">
        <h3>⚙️ Site settings</h3>
        <p class="muted">Owner-only site-wide controls. These settings are saved on the server and apply to the whole community.</p>
        <div class="owner-settings-grid">
          <label>XP per level<input id="ownerXp" type="number" min="10" value="${Number(data.settings?.xpPerLevel ?? 100)}"></label>
          <label>Daily XP limit<input id="ownerDailyXp" type="number" min="1" value="${Number(data.settings?.dailyXpLimit ?? 500)}"></label>
          <label>Gold per minute<input id="ownerGoldPerMinute" type="number" min="0" value="${Number(data.settings?.goldPerMinute ?? 0)}"></label>
        </div>
        <label class="check-row"><input id="ownerLinkFilter" type="checkbox" ${data.settings?.linkFilter ? 'checked' : ''}> Link filter</label>

        <h4>🚫 Filter-word controls</h4>
        <p class="muted">Choose the highest rank that can be affected. That rank and every rank below it will receive the automatic mute when a filtered word is used.</p>
        <div class="owner-settings-grid filter-controls-grid">
          <label>Auto-mute affects rank and below
            <select id="ownerFilterRank">${ranks.map(r=>`<option value="${r}" ${r===(data.settings?.filterMuteMinRank||'MEMBER')?'selected':''}>${rankIcon[r]||''} ${r}</option>`).join('')}</select>
          </label>
          <label>Automatic mute duration
            <div class="duration-input"><input id="ownerFilterDuration" type="number" min="1" max="10080" value="${Number(data.settings?.filterMuteDurationMinutes || 5)}"><span>minutes</span></div>
          </label>
        </div>
        <div class="toolbar"><button class="primary" id="saveOwnerSiteSettings">💾 Save site settings</button><button class="mini" onclick="ownerSettings()">Open full settings</button></div>
      </div>

      <div class="card">

        <h3>User controls</h3>

        ${
          (data.users || [])
            .map(user => `
              <div class="user-card">

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

                <button
                  class="mini"
                  onclick="ownerEdit(
                    '${esc(user.id)}'
                  )"
                >
                  Manage
                </button>

              </div>
            `)
            .join("")
        }

      </div>

      <div class="card">

        <h3>
          Gold transaction history
        </h3>

        ${
          data.goldTransactions?.length
            ? data.goldTransactions
                .slice(-100)
                .reverse()
                .map(transaction => `
                  <div>
                    ${fmt(transaction.time)}
                    ·
                    ${esc(transaction.type)}
                    ·
                    ${transaction.delta}
                  </div>
                `)
                .join("")
            : `<p>No transactions.</p>`
        }

      </div>
    `;

    const saveOwnerSiteSettings = $("saveOwnerSiteSettings");
    if (saveOwnerSiteSettings) {
      saveOwnerSiteSettings.onclick = async () => {
        try {
          await api("/api/owner/settings", {
            method: "PATCH",
            body: JSON.stringify({
              xpPerLevel: $("ownerXp").value,
              dailyXpLimit: $("ownerDailyXp").value,
              goldPerMinute: $("ownerGoldPerMinute").value,
              linkFilter: $("ownerLinkFilter").checked,
              filterMuteMinRank: $("ownerFilterRank").value,
              filterMuteDurationMinutes: $("ownerFilterDuration").value
            })
          });
          toast("Site settings and filter controls saved.");
          await loadOwner();
        } catch (e) {
          toast(e.message);
        }
      };
    }
  } catch (error) {
    toast(error.message);
  }
}

async function ownerEdit(id) {
  try {
    const data =
      await api("/api/owner/overview");

    const user =
      (data.users || [])
        .find(u => u.id === id);

    if (!user) return;

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
      <p class="muted">${user.username==="Maleficent" ? "Permanent owner account. Gold and password can be managed; its OWNER rank is protected." : "Owner can assign any rank, including OWNER."}</p>

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

      <input
        id="ogold"
        type="number"
        value="${user.gold || 0}"
        placeholder="Gold"
      >

      <input
        id="opass"
        type="password"
        placeholder="New password (optional)"
      >

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

    if ($("opass").value) {
      await api(
        `/api/owner/user/${id}/password`,
        {
          method: "PATCH",
          body: JSON.stringify({
            password: $("opass").value
          })
        }
      );
    }

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

async function inspectDMs() {
  try {
    const data =
      await api("/api/owner/dms");

    modal(`
      <h2>
        Owner-only private-message inspection
      </h2>

      ${
        (data.privateMessages || [])
          .map(message => `
            <div class="card">

              <b>@${esc(message.fromUsername || message.from)} → @${esc(message.toUsername || message.to)}</b>
              <div class="muted">${esc(message.fromDisplayName||'')} → ${esc(message.toDisplayName||'')}</div>
              <div>${esc(message.text || "")}</div>
              ${message.attachment?.type?.startsWith('image/')?`<img class="reported-image" src="${esc(message.attachment.url)}" alt="Private-message photo">`:message.attachment?`<a href="${esc(message.attachment.url)}" target="_blank" rel="noopener">Open attachment</a>`:''}
              <br>

              <small>
                ${fmt(message.time)}
              </small>

            </div>
          `)
          .join("") ||
        `<p>No private messages.</p>`
      }
    `);
  } catch (error) {
    toast(error.message);
  }
}

async function ownerFeatureGrants(){
  try{
    const data=await api('/api/owner/feature-permissions');
    modal(`<div class="feature-grant-modal"><h2>🧩 Feature Granting Panel</h2><p class="muted">Every site capability is listed here. Feature IDs are hidden; choose the minimum rank allowed to use each capability.</p><div class="feature-grant-list">${data.controls.map(f=>`<div class="feature-grant-row"><div><b>${esc(f.name)}</b><small>${esc(f.category)}</small></div><select data-feature="${esc(f.key)}">${data.ranks.map(r=>`<option value="${r}" ${(data.permissions[f.key]||f.defaultRank)===r?'selected':''}>${rankIcon[r]||''} ${r}</option>`).join('')}</select></div>`).join('')}</div><div class="toolbar"><button class="primary" id="saveFeatureGrants">Save all permissions</button><button class="mini" onclick="closeModal()">Cancel</button></div></div>`);
    $('saveFeatureGrants').onclick=async()=>{try{for(const sel of document.querySelectorAll('[data-feature]')){const current=data.permissions[sel.dataset.feature]||'';if(sel.value!==current){await api(`/api/owner/feature-permissions/${encodeURIComponent(sel.dataset.feature)}`,{method:'PATCH',body:JSON.stringify({rank:sel.value})});}}state.featurePermissions=data.permissions||state.featurePermissions; closeModal();toast('Feature permissions saved.');}catch(e){toast(e.message)}};
  }catch(e){toast(e.message)}
}

async function ownerSettings() {
  try {
    const data =
      await api("/api/owner/overview");

    const settings =
      data.settings || {};

    modal(`
      <h2>Site settings</h2>

      <input
        id="xp"
        type="number"
        value="${settings.xpPerLevel ?? 100}"
        placeholder="XP per level"
      >

      <input
        id="dxp"
        type="number"
        value="${settings.dailyXpLimit ?? 1000}"
        placeholder="Daily XP limit"
      >

      <input
        id="gm"
        type="number"
        value="${settings.goldPerMinute ?? 1}"
        placeholder="Gold per minute"
      >

      <label class="check-row"><input id="lf" type="checkbox" ${settings.linkFilter?"checked":""}> Link filter</label>
      <label class="field-label">Filtered-word mute applies to this rank and below</label>
      <select id="filterRank">${ranks.map(r=>`<option value="${r}" ${r===(settings.filterMuteMinRank||'MEMBER')?'selected':''}>${rankIcon[r]||''} ${r}</option>`).join('')}</select>
      <label class="field-label">Filtered-word mute duration (minutes)</label>
      <input id="filterDuration" type="number" min="1" max="10080" value="${Number(settings.filterMuteDurationMinutes||5)}">

      <button
        class="primary"
        onclick="saveOwnerSettings()"
      >
        Save
      </button>
    `);
  } catch (error) {
    toast(error.message);
  }
}

async function saveOwnerSettings() {
  try {
    await api(
      "/api/owner/settings",
      {
        method: "PATCH",
        body: JSON.stringify({
          xpPerLevel:
            $("xp").value,

          dailyXpLimit:
            $("dxp").value,

          goldPerMinute:
            $("gm").value,

          linkFilter:$('lf').checked,
          filterMuteMinRank:$('filterRank').value,
          filterMuteDurationMinutes:$('filterDuration').value
        })
      }
    );

    closeModal();

    toast("Settings saved.");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- NOTIFICATIONS ---------------- */

async function loadNotifications() {
  try {
    const [data,dm,staffCounts]=await Promise.all([
      api("/api/notifications"),
      api("/api/dm/unread-count"),
      api("/api/staff/unread-count").catch(()=>({reports:0,staffNotifications:0,total:0}))
    ]);
    const unread=(data.notifications||[]).filter(n=>!n.read);
    const notificationStaffCount=unread.filter(n=>["report","moderation","staff"].includes(n.type)).length;
    const reportCount=Math.max(Number(staffCounts.reports||0),notificationStaffCount);
    const counts={dm:Number(dm.count||0),report:reportCount,all:unread.length};
    const setBubble=(id,count)=>{
      const el=$(id);
      if(!el)return;
      el.textContent=count>99?'99+':String(count);
      el.style.setProperty('display',count>0?'inline-flex':'none','important');
      el.setAttribute('aria-label',`${count} unread`);
    };
    setBubble("notifDot",counts.all);
    setBubble("topNotifDot",counts.all);
    setBubble("topDmDot",counts.dm);
    setBubble("dmDot",counts.dm);
    setBubble("reportDot",counts.report);
    setBubble("topReportDot",counts.report);
    if($("topNotifDot")) $("topNotifDot").classList.toggle("green",counts.all>0);
  } catch(error) {
    console.warn("Notification refresh failed",error);
  }
}
setInterval(loadNotifications,5000);
setTimeout(loadNotifications,500);

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
function showAuroraHelp(){modal(`<h2>✨ Aurora</h2><p>Tag <b>@Aurora</b> and send <b>truth</b> or <b>dare</b> in any room. Aurora automatically replies with a randomized prompt.</p>`);}
async function openYoutubePanel(){
  modal(`<div class="youtube-panel"><h2>▶️ YouTube</h2><div class="toolbar"><input id="ytQuery" placeholder="Search YouTube…"><button class="primary" id="ytSearch">Search</button></div><div id="ytResults" class="youtube-results"><p class="muted">Search for a video to share it in this room.</p></div></div>`);
  $('ytSearch').onclick=async()=>{const q=$('ytQuery').value.trim();if(!q)return;const r=await api('/api/youtube/search?q='+encodeURIComponent(q)).catch(e=>({error:e.message}));if(r.error){toast(r.error);return;} $('ytResults').innerHTML=(r.results||[]).map(v=>`<button class="youtube-result" onclick="sendYoutube('${esc(v.id)}','${esc(v.title)}')"><img src="${esc(v.thumbnail)}"><span><b>${esc(v.title)}</b><small>${esc(v.channel||'YouTube')}</small></span></button>`).join('')||'<p class="muted">No results.</p>';};
}
async function sendYoutube(videoId,title){try{await api(`/api/rooms/${state.currentRoom}/youtube`,{method:'POST',body:JSON.stringify({videoId,title})});closeModal();toast('YouTube video shared in chat.');}catch(e){toast(e.message)}}
$("youtubeComposerBtn")?.addEventListener("click",()=>openYoutubePanel());
$("customGiftComposerBtn")?.addEventListener("click",()=>createCustomGift());

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
      <button class="mini" onclick="showAuroraHelp()">✨ Aurora Truth / Dare</button>
      <button class="mini" onclick="openYoutubePanel()">▶️ YouTube</button>
      <button class="mini" onclick="showInvite()">Invite link</button>

    </div>
  `);
};

async function clearRoom() {
  if (!confirm("Clear this room?")) {
    return;
  }

  try {
    await api(
      `/api/rooms/${state.currentRoom}/clear`,
      {
        method: "POST"
      }
    );

    closeModal();
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

    <input
      id="rp"
      placeholder="New password (blank removes)"
    >

    <button
      class="primary"
      onclick="saveRoom()"
    >
      Save
    </button>
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
          category: $("rc").value,
          slowMode: $("rs").value,
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
            "ADMIN"
          ]
            .map(r =>
              `<option value="${r}">
                ${r}
              </option>`
            )
            .join("")
        }

      </select>

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
  document.documentElement.dataset.theme=theme||'obsidian';
  const st=state.user?.settings||{}; document.documentElement.style.setProperty('--username-color',st.usernameColor||'#9b5cff');
  document.documentElement.style.setProperty('--profile-color',state.user?.profileColor||'#9b5cff');
  document.documentElement.style.setProperty('--profile-accent',state.user?.profileAccentColor||st.profileAccentColor||'#ff4fd8'); document.documentElement.style.setProperty('--chat-font',st.chatFont||'Inter'); document.documentElement.style.setProperty('--chat-size',st.fontSize==='large'?'1.08em':st.fontSize==='small'?'.94em':'1em'); document.documentElement.classList.toggle('compact-chat',!!st.compactMode); document.documentElement.dataset.effects=st.messageEffects||'none';
}

async function loadSettings(){
  const r=await api('/api/settings');
  const s=r.settings||{};
  const np=s.notificationPrefs||{};
  const sessions=(await api('/api/security/sessions').catch(()=>({sessions:[]}))).sessions||[];
  $('settings').innerHTML=`
    <div class="grid2">
      <div class="panel"><h3>👤 Account</h3><p class="muted">Manage the information connected to your account.</p><div class="settings-list">
        <button class="settings-row" onclick="editProfileInfo()"><span>🪪</span><b>Profile information</b><small>Display name, pronouns and basic details</small><strong>›</strong></button>
        <button class="settings-row" onclick="editAboutMe()"><span>💬</span><b>About Me</b><small>Update your profile description</small><strong>›</strong></button>
        <button class="settings-row" onclick="editEmail()"><span>✉</span><b>Email</b><small>Optional recovery/contact email</small><strong>›</strong></button>
        <button class="settings-row" onclick="changePasswordModal()"><span>🔑</span><b>Change password</b><small>Update your login password</small><strong>›</strong></button>
      </div></div>
      <div class="panel"><h3>🔒 Privacy & visibility</h3><label><input type="checkbox" id="setLastSeen" ${s.lastSeen!==false?'checked':''}> Show last seen</label><label><input type="checkbox" id="setOnline" ${s.online!==false?'checked':''}> Show online status</label><button class="primary" id="savePrivacy">Save privacy</button></div>
    </div>
    <div class="panel"><h3>🎨 Profile colors</h3><p class="muted">Choose extra colors for your profile and profile banner.</p><label>Profile color <input type="color" id="profileColor" value="${esc(state.user.profileColor||'#9b5cff')}"></label><label>Profile accent <input type="color" id="profileAccentColor" value="${esc(s.profileAccentColor||'#ff4fd8')}"></label><button class="primary" id="saveProfileColors">Save profile colors</button></div>
    <div class="panel"><h3>🎨 Appearance</h3><p class="muted">Personalize how Maleficent Chat looks for you.</p><div class="theme-picker">${['obsidian','midnight','forest','rose','lavender','sunset','ocean'].map(t=>`<button type="button" class="theme-chip ${s.theme===t?'active':''}" data-theme-choice="${t}"><span class="theme-dot"></span><b>${t[0].toUpperCase()+t.slice(1)}</b></button>`).join('')}</div><select id="v3Theme" class="hidden"><option>obsidian</option><option>midnight</option><option>forest</option><option>rose</option><option>lavender</option><option>sunset</option><option>ocean</option></select><select id="v3Font"><option value="small">Small text</option><option value="medium">Medium text</option><option value="large">Large text</option></select><label><input type="checkbox" id="v3Compact"> Compact mode</label><label><input type="checkbox" id="v3Motion"> Reduced animation</label><label><input type="checkbox" id="v3Contrast"> High contrast</label><label>Username color <input type="color" id="v3UsernameColor" value="${esc(s.usernameColor||'#9b5cff')}"></label><label>Chat font <select id="v3ChatFont"><option>Inter</option><option>Georgia</option><option>Monospace</option><option>Arial</option><option>Trebuchet MS</option></select></label><label>Message effects <select id="v3Effects"><option value="none">None</option><option value="soft">Soft glow</option><option value="sparkle">Sparkle</option></select></label><button class="primary" id="saveAppearance">Save appearance</button></div>
    <div class="panel"><h3>🔔 Notifications</h3><p class="muted">Turn off notification types you do not want to receive.</p><label><input type="checkbox" id="nMessages" ${np.messages!==false?'checked':''}> Private messages</label><label><input type="checkbox" id="nMentions" ${np.mentions!==false?'checked':''}> Mentions</label><label><input type="checkbox" id="nReplies" ${np.replies!==false?'checked':''}> Replies</label><label><input type="checkbox" id="nSecurity" ${np.security!==false?'checked':''}> Security alerts</label><label><input type="checkbox" id="nStaff" ${np.staff!==false?'checked':''}> Staff / reports</label><label><input type="checkbox" id="nGamification" ${np.gamification!==false?'checked':''}> Gold / level / achievements</label><label><input type="checkbox" id="nOther" ${np.other!==false?'checked':''}> Other notifications</label><button class="primary" id="saveNotifications">Save notifications</button></div>
    <div class="panel"><h3>🛡️ Security & sessions</h3><p class="muted">${sessions.length} active session record${sessions.length===1?'':'s'}.</p><button class="mini" id="viewLoginHistory">View login history</button><button class="mini danger" id="logoutAllDevices">Log out all other devices</button></div>
    <div class="panel danger-panel"><h3>⚠️ Account actions</h3><p class="muted">Deleting your account removes your account and personal conversations permanently.</p><button class="mini danger" onclick="deleteAccount()">Delete my account</button></div>`;
  $('v3Theme').value=s.theme||'obsidian'; $('v3Font').value=s.fontSize||'medium'; $('v3Compact').checked=!!s.compactMode; $('v3Motion').checked=!!s.reducedMotion; $('v3Contrast').checked=!!s.highContrast; applyTheme(s.theme||'obsidian');
  document.querySelectorAll('[data-theme-choice]').forEach(b=>b.onclick=()=>{ $('v3Theme').value=b.dataset.themeChoice; applyTheme(b.dataset.themeChoice); document.querySelectorAll('[data-theme-choice]').forEach(x=>x.classList.toggle('active',x===b)); });
  $('saveProfileColors').onclick=async()=>{try{const r=await api('/api/profile',{method:'PUT',body:JSON.stringify({profileColor:$('profileColor').value,profileAccentColor:$('profileAccentColor').value})});state.user=r.user;toast('Profile colors saved.');await loadProfile(state.user);}catch(e){toast(e.message)}};
  $('savePrivacy').onclick=async()=>{try{await api('/api/profile',{method:'PUT',body:JSON.stringify({privacy:{lastSeen:$('setLastSeen').checked,online:$('setOnline').checked}})});toast('Privacy saved.');}catch(e){toast(e.message)}};
  $('saveAppearance').onclick=async()=>{try{const payload={theme:$('v3Theme').value,fontSize:$('v3Font').value,compactMode:$('v3Compact').checked,reducedMotion:$('v3Motion').checked,highContrast:$('v3Contrast').checked,usernameColor:$('v3UsernameColor').value,chatFont:$('v3ChatFont').value,messageEffects:$('v3Effects').value};const r=await api('/api/settings',{method:'PUT',body:JSON.stringify(payload)});state.user.settings={...(state.user.settings||{}),...(r.settings||payload)};state.user.theme=payload.theme;applyTheme(payload.theme);applyUserAppearance();renderMessages();toast('Appearance saved and applied.');}catch(e){toast(e.message)}};
  $('saveNotifications').onclick=async()=>{await api('/api/notifications/preferences',{method:'PUT',body:JSON.stringify({messages:$('nMessages').checked,mentions:$('nMentions').checked,replies:$('nReplies').checked,security:$('nSecurity').checked,staff:$('nStaff').checked,gamification:$('nGamification').checked,other:$('nOther').checked})});toast('Notification preferences saved.');};
  $('viewLoginHistory').onclick=async()=>{const h=await api('/api/security/login-history');modal(`<h2>Login history</h2>${(h.history||[]).map(x=>`<div class="card"><b>${fmt(x.time)}</b><div class="muted">${esc(x.ip||'Unknown device')}</div></div>`).join('')||'<p class="muted">No login history.</p>'}`);};
  $('logoutAllDevices').onclick=async()=>{if(!confirm('Log out all sessions?'))return;try{await api('/api/security/logout-all',{method:'POST'});location.reload();}catch(e){toast(e.message)}};
}



/* ---------------- COMMUNITY HUB 3.0 ---------------- */
async function loadCommunityHub(){
 const el=$('hub'); if(!el)return;
 el.innerHTML=`<div class="hub-shell"><div class="topbar"><div><h2>✨ Community Hub</h2><p class="muted">Diaval memory, communities, events, cosmetics, achievements, discovery and safety tools.</p></div><button class="primary" id="hubRefresh">Refresh</button></div>
 <div class="hub-tabs"><button class="mini active" data-hub-tab="overview">Overview</button><button class="mini" data-hub-tab="events">🗓️ Events</button><button class="mini" data-hub-tab="shop">🛍️ Shop</button><button class="mini" data-hub-tab="titles">🏅 Titles</button><button class="mini" data-hub-tab="search">🔎 Search</button><button class="mini" data-hub-tab="media">🖼️ Media</button>${can('MOD')?'<button class="mini" data-hub-tab="audit">📜 Audit</button>':''}${can('OWNER')?'<button class="mini" data-hub-tab="automation">⚙️ Automation</button><a class="mini" href="/api/community/backup">💾 Backup</a>':''}</div><div id="hubContent"></div></div>`;
 const render=async(tab='overview')=>{document.querySelectorAll('[data-hub-tab]').forEach(b=>b.classList.toggle('active',b.dataset.hubTab===tab));const c=$('hubContent');try{
 if(tab==='overview'){const [st,tr]=await Promise.all([api('/api/community/stats'),api('/api/community/trending')]);c.innerHTML=`<div class="hub-grid"><div class="panel"><h3>📊 Your Statistics</h3><div class="stat-grid">${Object.entries({Messages:st.me.messages,'Friends':st.me.friends,'Games':st.me.gamesPlayed,'Wins':st.me.gamesWon,'Gifts:':st.me.giftsSent,'Achievements':st.me.achievements,XP:st.me.xp,Gold:st.me.gold}).map(([k,v])=>`<div class="stat-card"><b>${v}</b><span>${k}</span></div>`).join('')}</div></div><div class="panel"><h3>🔥 Trending Rooms</h3>${tr.rooms.map(r=>`<div class="hub-row"><span>${esc(r.icon||'💬')} <b>${esc(r.name)}</b></span><span>${r.activity} msgs</span></div>`).join('')||'<p class="muted">No activity yet.</p>'}</div><div class="panel"><h3>👑 Popular Profiles</h3>${tr.people.map(u=>`<div class="hub-row"><span>@${esc(u.username)}</span><span>❤️ ${u.profileLikes}</span></div>`).join('')}</div><div class="panel"><h3>📰 Trending News</h3>${tr.news.map(n=>`<div class="hub-row"><span>${esc(n.title||'News')}</span><span>${n.score||0}</span></div>`).join('')||'<p class="muted">No news yet.</p>'}</div></div>`;
 } else if(tab==='events'){const d=await api('/api/community/events');c.innerHTML=`<div class="section-title"><h3>🗓️ Community Events</h3>${can('ADMIN')?'<button class="primary" id="newEvent">＋ Create event</button>':''}</div><div class="hub-grid">${d.events.map(e=>`<div class="panel"><h3>${esc(e.icon||'🗓️')} ${esc(e.title)}</h3><p>${esc(e.description||'')}</p><small>${fmt(e.startsAt)} · ${e.attendees?.length||0} joined</small><br><button class="mini" data-join-event="${e.id}">Join / Leave</button></div>`).join('')||'<div class="panel"><p class="muted">No events scheduled.</p></div>'}</div>`;document.querySelectorAll('[data-join-event]').forEach(b=>b.onclick=async()=>{await api('/api/community/events/'+b.dataset.joinEvent+'/join',{method:'POST'});render('events')});if($('newEvent'))$('newEvent').onclick=()=>modal(`<h2>Create event</h2><input id="evTitle" placeholder="Event title"><textarea id="evDesc" placeholder="Description"></textarea><input id="evStart" type="datetime-local"><button class="primary" id="evSave">Create</button>`);if($('evSave'))$('evSave').onclick=async()=>{const t=new Date($('evStart').value).getTime();await api('/api/community/events',{method:'POST',body:JSON.stringify({title:$('evTitle').value,description:$('evDesc').value,startsAt:t,icon:'🗓️'})});closeModal();render('events')};
 } else if(tab==='shop'){const d=await api('/api/community/shop');c.innerHTML=`<div class="shop-grid">${d.items.map(i=>`<div class="panel shop-item"><div class="shop-icon">${i.icon}</div><h3>${esc(i.name)}</h3><p class="muted">${esc(i.type)}</p><b>🪙 ${i.cost}</b><button class="mini" data-buy="${i.id}">${d.owned.includes(i.id)?'Owned':'Buy'}</button>${d.owned.includes(i.id)?`<button class="mini" data-equip="${i.id}">Equip</button>`:''}</div>`).join('')}</div>`;document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=async()=>{try{await api('/api/community/shop/'+b.dataset.buy+'/buy',{method:'POST'});toast('Purchased.');render('shop')}catch(e){toast(e.message)}});document.querySelectorAll('[data-equip]').forEach(b=>b.onclick=async()=>{await api('/api/community/shop/'+b.dataset.equip+'/equip',{method:'POST'});toast('Equipped.');});
 } else if(tab==='titles'){const d=await api('/api/community/titles');c.innerHTML=`<div class="hub-grid">${d.titles.map(t=>`<div class="panel ${t.owned?'':'locked'}"><h3>${t.owned?'🏅':'🔒'} ${esc(t.name)}</h3><p>${esc(t.description)}</p><button class="mini" ${t.owned?'':'disabled'} data-title="${t.key}">${d.featured===t.key?'Featured':'Feature title'}</button></div>`).join('')}</div>`;document.querySelectorAll('[data-title]').forEach(b=>b.onclick=async()=>{await api('/api/community/title',{method:'PUT',body:JSON.stringify({key:b.dataset.title})});render('titles')});
 } else if(tab==='search'){c.innerHTML=`<form id="universalSearch" class="searchbar"><input id="hubQuery" placeholder="Search users, rooms, messages and news…"><button class="primary">Search</button></form><div id="hubSearchResults"></div>`;$('universalSearch').onsubmit=async e=>{e.preventDefault();const d=await api('/api/community/search?q='+encodeURIComponent($('hubQuery').value));$('hubSearchResults').innerHTML=`<div class="hub-grid"><div class="panel"><h3>Users</h3>${d.users.map(u=>`<p>@${esc(u.username)} · ${esc(u.displayName||'')}</p>`).join('')||'<p class="muted">None</p>'}</div><div class="panel"><h3>Rooms</h3>${d.rooms.map(r=>`<p>${esc(r.icon||'💬')} ${esc(r.name)}</p>`).join('')||'<p class="muted">None</p>'}</div><div class="panel"><h3>Messages</h3>${d.messages.map(m=>`<p><b>@${esc(m.username)}</b>: ${esc(m.text)}</p>`).join('')||'<p class="muted">None</p>'}</div><div class="panel"><h3>News</h3>${d.news.map(n=>`<p>${esc(n.title||n.text||'News')}</p>`).join('')||'<p class="muted">None</p>'}</div></div>`};
 } else if(tab==='media'){const d=await api('/api/community/media');c.innerHTML=`<div class="media-gallery">${d.media.map(m=>m.attachment?.type?.startsWith('image')?`<div class="media-card"><img src="${esc(m.attachment.url)}"><small>@${esc(m.username)} · ${fmt(m.time)}</small></div>`:`<div class="media-card"><audio controls src="${esc(m.attachment.url)}"></audio><small>@${esc(m.username)} · ${fmt(m.time)}</small></div>`).join('')||'<p class="muted">No shared media yet.</p>'}</div>`;
 } else if(tab==='audit'){const d=await api('/api/community/audit');c.innerHTML=`<div class="panel"><h3>📜 Staff Audit Timeline</h3>${d.logs.map(l=>`<div class="hub-row"><span><b>${esc(l.action)}</b> · ${esc(l.actor)} · ${esc(l.target)}</span><small>${fmt(l.time)}</small></div>`).join('')||'<p class="muted">No logs.</p>'}</div>`;
 } else if(tab==='lab'){
   const d=await api('/api/community/lab/overview');
   const roomOptions=(state.rooms||[]).map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
   c.innerHTML=`<div class="lab-grid">
     <div class="panel lab-card"><h3>🧵 Message Threads</h3><p class="muted">Reply to a message as a separate conversation.</p><button class="mini" id="labThread">Open latest thread</button></div>
     <div class="panel lab-card"><h3>⏰ Scheduled Messages</h3><p class="muted">Schedule a message for later.</p><button class="mini" id="labSchedule">Schedule</button><div class="lab-list">${(d.scheduled||[]).map(x=>`<div class="hub-row"><span>${esc(x.text)}</span><small>${fmt(x.sendAt)} <button class="mini danger" data-cancel-sched="${x.id}">Cancel</button></small></div>`).join('')||'<span class="muted">None scheduled.</span>'}</div></div>
     <div class="panel lab-card"><h3>🔖 Bookmark Folders</h3><p class="muted">Organize saved messages into folders.</p><button class="mini" id="labFolder">＋ New folder</button><div class="tag-row">${Object.keys(d.notes||{}).length?'':' '}${Object.keys(d.notes||{}).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div></div>
     <div class="panel lab-card"><h3>🏷️ Personal Labels</h3><p class="muted">Add labels to your own profile.</p><div class="tag-row">${(d.labels||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('')||'<span class="muted">No labels.</span>'}</div><button class="mini" id="labLabels">Edit labels</button></div>
     <div class="panel lab-card"><h3>💡 Feature Requests</h3><button class="mini" id="labSuggest">Submit suggestion</button><div class="lab-list">${(d.suggestions||[]).slice(0,8).map(s=>`<div class="hub-row"><span><b>${esc(s.title)}</b><small>${s.anonymous?'Anonymous':esc(s.author)} · ${esc(s.status)}</small></span><button class="mini" data-vote-suggestion="${s.id}">▲ ${s.votes||0}</button></div>`).join('')||'<span class="muted">No suggestions yet.</span>'}</div></div>
     <div class="panel lab-card"><h3>✍️ Mini Blogs</h3><p class="muted">Publish longer community posts without turning the main chat into a wall of text.</p><button class="mini" id="labBlog">＋ Write a post</button></div>
     <div class="panel lab-card"><h3>📰 Changelog</h3>${(d.changelog||[]).slice(0,6).map(x=>`<div class="hub-row"><span><b>${esc(x.version)}</b> ${esc(x.title)}</span><small>${fmt(x.time)}</small></div>`).join('')||'<p class="muted">No changelog entries.</p>'}${can('ADMIN')?'<button class="mini" id="labChangelog">＋ Add entry</button>':''}</div>
     <div class="panel lab-card"><h3>⭐ Reputation</h3><div class="big-number">${Number(d.reputation||0)}</div><p class="muted">Community reputation is separate from staff rank.</p></div>
     <div class="panel lab-card"><h3>🃏 Collectibles</h3><p>${(d.cards||[]).length} card types available · ${(d.collections||[]).length} collected</p><button class="mini" id="labClaim">Claim demo collectible</button></div>
     <div class="panel lab-card"><h3>🖼️ Stickers & 🔊 Soundboard</h3><p>${(d.stickers||[]).length} stickers · ${(d.soundboard||[]).length} sounds</p><button class="mini" id="labSticker">Add sticker</button><button class="mini" id="labSound">Add sound</button></div>
     <div class="panel lab-card"><h3>🤖 Room Bots & 📜 Lore</h3><p>Rooms can have their own bot personality, triggers and lore.</p>${can('ADMIN')?'<button class="mini" id="labBot">Configure current room bot</button>':'<span class="muted">Admin configuration.</span>'}</div>
     <div class="panel lab-card"><h3>🕰️ Chat Time Machine</h3><p class="muted">Browse messages from a selected date.</p><button class="mini" id="labTimeMachine">Browse history</button></div>
     <div class="panel lab-card"><h3>🧠 Community Memories</h3>${(d.memories||[]).slice(0,4).map(x=>`<p><b>${esc(x.title)}</b> — ${esc(x.text)}</p>`).join('')||'<p class="muted">No memories archived.</p>'}${can('ADMIN')?'<button class="mini" id="labMemory">＋ Archive memory</button>':''}</div>
     <div class="panel lab-card"><h3>🌙 Season System</h3>${(d.seasons||[]).filter(x=>x.active).map(x=>`<p><b>${esc(x.name)}</b> · ${esc(x.theme)}</p>`).join('')||'<p class="muted">No active season.</p>'}${can('OWNER')?'<button class="mini" id="labSeason">Create season</button>':''}</div>
     <div class="panel lab-card"><h3>🏛️ Community Museum</h3>${(d.museum||[]).slice(0,5).map(x=>`<p>🏛️ <b>${esc(x.title)}</b> — ${esc(x.description)}</p>`).join('')||'<p class="muted">Museum is empty.</p>'}${can('ADMIN')?'<button class="mini" id="labMuseum">Add exhibit</button>':''}</div>
     <div class="panel lab-card"><h3>🧩 User Quizzes</h3><button class="mini" id="labQuiz">Create quiz</button><span class="muted"> Build community-made quizzes with XP/Gold rewards.</span></div>
     <div class="panel lab-card"><h3>📅 Community Calendar</h3><p class="muted">Calendar uses your existing Events system, with RSVPs and reminders.</p><button class="mini" data-hub-tab-jump="events">Open calendar/events</button></div>
     <div class="panel lab-card"><h3>👋 Interactive Welcome Tour</h3><p class="muted">New accounts can replay the introduction to Maleficent Chat.</p><button class="mini" id="labWelcome">Replay welcome tour</button></div>
   </div>`;
   document.querySelectorAll('[data-cancel-sched]').forEach(b=>b.onclick=async()=>{await api('/api/community/scheduled/'+b.dataset.cancelSched,{method:'DELETE'});render('lab')});
   document.querySelectorAll('[data-vote-suggestion]').forEach(b=>b.onclick=async()=>{await api('/api/community/suggestions/'+b.dataset.voteSuggestion+'/vote',{method:'POST'});render('lab')});
   document.querySelectorAll('[data-hub-tab-jump]').forEach(b=>b.onclick=()=>render('events'));
   if($('labSchedule'))$('labSchedule').onclick=()=>{const local=new Date(Date.now()+5*60000);const pad=n=>String(n).padStart(2,'0');const localValue=`${local.getFullYear()}-${pad(local.getMonth()+1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;modal(`<h2>⏰ Schedule message</h2><select id="smRoom">${roomOptions}</select><textarea id="smText" placeholder="Message"></textarea><input id="smWhen" type="datetime-local" value="${localValue}"><button class="primary" id="smSave">Schedule</button>`);};

   if($('smSave'))$('smSave').onclick=async()=>{const raw=$('smWhen').value;const t=new Date(raw).getTime();if(!raw||!Number.isFinite(t)||t<=Date.now()){toast('Choose a future date and time.');return;}try{const d=await api('/api/community/scheduled',{method:'POST',body:JSON.stringify({roomId:$('smRoom').value,text:$('smText').value.trim(),sendAt:t})});closeModal();toast(`Scheduled for ${fmt(d.scheduled.sendAt)}.`);render('lab')}catch(e){toast(e.message)}};
   if($('labFolder'))$('labFolder').onclick=()=>modal(`<h2>🔖 New bookmark folder</h2><input id="folderName" placeholder="Folder name"><button class="primary" id="folderSave">Create</button>`);if($('folderSave'))$('folderSave').onclick=async()=>{await api('/api/community/bookmarks/folder',{method:'PUT',body:JSON.stringify({name:$('folderName').value})});closeModal();toast('Folder created.')};
   if($('labLabels'))$('labLabels').onclick=()=>modal(`<h2>🏷️ Profile labels</h2><input id="labelInput" value="${esc((d.labels||[]).join(', '))}" placeholder="Artist, Gamer, Music Lover"><button class="primary" id="labelSave">Save labels</button>`);if($('labelSave'))$('labelSave').onclick=async()=>{await api('/api/community/labels',{method:'PUT',body:JSON.stringify({labels:$('labelInput').value.split(',').map(x=>x.trim())})});closeModal();render('lab')};
   if($('labSuggest'))$('labSuggest').onclick=()=>modal(`<h2>💡 Feature suggestion</h2><input id="sgTitle" placeholder="Title"><textarea id="sgText" placeholder="Describe your idea"></textarea><label><input id="sgAnon" type="checkbox" style="width:auto"> Submit anonymously</label><button class="primary" id="sgSave">Submit</button>`);if($('sgSave'))$('sgSave').onclick=async()=>{await api('/api/community/suggestions',{method:'POST',body:JSON.stringify({title:$('sgTitle').value,text:$('sgText').value,anonymous:$('sgAnon').checked})});closeModal();render('lab')};
   if($('labBlog'))$('labBlog').onclick=()=>modal(`<h2>✍️ Mini blog</h2><input id="blTitle" placeholder="Title"><textarea id="blBody" placeholder="Write your post…"></textarea><select id="blVis"><option value="public">Public</option><option value="private">Private</option></select><button class="primary" id="blSave">Publish</button>`);if($('blSave'))$('blSave').onclick=async()=>{await api('/api/community/blogs',{method:'POST',body:JSON.stringify({title:$('blTitle').value,body:$('blBody').value,visibility:$('blVis').value})});closeModal();toast('Blog published.');};
   if($('labChangelog'))$('labChangelog').onclick=()=>modal(`<h2>📰 Changelog entry</h2><input id="clVer" placeholder="3.2.0"><input id="clTitle" placeholder="What's new?"><textarea id="clDetails" placeholder="One item per line"></textarea><button class="primary" id="clSave">Publish</button>`);if($('clSave'))$('clSave').onclick=async()=>{await api('/api/community/changelog',{method:'POST',body:JSON.stringify({version:$('clVer').value,title:$('clTitle').value,details:$('clDetails').value.split('\\n')})});closeModal();render('lab')};
   if($('labClaim'))$('labClaim').onclick=async()=>{await api('/api/community/collections/claim',{method:'POST',body:JSON.stringify({item:'Shadow Collector'})});toast('Collectible added.')};
   if($('labSticker'))$('labSticker').onclick=()=>modal(`<h2>🖼️ Sticker</h2><input id="stName" placeholder="Sticker name"><input id="stUrl" placeholder="Public image URL or /uploads/..."><button class="primary" id="stSave">Add</button>`);if($('stSave'))$('stSave').onclick=async()=>{await api('/api/community/stickers',{method:'POST',body:JSON.stringify({name:$('stName').value,url:$('stUrl').value})});closeModal();render('lab')};
   if($('labSound'))$('labSound').onclick=()=>modal(`<h2>🔊 Soundboard</h2><input id="soName" placeholder="Sound name"><input id="soUrl" placeholder="Audio URL or /uploads/..."><button class="primary" id="soSave">Add</button>`);if($('soSave'))$('soSave').onclick=async()=>{await api('/api/community/soundboard',{method:'POST',body:JSON.stringify({name:$('soName').value,url:$('soUrl').value})});closeModal();render('lab')};
   if($('labBot'))$('labBot').onclick=async()=>{const rid=state.currentRoom||state.rooms[0]?.id;if(!rid)return;const cur=await api('/api/community/room/'+rid+'/bot');modal(`<h2>🤖 Room Bot</h2><input id="rbName" value="${esc(cur.bot?.name||'Room Bot')}" placeholder="Bot name"><textarea id="rbWelcome">${esc(cur.bot?.welcome||'Welcome!')}</textarea><input id="rbTriggers" value="${esc((cur.bot?.triggers||[]).join(', '))}" placeholder="hello, welcome"><button class="primary" id="rbSave">Save</button>`);$('rbSave').onclick=async()=>{await api('/api/community/room/'+rid+'/bot',{method:'PUT',body:JSON.stringify({enabled:true,name:$('rbName').value,welcome:$('rbWelcome').value,triggers:$('rbTriggers').value.split(',').map(x=>x.trim())})});closeModal();toast('Room bot configured.')}};
   if($('labTimeMachine'))$('labTimeMachine').onclick=()=>modal(`<h2>🕰️ Chat Time Machine</h2><select id="tmRoom">${roomOptions}</select><input id="tmDate" type="date"><button class="primary" id="tmGo">Browse</button><div id="tmResults"></div>`);if($('tmGo'))$('tmGo').onclick=async()=>{const day=new Date($('tmDate').value).getTime(),d2=await api('/api/community/time-machine/'+$('tmRoom').value+'?from='+day+'&to='+(day+86400000-1));$('tmResults').innerHTML=(d2.messages||[]).map(m=>`<p><b>@${esc(m.username)}</b> ${esc(m.text)} <small>${fmt(m.time)}</small></p>`).join('')||'<p class="muted">No messages.</p>'};
   if($('labMemory'))$('labMemory').onclick=()=>modal(`<h2>🧠 Archive community memory</h2><input id="mmTitle" placeholder="Title"><textarea id="mmText" placeholder="What should the community remember?"></textarea><button class="primary" id="mmSave">Archive</button>`);if($('mmSave'))$('mmSave').onclick=async()=>{await api('/api/community/memories',{method:'POST',body:JSON.stringify({title:$('mmTitle').value,text:$('mmText').value})});closeModal();render('lab')};
   if($('labSeason'))$('labSeason').onclick=()=>modal(`<h2>🌙 New season</h2><input id="snName" placeholder="Season name"><input id="snTheme" placeholder="Theme"><input id="snEnd" type="datetime-local"><button class="primary" id="snSave">Create</button>`);if($('snSave'))$('snSave').onclick=async()=>{await api('/api/community/season',{method:'POST',body:JSON.stringify({name:$('snName').value,theme:$('snTheme').value,endsAt:new Date($('snEnd').value).getTime()})});closeModal();render('lab')};
   if($('labMuseum'))$('labMuseum').onclick=()=>modal(`<h2>🏛️ Museum exhibit</h2><input id="muTitle" placeholder="Exhibit title"><textarea id="muText" placeholder="Description"></textarea><button class="primary" id="muSave">Add</button>`);if($('muSave'))$('muSave').onclick=async()=>{await api('/api/community/museum',{method:'POST',body:JSON.stringify({title:$('muTitle').value,description:$('muText').value})});closeModal();render('lab')};
   if($('labQuiz'))$('labQuiz').onclick=()=>modal(`<h2>🧩 Create quiz</h2><textarea id="qQuestion" placeholder="Question"></textarea><input id="qOpts" placeholder="Option 1, Option 2, Option 3"><input id="qAnswer" type="number" min="0" value="0" placeholder="Correct option number"><button class="primary" id="qSave">Create</button>`);if($('qSave'))$('qSave').onclick=async()=>{await api('/api/community/quizzes',{method:'POST',body:JSON.stringify({question:$('qQuestion').value,options:$('qOpts').value.split(',').map(x=>x.trim()),answer:Number($('qAnswer').value)})});closeModal();toast('Quiz created.')};
   if($('labWelcome'))$('labWelcome').onclick=()=>{closeModal();toast('Welcome tour replay requested.');showWelcomeTour?.()};
   if($('labThread'))$('labThread').onclick=()=>{const last=state.currentRoom&&document.querySelector('#messages .message:last-child');if(last)toast('Use the message reply controls to open a thread. Thread API is ready.');else toast('Open a room first.');};
 } else if(tab==='automation'){const d=await api('/api/community/automation');c.innerHTML=`<div class="section-title"><h3>⚙️ Moderation Automation</h3><button class="primary" id="addAuto">＋ Rule</button></div>${d.rules.map(r=>`<div class="panel hub-row"><span>${r.enabled?'🟢':'⚪'} ${r.condition} ≥ ${r.threshold} → ${r.action} ${r.duration}m</span><button class="mini danger" data-auto="${r.id}">Delete</button></div>`).join('')||'<div class="panel"><p class="muted">No automation rules.</p></div>'}`;$('addAuto').onclick=()=>modal(`<h2>Automation rule</h2><select id="ac"><option>warnings</option><option>filteredMessages</option><option>reports</option></select><input id="at" type="number" min="1" value="3"><select id="aa"><option>mute</option><option>notify</option></select><input id="ad" type="number" min="1" value="10" placeholder="Duration minutes"><button class="primary" id="as">Save</button>`);if($('as'))$('as').onclick=async()=>{await api('/api/community/automation',{method:'POST',body:JSON.stringify({condition:$('ac').value,threshold:$('at').value,action:$('aa').value,duration:$('ad').value})});closeModal();render('automation')};document.querySelectorAll('[data-auto]').forEach(b=>b.onclick=async()=>{await api('/api/community/automation/'+b.dataset.auto,{method:'DELETE'});render('automation')});
 }}catch(e){c.innerHTML=`<div class="panel danger-panel">${esc(e.message)}</div>`}};
 document.querySelectorAll('[data-hub-tab]').forEach(b=>b.onclick=()=>render(b.dataset.hubTab));$('hubRefresh').onclick=()=>render('overview');await render();
}

/* ---------------- DIAVAL LOCAL ASSISTANT ---------------- */
async function loadDiaval(){
  const el=$('diaval');
  if(!el) return;
  el.innerHTML=`<div class="diaval-shell"><div class="diaval-head"><div class="diaval-avatar">🖤</div><div><h2>Diaval</h2><p class="muted">Local assistant · no external API required</p></div><select id="diavalPersonality"><option value="normal">🖤 Normal</option><option value="mischievous">😈 Mischievous</option><option value="royal">👑 Royal</option><option value="funny">😂 Funny</option><option value="helpful">📚 Helpful</option></select><button class="mini" id="diavalMem">🧠 Memory</button><button class="mini danger" id="clearDiaval">Clear conversation</button></div><div id="diavalMessages" class="diaval-messages"></div><form id="diavalForm" class="diaval-composer"><input id="diavalInput" maxlength="2000" placeholder="Talk to Diaval…"><button class="primary">Send</button></form></div>`;
  try{
    const d=await api('/api/diaval/history'); renderDiavalMessages(d.messages||[]);
    const prof=await api('/api/diaval/profile'); $('diavalPersonality').value=prof.personality||'normal';
  }catch(e){toast(e.message)}
  $('diavalPersonality').onchange=async()=>{try{await api('/api/diaval/profile',{method:'PUT',body:JSON.stringify({personality:$('diavalPersonality').value})});toast('Diaval personality updated.')}catch(e){toast(e.message)}};
  $('diavalMem').onclick=async()=>{try{const p=await api('/api/diaval/profile');modal(`<h2>🧠 Diaval Memory</h2><p class="muted">These are small local notes used to personalize Diaval.</p><div class="stack">${(p.memories||[]).map((m,i)=>`<div class="card">${esc(m)} <button class="mini danger" data-mem="${i}">×</button></div>`).join('')||'<p class="muted">No memories yet.</p>'}</div><input id="newMem" placeholder="Add a memory…"><button class="primary" id="addMem">Add memory</button>`);document.querySelectorAll('[data-mem]').forEach(b=>b.onclick=async()=>{p.memories.splice(Number(b.dataset.mem),1);await api('/api/diaval/profile',{method:'PUT',body:JSON.stringify({memories:p.memories})});closeModal();$('diavalMem').click()});$('addMem').onclick=async()=>{const v=$('newMem').value.trim();if(!v)return;p.memories.push(v);await api('/api/diaval/profile',{method:'PUT',body:JSON.stringify({memories:p.memories})});closeModal();toast('Memory added.');}}catch(e){toast(e.message)}};
  $('diavalForm').onsubmit=async e=>{e.preventDefault();const input=$('diavalInput'),text=input.value.trim();if(!text)return;input.value='';appendDiaval({role:'user',text,time:Date.now()});const btn=e.submitter;btn.disabled=true;try{const d=await api('/api/diaval/message',{method:'POST',body:JSON.stringify({text})});appendDiaval({role:'assistant',text:d.reply,time:Date.now()});}catch(err){toast(err.message)}finally{btn.disabled=false;input.focus();}};
  $('clearDiaval').onclick=async()=>{if(!confirm('Clear your Diaval conversation?'))return;await api('/api/diaval/history',{method:'DELETE'});renderDiavalMessages([]);toast('Diaval conversation cleared.');};
}
function renderDiavalMessages(rows){const el=$('diavalMessages');if(!el)return;el.innerHTML=rows.map(m=>`<div class="diaval-msg ${m.role}"><div class="diaval-msg-label">${m.role==='assistant'?'🖤 Diaval':'You'}</div><div class="diaval-bubble">${formatDiavalText(m.text)}</div><small>${fmt(m.time)}</small></div>`).join('')||`<div class="diaval-empty">🖤<h3>Hello, I’m Diaval.</h3><p>Ask me about Maleficent Chat, calculations, ideas, code, or just chat.</p></div>`;el.scrollTop=el.scrollHeight;}
function appendDiaval(m){const el=$('diavalMessages');if(!el)return;if(el.querySelector('.diaval-empty'))el.innerHTML='';el.insertAdjacentHTML('beforeend',`<div class="diaval-msg ${m.role}"><div class="diaval-msg-label">${m.role==='assistant'?'🖤 Diaval':'You'}</div><div class="diaval-bubble">${formatDiavalText(m.text)}</div><small>${fmt(m.time)}</small></div>`);el.scrollTop=el.scrollHeight;}
function formatDiavalText(t){return esc(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');}

/* ---------------- GAMES HUB ---------------- */
async function loadGames(){
  try{
    const d=await api('/api/games/scores'),me=d.me||{};
    $('gamesProgress').innerHTML=`<div class="game-stat"><b>${me.totalWins||0}</b><span>Wins</span></div><div class="game-stat"><b>${me.totalPlayed||0}</b><span>Games</span></div><div class="game-stat"><b>${me.rps?.wins||0}</b><span>RPS wins</span></div><div class="game-stat"><b>${me.dice?.wins||0}</b><span>Dice wins</span></div>`;
  }catch(e){toast(e.message)}
}
function gameTargetElement(){return $('gamesResult')||$('gameResult')||$('usersGameResult');}

async function claimDailyReward(){try{const r=await api('/api/rewards/daily',{method:'POST'});state.user.gold=r.gold;state.user.xp=r.xp;toast(`Daily reward claimed: +${r.amount} gold and +15 XP.`);await loadProfile(state.user);}catch(e){toast(e.message)}}
async function exportMyData(){try{const d=await api('/api/account/export');const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='maleficent-chat-data.json';a.click();URL.revokeObjectURL(a.href);toast('Your data export is ready.');}catch(e){toast(e.message)}}
/* ---------------- MODAL ---------------- */

$("modal").addEventListener(
  "click",
  event => {
    if (event.target === $("modal")) {
      closeModal();
    }
  }
);


function applyUserAppearance(){
  const st=state.user?.settings||{};
  document.documentElement.style.setProperty('--username-color',st.usernameColor||'#9b5cff');
  document.documentElement.style.setProperty('--chat-font',st.chatFont||'Inter');
  document.documentElement.style.setProperty('--chat-size',st.fontSize==='large'?'1.08em':st.fontSize==='small'?'.94em':'1em');
  document.documentElement.dataset.messageEffect=st.messageEffects||'';
}
async function recordGame(game,result){
  try{
    const d=await api('/api/games/score',{method:'POST',body:JSON.stringify({game,result})});
    await loadGames();
    return d;
  }catch(e){console.warn('game score save failed',e);toast('Game result could not be saved.');}
}
async function showGameScores(){try{const d=await api('/api/games/scores');const me=d.me||{};const rows=d.leaderboard||[];modal(`<div class="game-score-modal"><h2>🏆 Game Scores</h2><div class="game-my-score"><b>Your record</b><p>Wins: ${me.totalWins||0} · Games: ${me.totalPlayed||0}</p><small>RPS: ${me.rps?.wins||0}W / ${me.rps?.losses||0}L / ${me.rps?.draws||0}D · Dice: ${me.dice?.wins||0}W / ${me.dice?.losses||0}L / ${me.dice?.draws||0}D</small></div><div class="stack">${rows.map((r,i)=>`<div class="card"><b>#${i+1} ${esc(r.displayName||r.username)}</b><span class="muted"> @${esc(r.username)}</span><div>${r.totalWins||0} wins · ${r.totalPlayed||0} games</div></div>`).join('')||'<p class="muted">No games recorded yet.</p>'}</div></div>`);}catch(e){toast(e.message)}}
async function playRPS(){const choices=['Rock','Paper','Scissors'];const mine=choices[Math.floor(Math.random()*3)],bot=choices[Math.floor(Math.random()*3)];const result=mine===bot?'draw':((mine==='Rock'&&bot==='Scissors')||(mine==='Paper'&&bot==='Rock')||(mine==='Scissors'&&bot==='Paper'))?'win':'loss';const label=result==='draw'?'🤝 Draw — nobody wins!':result==='win'?'🏆 You won!':'🤖 Diaval won!';const el=gameTargetElement();if(el)el.innerHTML=`<div class="game-result-card"><div><b>✊ You</b> chose ${mine} · <b>🤖 Diaval</b> chose ${bot}</div><strong>${label}</strong><small>Saving result…</small></div>`;await recordGame('rps',result);if(el)el.querySelector('small').textContent='Result saved to your game record.';}
async function rollDice(){const a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6);const result=a===b?'draw':a>b?'win':'loss';const label=result==='draw'?'🤝 Draw — same number!':result==='win'?'🏆 You won!':'🤖 Diaval won!';const el=gameTargetElement();if(el)el.innerHTML=`<div class="game-result-card"><div>🎲 <b>You</b> rolled <strong>${a}</strong> · <b>🤖 Diaval</b> rolled <strong>${b}</strong></div><strong>${label}</strong><small>Saving result…</small></div>`;await recordGame('dice',result);if(el)el.querySelector('small').textContent='Result saved to your game record.';}

/* ---------------- INIT ---------------- */

bootstrap();

/* ===================== 3.1 COMMUNITY UPGRADE CLIENT ===================== */
async function loadCommunityHub(){
 const el=$("hub");if(!el)return;
 try{
  const [p,c,e,t]=await Promise.all([api("/api/polls"),api("/api/community/daily-challenge"),api("/api/community/events").catch(()=>({events:[]})),api("/api/themes").catch(()=>({presets:{}}))]);
  const polls=p.polls||[],events=e.events||[];
  el.innerHTML=`<div class="panel hub-hero"><div><span class="eyebrow">WELCOME BACK</span><h2>🖤 ${esc(state.user?.displayName||state.user?.username||"Member")}</h2><p class="muted">Your community dashboard is ready.</p></div><div class="hub-stats"><b>${state.user?.xp||0}<small> XP</small></b><b>${state.user?.gold||0}<small> Gold</small></b><b>Lv ${state.user?.level||1}</b></div></div>
  <div class="panel"><div class="panel-head"><b>🎯 Daily Challenge</b><span class="pill">${c.challenge.xp} XP · ${c.challenge.gold} Gold</span></div><h3>${esc(c.challenge.title)}</h3><p class="muted">${esc(c.challenge.text)}</p></div>
  <div class="panel"><div class="panel-head"><b>📊 Community Polls</b><button class="mini" onclick="createCommunityPoll()">＋ Poll</button></div>${polls.slice(0,5).map(x=>`<div class="poll-card"><b>${esc(x.question)}</b>${x.options.map((o,i)=>`<button class="poll-option" onclick="votePoll('${x.id}',${i})"><span>${esc(o)}</span><small>${x.counts[i]||0} · ${x.total?Math.round((x.counts[i]||0)/x.total*100):0}%</small></button>`).join("")}<small class="muted">${x.total||0} votes</small></div>`).join("")||'<p class="muted">No polls yet.</p>'}</div>
  <div class="panel"><div class="panel-head"><b>🎨 Themes</b><button class="mini" onclick="openThemeCustomizer()">Customize</button></div><div class="theme-swatches">${Object.entries(t.presets||{}).map(([k,v])=>`<button class="theme-swatch" style="--sw:${v.accent}" onclick="applyPresetTheme('${k}')">${esc(v.name)}</button>`).join("")}</div></div>
  <div class="panel"><div class="panel-head"><b>📅 Events</b><span class="muted">${events.length} active</span></div>${events.slice(0,4).map(x=>`<div class="event-card"><b>${esc(x.title)}</b><p>${esc(x.description||"")}</p><small>${x.start?fmt(x.start):""}</small></div>`).join("")||'<p class="muted">No events scheduled.</p>'}</div>`;
 }catch(err){el.innerHTML=`<div class="panel"><b>Community Hub</b><p class="error">${esc(err.message)}</p></div>`}
}
async function votePoll(id,option){try{await api(`/api/polls/${id}/vote`,{method:"POST",body:JSON.stringify({option})});toast("Vote recorded.");loadCommunityHub()}catch(e){toast(e.message)}}
async function createCommunityPoll(){modal(`<h2>📊 Create Poll</h2><input id="pollQ" placeholder="Question"><input id="poll1" placeholder="Option 1"><input id="poll2" placeholder="Option 2"><input id="poll3" placeholder="Option 3 (optional)"><input id="poll4" placeholder="Option 4 (optional)"><button class="primary" id="pollCreate">Create Poll</button>`);$("pollCreate").onclick=async()=>{try{await api("/api/polls",{method:"POST",body:JSON.stringify({question:$("pollQ").value,options:[$("poll1").value,$("poll2").value,$("poll3").value,$("poll4").value].filter(Boolean)})});closeModal();loadCommunityHub()}catch(e){toast(e.message)}}}
async function openThemeCustomizer(){const d=await api("/api/themes"),t=d.user||{accent:"#00bfae",background:"#071016",panel:"#111c23",bubble:"#24323a"};modal(`<h2>🎨 Personal Theme</h2><label>Accent<input id="themeAccent" type="color" value="${esc(t.accent)}"></label><label>Background<input id="themeBg" type="color" value="${esc(t.background)}"></label><label>Panels<input id="themePanel" type="color" value="${esc(t.panel)}"></label><label>Bubbles<input id="themeBubble" type="color" value="${esc(t.bubble)}"></label><button class="primary" id="saveTheme">Save Theme</button>`);$("saveTheme").onclick=async()=>{try{const x={accent:$("themeAccent").value,background:$("themeBg").value,panel:$("themePanel").value,bubble:$("themeBubble").value};await api("/api/themes/user",{method:"PUT",body:JSON.stringify(x)});applyCustomTheme(x);closeModal();toast("Theme saved.")}catch(e){toast(e.message)}}}
async function applyPresetTheme(key){try{const d=await api("/api/themes"),t=d.presets[key];applyCustomTheme({accent:t.accent,background:t.bg,panel:t.panel,bubble:t.panel});toast(`${t.name} theme applied.`)}catch(e){toast(e.message)}}
function applyCustomTheme(t){if(!t)return;document.documentElement.style.setProperty("--accent",t.accent);document.documentElement.style.setProperty("--accent-2",t.accent);document.documentElement.style.setProperty("--bg",t.background);document.documentElement.style.setProperty("--panel",t.panel);document.documentElement.style.setProperty("--bubble",t.bubble);localStorage.setItem("mc-theme",JSON.stringify(t))}
try{const t=JSON.parse(localStorage.getItem("mc-theme")||"null");if(t)applyCustomTheme(t)}catch{}
async function openNumberGuess(){modal(`<h2>🔢 Daily Number Challenge</h2><p class="muted">Pick a whole number from 1 to 100.</p><input id="guessNumber" type="number" min="1" max="100" placeholder="Your guess"><button class="primary" id="guessGo">Guess</button><div id="guessResult" class="game-result"></div>`);$("guessGo").onclick=async()=>{try{const d=await api("/api/games/number-guess",{method:"POST",body:JSON.stringify({number:Number($("guessNumber").value)})});$("guessResult").textContent=d.result==="win"?`🎉 Correct! +${d.reward.gold} Gold · +${d.reward.xp} XP`:`Try again — go ${d.result}.`;if(d.result==="win")closeModal()}catch(e){toast(e.message)}}}
function openTicTacToe(){let b=Array(9).fill(""),turn="X";const win=()=>{for(const [a,c,d] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])if(b[a]&&b[a]===b[c]&&b[a]===b[d])return b[a];return b.every(Boolean)?"draw":null};const draw=()=>{modal(`<h2>❌ Tic-Tac-Toe</h2><div class="ttt">${b.map((v,i)=>`<button class="ttt-cell" data-i="${i}">${v}</button>`).join("")}</div><p class="muted">Turn: ${turn}</p>`);document.querySelectorAll(".ttt-cell").forEach(x=>x.onclick=()=>{const i=+x.dataset.i;if(b[i]||win())return;b[i]=turn;const r=win();if(r){toast(r==="draw"?"Draw!":`${r} wins!`);recordGame("tictactoe",r==="draw"?"draw":"win");return}turn=turn==="X"?"O":"X";draw()})};draw()}


/* ===================== 3.3 SOCIAL PLATFORM CLIENT ===================== */
async function platformModal(title,body){modal(`<div class="platform-modal"><h2>${title}</h2>${body}</div>`)}
async function loadPlatformHub(){
 const el=$('hub'); if(!el)return;
 try{
  const [d,clubs,gallery,moments,quizzes,mysteries,secrets,hall,locales]=await Promise.all([
   api('/api/community/platform'),api('/api/community/clubs'),api('/api/community/gallery'),api('/api/community/moments'),api('/api/community/quizzes'),api('/api/community/mysteries'),api('/api/community/secrets'),api('/api/community/hall'),api('/api/locales')
  ]);
  const rooms=d.activeRooms||[], acts=d.activity||[], lab=d.featureLab||{}; const labOn=k=>lab[k]!==false;
  el.innerHTML=`
  <div class="panel hub-hero"><div><span class="eyebrow">MALeficent COMMUNITY</span><h2>🖤 ${esc(state.user?.displayName||state.user?.username||'Member')}</h2><p class="muted">Your community command center.</p></div><div class="hub-stats"><b>${d.reputation?.points||0}<small> REP</small></b><b>${esc(d.reputation?.level||'Newcomer')}</b><b>Lv ${state.user?.level||1}</b></div></div>
  <div class="platform-grid">
   <div class="panel"><div class="panel-head"><b>🧠 Smart Community Hub</b></div><div class="platform-list">${rooms.slice(0,6).map(r=>`<button class="platform-row" onclick="enterRoomFromHub('${r.id}')"><span>🏠 ${esc(r.name)}</span><small>🟢 ${r.onlineCount||0}</small></button>`).join('')||'<p class="muted">No rooms available.</p>'}</div><p class="muted">Season: ${esc(d.season?.name||'No active season')} · ${d.season?.theme?esc(d.season.theme):'—'}</p></div>
   <div class="panel"><div class="panel-head"><b>📡 Live Activity</b><button class="mini" onclick="showPlatformActivity()">View all</button></div>${acts.slice(0,7).map(a=>`<div class="activity-line"><span>${esc(a.text)}</span><small>${fmt(a.time)}</small></div>`).join('')||'<p class="muted">No recent activity.</p>'}</div>
   <div class="panel" data-lab="clubs"><div class="panel-head"><b>🧑‍🤝‍🧑 Clubs</b><button class="mini" ${labOn("clubs")?"":"disabled"} onclick="createClub()">＋ Club</button></div>${(clubs.clubs||[]).slice(0,5).map(c=>`<div class="club-row"><span>${esc(c.icon||'🎭')} <b>${esc(c.name)}</b><small>${c.members||0} members</small></span><button class="mini" onclick="joinClub('${c.id}')">Join</button></div>`).join('')||'<p class="muted">No clubs yet.</p>'}<button class="mini" onclick="showClubs()">Explore clubs</button></div>
   <div class="panel" data-lab="artGallery"><div class="panel-head"><b>🎨 Art Gallery</b><button class="mini" onclick="addArtwork()">＋ Upload</button></div>${(gallery.artworks||[]).slice(0,4).map(a=>`<div class="art-row"><b>${esc(a.title)}</b><small>${esc(a.category)} · ❤️ ${a.likes?.length||0}</small></div>`).join('')||'<p class="muted">No artwork yet.</p>'}<button class="mini" onclick="showGallery()">Open gallery</button></div>
   <div class="panel" data-lab="moments"><div class="panel-head"><b>📸 Community Moments</b><button class="mini" onclick="createMoment()">＋ Moment</button></div>${(moments.moments||[]).slice(0,4).map(m=>`<div class="moment-row"><b>@${esc(m.username)}</b><span>${esc(m.text||'')}</span><small>expires ${fmt(m.expiresAt)}</small></div>`).join('')||'<p class="muted">No active moments.</p>'}</div>
   <div class="panel" data-lab="hallOfFame"><div class="panel-head"><b>🏆 Hall of Fame</b><button class="mini" onclick="showHall()">Open</button></div>${(hall.reputation||[]).slice(0,5).map((x,i)=>`<div class="rank-row"><b>#${i+1} ${esc(x.displayName||x.username)}</b><span>${x.reputation} REP</span></div>`).join('')}</div>
   <div class="panel" data-lab="puzzleRooms"><div class="panel-head"><b>🧩 Puzzles & Mysteries</b><span>${state.user?.rank==='OWNER'||can('ADMIN')?`<button class="mini" onclick="managePuzzles()">Manage</button>`:''}</span></div><button class="platform-action" onclick="showPuzzles()">🧩 Puzzle Rooms (${quizzes.quizzes?.length||0})</button><button class="platform-action" onclick="showMysteries()">🕵️ Mystery Events (${mysteries.mysteries?.length||0})</button><button class="platform-action" onclick="showSecrets()">🗝️ Hidden Secrets (${(secrets.secrets||[]).filter(x=>x.found).length}/${secrets.secrets?.length||0})</button></div>
   <div class="panel" data-lab="dailyFortune"><div class="panel-head"><b>🔮 Daily Fortune</b><button class="mini" onclick="getFortune()">Reveal</button></div><p id="fortuneText" class="fortune-text">${esc(d.dailyFortune||'Your daily message is waiting.')}</p></div>
   <div class="panel"><div class="panel-head"><b>🧪 Feature Lab</b><span class="pill">Owner</span></div><p class="muted">Test experimental platform systems without removing their code.</p><button class="mini owner-only-platform" onclick="openFeatureLab()">Open Feature Lab</button><button class="mini owner-only-platform" onclick="openDevConsole()">Developer Console</button></div>
   <div class="panel"><div class="panel-head"><b>🗺️ More Platform Tools</b></div><button class="platform-action" onclick="showCommunityMap()">🗺️ Community Map</button><button class="platform-action" onclick="showPresets()">🎭 Identity Presets</button><button class="platform-action" onclick="showMusicRoom()">🎵 Shared Music Room</button><button class="platform-action" onclick="showArchive()">🗃️ Community Archive</button><button class="platform-action" onclick="showProfileShowcase()">🎬 Profile Showcase</button></div>
   <div class="panel"><div class="panel-head"><b>🌐 Language</b></div><select id="platformLocale"><option value="en">English</option><option value="mr">मराठी</option><option value="hi">हिन्दी</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option></select><button class="mini" onclick="saveLocale()">Save</button></div>
  </div>`;
  document.querySelectorAll('[data-lab]').forEach(card=>{card.style.display=labOn(card.dataset.lab)?'':'none';});
  $('platformLocale').value=locales.locale||'en';
  document.querySelectorAll('.owner-only-platform').forEach(x=>{if(state.user?.rank!=='OWNER')x.style.display='none'});
 }catch(e){el.innerHTML=`<div class="panel"><b>Community Hub</b><p class="error">${esc(e.message)}</p></div>`}
}
function enterRoomFromHub(id){document.querySelector(`[data-room-id="${id}"]`)?.click();}
async function showPlatformActivity(){const d=await api('/api/community/activity');platformModal('📡 Live Activity',`<div class="stack">${d.activity.map(x=>`<div class="card"><b>${esc(x.text)}</b><small>${fmt(x.time)}</small></div>`).join('')}</div>`)}
async function uploadCommunityFile(file){
  return new Promise(async(resolve,reject)=>{
    if(!file)return resolve(null);
    try{const fd=new FormData();fd.append('file',file);const r=await api('/api/community/upload',{method:'POST',body:fd});resolve(r);}catch(e){reject(e)}
  });
}
function deviceUpload(id){$(id)?.click();}
function createClub(){platformModal('🧑‍🤝‍🧑 Create Club',`
  <input id="clubName" placeholder="Club name">
  <input id="clubIcon" placeholder="Icon" value="🎭">
  <textarea id="clubDesc" placeholder="Description"></textarea>
  <textarea id="clubRules" placeholder="Club rules / expectations"></textarea>
  <select id="clubRank">${ranks.map(r=>`<option value="${r}">${rankIcon[r]||''} ${r}+</option>`).join('')}</select>
  <label><input id="clubPrivate" type="checkbox"> Private club</label>
  <input id="clubPassword" type="password" placeholder="Optional club password">
  <input id="clubBannerFile" type="file" accept="image/*" hidden>
  <button class="mini" onclick="deviceUpload('clubBannerFile')">📁 Select banner from device</button><span id="clubBannerName" class="muted">No banner selected</span>
  <button class="primary" id="clubCreate">Create</button>`);
  $('clubBannerFile').onchange=()=>{$('clubBannerName').textContent=$('clubBannerFile').files[0]?.name||'No banner selected'};
  $('clubCreate').onclick=async()=>{try{let banner='';if($('clubBannerFile').files[0])banner=(await uploadCommunityFile($('clubBannerFile').files[0])).url;await api('/api/community/clubs',{method:'POST',body:JSON.stringify({name:$('clubName').value,icon:$('clubIcon').value,description:$('clubDesc').value,rules:$('clubRules').value,private:$('clubPrivate').checked,password:$('clubPassword').value,rankRequired:$('clubRank').value,banner})});closeModal();loadPlatformHub()}catch(e){toast(e.message)}}}
async function joinClub(id,password=''){try{await api('/api/community/clubs/'+id+'/join',{method:'POST',body:JSON.stringify({password})});toast('Joined club.');await openClub(id);loadPlatformHub()}catch(e){if(e.message==='Incorrect club password.')platformModal('🔒 Club password',`<input id="clubJoinPass" type="password" placeholder="Password"><button class="primary" onclick="joinClub('${id}',$('clubJoinPass').value)">Enter club</button>`);else toast(e.message)}}
async function showClubs(){const d=await api('/api/community/clubs');platformModal('🧑‍🤝‍🧑 Clubs',`<div class="stack">${d.clubs.map(c=>`<div class="card club-explorer-card"><div class="panel-head"><span><b>${esc(c.icon)} ${esc(c.name)}</b><small>${c.members||0} members</small></span><div><button class="mini primary" onclick="openClub('${c.id}')">Enter</button></div></div><p>${esc(c.description||'No description yet.')}</p><small>${c.private?'🔒 Private club':'🌐 Public club'} · ${c.rankRequired||'MEMBER'}+</small></div>`).join('')||'<p class="muted">No clubs.</p>'}</div>`)}
async function openClub(id){
  try{
    const d=await api('/api/community/clubs/'+id);const joined=d.joined;const c=d.club;const isManager=joined&&(c.ownerId===state.user.id||can('ADMIN'));
    platformModal(`${esc(c.icon||'🎭')} ${esc(c.name)}`,`
      ${c.banner?`<img class="club-banner" src="${esc(c.banner)}" alt="">`:''}
      <div class="club-header-card"><div><h3>${esc(c.name)}</h3><p>${esc(c.description||'')}</p></div><span>${d.members.length} members · ${joined?'Member':'Not a member'}</span></div>
      <div class="club-tabs"><button class="mini">💬 Chat</button><button class="mini">👥 Members</button><button class="mini">📜 Rules</button>${isManager?`<button class="mini" onclick="editClub('${id}')">⚙️ Manage</button>`:''}</div>
      <div class="club-members"><b>Members & roles</b><div class="tag-list">${d.members.map(m=>`<span class="tag">@${esc(m.user?.username||'Unknown')} · ${esc(m.role||'MEMBER')}</span>`).join('')}</div></div>
      <div class="club-rules"><b>📜 Rules</b><p>${esc(c.rules||'No custom rules have been set.')}</p></div>
      <div class="club-chat" id="clubChat">${(d.messages||[]).map(m=>`<div class="club-message"><b>@${esc(m.username)}</b><span>${esc(m.text)}</span><small>${fmt(m.time)}</small></div>`).join('')||'<p class="muted">No club messages yet. Start the conversation.</p>'}</div>
      ${joined?`<textarea id="clubMessageText" placeholder="Write in the club…"></textarea><button class="primary" id="clubMessageSend">Send message</button>`:`<button class="primary" id="clubJoinFromPage">Join club</button>`}
    `);
    if($('clubJoinFromPage'))$('clubJoinFromPage').onclick=()=>joinClub(id);
    if($('clubMessageSend'))$('clubMessageSend').onclick=async()=>{const text=$('clubMessageText').value.trim();if(!text)return;try{await api('/api/community/clubs/'+id+'/messages',{method:'POST',body:JSON.stringify({text})});await openClub(id)}catch(e){toast(e.message)}};
  }catch(e){toast(e.message)}
}
async function editClub(id){
  const d=await api('/api/community/clubs/'+id),c=d.club;
  platformModal(`⚙️ Manage ${esc(c.name)}`,`<input id="ecName" value="${esc(c.name)}"><input id="ecIcon" value="${esc(c.icon||'🎭')}"><textarea id="ecDesc">${esc(c.description||'')}</textarea><textarea id="ecRules">${esc(c.rules||'')}</textarea><select id="ecRank">${ranks.map(r=>`<option value="${r}" ${r===(c.rankRequired||'MEMBER')?'selected':''}>${r}+</option>`).join('')}</select><label><input id="ecPrivate" type="checkbox" ${c.private?'checked':''}> Private</label><input id="ecPass" type="password" placeholder="New password (blank = keep existing)"><button class="primary" id="ecSave">Save club</button><button class="mini danger" id="ecDelete">Delete club</button>`);
  $('ecSave').onclick=async()=>{try{const body={name:$('ecName').value,icon:$('ecIcon').value,description:$('ecDesc').value,rules:$('ecRules').value,rankRequired:$('ecRank').value,private:$('ecPrivate').checked};if($('ecPass').value)body.password=$('ecPass').value;await api('/api/community/clubs/'+id,{method:'PATCH',body:JSON.stringify(body)});closeModal();openClub(id)}catch(e){toast(e.message)}};
  $('ecDelete').onclick=async()=>{if(!confirm('Delete this club and its messages?'))return;try{await api('/api/community/clubs/'+id,{method:'DELETE'});closeModal();loadPlatformHub()}catch(e){toast(e.message)}};
}
async function addArtwork(){platformModal('🎨 Add Artwork',`<input id="artTitle" placeholder="Title"><input id="artUrl" placeholder="Image URL"><input id="artFile" type="file" accept="image/*"><input id="artCat" placeholder="Category"><textarea id="artDesc" placeholder="Description"></textarea><button class="primary" id="artSave">Publish</button>`);$('artSave').onclick=async()=>{try{let url=$('artUrl').value.trim();if($('artFile').files[0])url=(await uploadCommunityFile($('artFile').files[0])).url;await api('/api/community/gallery',{method:'POST',body:JSON.stringify({title:$('artTitle').value,url,category:$('artCat').value,description:$('artDesc').value})});closeModal();loadPlatformHub()}catch(e){toast(e.message)}}}
async function showGallery(){const d=await api('/api/community/gallery');platformModal('🎨 Community Gallery',`<div class="gallery-grid">${d.artworks.map(a=>`<div class="card"><b>${esc(a.title)}</b><small>${esc(a.username)} · ${esc(a.category)}</small>${a.url?`<img src="${esc(a.url)}" class="gallery-image">`:''}<p>${esc(a.description||'')}</p><button class="mini" onclick="likeArtwork('${a.id}')">❤️ ${a.likes?.length||0}</button></div>`).join('')||'<p class="muted">No artwork.</p>'}</div>`)}
async function likeArtwork(id){try{await api('/api/community/gallery/'+id+'/like',{method:'POST'});showGallery()}catch(e){toast(e.message)}}
async function createMoment(){platformModal('📸 New Moment',`<textarea id="momentText" placeholder="Share a moment…"></textarea><input id="momentMedia" placeholder="Optional image URL"><input id="momentFile" type="file" accept="image/*,video/*,audio/*"><input id="momentMins" type="number" min="1" value="1440" placeholder="Minutes active"><button class="primary" id="momentSave">Post</button>`);$('momentSave').onclick=async()=>{try{let media=$('momentMedia').value.trim();if($('momentFile').files[0])media=(await uploadCommunityFile($('momentFile').files[0])).url;await api('/api/community/moments',{method:'POST',body:JSON.stringify({text:$('momentText').value,media,minutes:Number($('momentMins').value)})});closeModal();loadPlatformHub()}catch(e){toast(e.message)}}}
async function showHall(){const d=await api('/api/community/hall');platformModal('🏆 Hall of Fame',`<h3>Reputation</h3>${d.reputation.map((x,i)=>`<div class="rank-row"><b>#${i+1} ${esc(x.displayName||x.username)}</b><span>${x.reputation} REP</span></div>`).join('')}<h3>Messages</h3>${d.messages.slice(0,5).map(x=>`<div class="rank-row"><b>${esc(x.displayName||x.username)}</b><span>${x.messages}</span></div>`).join('')}`)}
async function managePuzzles(){
  platformModal('🧩 Puzzles & Mysteries Management',`
    <div class="stack">
      <button class="platform-action" onclick="createPuzzle()">＋ Create Puzzle</button>
      ${state.user?.rank==='OWNER'?`<button class="platform-action" onclick="createMystery()">＋ Create Mystery Event</button><button class="platform-action" onclick="createSecret()">＋ Create Hidden Secret</button>`:''}
    </div>`);
}
async function createPuzzle(){platformModal('🧩 Create Puzzle',`<input id="cpTitle" placeholder="Puzzle title"><textarea id="cpQuestion" placeholder="Puzzle question"></textarea><input id="cpAnswer" placeholder="Correct answer"><button class="primary" id="cpSave">Create puzzle</button>`);$('cpSave').onclick=async()=>{try{await api('/api/community/puzzles',{method:'POST',body:JSON.stringify({title:$('cpTitle').value,question:$('cpQuestion').value,answer:$('cpAnswer').value})});closeModal();toast('Puzzle created.');showPuzzles()}catch(e){toast(e.message)}}}
async function createMystery(){platformModal('🕵️ Create Mystery Event',`<input id="cmTitle" placeholder="Mystery title"><textarea id="cmIntro" placeholder="Introduction"></textarea><textarea id="cmClues" placeholder="One clue per line"></textarea><input id="cmAnswer" placeholder="Solution"><input id="cmDays" type="number" min="1" value="7" placeholder="Days active"><button class="primary" id="cmSave">Create mystery</button>`);$('cmSave').onclick=async()=>{try{const endsAt=Date.now()+Math.max(1,Number($('cmDays').value)||7)*86400000;await api('/api/community/mysteries',{method:'POST',body:JSON.stringify({title:$('cmTitle').value,intro:$('cmIntro').value,clues:$('cmClues').value.split('\n').map(x=>x.trim()).filter(Boolean),answer:$('cmAnswer').value,endsAt})});closeModal();toast('Mystery event created.');showMysteries()}catch(e){toast(e.message)}}}
async function createSecret(){platformModal('🗝️ Create Hidden Secret',`<input id="csCommand" value="/secret-" placeholder="Secret command"><input id="csTitle" placeholder="Secret title"><textarea id="csText" placeholder="Secret text"></textarea><input id="csGold" type="number" min="0" value="25" placeholder="Gold reward"><button class="primary" id="csSave">Create secret</button>`);$('csSave').onclick=async()=>{try{await api('/api/owner/secrets',{method:'POST',body:JSON.stringify({command:$('csCommand').value,title:$('csTitle').value,text:$('csText').value,gold:Number($('csGold').value)})});closeModal();toast('Hidden secret created.');showSecrets()}catch(e){toast(e.message)}}}
async function showPuzzles(){const d=await api('/api/community/puzzles');platformModal('🧩 Puzzle Rooms',`<div class="stack">${d.puzzles.map(x=>`<div class="card"><b>${esc(x.title)}</b><p>${esc(x.question)}</p><input id="pz-${x.id}" placeholder="Answer"><button class="mini" onclick="solvePuzzle('${x.id}')">Solve</button></div>`).join('')||'<p class="muted">No puzzles yet.</p>'}</div>`)}
async function solvePuzzle(id){const v=$('pz-'+id)?.value||'';try{const d=await api('/api/community/puzzles/'+id+'/solve',{method:'POST',body:JSON.stringify({answer:v})});toast(d.correct?'Correct! Rewards granted.':'Not quite.');}catch(e){toast(e.message)}}
async function showMysteries(){const d=await api('/api/community/mysteries');platformModal('🕵️ Mystery Events',`<div class="stack">${d.mysteries.map(x=>`<div class="card"><b>${esc(x.title)}</b><p>${esc(x.intro)}</p>${(x.clues||[]).map(c=>`<div>🔎 ${esc(c)}</div>`).join('')}<input id="my-${x.id}" placeholder="Your solution"><button class="mini" onclick="solveMystery('${x.id}')">Solve</button></div>`).join('')||'<p class="muted">No active mysteries.</p>'}</div>`)}
async function solveMystery(id){const v=$('my-'+id)?.value||'';try{const d=await api('/api/community/mysteries/'+id+'/solve',{method:'POST',body:JSON.stringify({answer:v})});toast(d.correct?'Mystery solved! Rewards granted.':'That solution did not work.');}catch(e){toast(e.message)}}
async function showSecrets(){const d=await api('/api/community/secrets');platformModal('🗝️ Hidden Secrets',`<div class="stack">${d.secrets.map(x=>`<div class="card"><b>${esc(x.title)}</b><p>${x.found?'✅ Discovered':'❓ Hidden'}</p>${x.found?'':`<button class="mini" onclick="discoverSecret('${x.id}')">Discover</button>`}</div>`).join('')}</div>`)}
async function discoverSecret(id){try{const d=await api('/api/community/secrets/'+id+'/discover',{method:'POST'});toast(`Secret discovered! +${d.reward?.gold||0} Gold.`);showSecrets()}catch(e){toast(e.message)}}
async function getFortune(){try{const d=await api('/api/community/fortune');const el=$('fortuneText');if(el)el.textContent=d.fortune.text;toast('Daily fortune revealed.')}catch(e){toast(e.message)}}
async function saveLocale(){try{await api('/api/locales',{method:'PATCH',body:JSON.stringify({locale:$('platformLocale').value})});toast('Language preference saved.')}catch(e){toast(e.message)}}
async function openAuroraManager(){
  try{
    const d=await api('/api/owner/aurora'),c=d.config||{};
    const roomOptions=(state.rooms||[]).map(r=>`<option value="${esc(r.id)}" ${r.id===(c.actionRoomId||'main')?'selected':''}>${esc(r.name)}</option>`).join('');
    platformModal('🪄 Aurora Management',`
      <p class="muted">Control Aurora’s automatic community announcements and Truth/Dare behavior. System actions are generated by the moderation system, not by a human moderator.</p>
      <label class="check-row"><input id="aurEnabled" type="checkbox" ${c.enabled!==false?'checked':''}> Aurora enabled</label>
      <label class="check-row"><input id="aurActions" type="checkbox" ${c.systemActions!==false?'checked':''}> Announce system actions (mute, kick, ban, warn, etc.)</label>
      <label class="check-row"><input id="aurTD" type="checkbox" ${c.truthDare!==false?'checked':''}> Truth & Dare replies</label>
      <label class="check-row"><input id="aurAuto" type="checkbox" ${c.announceAutomations!==false?'checked':''}> Announce automated moderation actions</label>
      <label>System announcement room<select id="aurRoom">${roomOptions}</select></label>
      <button class="primary" id="aurSave">💾 Save Aurora settings</button>`);
    $('aurSave').onclick=async()=>{try{await api('/api/owner/aurora',{method:'PATCH',body:JSON.stringify({enabled:$('aurEnabled').checked,systemActions:$('aurActions').checked,truthDare:$('aurTD').checked,announceAutomations:$('aurAuto').checked,actionRoomId:$('aurRoom').value})});closeModal();toast('Aurora settings saved.')}catch(e){toast(e.message)}};
  }catch(e){toast(e.message)}
}
async function openDiavalManager(){
  try{
    const d=await api('/api/owner/diaval'),c=d.config||{},cmds=c.customCommands||[];
    platformModal('🐉 Diaval Management',`
      <p class="muted">Local Diaval controls: enable/disable him, allow room mentions, direct-chat access, calculations, conversation context, memory size, and your own exact commands.</p>
      <label class="check-row"><input id="diaEnabled" type="checkbox" ${c.enabled!==false?'checked':''}> Diaval enabled</label>
      <label class="check-row"><input id="diaRoom" type="checkbox" ${c.roomMentions!==false?'checked':''}> Respond when mentioned in rooms</label>
      <label class="check-row"><input id="diaDirect" type="checkbox" ${c.directChat!==false?'checked':''}> Allow Diaval direct-chat page</label>
      <label class="check-row"><input id="diaCalc" type="checkbox" ${c.calculations!==false?'checked':''}> Allow calculations</label>
      <label class="check-row"><input id="diaContext" type="checkbox" ${c.conversationContext!==false?'checked':''}> Use recent room conversation as context</label>
      <label>Maximum stored memory notes<input id="diaMem" type="number" min="0" max="100" value="${Number(c.maxMemory||30)}"></label>
      <label>Response mode<select id="diaMode">${['helpful','concise','creative','royal'].map(x=>`<option value="${x}" ${c.responseMode===x?'selected':''}>${x}</option>`).join('')}</select></label>
      <h4>Custom Diaval commands</h4>
      <div class="stack" id="diaCmds">${cmds.map(x=>`<div class="card"><b>${esc(x.command)}</b><p>${esc(x.response)}</p><button class="mini danger" data-dia-del="${esc(x.id)}">Delete</button></div>`).join('')||'<p class="muted">No custom commands.</p>'}</div>
      <div class="card"><input id="diaCmd" placeholder="Exact trigger, e.g. hello"><textarea id="diaResp" placeholder="Diaval response"></textarea><button class="mini" id="diaAdd">＋ Add command</button></div>
      <button class="primary" id="diaSave">💾 Save Diaval settings</button>`);
    document.querySelectorAll('[data-dia-del]').forEach(b=>b.onclick=async()=>{const next=cmds.filter(x=>x.id!==b.dataset.diaDel);await api('/api/owner/diaval',{method:'PATCH',body:JSON.stringify({customCommands:next})});openDiavalManager()});
    $('diaAdd').onclick=()=>{const command=$('diaCmd').value.trim(),response=$('diaResp').value.trim();if(!command||!response)return toast('Enter a command and response.');cmds.push({id:'dia-'+Date.now(),command,response,enabled:true});$('diaCmd').value='';$('diaResp').value='';toast('Command added locally. Save settings to persist it.')};
    $('diaSave').onclick=async()=>{try{await api('/api/owner/diaval',{method:'PATCH',body:JSON.stringify({enabled:$('diaEnabled').checked,roomMentions:$('diaRoom').checked,directChat:$('diaDirect').checked,calculations:$('diaCalc').checked,conversationContext:$('diaContext').checked,maxMemory:$('diaMem').value,responseMode:$('diaMode').value,customCommands:cmds})});closeModal();toast('Diaval settings saved.')}catch(e){toast(e.message)}};
  }catch(e){toast(e.message)}
}

async function openMalAIManager(){
  try{
    const d=await api('/api/owner/mal-ai');
    const rows=(d.commands||[]).map(x=>`<div class="card mal-ai-row"><div><b>@Mal ${esc(x.command)}</b><small>${esc(x.response)}</small></div><div class="toolbar"><button class="mini" data-ai-toggle="${x.id}">${x.enabled===false?'Enable':'Disable'}</button><button class="mini danger" data-ai-delete="${x.id}">Delete</button></div></div>`).join('');
    platformModal('🖤 Mal AI Bot Management',`<p class="muted">Mal now has only the built-in <b>@Mal Time</b> command. Add your own exact commands below; all previous built-in commands have been removed. These commands run locally with no external AI API.</p><label class="lab-toggle"><span>Mal AI enabled</span><input id="malAiEnabled" type="checkbox" ${d.enabled?'checked':''}></label><div class="card"><input id="malAiCommand" placeholder="Command, e.g. Rules"><textarea id="malAiResponse" placeholder="Response Mal should give…"></textarea><button class="primary" id="addMalAICommand">＋ Save command</button></div><div class="stack">${rows||'<p class="muted">No custom commands yet.</p>'}</div>`);
    $('addMalAICommand').onclick=async()=>{try{await api('/api/owner/mal-ai/commands',{method:'POST',body:JSON.stringify({command:$('malAiCommand').value,response:$('malAiResponse').value})});toast('Mal AI command saved.');openMalAIManager()}catch(e){toast(e.message)}};
    $('malAiEnabled').onchange=async()=>{try{await api('/api/owner/mal-ai',{method:'PUT',body:JSON.stringify({enabled:$('malAiEnabled').checked})});toast('Mal AI setting saved.')}catch(e){toast(e.message)}};
    document.querySelectorAll('[data-ai-delete]').forEach(b=>b.onclick=async()=>{await api('/api/owner/mal-ai/commands/'+b.dataset.aiDelete,{method:'DELETE'});openMalAIManager()});
    document.querySelectorAll('[data-ai-toggle]').forEach(b=>b.onclick=async()=>{const id=b.dataset.aiToggle;const row=(d.commands||[]).find(x=>x.id===id);await api('/api/owner/mal-ai/commands/'+id,{method:'PATCH',body:JSON.stringify({enabled:row?.enabled===false})});openMalAIManager()});
  }catch(e){toast(e.message)}
}
async function openFeatureLab(){
  const d=await api('/api/owner/feature-lab');
  const keys=['clubs','communityMap','identityPresets','profileShowcase','artGallery','moments','musicRooms','puzzleRooms','mysteryEvents','easterEggs','liveActivity','dailyFortune','hallOfFame','archive','localization','malCommands'];
  platformModal('🧪 Feature Lab',`<p class="muted">Choose which experimental systems are live. Changes are only applied when you press Save changes.</p><div id="featureLabRows">${keys.map(k=>`<label class="lab-toggle"><span>${esc(k)}</span><input type="checkbox" data-lab-key="${k}" ${d.features[k]?'checked':''}></label>`).join('')}</div><div class="toolbar"><button class="primary" id="saveFeatureLab">💾 Save changes</button><button class="mini" onclick="closeModal()">Cancel</button></div>`);
  $('saveFeatureLab').onclick=async()=>{
    try{
      const payload={};document.querySelectorAll('[data-lab-key]').forEach(x=>payload[x.dataset.labKey]=x.checked);
      const r=await api('/api/owner/feature-lab',{method:'PUT',body:JSON.stringify(payload)});
      closeModal();toast('Feature Lab settings saved.');loadPlatformHub();
    }catch(e){toast(e.message)}
  };
}
async function toggleLab(k,on){return;}

async function openDevConsole(){try{const d=await api('/api/owner/dev-console');platformModal('🧰 Owner Developer Console',`<div class="console-grid"><div class="card"><b>Server</b><p>Node ${esc(d.node)}</p><p>Uptime ${Math.round(d.uptime)}s</p></div><div class="card"><b>Users</b><p>${d.online}/${d.users} online</p></div><div class="card"><b>Data</b><p>${d.messages} messages</p><p>${d.dbBytes} bytes</p></div><div class="card"><b>Rooms</b><p>${d.rooms}</p></div></div>`)}catch(e){toast(e.message)}}

// Make the new platform hub the richer implementation while preserving all 3.2 endpoints.
loadCommunityHub=loadPlatformHub;

async function showCommunityMap(){const d=await api('/api/community/platform');platformModal('🗺️ Community Map',`<p class="muted">Live room population map.</p><div class="platform-grid">${d.activeRooms.map(r=>`<button class="platform-row" onclick="enterRoomFromHub('${r.id}')"><span>🏠 ${esc(r.name)}</span><b>${r.onlineCount||0} online</b></button>`).join('')}</div>`)}
async function showPresets(){const d=await api('/api/community/presets');platformModal('🎭 Identity Presets',`<p class="muted">Save alternate looks without changing your main profile.</p><div class="stack">${d.presets.map(p=>`<div class="card"><b>${esc(p.name)}</b><p>${esc(p.bio||'')}</p><button class="mini danger" onclick="deletePreset('${p.id}')">Delete</button></div>`).join('')||'<p class="muted">No presets yet.</p>'}</div><input id="presetName" placeholder="Preset name"><input id="presetAvatar" placeholder="Avatar URL"><input id="presetBanner" placeholder="Banner URL"><input id="presetFrame" placeholder="Frame name"><input id="presetPlate" placeholder="Nameplate"><textarea id="presetBio" placeholder="Preset bio"></textarea><button class="primary" onclick="createPreset()">Create preset</button>`)}
async function createPreset(){try{await api('/api/community/presets',{method:'POST',body:JSON.stringify({name:$('presetName').value,avatar:$('presetAvatar').value,banner:$('presetBanner').value,frame:$('presetFrame').value,nameplate:$('presetPlate').value,bio:$('presetBio').value})});toast('Preset created.');showPresets()}catch(e){toast(e.message)}}
async function deletePreset(id){try{await api('/api/community/presets/'+id,{method:'DELETE'});showPresets()}catch(e){toast(e.message)}}
async function showMusicRoom(){const rid=state.currentRoom;if(!rid){toast('Open a room first.');return}const d=await api('/api/community/music/'+rid);platformModal('🎵 Shared Music Room',`<p class="muted">Room playlist · ${esc(state.rooms.find(r=>r.id===rid)?.name||'Current room')}</p><div class="stack">${(d.queue.items||[]).map(x=>`<div class="card"><b>${esc(x.title)}</b><small>by @${esc(x.user)} · ${x.votes||0} votes</small><button class="mini" onclick="voteMusic('${rid}','${x.id}')">▲ Vote</button></div>`).join('')||'<p class="muted">Queue is empty.</p>'}</div><input id="musicTitle" placeholder="Song title"><input id="musicUrl" placeholder="Optional URL"><button class="primary" onclick="addMusic('${rid}')">Add to queue</button>`)}
async function addMusic(rid){try{await api('/api/community/music/'+rid,{method:'POST',body:JSON.stringify({title:$('musicTitle').value,url:$('musicUrl').value})});showMusicRoom()}catch(e){toast(e.message)}}
async function voteMusic(rid,id){try{await api('/api/community/music/'+rid+'/vote/'+id,{method:'POST'});showMusicRoom()}catch(e){toast(e.message)}}
async function showArchive(){const d=await api('/api/community/archive');platformModal('🗃️ Community Archive',`<h3>📰 News</h3>${d.news.slice(0,8).map(x=>`<div class="card"><b>${esc(x.title||'News')}</b></div>`).join('')||'<p class="muted">No archived news.</p>'}<h3>🏛️ Museum</h3>${d.museum.slice(0,8).map(x=>`<div class="card"><b>${esc(x.title)}</b><p>${esc(x.description||'')}</p></div>`).join('')||'<p class="muted">No museum exhibits.</p>'}<h3>🧠 Memories</h3>${d.memories.slice(0,8).map(x=>`<div class="card"><b>${esc(x.title)}</b><p>${esc(x.text||'')}</p></div>`).join('')||'<p class="muted">No memories.</p>'}`)}
async function showProfileShowcase(){const u=state.user||{};platformModal('🎬 Profile Showcase',`<div class="profile-showcase card"><div class="showcase-banner" style="background-image:url('${esc(u.banner||'')}')"></div><div class="showcase-avatar">${u.avatar?`<img src="${esc(u.avatar)}">`:'🖤'}</div><h3>${esc(u.displayName||u.username)}</h3><p class="muted">@${esc(u.username)} · ${esc(u.rank||'MEMBER')}</p><p>${esc(u.bio||'No bio yet.')}</p><div class="stat-grid"><div class="stat-card"><b>${u.xp||0}</b><span>XP</span></div><div class="stat-card"><b>${u.gold||0}</b><span>Gold</span></div><div class="stat-card"><b>${u.profileLikes||0}</b><span>Likes</span></div></div></div>`)}
