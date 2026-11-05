const $ = id => document.getElementById(id);

// Register room creation before the rest of the app initializes. Event delegation also
// survives room-list rerenders and does not depend on the button retaining its onclick.
document.addEventListener("click", event => {
  const button = event.target instanceof Element ? event.target.closest("#newRoom, .room-create-button") : null;
  if (!button || button.classList.contains("hidden") || button.disabled) return;
  event.preventDefault();
  openRoomCreationModal();
}, true);

// Room theme data must exist before early socket events or room rendering can apply it.
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


// Declare maintenance polling state before bootstrap can start the app.
let constructionTimer=null,constructionPoll=null,constructionWriteInFlight=false;

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
  modeManagement: {},
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

// Validate profile links before rendering them. Keep this helper available before
// loadProfile() so a profile refresh cannot fail with a ReferenceError.
function safeProfileUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href;
  } catch {
    return "";
  }
}

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
  const roomMatch=String(url).match(/\/api\/rooms\/([^/?#]+)(?:\/|$)/);
  if(roomMatch){try{const roomAccess=JSON.parse(safeStorage.getItem('mc_room_join')||'null');if(roomAccess?.roomId!=null&&String(roomAccess.roomId)===String(roomMatch[1])&&roomAccess.joinToken)headers['x-room-join-token']=roomAccess.joinToken;}catch{}}
  const messageMatch=String(url).match(/\/api\/messages\/[^/?#]+(?:\/|$)/);
  if(!roomMatch&&messageMatch){try{const roomAccess=JSON.parse(safeStorage.getItem("mc_room_join")||"null");if(roomAccess?.roomId!=null&&String(roomAccess.roomId)===String(state.currentRoom)&&roomAccess.joinToken)headers["x-room-join-token"]=roomAccess.joinToken;}catch{}}
  if(!roomMatch&&/\/api\/messages\/[^/?#]+\/forward(?:[?#]|$)/.test(String(url))){
    try{const body=typeof opt.body==="string"?JSON.parse(opt.body):opt.body;const roomAccess=JSON.parse(safeStorage.getItem("mc_room_join")||"null");if(body?.roomId!=null&&String(roomAccess?.roomId)===String(body.roomId)&&roomAccess?.joinToken)headers["x-room-join-token"]=roomAccess.joinToken;}catch{}
  }
  // API responses must never be read from or written to the browser HTTP cache.
  // In particular, chat history must be fetched fresh after reloads.
  const res = await fetch(url, {
    ...opt,
    cache: "no-store",
    headers,
    credentials: "same-origin"
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = Error(body.error || "Request failed");
    err.kickedUntil = body.kickedUntil || null;
    err.reason = body.reason || null;
    err.moderationLock = body.moderationLock || null;
    if(body.moderationLock==="BAN" || /you have been banned/i.test(String(body.error||""))){
      safeStorage.removeItem("mc_token");
      safeStorage.removeItem("mc_room_join");
      $("auth")?.classList.add("hidden");$("app")?.classList.add("hidden");
      showBanLock(body.reason||"Community rules");
    }else if(body.moderationLock==="KICK" || (/you have been kicked/i.test(String(body.error||"")) && err.kickedUntil)){
      safeStorage.removeItem("mc_token");
      safeStorage.removeItem("mc_room_join");
      $("auth")?.classList.add("hidden");$("app")?.classList.add("hidden");
      showKickLock(err.kickedUntil,body.reason||"Community rules");
    }
    throw err;
  }

  return body;
}

let notificationWorkerError="";
let siteNotificationRegistration=null;
async function registerSiteNotificationWorker(){
  if(!("serviceWorker" in navigator)){notificationWorkerError="This browser does not support service workers.";return null;}
  try{
    const registration=await navigator.serviceWorker.register("/service-worker.js",{scope:"/",updateViaCache:"none"});
    await registration.update().catch(()=>{});
    siteNotificationRegistration=await navigator.serviceWorker.ready;
    notificationWorkerError="";
    return siteNotificationRegistration;
  }catch(e){
    notificationWorkerError=String(e?.message||e||"Unknown service-worker error");
    console.warn("Notification worker unavailable",e);
    return null;
  }
}
async function showSiteNotification(title,body,targetView){
  if(!("Notification" in window)||Notification.permission!=="granted")return;
  const options={body,icon:"/favicon.svg",badge:"/favicon.svg",tag:"mc-"+String(title).slice(0,32),data:{url:"/"+(targetView==="messages"?"#messages":"#rooms")}};
  try{const registration=siteNotificationRegistration||await registerSiteNotificationWorker();if(registration?.showNotification)await registration.showNotification(title,options);else new Notification(title,options);}catch(e){console.warn("Could not show notification",e);}
}
function decodePushKey(value){
  const normalized=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  const padded=normalized+"=".repeat((4-normalized.length%4)%4);
  const raw=atob(padded);
  return Uint8Array.from(raw,char=>char.charCodeAt(0));
}
async function enableSiteNotifications(){
  if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)){toast("This browser does not support background push notifications.");return;}
  try{
    const permission=await Notification.requestPermission();
    if(permission!=="granted"){toast("Notifications were not enabled. Allow notifications for this site in browser settings.");return;}
    const keyData=await api("/api/push/public-key");
    if(!keyData.enabled||!keyData.publicKey){toast("Background push is not configured on the server yet. Add the VAPID keys to Render environment variables.");return;}
    const registration=await registerSiteNotificationWorker();
    if(!registration)throw new Error("Could not register the notification service worker"+(notificationWorkerError?": "+notificationWorkerError:"."));
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodePushKey(keyData.publicKey)});
    await api("/api/push/subscribe",{method:"POST",body:JSON.stringify(subscription.toJSON())});
    siteNotificationRegistration=registration;
    const btn=$("enableSiteNotifications");if(btn)btn.textContent="🔔 Background notifications enabled";
    toast("Background notifications enabled on this device, including when the site is closed.");
  }catch(e){toast("Could not enable background notifications: "+(e.message||"check browser and site settings"));}
}
$("enableSiteNotifications")?.addEventListener("click",enableSiteNotifications);
async function testSiteNotifications(){
  const button=$("testSiteNotifications");
  if(button){button.disabled=true;button.textContent="Testing…";}
  try{
    const result=await api("/api/push/test",{method:"POST",body:JSON.stringify({})});
    toast(result.message||"Push provider accepted the test notification. Check your notification tray.");
  }catch(error){
    toast("Notification test failed: "+(error.message||"unknown error"));
  }finally{
    if(button){button.disabled=false;button.textContent="🧪 Send test";}
  }
}
async function hardRefreshSite(){
  const savedAuthToken=safeStorage.getItem("mc_token");
  const button=$("siteHardRefresh");
  if(button){button.disabled=true;button.textContent="⏳ Refreshing…";}
  try{
    // Clear only Cache Storage. Preserve login cookies, localStorage, IndexedDB,
    // server-side account/messages, and the push subscription.
    if("caches" in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(key=>caches.delete(key)));
    }
    if(savedAuthToken)safeStorage.setItem("mc_token",savedAuthToken);
    if("serviceWorker" in navigator){
      const registration=await navigator.serviceWorker.getRegistration("/");
      if(registration)await registration.update().catch(()=>{});
    }
    toast("Site cache cleared. Reloading the latest Maleficent Chat…");
    const url=new URL(window.location.href);
    url.searchParams.set("mc_refresh",String(Date.now()));
    window.location.replace(url.toString());
  }catch(error){
    console.error("Site refresh failed:",error);
    toast("Could not clear the site cache: "+String(error?.message||error));
    if(button){button.disabled=false;button.textContent="🔄 Site refresh";}
  }
}
$("siteHardRefresh")?.addEventListener("click",()=>{
  if(!window.confirm("Refresh Maleficent Chat and clear its cached files? Your account, messages, login session, and saved data will be kept."))return;
  hardRefreshSite();
});
$("testSiteNotifications")?.addEventListener("click",testSiteNotifications);
if("Notification" in window && Notification.permission==="granted") registerSiteNotificationWorker();

function toast(text) {
  const el = $("toast");
  // Some dashboard views do not include the global toast element.
  // Never let a missing notification node break the action that triggered it.
  if (!el) { console.warn("[Maleficent Chat]", String(text)); return; }
  el.textContent = String(text ?? "");
  el.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    const current = $("toast");
    if (current) current.style.display = "none";
  }, 2800);
}

function closeModal() {
  const overlay = $("modal");
  overlay.classList.add("hidden");
  // Tear down file inputs, image previews and temporary controls when a dialog
  // closes so an upload/crop preview cannot linger over the chat viewport.
  const body = $("modalBody");
  if (body) body.replaceChildren();
}

function modal(html) {
  $("modalBody").innerHTML = html;
  $("modal").classList.remove("hidden");
}

function avatar(u, cls = "avatar") {
  const name = u?.displayName || u?.username || "?";
  const initial = esc(name.slice(0, 1).toUpperCase());
  const src = String(u?.avatar || "").trim();
  return `
    <div class="${cls}">
      ${src
        ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.onerror=null;this.remove();this.parentElement.classList.add('avatar-image-failed');this.parentElement.textContent='${initial}'">`
        : initial}
    </div>
  `;
}

function can(requiredRank) {
  if (!state.user) return false;
  const userRank=String(state.user.rank||"").toUpperCase();
  const neededRank=String(requiredRank||"").toUpperCase();
  return (rankOrder[userRank] ?? -1) >= (rankOrder[neededRank] ?? 999);
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
    // A successful login must not be discarded just because the optional
    // bootstrap request fails. Keep the authenticated user and open the app;
    // bootstrap can be retried on the next refresh.
    state.user = result.user;
    state.featurePermissions = {};
    state.featureGrants = {};
    state.userPermissions = {};
    try {
      const boot = await api("/api/bootstrap");
      state.user = boot.user || result.user;
      state.featurePermissions = boot.featurePermissions || {};
      state.featureGrants = boot.settings?.feature_grants || {};
      state.userPermissions = boot.userPermissions || {};
    } catch (bootstrapError) {
      console.warn("Login succeeded but bootstrap failed; continuing with the authenticated user.", bootstrapError);
    }

    await start();
  } catch (error) {
    $("authMsg").textContent = error.message;
    if(/you have been banned/i.test(String(error.message||""))){showBanLock(error.reason||String(error.message).replace(/^.*you have been banned\s*/i,"").replace(/^[:.\-]\s*/,"")||"Community rules");}
    else if(/you have been kicked/i.test(String(error.message||"")) && error.kickedUntil){showKickLock(error.kickedUntil,error.reason||"Community rules");}
  }
};

// Mark the bundle ready only after the login handler has been registered.
window.__MC_APP_READY__ = true;

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
    const expiry=typeof until==="number"?until:(Number(until)||Date.parse(until));
    const remaining=expiry-Date.now();
    if(remaining<=0){clearActionLock();return;}
    const total=Math.floor(remaining/1000);
    const days=Math.floor(total/86400),hours=Math.floor((total%86400)/3600),minutes=Math.floor((total%3600)/60),seconds=total%60;
    const pad=n=>String(n).padStart(2,"0");
    box.innerHTML=`<div class="action-lock-card action-lock-full"><div class="action-lock-icon">🦶🏼</div><h1>You have been kicked</h1><h2>Reason</h2><p class="action-lock-reason">${safeReason}</p><div class="action-lock-countdown-label">You can return in</div><div class="action-lock-countdown">${days}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}</div><small>Days : Hours : Minutes : Seconds</small></div>`;
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

let liveSyncTimer=null, liveSyncRunId=0, liveRoomSyncBusy=false, liveDMSyncBusy=false, liveSyncLastInbox=0;

async function refreshRoomMessageList(roomId,{force=false}={}){
  if(!state.user||!roomId||String(state.currentRoom)!==String(roomId))return false;
  const requestedRoom=String(roomId);
  const data=await api("/api/rooms/"+encodeURIComponent(requestedRoom)+"/messages",{
    ...(typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?{signal:AbortSignal.timeout(7000)}:{})
  });
  if(String(state.currentRoom)!==requestedRoom||!Array.isArray(data.messages))return false;
  const list=$("messages");if(!list)return false;
  const incoming=data.messages;
  const incomingIds=incoming.map(m=>String(m.id));
  const renderedIds=Array.from(list.querySelectorAll("[data-mid]")).map(el=>String(el.dataset.mid));
  const same=incomingIds.length===renderedIds.length&&incomingIds.every((id,i)=>id===renderedIds[i]);
  if(!same||force){
    const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<180;
    state.messages=incoming;
    list.innerHTML=incoming.map(messageHTML).join("");
    if(nearBottom)list.scrollTop=list.scrollHeight;
  }else{state.messages=incoming;}
  return true;
}

async function refreshActiveDMMessageList(peerId){
  if(!state.user||!peerId||String(state.dmUserId)!==String(peerId))return false;
  const requestedPeer=String(peerId);
  const data=await api("/api/dm/"+encodeURIComponent(requestedPeer),{
    ...(typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?{signal:AbortSignal.timeout(7000)}:{})
  });
  if(String(state.dmUserId)!==requestedPeer||!Array.isArray(data.messages))return false;
  const list=$("dmMessages");if(!list)return false;
  const incoming=data.messages,peer=state.dmPeerUser||{};
  const oldIds=Array.from(list.querySelectorAll("[data-dmid]")).map(el=>String(el.dataset.dmid));
  const newIds=incoming.map(m=>String(m.id));
  const same=oldIds.length===newIds.length&&oldIds.every((id,i)=>id===newIds[i]);
  const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<180;
  if(!same){
    state.dmMessages=incoming;
    list.innerHTML=incoming.length?incoming.map(m=>dmMessageHTML(m,incoming,peer)).join(""):'<p class="muted">No private messages yet.</p>';
    if(nearBottom)list.scrollTop=list.scrollHeight;
    const count=$("dmSearchCount");if(count)count.textContent=incoming.length+" messages";
  }else{state.dmMessages=incoming;}
  return true;
}

async function syncLiveMessages(){
  if(!state.user)return; // Keep polling active even when mobile/webview visibility state is unreliable.
  // Keep each channel on its own lock. A slow or rejected room-history
  // request must never block private-message synchronization (or vice versa).
    // Run room history and the active private conversation independently. A slow
    // room request must not delay private messages (or vice versa).
    const roomTask=(async()=>{
    if(state.currentRoom&&!liveRoomSyncBusy){
      liveRoomSyncBusy=true;
      try {
      const roomId=String(state.currentRoom);
      try{
        // A stalled fetch must not leave the room-sync lock set forever.
        // Abort this read after 7 seconds so the next poll can recover.
        const data=await api("/api/rooms/"+encodeURIComponent(roomId)+"/messages",{...(typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?{signal:AbortSignal.timeout(7000)}:{})});
        if(String(state.currentRoom)===roomId&&Array.isArray(data.messages)){
          const incoming=data.messages;
          const list=$("messages");
          const incomingIds=incoming.map(m=>String(m.id));
          const renderedIds=list?Array.from(list.querySelectorAll("[data-mid]")).map(el=>String(el.dataset.mid)):[];
          const stateIds=(state.messages||[]).map(m=>String(m.id));
          const sameIds=(a,b)=>a.length===b.length&&a.every((id,index)=>id===b[index]);
          const domMatches=sameIds(renderedIds,incomingIds);
          const stateMatches=sameIds(stateIds,incomingIds);
          if(list&&(!domMatches||!stateMatches)){
            const wasNearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<180;
            state.messages=incoming;
            list.innerHTML=incoming.map(messageHTML).join("");
            if(wasNearBottom)list.scrollTop=list.scrollHeight;
          }else{
            const previousById=new Map((state.messages||[]).map(m=>[String(m.id),m]));
            state.messages=incoming;
            for(const message of incoming){
              const previous=previousById.get(String(message.id));
              if(!previous)continue;
              const stamp=JSON.stringify([message.edited,message.deleted,message.reactions,message.text,message.attachment]);
              const el=list?Array.from(list.querySelectorAll("[data-mid]")).find(node=>String(node.dataset.mid)===String(message.id)):null;
              if(el&&String(el.dataset.syncStamp||"")!==stamp){
                el.outerHTML=messageHTML(message);
                const fresh=list?Array.from(list.querySelectorAll("[data-mid]")).find(node=>String(node.dataset.mid)===String(message.id)):null;
                if(fresh)fresh.dataset.syncStamp=stamp;
              }
            }
          }
          if(list&&incoming.length&&list.scrollHeight-list.scrollTop-list.clientHeight<180)list.scrollTop=list.scrollHeight;
        }
      }catch(error){console.warn("Live room sync failed:",error?.message||error);}
      } finally { liveRoomSyncBusy=false; }
    }
    })();
    const dmTask=(async()=>{
    if(state.dmUserId&&!liveDMSyncBusy){
      liveDMSyncBusy=true;
      try {
      const peerId=String(state.dmUserId);
      try{
        // A stalled fetch must not leave the DM-sync lock set forever.
        // Abort this read after 7 seconds so the next poll can recover.
        const data=await api("/api/dm/"+encodeURIComponent(peerId),{...(typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?{signal:AbortSignal.timeout(7000)}:{})});
        if(String(state.dmUserId)===peerId&&Array.isArray(data.messages)){
          // PostgreSQL history is authoritative. Reconcile both message order and
          // sender/content fields, not just IDs; otherwise stale bubbles can keep
          // showing the wrong sender or an obsolete message on one device.
          const incoming=data.messages;
          const previous=Array.isArray(state.dmMessages)?state.dmMessages:[];
          const signature=m=>JSON.stringify([
            String(m?.id??""),String(m?.from??""),String(m?.to??""),
            String(m?.text??""),String(m?.time??""),String(m?.read??""),
            String(m?.replyTo??""),JSON.stringify(m?.attachment??null),
            String(m?.deleted??""),String(m?.edited??"")
          ]);
          const list=$("dmMessages");
          const renderedIds=list?Array.from(list.querySelectorAll("[data-dmid]")).map(el=>String(el.dataset.dmid)):[];
          const incomingIds=incoming.map(m=>String(m.id));
          const domMatches=renderedIds.length===incomingIds.length&&renderedIds.every((id,index)=>id===incomingIds[index]);
          const changed=previous.length!==incoming.length ||
            previous.some((m,i)=>signature(m)!==signature(incoming[i])) || !domMatches;
          state.dmMessages=incoming;
          if(list&&changed){
            const wasNearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<180;
            list.innerHTML=incoming.map(m=>dmMessageHTML(m,incoming,state.dmPeerUser||{})).join("");
            if(wasNearBottom)list.scrollTop=list.scrollHeight;
          }
          // Mark the conversation read only when there is actually an unread
          // incoming message. Posting this on every history poll created needless
          // database writes while the conversation was idle.
          if(peerId!=="system-bot"&&incoming.some(m=>String(m?.from??"")===peerId&&!m?.read)){
            api("/api/dm/"+encodeURIComponent(peerId)+"/read",{method:"POST"}).then(()=>{refreshTopDMUnreadBadge();loadDMList().catch(()=>{});}).catch(error=>console.warn("Could not mark active conversation read:",error?.message||error));
          }
        }
      }catch(error){console.warn("Live private-message sync failed:",error?.message||error);}
      } finally { liveDMSyncBusy=false; }
    }
    })();
    await Promise.allSettled([roomTask,dmTask]);
    const now=Date.now();
    if(now-liveSyncLastInbox>15000){
      liveSyncLastInbox=now;
      loadDMList().catch(()=>{});
      loadNotifications().catch(()=>{});
    }
}
let liveSyncWakeListenersBound=false;
let liveRoomPollTimer=null, liveDMPollTimer=null;
let liveRoomLastFallbackPoll=0, liveDMLastFallbackPoll=0;
function startLiveSync(){
  // Socket.IO delivers new messages immediately. Keep a frequent recovery poll
  // only while disconnected; when connected, periodically reconcile history to
  // recover missed events without querying PostgreSQL every second.
  if(liveRoomPollTimer)clearInterval(liveRoomPollTimer);
  if(liveDMPollTimer)clearInterval(liveDMPollTimer);
  syncLiveMessages();
  liveRoomPollTimer=setInterval(()=>{
    const now=Date.now(), connected=!!state.socket?.connected;
    const interval=connected?4000:1000;
    if(state.user&&state.currentRoom&&!liveRoomSyncBusy&&now-liveRoomLastFallbackPoll>=interval){
      liveRoomLastFallbackPoll=now;
      syncLiveMessages().catch(error=>console.warn("Automatic room sync failed:",error?.message||error));
    }
  },500);
  liveDMPollTimer=setInterval(()=>{
    const now=Date.now(), connected=!!state.socket?.connected;
    const interval=connected?4000:1000;
    if(state.user&&state.dmUserId&&!liveDMSyncBusy&&now-liveDMLastFallbackPoll>=interval){
      liveDMLastFallbackPoll=now;
      syncLiveMessages().catch(error=>console.warn("Automatic private-message sync failed:",error?.message||error));
    }
  },500);
  // Bind once so app focus/reconnect immediately catches up without sending a message.
  if(!liveSyncWakeListenersBound){
    liveSyncWakeListenersBound=true;
    document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state.user)syncLiveMessages();});
    window.addEventListener("focus",()=>{if(state.user)syncLiveMessages();});
    window.addEventListener("online",()=>{if(state.user)syncLiveMessages();});
  }
}
async function authenticateSocketAndJoinRoom(socket=state.socket, syncHistory=true) {
  if(!socket || !socket.connected || !state.user) return false;
  return new Promise(resolve=>{
    socket.emit("auth",{token:safeStorage.getItem("mc_token")||""},async ack=>{
      if(!ack?.ok || socket!==state.socket || !socket.connected){resolve(false);return;}
      let access=null;
      try{access=JSON.parse(safeStorage.getItem("mc_room_join")||"null");}catch{}
      if(!state.currentRoom || String(access?.roomId??"")!==String(state.currentRoom) || !access?.joinToken){resolve(true);return;}
      socket.emit("join-room",access);
      if(!syncHistory){resolve(true);return;}
      const roomId=String(state.currentRoom);
      try{
        const data=await api("/api/rooms/"+encodeURIComponent(roomId)+"/messages");
        if(socket!==state.socket || !socket.connected || String(state.currentRoom)!==roomId){resolve(false);return;}
        state.messages=Array.isArray(data.messages)?data.messages:[];
        const list=$("messages");
        if(list){list.innerHTML=state.messages.map(messageHTML).join("");list.scrollTop=list.scrollHeight;}
      }catch(error){
        console.warn("Room message resync failed:",error?.message||error);
      }
      resolve(true);
    });
  });
}

/* ---------------- START ---------------- */

/* ---------------- START ---------------- */

async function start() {
  checkUnderConstruction();
  if(constructionPoll)clearInterval(constructionPoll);
  constructionPoll=setInterval(checkUnderConstruction,15000);
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
  state.socket.io.opts.reconnection = true;
  state.socket.io.opts.reconnectionAttempts = Infinity;
  state.socket.io.opts.reconnectionDelay = 500;
  state.socket.io.opts.reconnectionDelayMax = 5000;
  startLiveSync();
  state.socket.on("under-construction:status",payload=>{
    if(payload?.enabled&&!isOwnerExempt())showConstructionPanel(payload.until);
    else hideConstructionPanel();
    const toggle=$("staffUnderConstructionToggle");
    if(toggle&&isOwnerExempt()){toggle.checked=!!payload?.enabled;toggle.setAttribute("aria-checked",toggle.checked?"true":"false");}
    const statusLabel=$("staffConstructionStatus");
    if(statusLabel){statusLabel.textContent=payload?.enabled?"ON · Maintenance enabled":"OFF · Site open";statusLabel.classList.toggle("is-on",!!payload?.enabled);}
  });
  state.socket.on("room:theme",data=>{if(!data?.roomId||!data?.theme)return;const room=state.rooms.find(r=>String(r.id)===String(data.roomId));if(room)room.roomTheme=data.theme;if(String(state.currentRoom)===String(data.roomId))applyRoomTheme(data.theme);});
  state.socket.on("gold:update",data=>{ if(state.user&&data?.gold!==undefined){state.user.gold=data.gold; updateNav();}});

  state.socket.on("connect", () => {
    loadNotifications();
    // A connect event can fire before or after the login flow joins Main Room.
    // Authenticate and restore room membership first, then reconcile both live
    // channels so messages missed while offline appear without reopening a view.
    const connectedSocket=state.socket;
    authenticateSocketAndJoinRoom(connectedSocket,true).then(ok=>{
      if(!ok||connectedSocket!==state.socket||!connectedSocket.connected)return;
      syncLiveMessages().catch(error=>console.warn("Post-reconnect message sync failed:",error?.message||error));
      loadDMList().catch(error=>console.warn("Post-reconnect inbox sync failed:",error?.message||error));
      refreshTopDMUnreadBadge();
    }).catch(error=>console.warn("Socket recovery failed:",error?.message||error));
  });
  // Socket.IO can finish its first handshake before listeners are attached on slow/older clients.
  // If it is already connected here, perform the same authentication/join recovery explicitly.
  if(state.socket.connected){
    authenticateSocketAndJoinRoom(state.socket,true).catch(error=>console.warn("Initial socket recovery failed:",error?.message||error));
    syncLiveMessages();
  }
  state.socket.on("room-error",d=>{
    toast(d?.error||"Could not join room.");
    if(d?.roomId&&String(d.roomId)===String(state.currentRoom)){
      try{const access=JSON.parse(safeStorage.getItem("mc_room_join")||"null");if(String(access?.roomId)===String(d.roomId))safeStorage.removeItem("mc_room_join");}catch{}
      state.currentRoom=null;state.currentRoomRole="USER";state.messages=[];
      if($("messages"))$("messages").innerHTML="";
      const main=state.rooms.find(room=>room.isDefault)||state.rooms.find(room=>/^main room$/i.test(String(room.name||"")));
      if(main)joinRoom(main.id).catch(()=>{});
    }
  });
  state.socket.on("dm-typing",d=>{
    if(String(d?.recipientId||"")!==String(state.user?.id)||String(d?.userId||"")!==String(state.dmUserId))return;
    const status=$("dmTypingStatus");
    if(!status||!state.dmUserId)return;
    clearTimeout(state.dmTypingResetTimer);
    status.textContent=d?.typing?((typeof d.user==="string"?d.user:"Someone")+" is typing…"):"Quote a message to reply · Attach photos or files";
    if(d?.typing)state.dmTypingResetTimer=setTimeout(()=>{if(status.isConnected)status.textContent="Quote a message to reply · Attach photos or files";},3500);
  });

  state.socket.on('rooms_updated', async()=>{try{await loadRooms();renderRooms();}catch{}});
  state.socket.on("connect",()=>{loadRooms().catch(()=>{});});

  state.socket.on("presence", () => {
    // Presence changes frequently. Do not refetch the room directory on every
    // join/leave; room creation/settings changes use rooms_updated instead.
    // Re-render cached room data and fetch users only when their view is open.
    if (state.view === "rooms") renderRooms();
    const onlinePanel=$("onlinePanel");
    if(onlinePanel && !onlinePanel.classList.contains("hidden")) renderOnline(onlinePanelTab);
    if (state.view === "users") loadUsers().catch(()=>{});
  });

  state.socket.on("message", message => {
    if (String(message.roomId) === String(state.currentRoom)) {
      appendMessage(message);
      if (document.hidden && String(message.userId||"")!==String(state.user?.id)) showSiteNotification(message.displayName||message.username||"New message", String(message.text||"New room message").slice(0,180), "rooms");
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
    try{const access=JSON.parse(safeStorage.getItem("mc_room_join")||"null");if(String(access?.roomId)===String(data.roomId))safeStorage.removeItem("mc_room_join");}catch{}
    state.currentRoom=null;state.currentRoomRole="USER";
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
    if(String(data?.roomId||"")!==String(state.currentRoom||""))return;
    const indicator=$("typing");
    if(!indicator)return;
    clearTimeout(state.roomTypingResetTimer);
    indicator.textContent=data?.typing? `${esc(data.user)} is typing…`:"";
    if(data?.typing)state.roomTypingResetTimer=setTimeout(()=>{if(indicator.isConnected)indicator.textContent="";},3500);
  });

  state.socket.on("notification", data => {
    loadNotifications();
    if(document.hidden)showSiteNotification(data?.title||"Maleficent Chat",String(data?.message||data?.body||"You have a new notification").slice(0,180),"notifications");
  });
  state.socket.on("room:announcement",()=>{if(state.currentRoom)loadRoomAnnouncements(state.currentRoom)});
  state.socket.on("room:announcement-delete",()=>{if(state.currentRoom)loadRoomAnnouncements(state.currentRoom)});
  state.socket.on("kick-lock", data => {
    safeStorage.removeItem("mc_token");safeStorage.removeItem("mc_room_join");
    $("auth")?.classList.add("hidden");$("app")?.classList.add("hidden");
    showKickLock(data?.kickedUntil||data?.until,data?.reason);
    try{state.socket?.disconnect();}catch{}
  });
  state.socket.on("ban-lock", data => {
    safeStorage.removeItem("mc_token");safeStorage.removeItem("mc_room_join");
    $("auth")?.classList.add("hidden");$("app")?.classList.add("hidden");
    showBanLock(data?.reason);
    try{state.socket?.disconnect();}catch{}
  });
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

  state.socket.on("dm-updated", payload => {
    const updated=payload?.message;
    if(!updated?.id)return;
    state.dmMessages=(state.dmMessages||[]).map(message=>String(message.id)===String(updated.id)?{...message,...updated}:message);
    const peer=String(state.dmUserId||""),from=String(updated.from??""),to=String(updated.to??"");
    if(peer&&(from===peer||to===peer)){
      const list=$("dmMessages");
      if(list&&state.dmPeerUser){
        list.innerHTML=state.dmMessages.map(message=>dmMessageHTML(message,state.dmMessages,state.dmPeerUser)).join("")||'<p class="muted">No private messages yet.</p>';
        list.scrollTop=list.scrollHeight;
      }
    }
    loadDMList().catch(()=>{});
  });
  state.socket.on("dm", message => {
    refreshTopDMUnreadBadge();
    const from=String(message?.from??message?.senderId??message?.fromId??"");
    const to=String(message?.to??message?.receiverId??message?.toId??"");
    const myId=String(state.user?.id??"");
    if(document.hidden && from!==myId) showSiteNotification("New private message", String(message?.text||message?.message||"You received a private message").slice(0,180), "messages");
    const peer=state.dmPeerUser;
    const activePeerId=String(state.dmUserId??"");
    if(message && peer && activePeerId && (from===activePeerId||to===activePeerId) && (from===myId||to===myId)){
      // Append the new message in place. Reopening the conversation on every
      // socket event refetched the full user directory and conversation history.
      state.dmMessages=Array.isArray(state.dmMessages)?state.dmMessages:[];
      if(!state.dmMessages.some(item=>String(item.id)===String(message.id))){
        state.dmMessages.push(message);
        const list=$("dmMessages");
        if(list){
          const empty=list.querySelector(".muted");
          if(empty)empty.remove();
          list.insertAdjacentHTML("beforeend",dmMessageHTML(message,state.dmMessages,peer));
          list.scrollTop=list.scrollHeight;
        }
      }
      if(from!==myId) api("/api/dm/"+encodeURIComponent(from)+"/read",{method:"POST"}).catch(()=>{});
      loadDMList().catch(()=>{});
    }else{
      loadDMList().catch(()=>{});
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
  const invite=roomInviteFromHash();
  if(invite?.roomId&&state.rooms.some(room=>String(room.id)===invite.roomId))joined=await joinRoom(invite.roomId);
  // Every authenticated visit should land directly in Main Room, not the room directory.
  // Avoid renderView() here because it re-fetches the room list and briefly returns to the directory.
  state.view = "rooms";
  document.querySelectorAll(".view").forEach(view => view.classList.add("hidden"));
  $("viewRooms")?.classList.remove("hidden");
  document.querySelectorAll(".nav[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === "rooms"));
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
      state.modeManagement = data.settings?.mode_management || {};
      state.userPermissions = data.userPermissions || {};
      await start();
    }
  } catch (error) {
    // A kicked account is intentionally rejected by bootstrap with HTTP 403.
    // Show the same full-screen moderation lock used after a failed login,
    // rather than silently leaving the user at the ordinary login screen.
    if (/you have been kicked/i.test(String(error?.message||"")) && error?.kickedUntil) {
      $("auth")?.classList.add("hidden");
      $("app")?.classList.add("hidden");
      showKickLock(error.kickedUntil,error.reason||"Community rules");
    } else if (/you have been banned/i.test(String(error?.message||""))) {
      $("auth")?.classList.add("hidden");
      $("app")?.classList.add("hidden");
      showBanLock(error.reason||"Community rules");
    }
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

  const staffSpaceLabels={MOD:"Moderator Space",ADMIN:"Admin Space",SUPER_ADMIN:"Superadmin Space",COMMISSOR:"Commissor Space",INSTRUCTOR:"Instructor Space",COOWNER:"Coowner Space",OWNER:"Owner Space",DEVELOPER:"Developer Space"};
  const currentStaffRank=String(state.user?.rank||"").toUpperCase();
  const canOpenStaffSpace=Object.prototype.hasOwnProperty.call(staffSpaceLabels,currentStaffRank)||canFeature("view_staff_dashboard");
  document.querySelectorAll(".staff-only").forEach(el =>
    el.classList.toggle("hidden", !canOpenStaffSpace)
  );
  const managementLabel=$("managementSpaceNavLabel");
  if(managementLabel) managementLabel.textContent=staffSpaceLabels[currentStaffRank]||"Staff Dashboard";
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

  // Room creation is Premium+ by default; staff ranks are explicitly eligible too.
  const roomCreatorRanks=["PREMIUM","ROYAL","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"];
  const mayCreateRooms=roomCreatorRanks.includes(String(state.user?.rank||"").toUpperCase())||canFeature("create_room")||canFeature("create_rooms");
  document.querySelectorAll("#newRoom, .room-create-button").forEach(el=>el.classList.toggle("hidden",!mayCreateRooms));
  document.querySelectorAll(".coowner-only").forEach(el=>{
    if(el.id==="newRoom"||el.classList.contains("room-create-button")) el.classList.toggle("hidden",!mayCreateRooms);
  });
}

document
  .querySelectorAll(".nav[data-view]")
  .forEach(button => {
    button.onclick = async () => {
      state.view = button.dataset.view;

      // Close the mobile navigation immediately so it cannot cover the selected view
      // while profile/settings data is loading.
      $("sidebar")?.classList.remove("open");

      document
        .querySelectorAll(".nav[data-view]")
        .forEach(x =>
          x.classList.toggle(
            "active",
            x.dataset.view === state.view
          )
        );

      await renderView();

      // Defensive mobile recovery: ensure My Profile never opens as an empty black view.
      if (state.view === "profile") {
        const profileRoot = $("profile");
        if (profileRoot && !profileRoot.children.length) {
          try {
            if (state.user) loadProfile(state.user);
            else {
              const fresh = await api("/api/bootstrap");
              if (fresh?.user) {
                state.user = fresh.user;
                loadProfile(state.user);
              }
            }
          } catch (error) {
            console.error("My Profile navigation recovery failed", error);
            if (profileRoot) profileRoot.innerHTML = '<section class="card profile-load-message" style="display:block!important;padding:20px;color:#f5edf9;background:#171126"><h2>My Profile could not load</h2><p>Please refresh the page and try again. If this message remains, the browser console has the loading error.</p><button class="primary" type="button" onclick="location.reload()">Refresh profile</button></section>';
          }
        }
      }

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
    case "games":
      return renderArcade();
    case "shop":
      return loadRankShop();

    case "rules":
      return loadCommunityRules();

    case "guide":
      return loadGuide();

    case "leaderboard":
      return loadLeaderboard();

    case "saved":
      return loadSavedMessages();

    case "search":
      return loadSearchRooms();

    case "profile": {
      // Recover the account object if a stale/partial session left the profile view empty.
      if (!state.user) {
        try {
          const fresh = await api("/api/bootstrap");
          if (fresh?.user) {
            state.user = fresh.user;
            state.featurePermissions = fresh.featurePermissions || state.featurePermissions || {};
            state.userPermissions = fresh.userPermissions || state.userPermissions || {};
          }
        } catch (error) {
          console.error("Could not reload account for My Profile", error);
        }
      }
      if (!state.user) {
        const root = $("profile");
        if (root) root.innerHTML = '<section class="card profile-load-message"><h2>My Profile</h2><p>Your account details could not be loaded. Please refresh the page and try again.</p><button class="primary" type="button" onclick="location.reload()">Refresh profile</button></section>';
        return;
      }
      try {
        return loadProfile(state.user);
      } catch (error) {
        console.error("My Profile failed to render", error);
        const root = $("profile");
        if (root) root.innerHTML = '<section class="card profile-load-message"><h2>My Profile</h2><p>The profile editor hit an error while loading. Your account has not been changed. Please refresh and try again.</p><button class="primary" type="button" onclick="location.reload()">Refresh profile</button></section>';
      }
      return;
    }

    case "settings":
      return loadSettings();

    case "staffApplications":
      return loadStaffApplication();

    case "management": {
      const rank=String(state.user?.rank||"").toUpperCase();
      const labels={
        MOD:["🛡️","Moderator Space"], ADMIN:["⭐","Admin Space"],
        SUPER_ADMIN:["🌟","Superadmin Space"], COMMISSOR:["👻","Commissor Space"],
        INSTRUCTOR:["⚔️","Instructor Space"], COOWNER:["🦉","Coowner Space"],
        OWNER:["👑","Owner Space"], DEVELOPER:["🛠️","Developer Space"]
      };
      if(!Object.prototype.hasOwnProperty.call(labels,rank)){
        toast("Management Spaces are available only to staff ranks.");
        state.view="rooms";
        return loadRooms();
      }
      const [icon,label]=labels[rank];
      const title=$("managementSpaceTitle"), description=$("managementSpaceDescription"), navLabel=$("managementSpaceNavLabel");
      if(title)title.textContent=icon+" "+label;
      if(navLabel)navLabel.textContent=label;
      if(description)description.textContent="Staff Dashboard tools and rank-authorized controls, all in one place.";
      const ownerEligible=["OWNER","DEVELOPER"].includes(rank);
      $("owner")?.classList.toggle("hidden",!ownerEligible);
      await loadStaff();
      if(ownerEligible) await loadOwner();
      return;
    }
  }
}

$("mobileMenu").onclick = () => {
  $("sidebar").classList.toggle("open");
};
const chatToolsToggle=$("chatToolsToggle");
if(chatToolsToggle) chatToolsToggle.onclick=()=>$("chatToolsDrawer")?.classList.toggle("open");

// Main-room attachment controls: explicitly wire both buttons to the hidden picker.
const roomFileInput=$("file");
const roomAttachButton=$("attach");
const roomMusicButton=$("youtubeMusicComposerBtn");
const roomFileLabel=$("fileName");
if(roomAttachButton && roomFileInput && !roomAttachButton.dataset.bound){
  roomAttachButton.dataset.bound="true";
  roomAttachButton.addEventListener("click",()=>{
    roomFileInput.accept="image/*,audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac,.opus";
    roomFileInput.click();
  });
}
if(roomMusicButton && roomFileInput && !roomMusicButton.dataset.bound){
  roomMusicButton.dataset.bound="true";
  roomMusicButton.title="Choose an MP3 or audio file to send in chat";
  roomMusicButton.setAttribute("aria-label","Choose MP3 or audio file");
  roomMusicButton.addEventListener("click",()=>{
    roomFileInput.accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac,.opus";
    roomFileInput.click();
  });
}
if(roomFileInput && !roomFileInput.dataset.labelBound){
  roomFileInput.dataset.labelBound="true";
  roomFileInput.addEventListener("change",()=>{
    if(roomFileLabel)roomFileLabel.textContent=roomFileInput.files?.[0]?.name||"";
    if(roomFileInput.files?.[0] && $("chatToolsDrawer"))$("chatToolsDrawer").classList.remove("open");
  });
}

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



let wallShowingSaved=false,wallShowingFriends=false,wallShowingReels=false;
async function loadWall(){
  try {
    const endpoint=wallShowingSaved?'/api/wall/saved':(wallShowingFriends?'/api/wall/friends':'/api/wall');
    const d=await api(endpoint),feed=$('wallFeed'); if(!feed)return;
    const emojis=['👍','❤️','😂','😮','🔥','👏'];
    const allWallPosts=d.posts||[];
    const isVideoPost=p=>/\.(mp4|webm|ogg)(\\?|$)/i.test(String(p.media_url||""));
    const wallPosts=wallShowingReels?allWallPosts.filter(isVideoPost):allWallPosts;
    const storyUsers=[];
    const storySeen=new Set();
    wallPosts.forEach(p=>{const key=String(p.user_id||p.username||'');if(key&&!storySeen.has(key)){storySeen.add(key);storyUsers.push(p);}});
    const myAvatar=state.user?.avatar||state.user?.avatar_url||'';
    const storiesHtml=`<section class="shadow-stories" aria-label="Shadow Feed stories">
      <button class="shadow-story shadow-your-story" type="button" id="shadowYourStory">
        <span class="shadow-story-ring"><span class="shadow-story-avatar">${myAvatar?`<img src="${esc(myAvatar)}" alt="">`:'✦'}</span><i>＋</i></span><span>Your story</span>
      </button>
      ${storyUsers.slice(0,12).map(p=>`<button class="shadow-story" type="button" data-shadow-story="${esc(p.id)}">
        <span class="shadow-story-ring"><span class="shadow-story-avatar">${p.avatar?`<img src="${esc(p.avatar)}" alt="">`:'✦'}</span></span>
        <span>${esc(p.username||'Member')}</span>
      </button>`).join('')}
    </section>`;
    feed.innerHTML=storiesHtml+wallPosts.map(p=>{
      const rx=p.reactions&&typeof p.reactions==='object'?p.reactions:{};
      return `<article class="card wall-post social-feed-card" data-wall-id="${esc(p.id)}" data-wall-author="${esc(p.user_id)}">
        <div class="news-card-top"><div class="social-author"><div class="social-author-avatar">${p.avatar?`<img src="${esc(p.avatar)}" alt="">`:'👤'}</div><div><h3>@${esc(p.username||'Unknown')}</h3><div class="muted">${esc(p.rank||'Member')} · ${fmt(p.created_at)}</div></div></div><button class="social-more" data-wall-more="${esc(p.id)}" aria-label="Post options">•••</button></div>
        <div class="news-body wall-content">${esc(p.content||'')}${p.media_url?(String(p.media_url).match(/\.(mp4|webm|ogg)(\?|$)/i)?`<video class="wall-media ${wallShowingReels?'shadow-reel-video':''}" controls playsinline preload="metadata" src="${esc(p.media_url)}"></video>`:`<img class="wall-media" src="${esc(p.media_url)}" alt="Wall upload">`):''}</div>
        <div class="news-actions social-reaction-actions">
          <button class="mini wall-like-action ${(Array.isArray(rx['❤️'])?rx['❤️'].map(String):[]).includes(String(state.user?.id))?'reacted':''}" type="button" data-wall-reaction="❤️" data-wall-id="${esc(p.id)}">♡ Like <b class="wall-action-count">${(Array.isArray(rx['❤️'])?rx['❤️'].length:0).toLocaleString()}</b></button>
          <button class="mini wall-comment-action" type="button" data-wall-comments="${esc(p.id)}">◯ Comment <b class="wall-action-count">${Math.max(0,Number(p.comment_count)||0).toLocaleString()}</b></button>
          <button class="mini wall-share-action" type="button" data-wall-share="${esc(p.id)}">${wallShowingReels?'▶ Main Chat':'↗ Share'}</button>
          <button class="mini" type="button" data-wall-save="${esc(p.id)}">${p.saved?'▣ Saved':'▢ Save'}</button>
          <button class="mini wall-options-action" type="button" data-wall-options="${esc(p.id)}" aria-expanded="false">••• More</button>
        </div>
        <div class="social-post-options hidden" id="wallOptions-${esc(p.id)}">
          <div class="wall-extra-reactions">${emojis.filter(e=>e!=='❤️').map(e=>{const us=Array.isArray(rx[e])?rx[e].map(String):[];return `<button type="button" class="${us.includes(String(state.user?.id))?'reacted':''}" data-wall-reaction="${esc(e)}" data-wall-id="${esc(p.id)}">${e} <b>${us.length}</b></button>`}).join('')}</div>
          ${(canFeature('pin_news')||['OWNER','DEVELOPER'].includes(String(state.user?.rank||'').toUpperCase()))?`<button type="button" data-wall-feature="${esc(p.id)}" data-featured="${p.featured?'true':'false'}">${p.featured?'Unfeature':'📌 Feature post'}</button>`:''}
          ${(String(p.user_id)===String(state.user?.id)||canFeature('delete_news'))?`<button class="danger" type="button" data-wall-delete="${esc(p.id)}">🗑 Delete post</button>`:''}
          <button type="button" data-wall-report="${esc(p.id)}">⚑ Report post</button>
          ${state.user?.username==='Maleficent'? `<button type="button" data-wall-pin="${esc(p.id)}">📌 Pin post</button>`:''}
        </div>
        <div class="wall-comments hidden" id="wallComments-${esc(p.id)}"></div>
      </article>`;
    }).join('')||'<p class="muted">No wall posts yet.</p>';
    $('shadowYourStory')?.addEventListener('click',()=> $('newWallPost')?.click());
    feed.querySelectorAll('[data-shadow-story]').forEach(b=>b.addEventListener('click',()=>{const card=feed.querySelector('[data-wall-id="'+CSS.escape(b.dataset.shadowStory)+'"]');card?.scrollIntoView({behavior:'smooth',block:'start'});card?.classList.add('shadow-story-highlight');setTimeout(()=>card?.classList.remove('shadow-story-highlight'),1200);}));
    document.querySelectorAll('[data-wall-more]').forEach(b=>b.onclick=()=> $('wallOptions-'+b.dataset.wallMore)?.classList.toggle('hidden'));
    feed.querySelectorAll('[data-wall-options]').forEach(b=>b.onclick=()=>{const box=$('wallOptions-'+b.dataset.wallOptions);if(!box)return;const opening=box.classList.contains('hidden');box.classList.toggle('hidden');b.setAttribute('aria-expanded',String(opening));});
    document.querySelectorAll('[data-wall-save]').forEach(b=>b.onclick=async()=>{try{const r=await api('/api/wall/'+encodeURIComponent(b.dataset.wallSave)+'/save',{method:'POST',body:JSON.stringify({})});toast(r.saved?'Post saved.':'Post removed from saved posts.');await loadWall()}catch(e){toast(e.message||'Could not save post.')}});
    document.querySelectorAll('[data-wall-reaction]').forEach(b=>b.onclick=async()=>{try{await api('/api/wall/'+encodeURIComponent(b.dataset.wallId)+'/reaction',{method:'POST',body:JSON.stringify({emoji:b.dataset.wallReaction})});await loadWall()}catch(e){toast(e.message||'Could not send reaction.')}});
    document.querySelectorAll('[data-wall-share]').forEach(b=>b.onclick=async()=>{const id=b.dataset.wallShare;if(wallShowingReels){await sendReelToMainChat(id);return;}const url=location.origin+'/#shadow-post='+encodeURIComponent(id);const title='Shadow Feed · Maleficent Chat';try{if(navigator.share){await navigator.share({title,text:'Check out this post on Maleficent Chat',url});}else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);toast('Post link copied.');}else{const field=document.createElement('textarea');field.value=url;document.body.appendChild(field);field.select();document.execCommand('copy');field.remove();toast('Post link copied.');}}catch(e){if(e?.name!=='AbortError')toast('Could not share this post.');}});
    const wallDoubleTapTimers=new WeakMap();
    feed.querySelectorAll('.wall-media:not(video)').forEach(media=>{media.addEventListener('click',()=>{const previous=wallDoubleTapTimers.get(media);if(previous){clearTimeout(previous);wallDoubleTapTimers.delete(media);const post=media.closest('[data-wall-id]');if(post){const like=post.querySelector('[data-wall-reaction="❤️"]');if(like&&!like.classList.contains('reacted'))like.click();}}else{wallDoubleTapTimers.set(media,setTimeout(()=>wallDoubleTapTimers.delete(media),320));}});});
    document.querySelectorAll('[data-wall-feature]').forEach(b=>b.onclick=async()=>{try{const featured=b.dataset.featured!=='true';await api('/api/wall/'+encodeURIComponent(b.dataset.wallFeature)+'/feature',{method:'POST',body:JSON.stringify({featured})});toast(featured?'Post featured.':'Post unfeatured.');await loadWall()}catch(e){toast(e.message||'Could not feature post.')}});
    document.querySelectorAll('[data-wall-report]').forEach(b=>b.onclick=async()=>{try{await api('/api/wall/'+encodeURIComponent(b.dataset.wallReport)+'/report',{method:'POST',body:JSON.stringify({reason:'Reported by community member'})});toast('Wall post reported.')}catch(e){toast(e.message)}});
    document.querySelectorAll('[data-wall-delete]').forEach(b=>b.onclick=async()=>{const id=b.dataset.wallDelete;if(!confirm('Delete this Shadow Feed post?'))return;b.disabled=true;try{await api('/api/wall/'+encodeURIComponent(id),{method:'DELETE'});toast('Shadow Feed post deleted.');await loadWall()}catch(e){toast(e.message||'Could not delete Shadow Feed post.');b.disabled=false}});
    document.querySelectorAll('[data-wall-pin]').forEach(b=>b.onclick=async()=>{try{await api('/api/wall/'+encodeURIComponent(b.dataset.wallPin)+'/pin',{method:'POST'});toast('Post pinned.');await loadWall()}catch(e){toast(e.message)}});
    document.querySelectorAll('[data-wall-comments]').forEach(b=>b.onclick=async()=>{const id=b.dataset.wallComments,box=$('wallComments-'+id);if(!box)return;box.classList.toggle('hidden');if(!box.classList.contains('hidden'))try{const d=await api('/api/wall/'+encodeURIComponent(id)+'/comments');box.innerHTML=`<div class="wall-comments-header"><strong>Comments</strong><button type="button" class="wall-comments-close" aria-label="Close comments">×</button></div>`+(d.comments||[]).map(v=>{const canDelete=String(v.user_id)===String(state.user?.id)||String(feed.querySelector('[data-wall-id="'+CSS.escape(id)+'"]')?.dataset.wallAuthor||'')===String(state.user?.id);return `<div class="news-comment wall-comment-item" data-wall-comment-id="${esc(v.id)}"><div class="wall-comment-avatar">${v.avatar?`<img src="${esc(v.avatar)}" alt="">`:'👤'}</div><div class="news-comment-main"><div class="news-comment-head"><b>@${esc(v.username||'Member')}</b><small>${esc(v.rank||'Member')}</small></div><div class="news-comment-text">${esc(v.content)}</div><div class="wall-comment-meta">${fmt(v.created_at)}</div></div>${canDelete?`<button type="button" class="wall-comment-delete" data-wall-comment-delete="${esc(v.id)}" aria-label="Delete comment" title="Delete comment">⌫</button>`:''}</div>`}).join('')+`<form class="wall-comment-form news-comment-form"><input placeholder="Add a comment…" maxlength="1000" required><button class="mini">Post</button></form>`;box.querySelector('.wall-comments-close')?.addEventListener('click',()=>box.classList.add('hidden'));box.querySelectorAll('[data-wall-comment-delete]').forEach(del=>del.addEventListener('click',async()=>{if(!confirm('Delete this comment?'))return;del.disabled=true;try{await api('/api/wall/'+encodeURIComponent(id)+'/comments/'+encodeURIComponent(del.dataset.wallCommentDelete),{method:'DELETE'});await loadWall();const post=feed.querySelector('[data-wall-id="'+CSS.escape(id)+'"]');post?.querySelector('[data-wall-comments]')?.click();}catch(err){toast(err.message||'Could not delete comment.');del.disabled=false}}));box.querySelector('form').onsubmit=async e=>{e.preventDefault();const input=e.currentTarget.querySelector('input');try{await api('/api/wall/'+encodeURIComponent(id)+'/comments',{method:'POST',body:JSON.stringify({content:input.value})});await loadWall();$('wallComments-'+id)?.classList.remove('hidden')}catch(err){toast(err.message)}}}catch(e){toast(e.message)}});
  } catch(e){toast(e.message||'Could not load Shadow Feed.')}
}
async function sendReelToMainChat(postId){
  try{
    const mainRoom=(state.rooms||[]).find(r=>r.isDefault||/^main room$/i.test(String(r.name||"")));
    if(!mainRoom){toast("Main Room could not be found.");return;}
    if(String(state.currentRoom)!==String(mainRoom.id)){
      const joined=await joinRoom(mainRoom.id);
      if(!joined){toast("Could not open Main Room.");return;}
    }
    const form=new FormData();form.append("reelId",String(postId));form.append("text","🎬 Shadow Reel");
    const result=await api("/api/rooms/"+encodeURIComponent(mainRoom.id)+"/messages",{method:"POST",body:form});
    if(result.message)appendMessage(result.message);
    toast("Reel shared to Main Room! 🎬");
  }catch(error){toast(error.message||"Could not share this Reel to Main Room.");}
}
function updateWallModeButtons(){
  const saved=$('wallSavedToggle'),friends=$('wallFriendsToggle'),reels=$('wallReelsToggle');
  if(saved){saved.textContent=wallShowingSaved?'← Community feed':'🔖 Saved posts';saved.setAttribute('aria-pressed',String(wallShowingSaved));}
  if(friends){friends.textContent=wallShowingFriends?'✓ Friends activity':'💜 Friends activity';friends.setAttribute('aria-pressed',String(wallShowingFriends));}
  if(reels){reels.textContent=wallShowingReels?'✓ Reels':'🎬 Reels';reels.setAttribute('aria-pressed',String(wallShowingReels));}
}
$('wallSavedToggle')?.addEventListener('click',async()=>{wallShowingSaved=!wallShowingSaved;if(wallShowingSaved){wallShowingFriends=false;wallShowingReels=false;}updateWallModeButtons();await loadWall();});
$('wallFriendsToggle')?.addEventListener('click',async()=>{wallShowingFriends=!wallShowingFriends;if(wallShowingFriends){wallShowingSaved=false;wallShowingReels=false;}updateWallModeButtons();await loadWall();});
$('wallReelsToggle')?.addEventListener('click',async()=>{wallShowingReels=!wallShowingReels;if(wallShowingReels){wallShowingSaved=false;wallShowingFriends=false;}updateWallModeButtons();await loadWall();});
$('newWallReel')?.addEventListener('click',()=>{
  modal('<div class="new-reel-modal"><h2>🎬 Create a Shadow Reel</h2><p class="muted">Share a vertical video with the community. Your Reel will also appear in the Reels tab.</p><textarea id="wallReelCaption" maxlength="1000" placeholder="Write a caption…"></textarea><label class="stack">Choose video<input id="wallReelFile" type="file" accept="video/mp4,video/webm,video/ogg"></label><small class="muted">MP4, WebM or OGG · maximum upload size 15 MB</small><div id="wallReelPreview" class="media-preview"></div><label class="stack">Reel duration<select id="wallReelExpiry"><option value="0">Keep on Shadow Feed</option><option value="24">Disappear after 24 hours</option><option value="72">Disappear after 3 days</option><option value="168">Disappear after 7 days</option></select></label><button class="primary" id="wallReelPublish" type="button">Upload & Publish Reel</button></div>');
  $('wallReelFile')?.addEventListener('change',()=>{const file=$('wallReelFile').files?.[0],preview=$('wallReelPreview');if(!preview)return;if(!file){preview.innerHTML='';return;}if(!file.type.startsWith('video/')){preview.innerHTML='<p class="error">Choose a video file.</p>';return;}const url=URL.createObjectURL(file);preview.innerHTML='<video class="shadow-reel-video" controls playsinline src="'+esc(url)+'"></video>';});
  $('wallReelPublish')?.addEventListener('click',async buttonEvent=>{const button=$('wallReelPublish'),file=$('wallReelFile')?.files?.[0];if(!file){toast('Choose a video before publishing.');return;}if(!file.type.startsWith('video/')){toast('Choose a supported video file.');return;}if(file.size>15*1024*1024){toast('Reels must be 15 MB or smaller.');return;}button.disabled=true;button.textContent='Uploading…';try{const form=new FormData();form.append('content',$('wallReelCaption')?.value||'');form.append('expiresInHours',$('wallReelExpiry')?.value||'0');form.append('file',file);const token=safeStorage.getItem('mc_token');const response=await fetch('/api/wall/post',{method:'POST',body:form,headers:token?{'x-auth-token':token}:{},credentials:'same-origin'});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Could not publish Reel.');closeModal();wallShowingReels=true;wallShowingSaved=false;wallShowingFriends=false;updateWallModeButtons();await loadWall();toast('Your Reel is live on Shadow Feed! 🎬');}catch(error){toast(error.message||'Could not publish Reel.');button.disabled=false;button.textContent='Upload & Publish Reel';}});
});
if($('newWallPost'))$('newWallPost').onclick=async()=>{
  modal(`<h2>New Shadow Feed Post</h2><textarea id="wallPostText" maxlength="5000" placeholder="Share something with the community…"></textarea><label class="stack">Post duration<select id="wallPostExpiry"><option value="0">Keep on Shadow Feed</option><option value="1">Disappear after 1 hour</option><option value="6">Disappear after 6 hours</option><option value="24">Disappear after 24 hours</option><option value="72">Disappear after 3 days</option><option value="168">Disappear after 7 days</option></select></label><input id="wallPostFile" type="file" accept="image/*,video/*"><div id="wallPreview" class="media-preview"></div><button class="primary" id="wallPostSend">Upload & Publish</button>`);
  $('wallPostFile')?.addEventListener('change',()=>{const f=$('wallPostFile').files?.[0],box=$('wallPreview');if(!f){box.innerHTML='';return}const u=URL.createObjectURL(f);box.innerHTML=f.type.startsWith('video/')?`<video controls src="${u}"></video>`:`<img src="${u}">`;});
  $('wallPostSend').onclick=async()=>{try{const fd=new FormData();fd.append('content',$('wallPostText').value);fd.append('expiresInHours',$('wallPostExpiry')?.value||'0');const f=$('wallPostFile').files?.[0];if(f)fd.append('file',f);const token=safeStorage.getItem("mc_token"); const headers=token?{"x-auth-token":token}:{}; const r=await fetch('/api/wall/post',{method:'POST',body:fd,headers,credentials:'same-origin'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Could not publish wall post.');closeModal();loadWall()}catch(e){toast(e.message)}};
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

async function getRecentGifSearches(){
  try{
    const items=JSON.parse(safeStorage.getItem("mc_gif_recent_searches")||"[]");
    return Array.isArray(items)?items.filter(x=>typeof x==="string"&&x.trim()).slice(0,6):[];
  }catch{return [];}
}
function saveRecentGifSearch(query){
  const q=String(query||"").trim().slice(0,80);
  if(!q)return;
  const items=[q,...getRecentGifSearches().filter(x=>x.toLowerCase()!==q.toLowerCase())].slice(0,6);
  safeStorage.setItem("mc_gif_recent_searches",JSON.stringify(items));
}
async function openGifPicker(){
  const roomIdAtOpen=String(state.currentRoom||"");
  if(!roomIdAtOpen){toast("Join a room before sending a GIF.");return;}
  let searchVersion=0;
  let searchTimer=null;
  let sending=false;
  let selectedGif=null;
  let nextOffset=0;
  let hasMore=false;
  const initialCost=Number(state.gifCost||10);
  modal(`<div class="gif-picker"><h2>GIFs · 🪙 ${initialCost} gold each</h2><input id="gifSearch" placeholder="Search GIFs…" autocomplete="off" aria-label="Search GIFs"><div id="gifRecent" class="gif-recent"></div><div id="gifSelected" class="gif-selected hidden"></div><div id="gifResults" class="gif-results" aria-live="polite"><p class="muted">Loading GIFs…</p></div><div class="gif-more-wrap"><button type="button" id="gifLoadMore" class="mini hidden">Load more GIFs</button></div><p id="gifBalance" class="muted">Your balance: 🪙 ${Number(state.user?.gold||0)}</p></div>`);
  const input=$("gifSearch"), results=$("gifResults"), recentBox=$("gifRecent"), selectedBox=$("gifSelected"), moreButton=$("gifLoadMore");
  if(!input||!results||!selectedBox||!moreButton)return;
  const renderRecent=()=>{
    const items=getRecentGifSearches();
    recentBox.innerHTML=items.length?'<span class="gif-recent-label">Recent searches</span>'+items.map(q=>`<button type="button" class="gif-recent-chip" data-gif-query="${esc(q)}">${esc(q)}</button>`).join(''):"";
  };
  const clearSelection=()=>{selectedGif=null;selectedBox.innerHTML="";selectedBox.classList.add("hidden");};
  const sendSelected=async()=>{
    if(!selectedGif||sending)return;
    if(String(state.currentRoom)!==roomIdAtOpen){toast("Your room changed. Reopen the GIF picker in the room you want.");return;}
    sending=true;
    const sendButton=$("gifSendSelected");
    if(sendButton){sendButton.disabled=true;sendButton.textContent="Sending…";}
    try{
      const r=await api(`/api/rooms/${encodeURIComponent(roomIdAtOpen)}/gif`,{method:"POST",body:JSON.stringify({url:selectedGif.url})});
      if(state.user&&r.gold!==undefined){state.user.gold=r.gold;updateNav();}
      const balance=$("gifBalance");
      if(balance)balance.textContent=`Your balance: 🪙 ${Number(state.user?.gold||0)}`;
      if(r.message&&String(state.currentRoom)===String(r.message.roomId))appendMessage(r.message);
      closeModal();
      toast("GIF sent successfully.");
    }catch(e){
      sending=false;
      if(sendButton){sendButton.disabled=false;sendButton.textContent="Send GIF";}
      toast(e.message||"Could not send this GIF.");
    }
  };
  const search=async(offset=0,append=false,term=input.value.trim())=>{
    const version=++searchVersion;
    if(!append){nextOffset=0;hasMore=false;clearSelection();results.innerHTML='<p class="muted">Loading GIFs…</p>';}
    moreButton.classList.add("hidden");
    try{
      const d=await api('/api/gifs/search?q='+encodeURIComponent(term)+'&offset='+String(offset));
      if(version!==searchVersion||!$("gifResults"))return;
      state.gifCost=Number(d.cost??state.gifCost??10);
      const heading=document.querySelector(".gif-picker h2");
      if(heading)heading.textContent=`GIFs · 🪙 ${state.gifCost} gold each`;
      const gifs=Array.isArray(d.results)?d.results:[];
      const markup=gifs.map(g=>`<button type="button" class="gif-choice" data-gif-url="${esc(g.url)}" data-gif-preview="${esc(g.preview||g.url)}" data-gif-title="${esc(g.title||"GIF")}"><img src="${esc(g.preview||g.url)}" alt="" loading="lazy"><span>${esc(g.title||"GIF")}</span></button>`).join('');
      if(append)results.insertAdjacentHTML("beforeend",markup);
      else results.innerHTML=markup||'<p class="muted">No GIFs found. Try another search.</p>';
      nextOffset=Number(d.nextOffset??(offset+gifs.length));
      hasMore=!!d.hasMore;
      if(hasMore&&gifs.length)moreButton.classList.remove("hidden");
      if(term)saveRecentGifSearch(term);
      renderRecent();
    }catch(e){
      if(version!==searchVersion||!$("gifResults"))return;
      if(!append)results.innerHTML=`<p class="muted">Could not load GIFs: ${esc(e.message||"Please try again.")}</p><button type="button" id="gifRetry" class="mini">Retry</button>`;
      $("gifRetry")?.addEventListener("click",()=>search(0,false),{once:true});
    }
  };
  input.addEventListener("input",()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>search(0,false),300);
  });
  recentBox.addEventListener("click",event=>{
    const chip=event.target.closest("[data-gif-query]");
    if(!chip)return;
    input.value=chip.dataset.gifQuery||"";
    search(0,false,input.value.trim());
  });
  results.addEventListener("click",event=>{
    const button=event.target.closest("[data-gif-url]");
    if(!button||sending)return;
    selectedGif={url:button.dataset.gifUrl,preview:button.dataset.gifPreview||button.dataset.gifUrl,title:button.dataset.gifTitle||"GIF"};
    selectedBox.innerHTML=`<img src="${esc(selectedGif.preview)}" alt="" loading="lazy"><div class="gif-selected-copy"><strong>${esc(selectedGif.title)}</strong><span>Preview selected GIF before sending</span><button type="button" id="gifSendSelected" class="mini">Send GIF · 🪙 ${state.gifCost}</button></div>`;
    selectedBox.classList.remove("hidden");
    results.querySelectorAll(".gif-choice").forEach(choice=>choice.classList.toggle("selected",choice===button));
    $("gifSendSelected")?.addEventListener("click",sendSelected);
  });
  moreButton.addEventListener("click",()=>{if(!sending&&hasMore)search(nextOffset,true,input.value.trim());});
  renderRecent();
  await search();
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

async function goToMainRoomFromRoomRefresh() {
  const button = $("refreshRoomsBtn");
  if (button) button.disabled = true;
  try {
    // Refresh the room data first, then use the same join flow as a room card.
    await loadRooms();
    const mainRoom = (state.rooms || []).find(room =>
      room?.isDefault || /^main room$/i.test(String(room?.name || "").trim().replace(/^🏠\s*/, ""))
    );
    if (!mainRoom) {
      toast("Main Room could not be found. Please try again.");
      return;
    }
    const joined = await joinRoom(mainRoom.id);
    if (joined === false) return;
  } catch (error) {
    console.warn("Could not navigate to Main Room:", error?.message || error);
    toast("Could not open Main Room: " + String(error?.message || error));
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadRooms() {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let roomAccess=null;
      try{roomAccess=JSON.parse(safeStorage.getItem("mc_room_join")||"null");}catch{}
      const data = await api("/api/rooms",{headers:roomAccess?.joinToken?{"x-room-join-token":roomAccess.joinToken}:{}});
      state.rooms = sanitizeRoomList(data.rooms);
      const invite=roomInviteFromHash();
      if(invite?.roomId&&invite.inviteToken){
        try{
          const resolved=await api("/api/rooms/invites/resolve",{method:"POST",body:JSON.stringify({roomId:invite.roomId,inviteToken:invite.inviteToken})});
          if(resolved.room)state.rooms=sanitizeRoomList([...state.rooms.filter(room=>String(room.id)!==String(resolved.room.id)),resolved.room]);
        }catch(error){lastError=error;}
      }
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
  try{return new Set(JSON.parse(safeStorage.getItem("mc_my_rooms_"+(state.user?.id||"guest"))||"[]").map(String));}catch{return new Set();}
}
function rememberMyRoom(id){
  const ids=joinedRoomIds();ids.add(String(id));safeStorage.setItem("mc_my_rooms_"+(state.user?.id||"guest"),JSON.stringify([...ids]));
  safeStorage.setItem("mc_last_room_"+(state.user?.id||"guest"),String(id));
}
function renderRooms() {
  const search=(($('roomSearch')?.value)||'').trim().toLowerCase();
  const visited=joinedRoomIds();
  const allRooms=Array.isArray(state.rooms)?state.rooms:[];
  const rooms=allRooms.filter(room=>{
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
          <span class="room-title-row"><strong>${esc(room.name)}</strong>${room.public===false?'<span class="room-lock" title="Secret room">🔒 Secret</span>':''}${locked?'<span class="room-lock">🔒</span>':''}</span>
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
    return `<button type="button" class="room-quick-chip ${selected ? 'active' : ''}" data-quick-room-id="${esc(id)}" aria-current="${selected ? 'page' : 'false'}"><span>${esc(room.icon || '💬')}</span><span>${esc(room.name || 'Room')}</span>${room.public===false || room.locked || room.passwordHash ? '<span class="room-quick-lock">🔒</span>' : ''}</button>`;
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
function roomInviteFromHash(){
  try{
    const params=new URLSearchParams(String(location.hash||"").replace(/^#/,""));
    const roomId=String(params.get("room")||"").trim();
    return roomId?{roomId,inviteToken:String(params.get("invite")||"")}:null;
  }catch{return null;}
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

    const roomInvite=roomInviteFromHash();
    const access=await api(`/api/rooms/${id}/join`, {
      method: "POST",
      body: JSON.stringify({ password,inviteToken:roomInvite?.roomId===id?roomInvite.inviteToken:"" })
    });

    safeStorage.setItem('mc_room_join',JSON.stringify({roomId:String(id),joinToken:access.joinToken}));
    if(roomInvite?.roomId===id)history.replaceState(null,"",location.pathname+location.search);

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

    // Joining over HTTP can finish before socket authentication; authenticate
    // again here so the room join cannot be silently ignored during login.
    if(state.socket?.connected) authenticateSocketAndJoinRoom(state.socket,false).catch(error=>console.warn("Room socket join failed:",error?.message||error));

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
    // Reconcile against the server immediately after the room UI is ready;
    // do not rely solely on a Socket.IO event that may have raced the join.
    syncLiveMessages().catch(error=>console.warn("Post-join live sync failed:",error?.message||error));
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
    else { list=online; title="Online"; }

    if(onlineSortMode==="global-rank")list.sort((a,b)=>(rankOrder[b.rank]??-1)-(rankOrder[a.rank]??-1)||a.username.localeCompare(b.username));
    else if(onlineSortMode==="room-rank")list.sort((a,b)=>(({ROOM_ADMIN:3,ROOM_MODERATOR:2,ROOM_OWNER:4}[roomRoleByUser[String(b.id)]||"USER"]||0)-({ROOM_ADMIN:3,ROOM_MODERATOR:2,ROOM_OWNER:4}[roomRoleByUser[String(a.id)]||"USER"]||0))||a.username.localeCompare(b.username));
    else if(onlineSortMode==="recent")list.sort((a,b)=>Number(b.lastActive||0)-Number(a.lastActive||0));
    else list.sort((a,b)=>(Number(b.online)-Number(a.online))||((rankOrder[b.rank]??-1)-(rankOrder[a.rank]??-1))||a.username.localeCompare(b.username));

    const count=online.length;
    $("onlinePanelTitle").innerHTML=`${esc(title)} <span class="online-badge">${count}</span>`;
    $("onlineUsers").innerHTML=`<div class="online-status-control"><label for="myCustomStatus">My status</label><select id="myCustomStatus"><option>Available</option><option>Busy</option><option>Away</option><option>Do Not Disturb</option></select></div><div class="online-user-grid">${list.map(user=>`
      <div class="online-user ${user.online?'is-online':'is-offline'}" onclick="openQuickUserCard('${esc(user.id)}')">
        ${avatar(user)}
        <div class="online-user-copy">
          <b>${esc(user.displayName)}</b>
          <small>@${esc(user.username)} ${invisibleDot(user)} ${moderationStatusTags(user)}${user.invisible?"":" · "+(user.customStatus||(user.online?"Available":"Away"))}</small>
          <span class="room-user-rank" title="${esc(roomRoleLabel[roomRoleByUser[String(user.id)]]||user.rank||'Member')}">${roomRoleByUser[String(user.id)] ? (roomRoleIcon[roomRoleByUser[String(user.id)]]||'✨') : (rankIcon[String(user.rank||'MEMBER').toUpperCase()]||'⚡')} ${esc(roomRoleLabel[roomRoleByUser[String(user.id)]]||String(user.rank||'MEMBER').replaceAll('_',' '))}</span>
        </div>
        <span class="status ${!user.invisible&&user.online?'on':''}"></span>
      </div>
    `).join("") || `<div class="online-empty"><div>${tab==="staff"?"🛡️":tab==="friends"?"💜":"👥"}</div><b>No users here</b><span>Try another tab.</span></div>`}</div>`;
    const sortSelect=$("onlineSortMode");if(sortSelect){sortSelect.value=onlineSortMode;sortSelect.onchange=()=>{onlineSortMode=sortSelect.value;renderOnline(onlinePanelTab);};}
    const statusSelect=$("myCustomStatus");if(statusSelect){statusSelect.value=state.user?.customStatus||"Available";statusSelect.onchange=async()=>{try{const result=await api("/api/me/status",{method:"POST",body:JSON.stringify({status:statusSelect.value})});state.user.customStatus=result.status;toast("Status updated.");await renderOnline(onlinePanelTab);}catch(e){toast(e.message||"Could not update status.");}};}

    $("onlineCount").textContent=`${count} online`;
    document.querySelectorAll("#onlineTabs [data-online-tab]").forEach(b=>b.classList.toggle("active",b.dataset.onlineTab===onlinePanelTab));
  }catch{}
}

function openOnlinePanelMenu(){
  modal(`<h2>People panel</h2><p class="muted">Switch between online users, offline users, everyone, staff, room staff, recently active users and friends.</p><div class="toolbar"><button class="mini" onclick="renderOnline('online');closeModal()">Online</button><button class="mini" onclick="renderOnline('offline');closeModal()">Offline</button><button class="mini" onclick="renderOnline('all');closeModal()">All users</button><button class="mini" onclick="renderOnline('staff');closeModal()">Staff</button><button class="mini" onclick="renderOnline('recent');closeModal()">Recently active</button><button class="mini" onclick="renderOnline('friends');closeModal()">Friends</button><button class="mini" onclick="renderOnline('roomstaff');closeModal()">Room staff</button></div>`);
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

function youtubePreviewHTML(videoId, title="YouTube video") {
  const id=String(videoId||"");
  if(!/^[A-Za-z0-9_-]{11}$/.test(id)) return "";
  const label=String(title||"YouTube video").slice(0,180);
  return '<div class="youtube-message"><button class="youtube-preview" type="button" data-video-id="' + id + '" data-title="' + esc(label) + '" onclick="playYouTubeMessage(this)" aria-label="Play YouTube video: ' + esc(label) + '"><img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" loading="lazy"><span class="youtube-play-icon" aria-hidden="true">▶</span><span class="youtube-preview-label">' + esc(label) + '</span></button></div>';
}
function playYouTubeMessage(button) {
  const videoId=String(button?.dataset?.videoId||"");
  if(!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
  const wrapper=button.closest(".youtube-message");
  if(!wrapper) return;
  const frame=document.createElement("iframe");
  frame.src="https://www.youtube-nocookie.com/embed/"+videoId+"?autoplay=1&rel=0";
  frame.title=String(button.dataset.title||"YouTube video");
  frame.loading="lazy";
  frame.allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.referrerPolicy="strict-origin-when-cross-origin";
  frame.allowFullscreen=true;
  wrapper.replaceChildren(frame);
}
function messageHTML(message) {
  if(message?.breadCommand && String(message.bot||message.username)==="Bot"){
    return `<div class="message bot-welcome-message bot-bread-message" data-mid="${esc(message.id)}">
      <div class="bot-welcome-bubble" style="border-color:#ffbd59;box-shadow:0 0 16px #ff8c4244">
        <div class="bot-welcome-byline">🤖 Bot</div>
        <div class="bot-welcome-glow" style="color:#ffc66d;text-shadow:0 0 12px #ff8c42">🍞 FOR YOU</div>
        <div class="bot-welcome-username">@${esc(message.breadTargetUsername||"")}</div>
      </div>
    </div>`;
  }
  if(message?.brainCommand && String(message.bot||message.username)==="Bot"){
    return `<div class="message bot-welcome-message bot-brain-message" data-mid="${esc(message.id)}">
      <div class="bot-welcome-bubble" style="border-color:#8b5cf6;box-shadow:0 0 18px #8b5cf644">
        <div class="bot-welcome-byline">🤖 Bot</div>
        <div class="bot-welcome-glow" style="color:#c4b5fd;text-shadow:0 0 12px #8b5cf6">🧠 BRAIN POWER</div>
        <div class="bot-welcome-username">@${esc(message.brainTargetUsername||"")}</div>
      </div>
    </div>`;
  }
  if(message?.roseCommand && String(message.bot||message.username)==="Bot"){
    return `<div class="message bot-welcome-message bot-rose-message" data-mid="${esc(message.id)}">
      <div class="bot-welcome-bubble" style="border-color:#ff4fd8;box-shadow:0 0 16px #ff174444">
        <div class="bot-welcome-byline">🤖 Bot</div>
        <div class="bot-welcome-glow" style="color:#ff8adf;text-shadow:0 0 12px #ff1744">🌹 FOR YOU</div>
        <div class="bot-welcome-username">@${esc(message.roseTargetUsername||"")}</div>
      </div>
    </div>`;
  }
  if(message?.bankCommand && String(message.bot||message.username)==="Bot"){
    return `<div class="message bot-welcome-message bot-bank-message" data-mid="${esc(message.id)}">
      <div class="bot-welcome-bubble" style="border-color:#fbbf24;box-shadow:0 0 16px #fbbf2433">
        <div class="bot-welcome-byline">🤖 Bot · BANK</div>
        <div class="bot-welcome-glow" style="color:#fcd34d;text-shadow:0 0 10px #f59e0b">🏦 ACCOUNT DETAILS</div>
        <div class="bot-welcome-username">@${esc(message.bankUsername||"User")}</div>
        <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:8px;font-size:13px">
          <span>⭐ Level <b>${Math.max(1,Number(message.bankLevel)||1)}</b></span>
          <span>✨ XP <b>${Math.max(0,Number(message.bankXp)||0).toLocaleString()}</b></span>
          <span>🪙 Gold <b>${Math.max(0,Number(message.bankGold)||0).toLocaleString()}</b></span>
        </div>
      </div>
    </div>`;
  }
  if(message?.stealCommand && String(message.bot||message.username)==="Bot"){
    const outcome=String(message.stealOutcome||"");
    const color=outcome==="success"?"#5cffb0":outcome==="reverse"?"#c084fc":outcome==="bail"?"#ff7373":"#fbbf24";
    const heading=outcome==="success"?"💰 HEIST SUCCESS":outcome==="reverse"?"🔄 REVERSE LOOT":outcome==="bail"?"🚨 BAIL FEE":"🪙 EMPTY VAULT";
    return `<div class="message bot-welcome-message bot-steal-message" data-mid="${esc(message.id)}">
      <div class="bot-welcome-bubble" style="border-color:${color};box-shadow:0 0 16px ${color}33">
        <div class="bot-welcome-byline">🤖 Bot</div>
        <div class="bot-welcome-glow" style="color:${color};text-shadow:0 0 10px ${color}">${heading}</div>
        <div class="bot-welcome-username">${esc(message.text||"")}</div>
      </div>
    </div>`;
  }
  if(message?.roastCommand && String(message.bot||message.username)==="Bot"){
    return `<div class="message bot-welcome-message bot-roast-message" data-mid="${esc(message.id)}">
      <div class="bot-welcome-bubble">
        <div class="bot-welcome-byline">🤖 Bot</div>
        <div class="bot-welcome-glow" style="color:#ff7a45;text-shadow:0 0 12px #ff4fd8">BOT ROAST</div>
        <div class="bot-welcome-username">${esc(message.text||"") .replace(/\\n/g,"<br>")}</div>
      </div>
    </div>`;
  }
  if(message?.auraCommand && String(message.bot||message.username)==="Bot"){
    const score=Math.max(0,Math.min(100,Number(message.auraScore)||0));
    const color=/^#[0-9a-f]{6}$/i.test(String(message.auraColor||""))?message.auraColor:"#a855f7";
    return `<div class="message bot-welcome-message bot-aura-message" data-mid="${esc(message.id)}">
      <div class="bot-welcome-bubble" style="border-color:${color};box-shadow:0 0 18px ${color}44">
        <div class="bot-welcome-byline">🤖 Bot · AURA SCAN</div>
        <div class="bot-welcome-glow" style="color:${color};text-shadow:0 0 12px ${color}">${esc(message.auraName||"MYSTERIOUS ENERGY")}</div>
        <div class="bot-ship-track" role="img" aria-label="Aura score ${score}%"><div class="bot-ship-fill" style="width:${score}%;background:${color}"></div></div>
        <div class="bot-ship-percent" style="color:${color}">${score}% AURA</div>
        <div class="bot-welcome-username">@${esc(message.auraTargetUsername||"")} · ${esc(message.auraVibe||"")}</div>
      </div>
    </div>`;
  }
  if(message?.shipCompatibility && String(message.bot||message.username)==="Bot"){
    const percent=Math.max(0,Math.min(100,Number(message.shipCompatibilityPercent)||0));
    const names=Array.isArray(message.shipUsernames)?message.shipUsernames:[];
    return `<div class="message bot-welcome-message bot-ship-message" data-mid="${esc(message.id)}">
      <div class="bot-welcome-bubble bot-ship-bubble">
        <div class="bot-welcome-byline">🤖 Bot</div>
        <div class="bot-welcome-glow bot-ship-heading">COMPATIBILITY</div>
        <div class="bot-ship-names">${esc(names[0]||"User")} <span>♡</span> ${esc(names[1]||"")}</div>
        <div class="bot-ship-track" role="img" aria-label="Compatibility ${percent}%"><div class="bot-ship-fill" style="width:${percent}%"></div></div>
        <div class="bot-ship-percent">${percent}%</div>
      </div>
    </div>`;
  }
  if(message?.welcomeBack && String(message.bot||message.username)==="Bot"){
    return `<div class="message bot-welcome-message" data-mid="${esc(message.id)}">
      <div class="bot-welcome-bubble">
        <div class="bot-welcome-byline">🤖 Bot</div>
        <div class="bot-welcome-glow">WELCOME BACK</div>
        <div class="bot-welcome-username">${esc(message.welcomeTargetUsername||"")}</div>
      </div>
    </div>`;
  }
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
      attachment = youtubePreviewHTML(videoId,message.youtube.title||"YouTube video");
    }
  }

  if (message.attachment) {
    if(message.attachment.type==='video/youtube' && message.attachment.videoId){
      attachment=youtubePreviewHTML(message.attachment.videoId,message.attachment.name||"YouTube video");
    } else if(message.attachment.type && message.attachment.type.startsWith("video/")){
      attachment = `<video class="message-video-attachment" controls playsinline preload="metadata" src="${esc(message.attachment.url)}"></video>`;
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
            ${canFeature("report_message")?`<button class="message-menu-item" role="menuitem" onclick="reportMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">!</span><span><b>Report</b><small>Report this content</small></span></button>`:""}
            ${canFeature("react_message")?`<button class="message-menu-item" role="menuitem" onclick="toggleReactionPicker('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">☺</span><span><b>React</b><small>Add an emoji reaction</small></span></button>`:""}
            ${canFeature("save_message")?`<button class="message-menu-item" role="menuitem" onclick="saveMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">♧</span><span><b>Save</b><small>Keep in saved messages</small></span></button>`:""}
            ${message.text ? `<button class="message-menu-item" role="menuitem" onclick="copyMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">▢</span><span><b>Copy text</b><small>Copy message to clipboard</small></span></button>` : ""}
            ${
              String(message.userId) === String(state.user.id) && canFeature("edit_message")
              ? `<button class="message-menu-item" role="menuitem" onclick="editMsg('${esc(message.id)}');closeMessageMenus()"><span class="menu-icon">✎</span><span><b>Edit</b><small>Change your message</small></span></button>`
              : ""
            }
            ${
              (String(message.userId) === String(state.user?.id) && canFeature("delete_own_messages")) || canFeature("delete_message")
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

function canUsePresenceMode(mode){
  const rank=String(state.user?.rank||"").toUpperCase();
  if(rank==="DEVELOPER"||state.user?.username==="Maleficent")return true;
  const fallback={ghost:["OWNER"],dead:["INSTRUCTOR","COOWNER","OWNER"],invisible:["COMMISSOR","INSTRUCTOR","COOWNER","OWNER"]};
  const configured=state.modeManagement?.[mode];
  const allowed=Array.isArray(configured)?configured:fallback[mode]||[];
  return allowed.map(x=>String(x||"").toUpperCase()).includes(rank);
}

async function togglePresenceMode(mode){
  if(!canUsePresenceMode(mode)){toast("Your rank has not been granted this presence mode.");return;}
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
  if(!["ghost","dead","invisible"].some(canUsePresenceMode)){toast("Your rank has not been granted any presence modes.");return;}
  modal(`<div class="mode-control-panel" style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:420px;min-width:0;box-sizing:border-box;padding:14px">
    <h2 style="margin:0;font-size:18px;line-height:1.25">🕶️ Presence Modes</h2>
    <p class="muted" style="margin:0;font-size:13px;line-height:1.5;white-space:normal;overflow-wrap:anywhere">Select one mode. Read the description before applying it.</p>
    <label class="mode-control-row" style="display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:10px;width:100%;min-width:0;box-sizing:border-box;padding:10px;border:1px solid var(--border-color,#393244);border-radius:10px;white-space:normal">
      <input type="checkbox" id="modePopupHide" style="margin:3px 0 0" ${state.user?.hideMode&&!state.user?.deadMode?'checked':''} ${canUsePresenceMode("ghost")?'':'disabled title="Not granted to your rank"'}>
      <span style="display:block;min-width:0;white-space:normal;overflow-wrap:anywhere"><b style="display:block;margin-bottom:4px">👻 Ghost Mode</b><small style="display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.45">Your account is hidden from all user lists, search, profiles, and presence—including from staff. You can still chat; your messages appear as Aurora and no join announcement is sent.</small></span>
    </label>
    <label class="mode-control-row" style="display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:10px;width:100%;min-width:0;box-sizing:border-box;padding:10px;border:1px solid var(--border-color,#393244);border-radius:10px;white-space:normal">
      <input type="checkbox" id="modePopupDead" style="margin:3px 0 0" ${state.user?.deadMode?'checked':''} ${canUsePresenceMode("dead")?'':'disabled title="Not granted to your rank"'}>
      <span style="display:block;min-width:0;white-space:normal;overflow-wrap:anywhere"><b style="display:block;margin-bottom:4px">💀 Dead Mode</b><small style="display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.45">Your account stays visible in online/offline lists and profiles. Aurora announces when you join, but all messages you send appear as Aurora.</small></span>
    </label>
    <label class="mode-control-row" style="display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:10px;width:100%;min-width:0;box-sizing:border-box;padding:10px;border:1px solid var(--border-color,#393244);border-radius:10px;white-space:normal">
      <input type="checkbox" id="modePopupInvisible" style="margin:3px 0 0" ${state.user?.invisible&&!state.user?.deadMode?'checked':''} ${canUsePresenceMode("invisible")?'':'disabled title="Not granted to your rank"'}>
      <span style="display:block;min-width:0;white-space:normal;overflow-wrap:anywhere"><b style="display:block;margin-bottom:4px">😈 Invisible Mode</b><small style="display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.45">Hidden from online and offline user lists for everyone except higher-ranked staff. Your room joins are not announced; eligible staff see a green indicator.</small></span>
    </label>
    <div class="mode-control-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid var(--border-color,#393244);border-radius:10px">
      <span><b>🎉 Party Mode</b><small style="display:block;line-height:1.45;margin-top:4px">Rainbow-glowing usernames, spinning GIFs and a music player starting at 0:20. This affects your current browser only.</small></span>
      <button type="button" class="mini" id="togglePartyMode">🎉 Turn Party Mode On</button>
    </div>
    <p class="muted" id="modePopupStatus" aria-live="polite" style="font-size:12px;line-height:1.4;min-height:14px;margin:0;overflow-wrap:anywhere"></p>
    <div class="toolbar" style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="primary" id="applyModePopup">Apply mode</button><button type="button" class="mini" onclick="closeModal()">Cancel</button></div>
  </div>`);
  const hide=$("modePopupHide"),dead=$("modePopupDead"),invisible=$("modePopupInvisible"),apply=$("applyModePopup");
  const partyToggle=$("togglePartyMode");
  if(partyToggle){
    partyToggle.textContent=isPartyModeActive()?"🎉 Turn Party Mode Off":"🎉 Turn Party Mode On";
    partyToggle.addEventListener("click",()=>setPartyMode(!isPartyModeActive()));
  }
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
      state.user.hideMode=!!result.hideMode;state.user.deadMode=!!result.deadMode;state.user.invisible=!!result.invisible;
      closeModal();toast("Presence mode updated.");updateNav();await loadUsers().catch(()=>{});await renderOnline(onlinePanelTab).catch(()=>{});
    }catch(error){if(status)status.textContent=error.message||"Could not update modes.";toast(error.message||"Could not update modes.");apply.disabled=false;}
  });
}
function canUsePartyMode(){
  const rank=String(state.user?.rank||"").toUpperCase();
  return ["SUPER_ADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"].includes(rank)||state.user?.username==="Maleficent";
}
function isPartyModeActive(){return document.body.classList.contains("party-mode-active");}
function setPartyMode(enabled){
  if(enabled&&!canUsePartyMode()){toast("Party Mode is available to SUPER_ADMIN and higher ranks.");return;}
  const active=!!enabled;
  document.body.classList.toggle("party-mode-active",active);
  let player=document.getElementById("partyModePlayer");
  if(active){
    if(!player){
      player=document.createElement("iframe");
      player.id="partyModePlayer";
      player.title="Party Mode music";
      player.allow="autoplay; encrypted-media; picture-in-picture";
      player.referrerPolicy="strict-origin-when-cross-origin";
      player.src="https://www.youtube-nocookie.com/embed/HIiJ2Q5gFAE?autoplay=1&start=20&playsinline=1&controls=1&rel=0";
      player.className="party-mode-player";
      player.setAttribute("allowfullscreen","");
      player.setAttribute("tabindex","-1");
      document.body.appendChild(player);
    }
    // Keep audio playing without covering the chat/composer with a visible video.
    player.style.display="block";
  }else if(player){
    player.src="about:blank";
    player.remove();
  }
  const toggle=document.getElementById("togglePartyMode");
  if(toggle)toggle.textContent=active?"🎉 Turn Party Mode Off":"🎉 Turn Party Mode On";
}
/* ---------------- MALefICENT ARCADE ---------------- */
let arcadeGameTimer=null,arcadeInterval=null;
function renderArcade(){
  const root=$("gamesRoot");if(!root)return;
  if(arcadeGameTimer){clearTimeout(arcadeGameTimer);arcadeGameTimer=null;}if(arcadeInterval){clearInterval(arcadeInterval);arcadeInterval=null;}
  root.innerHTML=`
    <section class="arcade-home">
      <div class="arcade-welcome"><div><span class="arcade-kicker">MALEFICENT ARCADE</span><h2>Choose your next obsession.</h2><p>Quick games, friendly rivalries, and tiny victories. No drawing tools or old Gravity Run mode.</p></div><div class="arcade-orb">✦</div></div>
      <section class="arcade-studio-card"><div><span class="arcade-kicker">CREATIVE STUDIO</span><h3>🖌️ Doodle Studio</h3><p>Draw something, save it to your personal library, or share it in the current room.</p></div><button type="button" class="primary" data-open-doodle-studio>Open Doodle Studio ↗</button></section>
      <section class="arcade-library"><div class="news-card-top"><h3>Saved drawings</h3><button type="button" class="mini" data-refresh-doodle-library>Refresh</button></div><div id="doodleLibrary" class="doodle-library-list"><p class="muted">Loading your drawings…</p></div></section>
      <div class="arcade-game-grid">
        <button class="arcade-game-card" data-arcade-game="memory"><span class="arcade-card-icon arcade-violet">🧠</span><span class="arcade-card-copy"><b>Memory Match</b><small>Flip cards, find pairs, beat your best.</small><em>Solo · Focus</em></span><span class="arcade-play">Play ↗</span></button>
        <button class="arcade-game-card" data-arcade-game="tic"><span class="arcade-card-icon arcade-pink">⭕</span><span class="arcade-card-copy"><b>Tic-Tac-Toe</b><small>A classic head-to-head challenge.</small><em>2 players · Same device</em></span><span class="arcade-play">Play ↗</span></button>
        <button class="arcade-game-card" data-arcade-game="reaction"><span class="arcade-card-icon arcade-mint">⚡</span><span class="arcade-card-copy"><b>Reaction Rush</b><small>Wait for the signal, then tap fast.</small><em>Solo · Reflex</em></span><span class="arcade-play">Play ↗</span></button>
        <button class="arcade-game-card" data-arcade-game="number"><span class="arcade-card-icon arcade-gold">🔢</span><span class="arcade-card-copy"><b>Number Sprint</b><small>Solve quick puzzles before time runs out.</small><em>Solo · 30 seconds</em></span><span class="arcade-play">Play ↗</span></button>
      </div>
      <div class="arcade-footnote">✧ Your game progress stays in this session. Multiplayer matchmaking and cross-device scores aren’t enabled in this arcade yet.</div>
    </section>`;
  root.querySelectorAll("[data-arcade-game]").forEach(btn=>btn.onclick=()=>launchArcadeGame(btn.dataset.arcadeGame));
  root.querySelector("[data-open-doodle-studio]")?.addEventListener("click",()=>openDoodleComposer());
  root.querySelector("[data-refresh-doodle-library]")?.addEventListener("click",()=>loadDoodleLibrary()); 
  loadDoodleLibrary();
}
async function loadDoodleLibrary(){
  const list=$("doodleLibrary");if(!list)return;
  try{
    const data=await api("/api/doodles");
    const drawings=Array.isArray(data.doodles)?data.doodles:[];
    list.innerHTML=drawings.length?drawings.map(d=>`<article class="card doodle-library-item"><div><b>${esc(d.title||"Untitled doodle")}</b><p class="muted">${esc(fmt(d.createdAt||d.created_at))}</p></div><div class="toolbar"><button type="button" data-doodle-view="${esc(d.id)}">View</button><button type="button" data-doodle-delete="${esc(d.id)}">Delete</button></div></article>`).join(""):'<p class="muted">No saved drawings yet. Open Doodle Studio and save your first drawing.</p>';
    list.querySelectorAll("[data-doodle-view]").forEach(btn=>btn.onclick=async()=>{
      btn.disabled=true;
      try{
        const result=await api("/api/doodles/"+encodeURIComponent(btn.dataset.doodleView)+"/image");
        if(!/^data:image\/png;base64,/.test(String(result.image||"")))throw Error("Saved drawing image is invalid.");
        modal(`<div class="doodle-preview"><div class="news-card-top"><h3>${esc(result.title||"Saved doodle")}</h3><button type="button" class="mini" id="doodlePreviewClose">×</button></div><img src="${esc(result.image)}" alt="Saved doodle preview"></div>`);
        $("doodlePreviewClose")?.addEventListener("click",closeModal);
      }catch(e){toast(e.message||"Could not open drawing.");}
      finally{btn.disabled=false;}
    });
    list.querySelectorAll("[data-doodle-delete]").forEach(btn=>btn.onclick=async()=>{
      if(!confirm("Delete this saved drawing?"))return;
      btn.disabled=true;
      try{await api("/api/doodles/"+encodeURIComponent(btn.dataset.doodleDelete),{method:"DELETE"});toast("Saved drawing deleted.");await loadDoodleLibrary();}
      catch(e){toast(e.message||"Could not delete drawing.");btn.disabled=false;}
    });
  }catch(e){list.innerHTML='<p class="error">'+esc(e.message||"Could not load saved drawings.")+'</p>';}
}
function launchArcadeGame(game){
  const root=$("gamesRoot");if(!root)return;
  if(arcadeGameTimer){clearTimeout(arcadeGameTimer);arcadeGameTimer=null;}if(arcadeInterval){clearInterval(arcadeInterval);arcadeInterval=null;}
  const back='<button class="mini arcade-back" data-arcade-back>← All games</button>';
  if(game==="memory"){
    const symbols=["🌙","🦇","🕷️","🖤","🔮","🥀","🗝️","✨"];
    const cards=[...symbols,...symbols].sort(()=>Math.random()-.5).map((symbol,i)=>({symbol,id:i,open:false,matched:false}));
    let moves=0,found=0,locked=false;
    const draw=()=>{root.innerHTML='<section class="arcade-play-view">'+back+'<header class="arcade-game-heading"><span>🧠</span><div><h2>Memory Match</h2><p>Find every matching pair.</p></div><b>'+found+'/8 pairs</b></header><div class="arcade-game-stats"><span>Moves <b>'+moves+'</b></span><span>Pairs <b>'+found+'/8</b></span></div><div class="memory-board">'+cards.map(c=>'<button class="memory-card '+(c.matched?'matched':c.open?'revealed':'')+'" data-memory="'+c.id+'" '+(c.matched||c.open?'disabled':'')+' aria-label="'+(c.matched||c.open?c.symbol:'Hidden card')+'">'+(c.matched||c.open?c.symbol:'✦')+'</button>').join('')+'</div><p class="arcade-status">'+(found===8?'✨ Perfect match! You cleared the board in '+moves+' moves.':'Tap two cards to reveal their symbols.')+'</p><button class="primary" data-memory-restart>↻ Restart</button></section>';bindBack();root.querySelectorAll('[data-memory]').forEach(b=>b.onclick=()=>{if(locked)return;const c=cards.find(x=>x.id===Number(b.dataset.memory));if(!c||c.matched||c.open)return;c.open=true;const open=cards.filter(x=>x.open&&!x.matched);drawKeepMemory();if(open.length===2){moves++;locked=true;if(open[0].symbol===open[1].symbol){open.forEach(x=>{x.matched=true;x.open=false});found++;locked=false;draw()}else arcadeGameTimer=setTimeout(()=>{open.forEach(x=>x.open=false);locked=false;draw()},700)}});root.querySelector('[data-memory-restart]').onclick=()=>launchArcadeGame('memory');};
    const drawKeepMemory=()=>{cards.filter(c=>c.open&&!c.matched).forEach(c=>{const b=root.querySelector('[data-memory="'+c.id+'"]');if(b){b.classList.add('revealed');b.textContent=c.symbol;b.disabled=true;}})};
    draw();return;
  }
  if(game==="tic"){
    let board=Array(9).fill(""),turn="X",done=false;
    const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    const draw=()=>{const winner=wins.find(line=>line.every(i=>board[i]&&board[i]===board[line[0]]));done=!!winner||board.every(Boolean);root.innerHTML='<section class="arcade-play-view">'+back+'<header class="arcade-game-heading"><span>⭕</span><div><h2>Tic-Tac-Toe</h2><p>Pass the device and take turns.</p></div></header><div class="tic-status">'+(winner?'🎉 Player '+board[winner[0]]+' wins!':done?'It’s a draw!':'Player '+turn+'’s turn')+'</div><div class="tic-board">'+board.map((v,i)=>'<button class="tic-cell '+(v==='X'?'tic-x':v==='O'?'tic-o':'')+'" data-tic="'+i+'" '+(v||done?'disabled':'')+'>'+v+'</button>').join('')+'</div><button class="primary" data-tic-reset>Play again</button></section>';bindBack();root.querySelectorAll('[data-tic]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.tic);if(done||board[i])return;board[i]=turn;turn=turn==="X"?"O":"X";draw()});root.querySelector('[data-tic-reset]').onclick=()=>launchArcadeGame('tic')};
    draw();return;
  }
  if(game==="reaction"){
    let phase="ready",started=0,delay=0;
    const draw=(message)=>{root.innerHTML='<section class="arcade-play-view">'+back+'<header class="arcade-game-heading"><span>⚡</span><div><h2>Reaction Rush</h2><p>Tap only when the panel turns green.</p></div></header><button class="reaction-pad '+phase+'" id="reactionPad">'+(phase==="ready"?"Start test":phase==="wait"?"Wait for green…":phase==="go"?"TAP NOW!":phase==="early"?"Too early! Try again":message||"Your time")+'</button><p class="arcade-status" id="reactionResult">'+(phase==="result"?message:"Keep your eyes on the signal.")+'</p></section>';bindBack();const pad=$("reactionPad");if(pad)pad.onclick=()=>{if(phase==="ready"||phase==="early"||phase==="result"){phase="wait";draw();delay=900+Math.random()*2600;arcadeGameTimer=setTimeout(()=>{phase="go";started=Date.now();draw()},delay)}else if(phase==="wait"){if(arcadeGameTimer)clearTimeout(arcadeGameTimer);phase="early";draw()}else if(phase==="go"){const ms=Date.now()-started;phase="result";draw(ms+" ms — "+(ms<250?"Lightning fast!":ms<400?"Nice reflexes!":"Try to beat that time."))}}};
    draw();return;
  }
  if(game==="number"){
    let score=0,left=30,current=null,ended=false;
    const question=()=>{const a=1+Math.floor(Math.random()*20),b=1+Math.floor(Math.random()*20),op=Math.random()<.5?"+":"−";return {text:a+" "+op+" "+b,value:op==="+"?a+b:a-b,options:[]}};
    const draw=()=>{if(ended){root.innerHTML='<section class="arcade-play-view">'+back+'<header class="arcade-game-heading"><span>🔢</span><div><h2>Number Sprint</h2><p>Round complete.</p></div></header><div class="number-finish"><b>'+score+'</b><span>correct answers</span></div><button class="primary" data-number-restart>Run it back</button></section>';bindBack();root.querySelector('[data-number-restart]').onclick=()=>launchArcadeGame('number');return}
      if(!current)current=question();const opts=[current.value,current.value+1,current.value-2,current.value+3].sort(()=>Math.random()-.5);
      root.innerHTML='<section class="arcade-play-view">'+back+'<header class="arcade-game-heading"><span>🔢</span><div><h2>Number Sprint</h2><p>Answer as many as you can in 30 seconds.</p></div></header><div class="number-stats"><span>Score <b>'+score+'</b></span><span>Time <b>'+left+'s</b></span></div><div class="number-question">'+current.text+' = ?</div><div class="number-options">'+opts.map(n=>'<button data-number="'+n+'">'+n+'</button>').join('')+'</div><p class="arcade-status" id="numberStatus">Choose the correct answer.</p></section>';bindBack();root.querySelectorAll('[data-number]').forEach(b=>b.onclick=()=>{if(Number(b.dataset.number)===current.value){score++;current=null;}else{const status=$("numberStatus");if(status)status.textContent="Not quite — keep going!";return}draw()});
    };
    draw();arcadeInterval=setInterval(()=>{left--;if(left<=0){clearInterval(arcadeInterval);arcadeInterval=null;ended=true;draw()}else{const time=root.querySelector('.number-stats b:last-child');if(time)time.textContent=left+'s'}},1000);
    return;
  }
}
function bindBack(){const b=$("gamesRoot")?.querySelector("[data-arcade-back]");if(b)b.onclick=renderArcade;}
function openDoodleComposer(){
  const canSave=canFeature('doodle_studio_save'),canShare=!!state.currentRoom&&canFeature('doodle_studio_share');
  if(!canSave&&!canShare){toast('Doodle Studio is not available for your account.');return;}
  modal(`<div class="doodle-modal"><div class="doodle-head"><h2>🖌️ Doodle Studio</h2><button type="button" class="mini" id="doodleClose">×</button></div>
    <div class="doodle-tools"><label class="doodle-title-field">Title <input id="doodleTitle" type="text" maxlength="80" value="Untitled doodle" placeholder="Name your drawing"></label><button type="button" id="doodlePen">🖌️ Pen</button><button type="button" id="doodleEraser">🧽 Eraser</button><label>Color <input type="color" id="doodleColor" value="#111111"></label><label>Size <input type="range" id="doodleSize" min="2" max="24" value="5"></label><button type="button" id="doodleUndo">↶ Undo</button><button type="button" id="doodleClear">🗑 Clear</button></div>
    <canvas id="doodleCanvas" width="900" height="620" aria-label="Draw your doodle here"></canvas>
    <div class="doodle-footer"><span class="muted">Save a private copy or share it with your current room.</span>${canSave?'<button type="button" id="doodleSave">💾 Save drawing</button>':''}${canShare?'<button type="button" class="primary" id="doodleSend">➤ Send to Room</button>':''}</div></div>`);
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
  $('doodleSave')?.addEventListener('click',async()=>{const btn=$('doodleSave');btn.disabled=true;btn.textContent='Saving…';try{
    const image=canvas.toDataURL('image/png');
    const title=($('doodleTitle')?.value||'Untitled doodle').trim().slice(0,80)||'Untitled doodle';
    await api('/api/doodles',{method:'POST',body:JSON.stringify({title,image})});
    toast('Doodle saved to your personal library.');await loadDoodleLibrary();btn.textContent='✓ Saved';
  }catch(e){toast(e.message||'Could not save doodle.');btn.disabled=false;btn.textContent='💾 Save drawing';}});
  $('doodleSend')?.addEventListener('click',async()=>{const btn=$('doodleSend');btn.disabled=true;btn.textContent='Sending…';try{
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not export the doodle.')),'image/png'));
    const file=new File([blob],'maleficent-doodle.png',{type:'image/png'}),form=new FormData();form.append('text','');form.append('file',file);
    const data=await api('/api/rooms/'+encodeURIComponent(state.currentRoom)+'/messages',{method:'POST',body:form});
    if(data.message&&String(data.message.roomId)===String(state.currentRoom))appendMessage(data.message);
    closeModal();toast('Doodle sent to the room!');
  }catch(e){btn.disabled=false;btn.textContent='➤ Send to Main Chat';toast(e.message||'Could not send doodle.')}});
}
$('doodleBtn')?.addEventListener('click',openDoodleComposer);


async function openReelSharePicker(){
  try{
    const data=await api("/api/wall");
    const videos=(data.posts||[]).filter(p=>/\.(mp4|webm|ogg)(\\?|$)/i.test(String(p.media_url||"")));
    if(!videos.length){toast("No published Reels yet. Upload a video post in Shadow Feed first.");return;}
    modal('<div class="reel-picker"><h2>🎬 Share a Reel to Main Room</h2><p class="muted">Choose a video from Shadow Feed.</p><div class="reel-picker-list">'+videos.map(p=>'<button type="button" class="reel-picker-item" data-share-reel="'+esc(p.id)+'"><video muted playsinline preload="metadata" src="'+esc(p.media_url)+'"></video><span><b>@'+esc(p.username||"Member")+'</b><small>'+esc(p.content||"Shadow Reel")+'</small></span><strong>Send ↗</strong></button>').join('')+'</div></div>');
    document.querySelectorAll('[data-share-reel]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;const postId=button.dataset.shareReel;closeModal();await sendReelToMainChat(postId);}));
  }catch(error){toast(error.message||"Could not load Reels.");}
}
$('reelComposerBtn')?.addEventListener('click',openReelSharePicker);

const composer=$("composer");
if(composer && !composer.dataset.submitBound){
  composer.dataset.submitBound="true";
  composer.addEventListener("submit",async e=>{
    e.preventDefault();
    if(!state.user){toast("Your session is not ready. Please log in again.");return;}
    if(!state.currentRoom){toast("Join a room before sending a message.");return;}
    const input=$("message"),fileInput=$("file"),sendButton=composer.querySelector(".send");
    const textValue=(input?.value||"").trim(),file=fileInput?.files?.[0];
    // /clear uses the same permission-checked, evidence-preserving room clear endpoint as the room controls.
    if(/^\/clear(?:\s|$)/i.test(textValue)){
      if(file){toast("Send /clear without an attachment.");return;}
      if(input)input.value="";
      if(sendButton){sendButton.disabled=true;sendButton.textContent="Clearing…";}
      try{
        const result=await api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/clear`,{method:"POST"});
        state.messages=(state.messages||[]).filter(m=>String(m.roomId)!==String(state.currentRoom));
        if($("messages"))$("messages").innerHTML="";
        toast("Room cleared. "+Number(result.removed||0)+" messages removed.");
      }catch(error){
        toast(error.message||"Could not clear room.");
      }finally{
        if(sendButton){sendButton.disabled=false;sendButton.textContent="Send";}
        input?.focus();
      }
      return;
    }
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
      const sentRoomId=String(state.currentRoom);
      const result=await api("/api/rooms/"+encodeURIComponent(sentRoomId)+"/messages",{method:"POST",body:form});
      if(result.guide){
        const rows=(result.commands||[]).map(item=>'<div style="padding:10px 12px;border:1px solid var(--border,#342544);border-radius:10px;background:rgba(155,92,255,.07);margin:7px 0"><b style="color:#d8b4fe">'+esc(item.usage||("/"+item.name))+'</b><div style="font-size:13px;margin-top:4px">'+esc(item.description||"")+'</div></div>').join("");
        modal('<div class="guide-command-dialog"><h2>📖 Your Command Guide</h2><p class="muted">Commands available to your <b>'+esc(result.rank||state.user.rank||"MEMBER")+'</b> rank only.</p><div style="max-height:55vh;overflow:auto;padding-right:3px">'+(rows||'<p class="muted">No commands are currently available for your rank.</p>')+'</div><div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="primary" onclick="closeModal()">Close</button></div></div>');
        if(input)input.value="";
        input?.focus();
        return;
      }
      if(result.message)appendMessage(result.message);
      // Targeted refresh: reconcile only this room's message list after a successful send.
      // This never reloads the page or touches login/session state.
      try{await refreshRoomMessageList(sentRoomId,{force:true});}catch(refreshError){console.warn("Post-send room refresh failed:",refreshError?.message||refreshError);}
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
["userGenderFilter","userAgeMin","userAgeMax","userCountryFilter","userSortBy"].forEach(id=>$ (id)?.addEventListener("input",()=>loadUsers()));
["userGenderFilter","userSortBy"].forEach(id=>$ (id)?.addEventListener("change",()=>loadUsers()));
$("resetUserFilters")?.addEventListener("click",()=>{
  ["userSearch","userCountryFilter","userAgeMin","userAgeMax"].forEach(id=>{if($(id))$(id).value="";});
  ["userGenderFilter"].forEach(id=>{if($(id))$(id).value="";});
  if($("userSortBy"))$("userSortBy").value="default";
  loadUsers();
});
function invisibleDot(user){return user?.invisible?'<i class="invisible-staff-dot" title="Invisible mode active"></i>':'';}
function moderationStatusTags(user){
  const tags=[];
  const activeUntil=value=>{if(value==null||value==='')return false;const n=Number(value);const time=Number.isFinite(n)&&n>0?n:Date.parse(value);return Number.isFinite(time)&&time>Date.now();};
  if(user?.banned===true||user?.banned==='true')tags.push('<span class="user-moderation-tag is-banned" title="This user is banned" aria-label="Banned">🚫</span>');
  if(activeUntil(user?.mutedUntil))tags.push('<span class="user-moderation-tag is-muted" title="This user is muted" aria-label="Muted">✋🏼</span>');
  if(activeUntil(user?.kickedUntil))tags.push('<span class="user-moderation-tag is-kicked" title="This user is kicked until the action expires" aria-label="Kicked">🦶🏼</span>');
  return tags.length?'<span class="user-moderation-tags" aria-label="Moderation status">'+tags.join('')+'</span>':'';
}
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
        <small class="instagram-user-handle">@${esc(user.username)} ${invisibleDot(user)} ${moderationStatusTags(user)}</small>
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
      <div class="profile-stats"><span class="profile-stat">⭐ ${user.level||1}</span><span class="profile-stat">XP ${user.xp||0}</span><span class="profile-stat">❤️ ${user.profileLikes||data.profileLikes||0}</span><button class="mini profile-hamburger" id="profileMenuBtn" title="Profile actions">☰</button>${!isSelf && (String(state.user?.rank||"").toUpperCase()==="DEVELOPER" || (state.user?.username==="Maleficent" && String(state.user?.rank||"").toUpperCase()==="OWNER") || canFeature("staff_rank_assignment")) ? `<button class="mini profile-rank-btn" id="profileRankBtn">🏅 Rank</button>` : ""}</div>
      <div class="equipped-profile-frame ${frame?esc(frame.id):''}" title="${frame?esc(frame.name):'Profile avatar'}">${avatar(user,'big-avatar')}</div>
      <div class="profile-rank">${rank(user.rank)}${user.verified?' · ✓ Verified':''}${profileBadge?` <span class="equipped-profile-badge" title="${esc(profileBadge.name)}">${esc(profileBadge.icon)} ${esc(profileBadge.name)}</span>`:''}</div>
      <div class="profile-name">${esc(user.displayName)}${user._nickname?` <span class="nickname-badge">“${esc(user._nickname)}”</span>`:''}</div>
      <div class="profile-handle">@${esc(user.username)}</div>
      <div class="profile-social-stats">
        <span class="profile-social-stat"><b>🪙 ${Number(user.gold||0).toLocaleString()}</b><small>Gold</small></span>
        <span class="profile-social-stat"><b>👥 ${Number(user.friendsCount||user.friendCount||0).toLocaleString()}</b><small>Friends</small></span>
        <span class="profile-social-stat"><b>🏅 ${esc(String(user.rank||"MEMBER").replace(/_/g," "))}</b><small>Rank</small></span>
      </div>
      ${!isSelf?`<div class="profile-primary-actions"><button class="profile-social-button profile-message-button" id="profileSendPM"><span>✉</span> Send PM</button><button class="profile-social-button profile-friend-button" id="profileAddFriend"><span>＋</span> Add Friend</button></div>`:""}
    </div>
    <div class="profile-tabs">
      <button class="profile-tab active" data-tab="info">Account</button>
      <button class="profile-tab" data-tab="about">About Me</button>
      <button class="profile-tab" data-tab="friends">Friends</button>
      <button class="profile-tab" data-tab="gifts">🎁 Gifts</button>
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
      <div class="profile-actions"><button class="mini" id="profileAchievementsBtn">🏆 Achievements</button>${!isSelf&&canFeature('profile_note')?`<button class="mini" id="profileNoteBtn">📝 Add Note <span id="profileNoteDot" style="display:none">●</span></button>${canFeature('profile_note')?'<button class="mini" id="profileFeatureBlockBtn">🚫 Feature Block</button>':''}`:''}<div class="profile-action-hint">Tap ☰ above for profile actions.</div></div>`;
    else if(tab==='about') box.innerHTML=`<div class="about-card"><h3>About Me</h3><p>${esc(user.bio||'This user has not written an About Me yet.')}</p>${user.country?`<div class="profile-info-row"><b>🌍 Country</b><span>${esc(countryFlagFor(user.country))} ${esc(user.country)}</span></div>`:''}${user.pronouns?`<div class="profile-info-row"><b>Pronouns</b><span>${esc(user.pronouns)}</span></div>`:''}${user.interests?.length?`<div class="tag-list">${user.interests.map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div>`:''}${isSelf?`<button class="primary" id="editAboutBtn">✏️ Edit About Me</button>`:''}</div>`;
    else if(tab==='friends') box.innerHTML=`<div class="about-card"><h3>Friends</h3><p class="muted">Friends and social connections for @${esc(user.username)}.</p><div class="profile-info-row"><b>👥 Friends</b><span>${user.friendsCount||0}</span></div><button class="mini" id="viewFriendsBtn">Open Friends</button></div>`;
    else if(tab==='gifts'){
      box.innerHTML='<div class="about-card"><h3>🎁 Gifts</h3><p class="muted">Gold gifts received by this user.</p><div class="gift-profile-list">Loading gifts…</div></div>';
      Promise.all([api('/api/users/'+encodeURIComponent(user.id)+'/gifts'),api('/api/gifts/catalog')]).then(([giftData,catalogData])=>{
        if(!box.isConnected)return;
        if(giftData.hidden){box.innerHTML='<div class="about-card"><h3>🎁 Gifts</h3><p class="muted">This user has hidden their gifts.</p></div>';return;}
        const gifts=giftData.gifts||[],catalog=catalogData.gifts||[];
        box.innerHTML='<div class="about-card"><h3>🎁 Gifts</h3><p class="muted">Gifts received by @'+esc(user.username)+'.</p>'+
          (isSelf?'<label class="gift-visibility-toggle"><input type="checkbox" id="giftVisibilityToggle" '+(user.privacy?.showGifts===false?'':'checked')+'> Show my gifts on my public profile</label>':'')+
          (!isSelf?'<button class="primary gift-open-send" id="sendGiftFromProfile">🎁 Send a gift · Use gold</button>':'')+
          '<div class="gift-profile-list">'+(gifts.length?gifts.map(g=>'<article class="gift-profile-item"><span class="gift-profile-icon">'+esc(g.gift_icon||'🎁')+'</span><div class="gift-profile-copy"><b>'+esc(g.gift_name)+'</b><small>From @'+esc(g.sender_username||'deleted')+' · 🪙 '+Number(g.goldCost||0).toLocaleString()+'</small>'+(g.message?'<p>'+esc(g.message)+'</p>':'')+'</div></article>').join(''):'<p class="muted">No gifts yet. Send the first one! 💜</p>')+'</div></div>';
        $('giftVisibilityToggle')?.addEventListener('change',async e=>{try{await api('/api/users/me/gift-visibility',{method:'PATCH',body:JSON.stringify({showGifts:e.target.checked})});user.privacy={...(user.privacy||{}),showGifts:e.target.checked};if(state.user&&String(state.user.id)===String(user.id))state.user.privacy={...(state.user.privacy||{}),showGifts:e.target.checked};toast(e.target.checked?'Gifts are visible on your profile.':'Gifts are now hidden from your profile.');}catch(err){e.target.checked=!e.target.checked;toast(err.message)}});
        $('sendGiftFromProfile')?.addEventListener('click',()=>openGiftPicker(user,catalog));
      }).catch(e=>{if(box.isConnected)box.innerHTML='<div class="about-card"><h3>🎁 Gifts</h3><p class="muted">'+esc(e.message||'Could not load gifts.')+'</p></div>';});
    }
    else box.innerHTML=`<div class="about-card"><div class="profile-info-row"><b>📝 About</b><span>${esc(user.bio||'No About Me')}</span></div><div class="profile-info-row"><b>📜 Username history</b><span>${(user.usernameHistory||[]).length} changes</span></div><div class="profile-info-row"><b>🔗 Profile ID</b><span>${esc(user.id)}</span></div>${can('MOD')&&canAccessStaffTarget(user)?`<div class="toolbar"><button class="mini" id="profileHistoryBtn">📜 Staff action history</button><button class="mini" id="profileIpInsightsBtn">🔎 View insights</button></div><div id="profileHistoryBox"></div>`:''}<div class="profile-actions">${can('COOWNER')&&canAccessStaffTarget(user)?'<button class="mini danger" id="profileDeleteAccountBtn">🗑️ Delete account</button>':''}${!isSelf?'<button class="mini danger" id="profileReportBtn">⚑ Report user</button>':''}</div></div>`;
    if(tab==='more' && can('MOD')) $('profileHistoryBtn')?.addEventListener('click',()=>showUserActionHistory(user.id));
    if(tab==='more' && can('MOD') && !isSelf) $('profileIpInsightsBtn')?.addEventListener('click',()=>showIpInsights(user));
    if(tab==='info'&&!isSelf&&canFeature('profile_note'))api(`/api/staff/user/${encodeURIComponent(user.id)}/note`).then(n=>{if($('profileNoteDot'))$('profileNoteDot').style.display=n.hasNote?'inline-block':'none';}).catch(()=>{});
    wireProfileTabActions();
  };
  function openGiftPicker(target,catalog){
    if(!Array.isArray(catalog)||!catalog.length){toast('No gifts are available right now.');return;}
    modal('<div class="gift-picker"><h2>🎁 Send a gift</h2><p class="muted">Choose a gift for @'+esc(target.username)+'. Your gold balance: 🪙 '+Number(state.user?.gold||0).toLocaleString()+'</p><div class="gift-picker-grid">'+catalog.map(g=>'<button type="button" class="gift-choice" data-gift-id="'+esc(g.id)+'"><span>'+esc(g.icon||'🎁')+'</span><b>'+esc(g.name)+'</b><small>🪙 '+Number(g.price||0).toLocaleString()+'</small></button>').join('')+'</div><label for="giftMessage">Add a note (optional)</label><textarea id="giftMessage" maxlength="180" rows="2" placeholder="A little something for you…"></textarea><div class="toolbar"><button class="primary" id="giftSendConfirm" disabled>Send gift</button><button class="mini" id="giftSendCancel">Cancel</button></div><p id="giftPickerStatus" class="muted"></p></div>');
    let selected=null;
    document.querySelectorAll('.gift-choice').forEach(btn=>btn.addEventListener('click',()=>{selected=btn.dataset.giftId;document.querySelectorAll('.gift-choice').forEach(x=>x.classList.toggle('selected',x===btn));$('giftSendConfirm').disabled=false;}));
    $('giftSendCancel').onclick=closeModal;
    $('giftSendConfirm').onclick=async()=>{
      if(!selected)return;
      const btn=$('giftSendConfirm');btn.disabled=true;btn.textContent='Sending…';
      try{const result=await api('/api/users/'+encodeURIComponent(target.id)+'/gifts',{method:'POST',body:JSON.stringify({giftId:selected,message:$('giftMessage')?.value||''})});state.user.gold=result.gold;updateNav();closeModal();toast('Gift sent! 🎁');}
      catch(e){$('giftPickerStatus').textContent=e.message||'Could not send gift.';btn.disabled=false;btn.textContent='Send gift';}
    };
  }
  function wireProfileTabActions(){
    $('profileDeleteAccountBtn')?.addEventListener('click',async()=>{
      const expected=String(user.username||'');
      const entered=prompt('Permanently delete @'+expected+'? This cannot be undone. Type the exact username to confirm:');
      if(entered===null)return;
      if(entered.trim()!==expected){toast('Username confirmation did not match.');return;}
      try{
        await api('/api/staff/users/'+encodeURIComponent(user.id),{method:'DELETE',body:JSON.stringify({confirmUsername:entered.trim()})});
        closeModal();
        toast('Account @'+expected+' deleted.');
      }catch(e){toast(e.message||'Could not delete this account.');}
    });
    $('profileAchievementsBtn')?.addEventListener('click',()=>showAchievements(user));
    $('profileNoteBtn')?.addEventListener('click',()=>staffProfileNoteModal(user));
    $('profileFeatureBlockBtn')?.addEventListener('click',()=>staffFeatureBlockModal(user));
    $('selfAchievementsBtn')?.addEventListener('click',()=>showAchievements(user));
    $('profileLikeBtn')?.addEventListener('click',async()=>{try{const r=await api(`/api/users/${user.id}/like`,{method:'POST'});data.likedByMe=r.liked;user.profileLikes=r.likes;$('profileLikeBtn').innerHTML=`${r.liked?'❤️ Unlike':'❤️ Like'} <span id="likeCount">${r.likes}</span>`;document.querySelector('.profile-stats .profile-stat:last-child').textContent=`❤️ ${r.likes}`;}catch(e){toast(e.message)}});
    $('profileMessageBtn')?.addEventListener('click',()=>{closeModal();openDM(user.id);});
    $('profileFriendBtn')?.addEventListener('click',async()=>{if(data.friendship==='ACCEPTED'){toast('Already friends.');return;}try{await friend(user.id);data.friendship='PENDING';renderTab('info');}catch(e){}});
    $('profileBlockBtn')?.addEventListener('click',async()=>{await block(user.id);closeModal();});
    $('profileGoldBtn')?.addEventListener('click',()=>shareGoldModal(user));
    $('profileNicknameBtn')?.addEventListener('click',()=>nicknameModal(user));
    $('profileModerateBtn')?.addEventListener('click',()=>moderate(user.id));
    $('profileStaffAccountBtn')?.addEventListener('click',()=>staffAccountModal(user));
    $('profileSendPM')?.addEventListener('click',()=>{closeModal();openDM(user.id);});
    $('profileAddFriend')?.addEventListener('click',async()=>{try{await friend(user.id);toast('Friend request sent.');}catch(e){toast(e.message)}});
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
  const deleteAction=String(message.from)===String(state.user?.id)&&!message.deleted
    ? '<button type="button" class="mini danger" data-dm-delete="'+esc(message.id)+'">🗑 Delete</button>'
    : "";
  const quoted = message.replyTo
    ? messages.find(m => String(m.id) === String(message.replyTo))
    : null;

  const quoteAuthor = quoted
    ? (quoted.from === state.user.id ? "You" : user.displayName)
    : null;

  const quoteText = quoted
    ? (quoted.deleted ? "Deleted message" : (quoted.text || (quoted.attachment ? "📎 Attachment" : "Message")))
    : null;

  return `
    <div
      class="msg dm-msg ${String(message.from) === String(state.user.id) ? "mine" : "theirs"}"
      data-dmid="${esc(message.id)}"
    >
      <div class="msg-body">
        <div class="msg-top">
          <b class="message-author" style="color:${esc(user.settings?.usernameColor||'var(--username-color)')}">${String(message.from) === String(state.user.id) ? "You" : esc(user.displayName)}</b>
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
          !message.deleted && message.text && !message.youtube?.videoId
            ? `<div class="msg-text">${esc(message.text)}</div>`
            : ""
        }

        ${message.deleted ? '<div class="msg-text muted">This message was deleted.</div>' : ""}

        ${
          !message.deleted && message.attachment
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
          ${deleteAction}
        </div>
      </div>
    </div>
  `;
}

async function openDM(id) {
  try {
    let user;
    if(String(id)==="system-bot"){
      user={id:"system-bot",username:"System",displayName:"System Bot",rank:"BOT",online:false,settings:{},avatar:null};
    }else{
      const users = await api("/api/users");
      user = (users.users || []).find(x => String(x.id) === String(id));
    }
    if (!user) {
      toast("User not found.");
      return;
    }

    state.dmUserId = String(id);
    state.dmPeerUser = user;

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
    $('dmMessages')?.addEventListener("click",async event=>{
      const button=event.target?.closest?.("[data-dm-delete]");
      if(!button)return;
      const messageId=String(button.dataset.dmDelete||"");
      const message=(state.dmMessages||[]).find(item=>String(item.id)===messageId);
      if(!message||message.deleted||String(message.from)!==String(state.user?.id))return;
      if(!confirm("Delete this private message for both participants? This cannot be undone."))return;
      button.disabled=true;
      try{
        const result=await api("/api/dm/messages/"+encodeURIComponent(messageId),{method:"DELETE"});
        const updated=result.message||{...message,text:"",attachment:null,deleted:true,deletedAt:Date.now()};
        state.dmMessages=(state.dmMessages||[]).map(item=>String(item.id)===messageId?{...item,...updated}:item);
        const list=$("dmMessages");
        if(list&&state.dmPeerUser){list.innerHTML=state.dmMessages.map(item=>dmMessageHTML(item,state.dmMessages,state.dmPeerUser)).join("");list.scrollTop=list.scrollHeight;}
        toast("Private message deleted.");
        loadDMList().catch(()=>{});
      }catch(error){toast(error.message||"Could not delete the message.");button.disabled=false;}
    });
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
    // The conversation DOM now exists. Fetch again now so a message that arrived
    // while the contact list/modal was loading appears without reopening the DM.
    syncLiveMessages().catch(error=>console.warn("Post-open private-message sync failed:",error?.message||error));
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
      // Refresh badges/inbox only after the server confirms read receipts.
      refreshTopDMUnreadBadge().catch(()=>{});
      loadDMList().catch(()=>{});
    } catch (error) {
      console.warn("Could not mark opened conversation as read:",error?.message||error);
    }

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
        const sent = await api(`/api/dm/${encodeURIComponent(id)}`, {method:"POST",body:fd});
        // Reconcile only this private conversation after a successful send.
        // The refresh updates the open message list, not the website or modal.
        // Render the acknowledged message immediately instead of reloading users,
        // conversation history and nicknames after every send.
        if(sent.message){
          state.dmMessages=Array.isArray(state.dmMessages)?state.dmMessages:[];
          if(!state.dmMessages.some(item=>String(item.id)===String(sent.message.id))){
            state.dmMessages.push(sent.message);
            const list=$("dmMessages");
            if(list){list.querySelector(".muted")?.remove();list.insertAdjacentHTML("beforeend",dmMessageHTML(sent.message,state.dmMessages,state.dmPeerUser||user));list.scrollTop=list.scrollHeight;}
          }
        }
        input.value=""; safeStorage.removeItem(draftKey); if(state.socket?.connected)state.socket.emit("dm-typing",{userId:id,user:state.user?.displayName||state.user?.username,typing:false}); if($("dmFile")) $("dmFile").value=""; if($("dmFileName")) $("dmFileName").textContent="";
        state.dmReplyTo=null; state.dmReplyUser=null; state.dmReplyAuthor=null; state.dmReplyText=null;
        const count=$("dmSearchCount");if(count)count.textContent=(state.dmMessages||[]).length+" messages";
        // A final targeted reconciliation catches any message state omitted from the send response.
        refreshActiveDMMessageList(String(id)).catch(refreshError=>console.warn("Post-send private-message refresh failed:",refreshError?.message||refreshError));
        loadDMList().catch(()=>{});
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
    String(message.from) === String(state.user.id)
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

async function staffFeatureBlockModal(user){
  try{
    const data=await api('/api/staff/user/'+encodeURIComponent(user.id)+'/feature-blocks');
    const features=data.features||[],blocked=data.blocked||{};
    const categories=[...new Set(features.map(f=>f.category||'Other'))];
    const featureRows=categories.map(category=>{
      const rows=features.filter(f=>(f.category||'Other')===category);
      return '<section class="feature-block-category"><h3>'+esc(category)+'</h3>'+rows.map(f=>'<label class="feature-block-row"><span><b>'+esc(f.name)+'</b><small>'+(blocked[f.key]?'Blocked for this user':'Available to this user')+'</small></span><input class="feature-block-toggle" type="checkbox" data-feature="'+esc(f.key)+'" '+(blocked[f.key]?'checked':'')+'><i></i></label>').join('')+'</section>';
    }).join('');
    modal('<div class="staff-feature-block-modal"><h2>🚫 Feature Block</h2><p class="muted">Choose which site features @'+esc(user.username)+' can use. Turning a feature off blocks its supported server actions for this account; other users are not affected.</p><div class="feature-block-list">'+featureRows+'</div><div class="toolbar"><button class="primary" id="saveFeatureBlocks">Save changes</button><button class="mini" type="button" onclick="closeModal()">Cancel</button></div></div>');
    $('saveFeatureBlocks').onclick=async()=>{
      const next={};
      document.querySelectorAll('.feature-block-toggle').forEach(el=>{if(el.checked)next[el.dataset.feature]=true;});
      const btn=$('saveFeatureBlocks');if(btn){btn.disabled=true;btn.textContent='Saving…';}
      try{
        await api('/api/staff/user/'+encodeURIComponent(user.id)+'/feature-blocks',{method:'PUT',body:JSON.stringify({blocked:next})});
        closeModal();toast('Feature blocks saved for @'+user.username+'.');
      }catch(e){if(btn){btn.disabled=false;btn.textContent='Save changes';}toast(e.message);}
    };
    document.querySelectorAll('.feature-block-toggle').forEach(el=>el.addEventListener('change',()=>{
      const label=el.closest('.feature-block-row')?.querySelector('small');
      if(label)label.textContent=el.checked?'Blocked for this user':'Available to this user';
    }));
  }catch(e){toast(e.message);}
}

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
  const isOwner=String(state.user?.rank||"").toUpperCase()==="DEVELOPER" || (state.user?.username==="Maleficent" && String(state.user?.rank||"").toUpperCase()==="OWNER");
  const actorIsDeveloper=String(state.user?.rank||"").toUpperCase()==="DEVELOPER"||String(state.user?.username||"").toLowerCase()==="maleficent";
  const targetIsDeveloper=String(user.rank||"").toUpperCase()==="DEVELOPER"||String(user.username||"").toLowerCase()==="maleficent";
  const canActOnTarget=!targetIsDeveloper||actorIsDeveloper;
  const canStaffModification=canActOnTarget&&canFeature("account_modifications")&&canAccessStaffTarget(user);
  const canShareWallet=canActOnTarget&&canFeature("share_gold")&&canAccessStaffTarget(user);
  const roomRole=String(state.currentRoomRole||"USER").toUpperCase();
  const targetIsStaff=(rankOrder[String(user.rank||"MEMBER").toUpperCase()]??-1)>=(rankOrder.MOD??4)||String(user.username||"").toLowerCase()==="maleficent";
  const hierarchyAllowsRoomActions=canActOnTarget&&(!targetIsStaff||canAccessStaffTarget(user));
  const canGiveRank=hierarchyAllowsRoomActions&&(isOwner||canFeature("staff_rank_assignment"));
  const canRoomRank=hierarchyAllowsRoomActions&&(canFeature("room_rank_assign")||["ROOM_OWNER","ROOM_ADMIN"].includes(roomRole));
  const canRoomModerate=hierarchyAllowsRoomActions&&(canFeature("room_moderate")||["ROOM_OWNER","ROOM_ADMIN","ROOM_MODERATOR"].includes(roomRole));
  const canModerate=canActOnTarget&&(canFeature("moderate_user")||canFeature("moderate_users"))&&canAccessStaffTarget(user);
  const canStaffAccount=canActOnTarget&&canFeature("manage_staff_accounts")&&canAccessStaffTarget(user);
  const canHistory=canActOnTarget&&canFeature("view_user_history")&&canAccessStaffTarget(user);
  modal(`<div class="profile-drawer quick-action-menu"><h2>Actions · @${esc(user.username||'user')}</h2>
     <button class="quick-user-row" id="drawerPM"><span>💬</span><b>Private message</b><i>›</i></button>
     <button class="quick-user-row" id="drawerLikeProfile"><span>❤️</span><b>Like profile</b><i>›</i></button>
     <button class="quick-user-row" id="drawerAddFriend"><span>👥</span><b>Add friend</b><i>›</i></button>
     <button class="quick-user-row" id="drawerBlock"><span>🚫</span><b>Block</b><i>›</i></button>
     ${canStaffModification?'<button class="quick-user-row" id="drawerStaffModification"><span>🛠️</span><b>Staff modification</b><i>›</i></button>':''}
     ${canShareWallet?'<button class="quick-user-row" id="drawerWallet"><span>🪙</span><b>Share wallet</b><i>›</i></button>':''}
     ${canGiveRank?'<button class="quick-user-row" id="drawerGiveRank"><span>🏅</span><b>Give rank</b><i>›</i></button>':''}
     ${canRoomRank?'<button class="quick-user-row" id="drawerRoomRank"><span>✨</span><b>Room rank</b><i>›</i></button>':''}
     ${canRoomModerate?'<button class="quick-user-row" id="drawerRoomModerate"><span>🛡️</span><b>Room moderation</b><i>›</i></button>':''}
     ${canModerate?'<button class="quick-user-row" id="drawerModerateUser"><span>🛡️</span><b>Moderate user</b><i>›</i></button>':''}
     ${canStaffAccount?'<button class="quick-user-row" id="drawerStaffAccount"><span>⚙️</span><b>Staff account</b><i>›</i></button>':''}
     ${canHistory?'<button class="quick-user-row" id="drawerUserHistory"><span>📜</span><b>User history</b><i>›</i></button>':''}
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

function countryFlagFor(country){
  const key=String(country||'').trim().toLowerCase();
  const flags={'india':'🇮🇳','united states':'🇺🇸','united states of america':'🇺🇸','usa':'🇺🇸','uk':'🇬🇧','united kingdom':'🇬🇧','canada':'🇨🇦','australia':'🇦🇺','new zealand':'🇳🇿','pakistan':'🇵🇰','bangladesh':'🇧🇩','nepal':'🇳🇵','sri lanka':'🇱🇰','uae':'🇦🇪','united arab emirates':'🇦🇪','saudi arabia':'🇸🇦','singapore':'🇸🇬','malaysia':'🇲🇾','indonesia':'🇮🇩','philippines':'🇵🇭','japan':'🇯🇵','south korea':'🇰🇷','china':'🇨🇳','russia':'🇷🇺','ukraine':'🇺🇦','germany':'🇩🇪','france':'🇫🇷','italy':'🇮🇹','spain':'🇪🇸','portugal':'🇵🇹','brazil':'🇧🇷','mexico':'🇲🇽','south africa':'🇿🇦','nigeria':'🇳🇬','egypt':'🇪🇬','turkey':'🇹🇷','ireland':'🇮🇪','netherlands':'🇳🇱','switzerland':'🇨🇭','sweden':'🇸🇪','norway':'🇳🇴','denmark':'🇩🇰','poland':'🇵🇱','argentina':'🇦🇷','thailand':'🇹🇭','vietnam':'🇻🇳'};
  return flags[key]||'🌐';
}
async function loadProfile(user){
  if(!user) return;
  const cosmetics=Array.isArray(user.equippedCosmetics)?user.equippedCosmetics:[];
  const frame=cosmetics.find(x=>x.category==='frame');
  const profileTheme=cosmetics.find(x=>x.category==='theme');
  const profileBadge=cosmetics.find(x=>x.category==='badge');
  const banner=user.banner?`style="background-image:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.72)),url('${esc(user.banner)}')"`:'';
  $('profile').innerHTML=`<div class="my-profile-wrap"><div class="profile-settings-card ${profileTheme?esc(profileTheme.id):''} profile-theme-${['obsidian','midnight','rose','emerald'].includes(user.theme)?esc(user.theme):'obsidian'}">
    <div class="profile-settings-head" ${banner}>
      <div class="profile-settings-top"><span>⭐ ${user.level||1}</span><span>❤️ ${user.profileLikes||0}</span><button class="mini" onclick="uploadAvatar()">📷</button><button class="mini" onclick="editProfileInfo()" title="Edit profile">✏️</button><button class="mini" id="myProfileMenuBtn" title="More">☰</button></div>
      ${avatar(user,'big-avatar')}
      <div class="profile-rank">${rank(user.rank)}${user.verified?' · ✓ Verified':''}</div>
      <div class="profile-name" style="color:${esc(user.profileColor||user.settings?.usernameColor||'')}" >${esc(user.displayName)}</div><div class="profile-handle">@${esc(user.username)}${user.privacy?.pronouns!==false&&user.pronouns?` · ${esc(user.pronouns)}`:''}</div><div class="profile-extra">${user.privacy?.country!==false&&user.country?`<span class="profile-country">${esc(countryFlagFor(user.country))} ${esc(user.country)}</span>`:''}${user.privacy?.mood!==false&&user.mood?`<span>☻ ${esc(user.mood)}</span>`:''}${user.privacy?.relationship!==false&&user.relationship?`<span>♥ ${esc(user.relationship)}</span>`:''}${user.privacy?.location!==false&&user.location?`<span>📍 ${esc(user.location)}</span>`:''}${user.privacy?.website!==false&&user.website?`<span>🔗 <a href="${esc(safeProfileUrl(user.website))}" target="_blank" rel="noopener noreferrer">Website</a></span>`:''}</div>
      <div class="profile-media-actions"><button class="mini profile-media-action" type="button" onclick="uploadAvatar()" title="Add or change profile picture" aria-label="Add or change profile picture">📷 Profile picture</button><button class="mini profile-media-action" type="button" onclick="uploadBanner()" title="Add or change profile banner" aria-label="Add or change profile banner">🖼️ Profile banner</button></div>
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
      <button class="settings-row" onclick="privacyModal()"><span>🔒</span><b>Privacy Control</b><small>Choose which profile details other members can see</small><strong>›</strong></button>
      <button class="settings-row" onclick="uploadAvatar()"><span>🖼️</span><b>Edit photos</b><small>Profile photo and banner</small><strong>›</strong></button>
      <button class="settings-row" onclick="editProfileStyle()"><span>✨</span><b>Profile styles</b><small>Change profile colors and background — preview before saving</small><strong>›</strong></button>
      <button class="settings-row" onclick="usernameHistory()"><span>📜</span><b>Username history</b><small>${(user.usernameHistory||[]).length} recorded changes</small><strong>›</strong></button>
      <button class="settings-row danger-row" onclick="deleteAccount()"><span>⊘</span><b>Delete account</b><small>This action is permanent</small><strong>›</strong></button>
    </div>`;}
  };
  document.querySelectorAll('.settings-tab').forEach(b=>b.addEventListener('click',()=>render(b.dataset.st))); $('myProfileMenuBtn')?.addEventListener('click',()=>openProfileActionDrawer(state.user,{})); render('account');
}

async function saveMyProfile(fields,message){try{const r=await api('/api/profile',{method:'PUT',body:JSON.stringify(fields)});state.user=r.user;closeModal();updateNav();await loadProfile(state.user);toast(message||'Saved.');}catch(e){toast(e.message)}}
function editProfileInfo(){const u=state.user||{};modal(`<h2>Edit info</h2><input id="piName" value="${esc(u.displayName||'')}" placeholder="Display name"><input id="piPronouns" value="${esc(u.pronouns||'')}" placeholder="Pronouns"><input id="piCountry" maxlength="80" value="${esc(u.country||'')}" placeholder="Country (e.g. India)"><input id="piLocation" value="${esc(u.location||'')}" placeholder="City / location"><input id="piWebsite" value="${esc(u.website||'')}" placeholder="Website URL"><input id="piInterests" value="${esc((u.interests||[]).join(', '))}" placeholder="Interests, separated by commas"><button class="primary" id="savePI">Save</button>`);$('savePI').onclick=()=>saveMyProfile({displayName:$('piName').value.trim(),pronouns:$('piPronouns').value.trim(),country:$('piCountry').value.trim(),location:$('piLocation').value.trim(),website:$('piWebsite').value.trim(),interests:$('piInterests').value.split(',').map(x=>x.trim()).filter(Boolean)},'Info saved.');}
function editRelationship(){modal(`<h2>Edit relationship</h2><select id="rel"><option value="">Not set</option><option>Single</option><option>In a relationship</option><option>Complicated</option><option>Prefer not to say</option></select><button class="primary" id="saveRel">Save</button>`);$('rel').value=state.user.relationship||'';$('saveRel').onclick=()=>saveMyProfile({relationship:$('rel').value},'Relationship saved.');}
function editUsername(){modal(`<h2>Edit username</h2><input id="newUsername" maxlength="24" value="${esc(state.user.username)}"><p class="muted">3–24 letters, numbers and underscores.</p><button class="primary" id="saveUsername">Save</button>`);$('saveUsername').onclick=()=>saveMyProfile({username:$('newUsername').value.trim()},'Username saved.');}
function editAboutMe(){modal(`<h2>Edit about me</h2><textarea id="aboutMeEdit" rows="7" maxlength="500">${esc(state.user.bio||'')}</textarea><button class="primary" id="saveAboutMe">Save</button>`);$('saveAboutMe').onclick=()=>saveMyProfile({bio:$('aboutMeEdit').value},'About Me saved.');}
function editMood(){modal(`<h2>Edit mood</h2><input id="moodEdit" maxlength="120" value="${esc(state.user.mood||'')}" placeholder="How are you feeling?"><button class="primary" id="saveMood">Save</button>`);$('saveMood').onclick=()=>saveMyProfile({mood:$('moodEdit').value.trim()},'Mood saved.');}
function editProfileStyle(){
  const u=state.user||{};
  const themes={
    obsidian:{bg:'#171126',panel:'#0b0912',accent:'#b69aff',text:'#f6f0ff'},
    midnight:{bg:'#101b2b',panel:'#080f1a',accent:'#63d8ff',text:'#eaf7ff'},
    rose:{bg:'#351725',panel:'#1c0c16',accent:'#ff8eb7',text:'#fff0f6'},
    emerald:{bg:'#123128',panel:'#081d17',accent:'#73efbb',text:'#eafff5'}
  };
  modal(`<h2>✨ Profile styles</h2>
    <p class="muted">Choose a style and see the preview update before saving. This changes the appearance of your profile card.</p>
    <div id="profileStylePreview" style="border:1px solid #7d58aa;border-radius:16px;overflow:hidden;margin:12px 0 16px;background:#171126;color:#f6f0ff">
      <div id="profileStyleBannerPreview" style="height:74px;background:linear-gradient(135deg,#38245c,#120d20);"></div>
      <div style="padding:0 14px 16px;text-align:center">
        <div id="profileStyleAvatarPreview" style="width:64px;height:64px;margin:-32px auto 8px;border:3px solid #171126;border-radius:50%;background:#34224b;display:flex;align-items:center;justify-content:center;font-size:28px;position:relative">🖤</div>
        <div id="profileStyleNamePreview" style="font-size:18px;font-weight:800;color:#b69aff">${esc(u.displayName||u.username||'Your profile')}</div>
        <div style="opacity:.8;font-size:12px">@${esc(u.username||'username')} · ${esc(u.rank||'MEMBER')}</div>
        <div id="profileStyleBadgePreview" style="display:inline-block;margin-top:8px;padding:4px 10px;border-radius:999px;background:#302044;color:#b69aff;font-size:12px">${esc(u.badge||'Profile badge')}</div>
      </div>
    </div>
    <label>Profile theme<select id="profileThemeEdit"><option value="obsidian">Obsidian</option><option value="midnight">Midnight Cyber</option><option value="rose">Rose</option><option value="emerald">Emerald</option></select></label>
    <label>Display name color<input id="profileColorEdit" type="color" value="${/^#[0-9a-f]{6}$/i.test(u.profileColor||'')?u.profileColor:'#b69aff'}"></label>
    <label>Profile badge text<input id="profileBadgeEdit" maxlength="32" value="${esc(u.badge||'')}" placeholder="e.g. Artist, Gamer"></label>
    <label>Profile banner image URL<input id="profileBannerEdit" maxlength="500" value="${esc(u.banner||'')}" placeholder="https://… (optional)"></label>
    <div class="toolbar"><button class="mini" type="button" id="previewProfileStyle">Preview profile</button><button class="primary" id="saveProfileStyle">Save appearance</button></div>`);
  const themeInput=$('profileThemeEdit'), colorInput=$('profileColorEdit'), badgeInput=$('profileBadgeEdit'), bannerInput=$('profileBannerEdit');
  themeInput.value=themes[u.theme]?u.theme:'obsidian';
  const preview=()=>{const t=themes[themeInput.value]||themes.obsidian;const card=$('profileStylePreview');card.style.background=t.bg;card.style.color=t.text;card.style.borderColor=t.accent;$('profileStyleBannerPreview').style.background=bannerInput.value.trim()? `linear-gradient(180deg,rgba(0,0,0,.1),rgba(0,0,0,.5)),url("${bannerInput.value.trim().replace(/["\\\\]/g,'')}") center/cover`:`linear-gradient(135deg,${t.accent},${t.panel})`;$('profileStyleAvatarPreview').style.borderColor=t.bg;$('profileStyleNamePreview').style.color=colorInput.value;$('profileStyleBadgePreview').style.color=t.accent;$('profileStyleBadgePreview').style.background=t.panel;$('profileStyleBadgePreview').textContent=badgeInput.value.trim()||'Profile badge';};
  [themeInput,colorInput,badgeInput,bannerInput].forEach(el=>el.addEventListener('input',preview));
  preview();
  $('previewProfileStyle').onclick=()=>{
    const card=$('profileStylePreview');
    const previewHtml=card.outerHTML;
    modal('<h2>✨ Profile preview</h2><p class="muted">This is how your profile card will look with the current selections. Nothing has been saved yet.</p>'+previewHtml+'<div class="toolbar"><button class="mini" type="button" id="backToProfileStyle">Back to settings</button><button class="primary" type="button" id="savePreviewedProfileStyle">Save appearance</button></div>');
    $('backToProfileStyle').onclick=editProfileStyle;
    $('savePreviewedProfileStyle').onclick=()=>saveMyProfile({profileColor:colorInput.value,theme:themeInput.value,badge:badgeInput.value.trim(),banner:bannerInput.value.trim()},'Profile appearance saved.');
  };
  $('saveProfileStyle').onclick=()=>saveMyProfile({profileColor:colorInput.value,theme:themeInput.value,badge:badgeInput.value.trim(),banner:bannerInput.value.trim()},'Profile appearance saved.');
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
  const u=state.user||{},p={lastSeen:true,online:true,country:true,location:true,website:true,bio:true,pronouns:true,relationship:true,mood:true,interests:true,...(u.privacy||{})};
  const options=[['country','🌍 Country and flag','Show my country and its flag on my profile'],['location','📍 City / location','Show the location field'],['website','🔗 Website','Show my website link'],['bio','📝 About Me','Show my bio'],['pronouns','🪪 Pronouns','Show my pronouns'],['relationship','♥ Relationship','Show relationship status'],['mood','☻ Mood','Show my mood'],['interests','✨ Interests','Show my interests'],['online','🟢 Online status','Let others see when I am online'],['lastSeen','◉ Last seen','Show my last-seen time']];
  modal(`<div class="privacy-control-modal"><h2>🔒 Privacy Control</h2><p class="muted">Choose exactly which details appear to other members. Changes are saved to your account.</p><div class="privacy-control-list">${options.map(([key,title,desc])=>`<label class="privacy-control-row"><span><b>${title}</b><small>${desc}</small></span><input type="checkbox" data-privacy-key="${key}" ${p[key]!==false?'checked':''}></label>`).join('')}</div><div class="toolbar"><button class="mini" id="privacyCancel">Cancel</button><button class="primary" id="privacySave">Save privacy</button></div></div>`);
  $('privacyCancel').onclick=closeModal;
  $('privacySave').onclick=async()=>{const privacy={};document.querySelectorAll('[data-privacy-key]').forEach(el=>privacy[el.dataset.privacyKey]=el.checked);try{const r=await api('/api/profile',{method:'PUT',body:JSON.stringify({privacy})});state.user=r.user;closeModal();await loadProfile(state.user);toast('Privacy settings saved.');}catch(e){toast(e.message)}};
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

async function hardRefreshSiteCache(){
  const savedAuthToken=safeStorage.getItem("mc_token");
  if(!confirm("Hard refresh Maleficent Chat on this device?\n\nThis clears cached website files and reloads the site. It does NOT delete room messages, private messages, accounts, profiles, ranks, gold, settings, or saved records. Your notification subscription will be kept."))return;
  const button=$("hardRefreshSiteButton");
  if(button){button.disabled=true;button.textContent="⟳ Clearing cache…";}
  try{
    if("caches" in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(key=>caches.delete(key)));
    }
    if(savedAuthToken)safeStorage.setItem("mc_token",savedAuthToken);
    toast("Site cache cleared. Keeping your login and reloading Maleficent Chat…");
    const url=new URL(window.location.href);
    url.searchParams.set("site_refresh",String(Date.now()));
    window.location.replace(url.toString());
  }catch(error){
    console.error("Site cache refresh failed:",error);
    toast("Could not clear the site cache: "+(error?.message||"unknown error"));
    if(button){button.disabled=false;button.textContent="⟳ Site Refresh";}
  }
}

async function loadClearedRoomEvidence(query=''){
  const target=$('clearedRoomEvidenceList');if(!target)return;
  target.innerHTML='<p class="muted">Loading cleared-room evidence…</p>';
  try{
    const data=await api('/api/staff/cleared-room-evidence?q='+encodeURIComponent(String(query||'').trim()));
    const rows=data.evidence||[];
    target.innerHTML=rows.map(row=>`<details class="cleared-room-evidence-entry" data-cleared-evidence="${esc(row.id)}"><summary><b>🗃️ ${esc(row.room_name||'Unknown room')}</b> · ${Number(row.message_count||0)} message(s)<small style="display:block">${esc(row.cleared_by_username||'Unknown staff')} · ${esc(row.cleared_at?new Date(row.cleared_at).toLocaleString():'Unknown date')}</small></summary><div class="toolbar" style="margin-top:10px"><button type="button" class="mini primary" data-inspect-cleared-evidence="${esc(row.id)}">🔎 Inspect messages</button><button type="button" class="mini danger" data-delete-cleared-evidence="${esc(row.id)}">🗑 Delete evidence</button></div></details>`).join('')||'<p class="muted">No cleared-room evidence found. Evidence is created for room clears performed after this feature deploys.</p>';
    target.querySelectorAll('[data-inspect-cleared-evidence]').forEach(button=>button.addEventListener('click',()=>inspectClearedRoomEvidence(button.dataset.inspectClearedEvidence)));
    target.querySelectorAll('[data-delete-cleared-evidence]').forEach(button=>button.addEventListener('click',()=>deleteClearedRoomEvidence(button.dataset.deleteClearedEvidence)));
  }catch(error){target.innerHTML='<p class="muted">'+esc(error.message||'Could not load cleared-room evidence.')+'</p>';}
}
async function inspectClearedRoomEvidence(id){
  try{
    const data=await api('/api/staff/cleared-room-evidence/'+encodeURIComponent(id));
    const evidence=data.evidence||{},messages=Array.isArray(evidence.messages)?evidence.messages:[];
    const messageRows=messages.map(message=>{
      const author=message.username||message.displayName||message.authorName||message.user?.username||message.senderUsername||'Unknown user';
      const text=message.text||message.message||message.content||'';
      const time=message._evidenceCreatedAt||message.time||message.createdAt||message.created_at;
      const attachment=message.attachment||message.media||null;
      const body=text?'<div class="cleared-evidence-message-text">'+esc(text)+'</div>':'';
      const media=attachment?(typeof attachment==='string'?'<a href="'+esc(attachment)+'" target="_blank" rel="noopener">Open attachment</a>':(attachment.url?'<a href="'+esc(attachment.url)+'" target="_blank" rel="noopener">Open attachment</a>':'')):'';
      return '<article class="cleared-evidence-message"><div class="toolbar" style="justify-content:space-between"><b>@'+esc(author)+'</b><small>'+esc(time?new Date(time).toLocaleString():'Time unavailable')+'</small></div>'+body+media+'</article>';
    }).join('');
    modal('<div class="cleared-evidence-viewer"><h2>🗃️ '+esc(evidence.room_name||'Cleared room')+' — message evidence</h2><p class="muted">Cleared by @'+esc(evidence.cleared_by_username||'Unknown')+' · '+esc(evidence.cleared_at?new Date(evidence.cleared_at).toLocaleString():'Unknown date')+' · '+messages.length+' message(s)</p><div class="cleared-evidence-message-list">'+(messageRows||'<p class="muted">This clear record has no messages stored.</p>')+'</div><div class="toolbar"><button type="button" class="mini" onclick="closeModal()">Close</button></div></div>');
  }catch(error){toast(error.message||'Could not inspect this evidence record.');}
}
async function deleteClearedRoomEvidence(id){
  if(!confirm('Permanently delete this cleared-room evidence record and its archived messages? This does not restore or delete any current room messages.'))return;
  try{
    await api('/api/staff/cleared-room-evidence/'+encodeURIComponent(id),{method:'DELETE'});
    toast('Cleared-room evidence deleted.');
    await loadClearedRoomEvidence($('clearedRoomEvidenceQuery')?.value||'');
  }catch(error){toast(error.message||'Could not delete evidence.');}
}

async function loadStaffFilterManagement(){
  const host=$("staffFilterManagement");if(!host)return;
  let words=[];
  const render=()=>{
    const q=String($("staffFilterSearch")?.value||"").trim().toLowerCase();
    const shown=words.filter(x=>String(x.word||"").toLowerCase().includes(q));
    host.innerHTML='<p class="muted">Manage chat filters, automatic report triggers, restricted usernames, and OCR-based restricted-media phrases. Changes save immediately. Add <code>p: phrase</code> to block images containing readable matching text. SUPER_ADMIN and higher bypass this media rule.</p><label>Add entries<textarea id="staffFilterBulkWords" rows="3" placeholder="ordinaryword&#10;r: reportword&#10;u: restrictedname&#10;p: restricted text inside images"></textarea></label><div class="toolbar"><button type="button" class="primary" id="staffAddFilterEntries">＋ Add entries</button><input id="staffFilterSearch" type="search" placeholder="Search entries…" value="'+esc(q)+'"></div><p class="muted">Total: '+words.length+' · Showing: '+shown.length+'</p>'+shown.map(x=>'<div class="card toolbar" style="justify-content:space-between"><div><b>'+esc(/^r\s*:/i.test(x.word)?'Auto System Report Words':(/^u\s*:/i.test(x.word)?'Restricted Usernames & Display Names':(/^p\s*:/i.test(x.word)?'Restricted Media OCR Phrases':'Filter Words')))+'</b><br><code>'+esc(x.word)+'</code></div><button type="button" class="mini danger" data-staff-filter-delete="'+esc(x.id)+'">Delete</button></div>').join("");
    $("staffFilterSearch")?.addEventListener("input",()=>render());
    $("staffAddFilterEntries")?.addEventListener("click",async()=>{const input=$("staffFilterBulkWords"),text=String(input?.value||"").trim();if(!text){toast("Enter at least one filter entry.");return;}try{await api("/api/filter-words/bulk",{method:"POST",body:JSON.stringify({text})});toast("Filter entries saved.");await refresh();}catch(e){toast(e.message||"Could not save filter entries.");}});
    host.querySelectorAll("[data-staff-filter-delete]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Delete this filter entry?"))return;try{await api("/api/filter-words/"+encodeURIComponent(b.dataset.staffFilterDelete),{method:"DELETE"});toast("Filter entry deleted.");await refresh();}catch(e){toast(e.message||"Could not delete filter entry.");}}));
  };
  const refresh=async()=>{try{const d=await api("/api/filter-words");words=Array.isArray(d.words)?d.words:[];render();}catch(e){host.innerHTML='<p class="muted">'+esc(e.message||"Could not load filter management.")+'</p>';}};
  await refresh();
}
async function loadStaff() {
  try {
    const data=await api('/api/staff/dashboard');
    const staffRank=String(state.user?.rank||'').toUpperCase();

    // Moderators are intentionally limited to the Statistics card in their staff space.
    // Return before requesting Admin-only endpoints, which previously rejected MOD and
    // caused the entire dashboard to stay blank.
    if(staffRank==='MOD'){
      const stats=data.stats||{};
      $('staff').innerHTML=`
        <section class="card moderator-statistics-card">
          <h3>📊 Moderator Statistics</h3>
          <p class="muted">Read-only community overview for Moderators.</p>
          <div class="grid2">
            <div class="card"><h3>👥 Users</h3><p>${Number(stats.users||0)}</p></div>
            <div class="card"><h3>🟢 Online</h3><p>${Number(stats.online||0)}</p></div>
            <div class="card"><h3>💬 Messages</h3><p>${Number(stats.messages||0)}</p></div>
            <div class="card"><h3>🚩 Open Reports</h3><p>${Number(stats.reportsOpen||0)}</p></div>
          </div>
        </section>`;
      $('owner')?.classList.add('hidden');
      return;
    }

    const bootstrapData=await api('/api/bootstrap');
    const filterWords=await api('/api/staff/filter-word');
    const systemCenter=await api('/api/staff/system-center').catch(()=>null);
    const canUseAdminPanel=['ADMIN','SUPER_ADMIN','COMMISSOR','INSTRUCTOR','COOWNER','OWNER','DEVELOPER'].includes(staffRank);
    const staffRankOrder=['MEMBER','VIP','PREMIUM','ROYAL','MOD','ADMIN','SUPER_ADMIN','COMMISSOR','INSTRUCTOR','COOWNER','OWNER','DEVELOPER'];
    const canHardRefreshSite=staffRankOrder.indexOf(String(state.user?.rank||'').toUpperCase())>=staffRankOrder.indexOf('INSTRUCTOR');



    $('staff').innerHTML=`
      ${['INSTRUCTOR','COOWNER','OWNER','DEVELOPER'].includes(String(state.user?.rank||'').toUpperCase()) ? '<details class="staff-compact-dropdown"><summary>🗃️ Cleared Room Messages Inspection</summary><section class="card cleared-room-evidence-card"><div class="toolbar" style="justify-content:space-between;align-items:flex-start"><div><h3>🗃️ Cleared Room Messages Inspection</h3><p class="muted">Review archived messages from rooms that were cleared. New clears are archived automatically before messages are removed.</p></div><button class="mini" type="button" id="refreshClearedRoomEvidence">↻ Refresh</button></div><form id="clearedRoomEvidenceSearch" class="toolbar"><input id="clearedRoomEvidenceQuery" maxlength="100" placeholder="Filter by room name or staff username"><button class="mini primary" type="submit">Search</button></form><div id="clearedRoomEvidenceList"><p class="muted">Loading cleared-room evidence…</p></div></section></details>' : ''}
      ${canHardRefreshSite ? '<section class="card site-hard-refresh-card"><div><h3>⟳ Site Refresh</h3><p class="muted">Clear cached website files on this device and reload Maleficent Chat. All account data and messages remain stored safely.</p></div><button class="primary" type="button" id="hardRefreshSiteButton">⟳ Hard Refresh Site</button></section>' : ''}
      ${(String(state.user?.rank||'').toUpperCase()==='DEVELOPER'||String(state.user?.rank||'').toUpperCase()==='OWNER') ? '<details class="staff-compact-dropdown"><summary>🚧 Under Construction</summary><section class="card under-construction-admin-card"><div class="under-construction-admin-heading"><div><h3>🚧 Under Construction</h3><p class="muted">Switch maintenance mode ON to block regular users. Create a shutdown code when enabling; the same code is required to switch it OFF. Owner and Developer accounts remain exempt.</p></div><span class="construction-status-pill" id="staffConstructionStatus" aria-live="polite">Checking status…</span></div><div class="construction-switch-row"><span><b>Maintenance mode</b><small>OFF = site open · ON = maintenance screen</small></span><span class="construction-switch"><input type="checkbox" id="staffUnderConstructionToggle" role="switch" aria-label="Under Construction mode" aria-checked="false" onchange="toggleUnderConstruction(this.checked)"><span class="construction-switch-track" aria-hidden="true"></span></span></div><div class="construction-message-box"><label for="staffConstructionMessage">Maintenance message for users</label><textarea id="staffConstructionMessage" maxlength="1000" rows="3" placeholder="Write the message users should see above the shutdown code box"></textarea><small class="muted">This message will appear on the maintenance screen above the Shutdown Code field.</small></div><div class="construction-code-box"><label for="staffConstructionCode" id="staffConstructionCodeLabel">Create shutdown code<input type="password" id="staffConstructionCode" minlength="4" maxlength="128" autocomplete="new-password" placeholder="Create a code to switch ON" aria-describedby="staffConstructionCodeHelp"></label><small id="staffConstructionCodeHelp" class="muted">Use 4–128 characters. When maintenance is ON, enter this same code before switching it OFF.</small></div><p class="muted construction-last-result" id="staffConstructionResult" aria-live="polite">The saved server setting will be checked before displaying the current state.</p></section></details>' : ''}
      ${["INSTRUCTOR","COOWNER","OWNER","DEVELOPER"].includes(String(state.user?.rank||"").toUpperCase()) ? '<details class="staff-compact-dropdown"><summary>🔎 Personalized IP Inspection</summary><section class="card ip-inspection-card"><div><h3>🔎 Personalized IP Inspection</h3><p class="muted">Your rank: <b>'+esc(String(state.user?.rank||"").toUpperCase())+'</b> · Fields are restricted automatically by your staff rank.</p><div class="ip-access-profile" role="status">'+(String(state.user?.rank||"").toUpperCase()==="INSTRUCTOR"?"⚔️ Instructor access · Email + approximate location only":String(state.user?.rank||"").toUpperCase()==="COOWNER"?"👻 Co-owner access · IP and network details, without browser/device details":"👑 Owner access · Full recorded IP and network details")+'</div></div><form id="ipInspectionForm" class="ip-inspection-form"><input id="ipInspectionSearch" placeholder="Search an account by @username" maxlength="100" autocomplete="off"><button class="primary" type="submit">🔎 Inspect</button></form><div id="ipInspectionSuggestions" class="ip-inspection-suggestions" hidden></div><p class="muted ip-inspection-note">Location is approximate. Access is enforced on the server, not just hidden in the interface.</p><div id="ipInspectionResults"><p class="muted">Search for an account to inspect the details available to your rank.</p></div><section class="card developer-network-console" id="developerNetworkConsole" style="margin-top:14px"><h3>🛡️ Developer Network Security</h3><p class="muted">Developer-only controls. Network location and VPN detection are approximate; avoid treating one signal as proof of abuse.</p><details open><summary>🚫 IP Ban / Range Ban</summary><form id="devIpRuleForm" class="stack" style="margin-top:10px"><label>IP, wildcard, or IPv4 CIDR<input id="devIpRulePattern" maxlength="64" required placeholder="45.67.1.* or 45.67.0.0/16"></label><label>Reason<input id="devIpRuleReason" maxlength="240" placeholder="Spam / ban evasion"></label><button class="primary" type="submit">Add IP / range ban</button></form><div id="devIpRulesList" class="stack"></div></details><details><summary>🌐 VPN, country and region restrictions</summary><form id="devNetworkPolicyForm" class="stack" style="margin-top:10px"><label class="check-row"><input type="checkbox" id="devBlockVpn"> Automatically block detected VPN / proxy / Tor / hosting IPs</label><label>Allowed countries (leave blank to allow all)<textarea id="devAllowedCountries" rows="2" placeholder="IN or INDIA"></textarea></label><label>Blocked countries<textarea id="devBlockedCountries" rows="2" placeholder="COUNTRY CODE or country name"></textarea></label><label>Block VPN / proxy only from these countries<textarea id="devBlockedVpnCountries" rows="2" placeholder="IN or INDIA"></textarea></label><label>Blocked states / regions<textarea id="devBlockedRegions" rows="2" placeholder="MAHARASHTRA"></textarea></label><button class="primary" type="submit">Save network restrictions</button><p class="muted">Country entries accept country codes or country names. Region matching uses the geolocation provider region name. If a lookup is unavailable, country rules fail open to avoid accidental site-wide lockout.</p></form></details><details><summary>🧭 IP history timeline and risk signals</summary><form id="devNetworkAccountForm" class="toolbar" style="margin-top:10px"><input id="devNetworkAccountSearch" maxlength="80" placeholder="Search username"><button class="primary" type="submit">Inspect timeline</button></form><div id="devNetworkAccountResults"><p class="muted">Search a username to see the last recorded IP changes, approximate locations, device/IP correlation and local risk score.</p></div></details><details><summary>🗺️ One-click IP lookup</summary><form id="devIpLookupForm" class="toolbar" style="margin-top:10px"><input id="devIpLookupAddress" maxlength="64" required placeholder="Public IPv4 address"><button class="primary" type="submit">Look up IP</button></form><div id="devIpLookupResults"></div><p class="muted">Map pins use OpenStreetMap coordinates supplied by the IP lookup provider. ISP branding is shown as provider text when no verified logo is available.</p></details></section></section></details>' : ''}
      ${["COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"].includes(staffRank) ? '<details class="filter-words-details staff-applications-dropdown" id="staffApplicationsDropdown"><summary>📝 Staff Applications <span class="staff-app-count" id="staffApplicationCount">Loading…</span></summary><div class="staff-applications-content" id="staffApplicationsList"><p class="muted">Loading applications…</p></div></details>' : ''}
      ${["COOWNER","OWNER","DEVELOPER"].includes(String(state.user?.rank||"").toUpperCase()) ? `<details class="filter-words-details system-notifications-dropdown" id="systemNotificationsDropdown">
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
      </details>` : ''}
      <div class="grid2">
        <div class="card"><h3>Statistics</h3><p>Users: ${data.stats.users}<br>Online: ${data.stats.online}<br>Messages: ${data.stats.messages}<br>Open reports: ${data.stats.reportsOpen}</p></div>
        <div class="card"><h3>Filtered words</h3><p class="muted">Use <code>p: phrase</code> for OCR-based restricted image text. SUPER_ADMIN and above bypass the media restriction.</p><button class="mini" onclick="addFilterWord()">＋ Add word</button><details class="filter-words-details"><summary>Filter words (${(filterWords.words||[]).length})</summary><div class="filter-word-list">${(filterWords.words||[]).map(w=>`<div class="filter-word-row"><span class="muted">${/^p\s*:/i.test(w)?'Restricted Media':(/^r\s*:/i.test(w)?'Auto Report':(/^u\s*:/i.test(w)?'Restricted Username':'Filter'))}</span> <code>${esc(w)}</code><button class="mini danger" onclick="deleteFilterWord(decodeURIComponent('${encodeURIComponent(w)}'))">×</button></div>`).join('')||'<span class="muted">No filter words configured.</span>'}</div></details><p class="muted">Link filter: ${bootstrapData.settings?.linkFilter?'ON':'OFF'}</p></div>
      </div>

      
`;

    // Put staff dashboard sections in the numbered order requested in the mobile screenshot.
    const staffRoot=$("staff");
    if(!["COOWNER","OWNER","DEVELOPER"].includes(String(state.user?.rank||"").toUpperCase()))staffRoot?.querySelector("#systemNotificationsDropdown")?.remove();
    const developerNetworkConsole=$("developerNetworkConsole");
    if(developerNetworkConsole&&!(String(state.user?.rank||"").toUpperCase()==="DEVELOPER"&&String(state.user?.username||"")==="Maleficent"))developerNetworkConsole.remove();
    staffRoot?.querySelector("#staffGuideManagementDropdown")?.remove();
    staffRoot?.querySelector("#staffFilterManagementDropdown")?.remove();
    const canManageGuidesAndFilters=["COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"].includes(staffRank);
    const canManageGuides=["COOWNER","OWNER","DEVELOPER"].includes(staffRank);
    if(canManageGuidesAndFilters&&staffRoot){
      const clearedSection=staffRoot.querySelector(".cleared-room-evidence-card")?.closest("details");
      if(canManageGuides){
        const guideDropdown=document.createElement("details");
        guideDropdown.id="staffGuideManagementDropdown";guideDropdown.className="staff-compact-dropdown filter-words-details";
        guideDropdown.innerHTML='<summary>📘 Guide Management <span class="muted">— click to open</span></summary><div class="owner-filter-management-content"><div id="staffGuideManagement" class="stack"></div></div>';
        if(clearedSection)staffRoot.insertBefore(guideDropdown,clearedSection);else staffRoot.append(guideDropdown);
        loadOwnerGuideManagement();
      }
      const filterDropdown=document.createElement("details");
      filterDropdown.id="staffFilterManagementDropdown";filterDropdown.className="staff-compact-dropdown filter-words-details";
      filterDropdown.innerHTML='<summary>🧩 Filter Management <span class="muted">— click to open</span></summary><div class="owner-filter-management-content" id="staffFilterManagement"></div>';
      if(clearedSection)staffRoot.insertBefore(filterDropdown,clearedSection);else staffRoot.append(filterDropdown);
      loadStaffFilterManagement();
    }
    const statsGrid=staffRoot?.querySelector(".grid2");
    const statsCard=statsGrid?.children[0], filterCard=statsGrid?.children[1];
    const orderedStaffSections=[
      [statsCard,"staff-order-1"],
      [staffRoot?.querySelector("#systemNotificationsDropdown"),"staff-order-2"],
      [staffRoot?.querySelector(".ip-inspection-card")?.closest("details"),"staff-order-3"],
      [filterCard,"staff-order-4"],
      [staffRoot?.querySelector("#staffGuideManagementDropdown"),"staff-order-5"],
      [staffRoot?.querySelector("#staffFilterManagementDropdown"),"staff-order-6"],
      [staffRoot?.querySelector(".cleared-room-evidence-card")?.closest("details"),"staff-order-7"],
      [staffRoot?.querySelector(".under-construction-admin-card")?.closest("details"),"staff-order-8"],
      [staffRoot?.querySelector("#staffApplicationsDropdown"),"staff-order-9"],
      [staffRoot?.querySelector(".site-hard-refresh-card"),"staff-order-10"]
    ];
    orderedStaffSections.forEach(([node,cls])=>{if(node){node.classList.add(cls);staffRoot.appendChild(node);}});
    if(statsGrid&&!statsGrid.children.length)statsGrid.remove();
    $("hardRefreshSiteButton")?.addEventListener("click",hardRefreshSiteCache);
    if(['INSTRUCTOR','COOWNER','OWNER','DEVELOPER'].includes(String(state.user?.rank||'').toUpperCase())){
      $('refreshClearedRoomEvidence')?.addEventListener('click',()=>loadClearedRoomEvidence());
      $('clearedRoomEvidenceSearch')?.addEventListener('submit',e=>{e.preventDefault();loadClearedRoomEvidence($('clearedRoomEvidenceQuery')?.value||'');});
      loadClearedRoomEvidence();
    }
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

    const developerOnly=String(state.user?.rank||"").toUpperCase()==="DEVELOPER";
    if(!developerOnly)$('developerNetworkConsole')?.remove();
    async function loadDeveloperNetworkConfig(){
      if(!developerOnly)return;
      try{
        const d=await api('/api/developer/network-security'),c=d.config||{};
        const list=$('devIpRulesList');
        if(list)list.innerHTML=(c.ipRules||[]).map(r=>'<div class="about-card"><b>'+esc(r.pattern)+'</b><small>'+esc(r.reason||'No reason')+'</small><button type="button" class="secondary" data-remove-ip-rule="'+esc(r.id)+'">Remove rule</button></div>').join('')||'<p class="muted">No IP/range bans configured.</p>';
        if($('devBlockVpn'))$('devBlockVpn').checked=!!c.blockVpn;
        if($('devAllowedCountries'))$('devAllowedCountries').value=(c.allowedCountries||[]).join(', ');
        if($('devBlockedCountries'))$('devBlockedCountries').value=(c.blockedCountries||[]).join(', ');
        if($('devBlockedRegions'))$('devBlockedRegions').value=(c.blockedRegions||[]).join(', ');
      }catch(e){const list=$('devIpRulesList');if(list)list.innerHTML='<p class="muted">'+esc(e.message||'Developer security settings unavailable')+'</p>';}
    }
    $('devIpRuleForm')?.addEventListener('submit',async e=>{
      e.preventDefault();
      try{await api('/api/developer/network-security/rules',{method:'POST',body:JSON.stringify({pattern:$('devIpRulePattern')?.value,reason:$('devIpRuleReason')?.value})});if($('devIpRulePattern'))$('devIpRulePattern').value='';if($('devIpRuleReason'))$('devIpRuleReason').value='';toast('IP/range rule added');await loadDeveloperNetworkConfig();}
      catch(err){toast(err.message||'Could not add IP rule');}
    });
    $('devIpRulesList')?.addEventListener('click',async e=>{
      const btn=e.target.closest('[data-remove-ip-rule]');if(!btn)return;
      try{await api('/api/developer/network-security/rules/'+encodeURIComponent(btn.dataset.removeIpRule),{method:'DELETE'});toast('IP/range rule removed');await loadDeveloperNetworkConfig();}catch(err){toast(err.message||'Could not remove IP rule');}
    });
    $('devNetworkPolicyForm')?.addEventListener('submit',async e=>{
      e.preventDefault();
      try{await api('/api/developer/network-security/policy',{method:'PUT',body:JSON.stringify({blockVpn:$('devBlockVpn')?.checked,allowedCountries:$('devAllowedCountries')?.value||'',blockedCountries:$('devBlockedCountries')?.value||'',blockedRegions:$('devBlockedRegions')?.value||''})});toast('Network restrictions saved');}
      catch(err){toast(err.message||'Could not save network restrictions');}
    });
    $('devNetworkAccountForm')?.addEventListener('submit',async e=>{
      e.preventDefault();const out=$('devNetworkAccountResults');if(!out)return;
      out.innerHTML='<p class="muted">Loading IP history and risk signals…</p>';
      try{const d=await api('/api/developer/network-security/timeline?q='+encodeURIComponent($('devNetworkAccountSearch')?.value||''));out.innerHTML='<div class="about-card"><h4>@'+esc(d.username)+' · Local risk score '+esc(d.riskScore)+'/100</h4><p>'+esc((d.riskSignals||[]).join(' · ')||'No heuristic risk signals detected')+'</p><p class="muted">'+esc(d.distinctIpCount)+' distinct IP addresses recorded. Device fingerprint registered: '+(d.deviceFingerprintRegistered?'Yes':'No')+'.</p><div class="ip-inspection-table-wrap"><table class="ip-inspection-table"><thead><tr><th>IP</th><th>Approx. location / ISP</th><th>Event</th><th>Time</th><th>Map</th></tr></thead><tbody>'+(d.events||[]).map(r=>{const n=r.network||{},ip=esc(r.ip_address||'Unavailable'),xy=String(n.coordinates||'').split(','),map=xy.length===2&&xy.every(v=>Number.isFinite(Number(v)))?'https://www.openstreetmap.org/?mlat='+encodeURIComponent(xy[0])+'&mlon='+encodeURIComponent(xy[1])+'#map=10/'+encodeURIComponent(xy[0])+'/'+encodeURIComponent(xy[1]):'';return '<tr><td><code>'+ip+'</code></td><td>'+esc([n.city,n.region,n.country,n.networkProvider].filter(Boolean).join(', ')||'Unavailable')+(n.vpnDetected?'<small>⚠ VPN/proxy signal</small>':'')+'</td><td>'+esc(r.event_type||'Unknown')+'</td><td>'+esc(r.recorded_at?fmt(new Date(r.recorded_at).getTime()):'Unknown')+'</td><td>'+(map?'<a href="'+esc(map)+'" target="_blank" rel="noopener">Open map</a>':'Unavailable')+'</td></tr>';}).join('')+'</tbody></table></div><p class="muted">'+esc(d.disclaimer||'IP location is approximate.')+'</p></div>';}
      catch(err){out.innerHTML='<p class="muted">'+esc(err.message||'Could not load timeline')+'</p>';}
    });
    $('devIpLookupForm')?.addEventListener('submit',async e=>{
      e.preventDefault();const out=$('devIpLookupResults');if(!out)return;out.innerHTML='<p class="muted">Looking up network…</p>';
      try{const d=await api('/api/developer/network-security/lookup?ip='+encodeURIComponent($('devIpLookupAddress')?.value||'')),n=d.network||{};out.innerHTML='<div class="about-card"><h4>'+esc(d.ip)+' · Local risk '+esc(d.riskScore)+'/100</h4><p>'+esc([n.city,n.region,n.country].filter(Boolean).join(', ')||'Location unavailable')+'</p><p>ISP / organization: '+esc(n.networkProvider||n.organization||'Unavailable')+' · ASN: '+esc(n.asn||'Unavailable')+'</p><p>Signals: '+esc((d.riskSignals||[]).join(', ')||'No local risk signals')+'</p>'+(d.mapUrl?'<p><a href="'+esc(d.mapUrl)+'" target="_blank" rel="noopener">🗺️ Open approximate map pin</a></p>':'<p class="muted">No map coordinates returned by the provider.</p>')+'<p class="muted">Provider results can be inaccurate. This is not a global blacklist lookup.</p></div>';}
      catch(err){out.innerHTML='<p class="muted">'+esc(err.message||'IP lookup failed')+'</p>';}
    });
    if(developerOnly)loadDeveloperNetworkConfig();

    if(String(state.user?.rank||'').toUpperCase()==='DEVELOPER'&&String(state.user?.username||'')==='Maleficent'){
      loadDeveloperNetworkSecurity('',true);
      $('devIpRuleForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/developer/network-security/ip-rules',{method:'POST',body:JSON.stringify({pattern:$('devIpRulePattern').value.trim(),reason:$('devIpRuleReason').value.trim()})});$('devIpRulePattern').value='';$('devIpRuleReason').value='';toast('IP / range ban added.');await loadDeveloperNetworkSecurity();}catch(err){toast(err.message);}});
      $('devIpRulesList')?.addEventListener('click',async e=>{const btn=e.target.closest('[data-dev-delete-ip-rule]');if(!btn)return;try{await api('/api/developer/network-security/ip-rules/'+encodeURIComponent(btn.dataset.devDeleteIpRule),{method:'DELETE'});toast('IP / range ban removed.');await loadDeveloperNetworkSecurity();}catch(err){toast(err.message);}});
      $('devNetworkPolicyForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/developer/network-security',{method:'PUT',body:JSON.stringify({blockVpn:$('devBlockVpn').checked,allowedCountries:$('devAllowedCountries').value,blockedCountries:$('devBlockedCountries').value,blockedVpnCountries:$('devBlockedVpnCountries').value,blockedRegions:$('devBlockedRegions').value})});toast('Network restrictions saved.');await loadDeveloperNetworkSecurity('',true);}catch(err){toast(err.message);}});
      $('devNetworkAccountForm')?.addEventListener('submit',e=>{e.preventDefault();loadDeveloperNetworkSecurity(($('devNetworkAccountSearch').value||'').trim().replace(/^@/,''));});
      $('devIpLookupForm')?.addEventListener('submit',e=>{e.preventDefault();lookupDeveloperIp(($('devIpLookupAddress').value||'').trim());});
    }

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
      const activeActionTarget=$("activeActionUsers");
      // This optional widget is absent from the current dashboard layout; skip it safely.
      if(!activeActionTarget)return;
      activeActionTarget.innerHTML=rows.map(x=>`<div class="user-card"><div style="flex:1"><b>${esc(x.displayName)}</b> @${esc(x.username)}<div class="muted">${rank(x.rank)} · ${x.banned?"Banned":x.kickedUntil?"Kicked until "+fmt(x.kickedUntil):"Muted until "+fmt(x.mutedUntil)}</div><div class="muted">${esc(x.reason||"")}</div></div><button class="mini" onclick="openUser('${esc(x.id)}')">Open</button></div>`).join("")||'<p class="muted">No users currently have this action.</p>';
    };
    $("staffActionFilter")?.addEventListener("change",renderActiveActions);
    renderActiveActions();
  }catch(e){toast(e.message)}
}

async function loadDeveloperNetworkSecurity(query='',populatePolicy=false){
  const root=$('developerNetworkConsole');
  if(!root||String(state.user?.rank||'').toUpperCase()!=='DEVELOPER'||String(state.user?.username||'')!=='Maleficent')return;
  try{
    const url='/api/developer/network-security'+(query?'?q='+encodeURIComponent(query):'');
    const d=await api(url),cfg=d.config||{};
    if(populatePolicy){
      $('devBlockVpn').checked=!!cfg.blockVpn;
      $('devAllowedCountries').value=(cfg.allowedCountries||[]).join('\n');
      $('devBlockedCountries').value=(cfg.blockedCountries||[]).join('\n');
      $('devBlockedVpnCountries').value=(cfg.blockedVpnCountries||[]).join('\n');
      $('devBlockedRegions').value=(cfg.blockedRegions||[]).join('\n');
    }
    const rules=cfg.ipRules||[];
    $('devIpRulesList').innerHTML=rules.length?rules.map(rule=>'<div class="about-card" style="margin-top:8px"><div class="profile-info-row"><b><code>'+esc(rule.pattern)+'</code></b><button class="mini danger" type="button" data-dev-delete-ip-rule="'+esc(rule.id)+'">Remove</button></div><p class="muted">'+esc(rule.reason||'Blocked by Developer')+' · '+esc(rule.createdBy||'Developer')+'</p></div>').join(''):'<p class="muted">No IP or range bans configured.</p>';
    if(d.account){
      const risk=d.risk||{score:0,level:'Low',reasons:[]};
      const deviceRows=(d.deviceSignals||[]).map(item=>'<div class="profile-info-row"><b>'+esc(item.label)+'</b><span>'+esc(item.value)+'</span></div>').join('');
      const timeline=(d.timeline||[]).map(row=>{
        const n=row.network||{},coords=String(n.coordinates||''),hasCoords=/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(coords);
        const map=hasCoords?'<a href="https://www.openstreetmap.org/?mlat='+encodeURIComponent(coords.split(',')[0])+'&mlon='+encodeURIComponent(coords.split(',')[1])+'&zoom=10" target="_blank" rel="noopener">Open map pin</a>':'';
        return '<tr><td><code>'+esc(row.ip_address||'Unavailable')+'</code></td><td>'+esc([n.city,n.region,n.country].filter(Boolean).join(', ')||'Unavailable')+(map?'<small>'+map+'</small>':'')+'</td><td>'+esc([n.networkProvider,n.asn].filter(Boolean).join(' · ')||'Unavailable')+'</td><td>'+esc(n.vpnDetected?((n.vpnSignals||[]).join(', ')||'Possible VPN / proxy'):'No VPN signal')+'</td><td>'+esc(row.event_type||'event')+'<small>'+esc(row.recorded_at?fmt(new Date(row.recorded_at).getTime()):'Unknown')+'</small></td></tr>';
      }).join('');
      $('devNetworkAccountResults').innerHTML='<div class="about-card" style="margin-top:10px"><div class="profile-info-row"><b>@'+esc(d.account.username)+'</b><span>Registered '+esc(d.account.registeredAt?fmt(new Date(d.account.registeredAt).getTime()):'Unknown')+'</span></div><div class="profile-info-row"><b>Local IP risk score</b><span>'+esc(risk.score)+'/100 · '+esc(risk.level)+'</span></div><p class="muted">'+esc((risk.reasons||[]).join(' · ')||'No strong local risk signals found.')+'</p><p class="muted">'+esc(d.disclaimer||'Local signals only; not a global reputation feed.')+'</p><h4>Device + IP correlation</h4>'+deviceRows+'</div><div class="ip-inspection-table-wrap" style="margin-top:10px"><table class="ip-inspection-table"><thead><tr><th>IP / time</th><th>Approximate location</th><th>ISP / ASN</th><th>VPN signal</th><th>Event</th></tr></thead><tbody>'+timeline+'</tbody></table></div>'+(timeline?'':'<p class="muted">No IP history is recorded for this account yet.</p>');
    }else if(query){
      $('devNetworkAccountResults').innerHTML='<p class="muted">No matching account was found.</p>';
    }
  }catch(e){const target=$('devNetworkAccountResults');if(target)target.innerHTML='<p class="muted">'+esc(e.message||'Could not load Developer network security data.')+'</p>';toast(e.message||'Developer network security load failed.');}
}
async function lookupDeveloperIp(ip){
  const out=$('devIpLookupResults');if(!out)return;
  out.innerHTML='<p class="muted">Looking up network details…</p>';
  try{
    const d=await api('/api/developer/network-security/lookup?ip='+encodeURIComponent(ip));
    const n=d.network||{};
    out.innerHTML='<div class="about-card" style="margin-top:10px"><div class="profile-info-row"><b>'+esc(d.ip)+'</b><span>'+esc(n.lookupStatus||'Unavailable')+'</span></div><p><b>Approximate location:</b> '+esc([n.city,n.region,n.country].filter(Boolean).join(', ')||'Unavailable')+'</p><p><b>ISP / ASN:</b> '+esc([n.networkProvider,n.asn,n.organization].filter(Boolean).join(' · ')||'Unavailable')+'</p><p><b>VPN / proxy:</b> '+esc(n.vpnDetected?((n.vpnSignals||[]).join(', ')||'Possible VPN / proxy'):'No provider signal')+'</p>'+(d.mapUrl?'<p><a href="'+esc(d.mapUrl)+'" target="_blank" rel="noopener">Open approximate map pin</a></p>':'<p class="muted">No map coordinates were returned for this IP.</p>')+'</div>';
  }catch(e){out.innerHTML='<p class="muted">'+esc(e.message||'IP lookup failed.')+'</p>';}
}

async function loadIpInspection(query=''){
  const results=$('ipInspectionResults'); if(!results)return;
  results.innerHTML='<p class="muted">Loading IP history and approximate network details…</p>';
  try{
    const d=await api('/api/staff/ip-inspection?q='+encodeURIComponent(query));
    const rows=d.records||[], matches=d.sameIpAccounts||[], viewerRank=String(state.user?.rank||'').toUpperCase();
    if(!rows.length){results.innerHTML='<p class="muted">No accounts matched that search, or your rank cannot inspect those accounts.</p>';return;}
    const rowHtml=rows.map(r=>{
      const n=r.network||{};
      const location=[n.city,n.region,n.country].filter(Boolean).join(', ');
      if(viewerRank==='INSTRUCTOR')return '<tr><td><b>@'+esc(r.username||'Unknown')+'</b></td><td>'+esc(r.email||'No email recorded')+'</td><td>'+esc(location||'Unavailable')+'</td></tr>';
      const network=[n.networkProvider,n.asn,n.organization&&n.organization!==n.networkProvider?n.organization:''].filter(Boolean).join(' · ');
      const technical=[n.timezone?'TZ: '+n.timezone:'',n.coordinates?'Approx. coordinates: '+n.coordinates:'',n.hostname?'Host: '+n.hostname:'',viewerRank==='OWNER'||viewerRank==='DEVELOPER'?(n.postalCode?'Pincode: '+n.postalCode:''):''].filter(Boolean).join(' · ');
      return '<tr><td><b>@'+esc(r.username||'Unknown')+'</b><small>'+esc(r.email||'No email recorded')+'</small><small>Registered: '+(r.registered_at?fmt(new Date(r.registered_at).getTime()):'Unknown')+'</small></td><td><code>'+esc(r.ip_address||'Unavailable')+'</code></td><td>'+esc(location||'Unavailable')+(n.networkType?'<small>'+esc(n.networkType)+'</small>':'')+'</td><td>'+esc(network||'Unavailable')+'</td><td>'+esc(technical||'Unavailable')+'</td><td><span class="ip-lookup-status">'+esc(n.lookupStatus||'Unavailable')+'</span>'+(n.lookupSource?'<small>Source: '+esc(n.lookupSource)+'</small>':'')+'</td><td>'+esc(r.event_type||'No event')+'<small>'+(r.recorded_at?fmt(new Date(r.recorded_at).getTime()):'No IP event recorded')+'</small></td>'+(viewerRank==='OWNER'||viewerRank==='DEVELOPER'?'<td class="ip-user-agent">'+esc(r.user_agent||'Unavailable')+'</td><td>'+esc(r.login_status||'Unknown')+'</td>':'')+'</tr>';
    }).join('');
    const matchRows=matches.map(r=>{
      const n=r.network||{};
      return '<tr><td><b>@'+esc(r.username||'Unknown')+'</b><small>'+esc(r.email||'No email recorded')+'</small><small>Registered: '+(r.created_at?fmt(new Date(r.created_at).getTime()):'Unknown')+'</small></td><td><code>'+esc(r.ip_address||'Unavailable')+'</code></td><td>'+esc([n.city,n.region,n.country].filter(Boolean).join(', ')||'Unavailable')+'</td><td>'+esc([n.networkProvider,n.asn,n.organization&&n.organization!==n.networkProvider?n.organization:''].filter(Boolean).join(' · ')||'Unavailable')+'</td><td>'+esc(r.event_type||'login')+'<small>'+(r.recorded_at?fmt(new Date(r.recorded_at).getTime()):'Unknown')+'</small></td></tr>';
    }).join('');
    const sameIpSection='<section class="about-card" style="margin-top:16px"><h3>🔗 Accounts with matching IP addresses ('+matches.length+')</h3><p class="muted">Accounts below have at least one recorded IP address matching an account in the search results. A shared IP can be caused by shared Wi-Fi, schools, workplaces, mobile carriers or VPNs; it does not prove the same person owns the accounts.</p>'+(matches.length?'<div class="ip-inspection-table-wrap"><table class="ip-inspection-table"><thead><tr><th>Matching account</th><th>Matching IP</th><th>Approx. location</th><th>ISP / ASN</th><th>Event / time</th></tr></thead><tbody>'+matchRows+'</tbody></table></div>':'<p class="muted">No other accounts with matching recorded IP addresses were found.</p>')+'</section>';
    const vpnUsers=d.vpnAccounts||[];
    const vpnSection='<section class="about-card vpn-using-section" style="margin-top:16px"><h3>🛡️ VPN using ('+vpnUsers.length+')</h3><p class="muted">Accounts with VPN/proxy provider flags or network-name signals in the IP history currently shown. Detection is approximate: some VPNs will not be detected, and hosting networks can be false positives.</p>'+(vpnUsers.length?'<div class="ip-inspection-table-wrap"><table class="ip-inspection-table"><thead><tr><th>Account</th><th>Rank</th><th>Network / country</th><th>Detection signal</th><th>Event / time</th></tr></thead><tbody>'+vpnUsers.map(u=>'<tr><td><b>@'+esc(u.username)+'</b></td><td>'+esc(u.rank||'Unknown')+'</td><td>'+esc([u.networkProvider,u.country].filter(Boolean).join(' · ')||'Unavailable')+'</td><td>'+esc((u.signals||[]).join(', ')||u.method||'Possible VPN / proxy')+'</td><td>'+esc(u.event_type||'Unknown')+'<small>'+(u.recorded_at?fmt(new Date(u.recorded_at).getTime()):'Unknown')+'</small></td></tr>').join('')+'</tbody></table></div>':'<p class="muted">No VPN/proxy signals were detected in the IP records loaded for this search.</p>')+'</section>';
    const instructor=viewerRank==='INSTRUCTOR', owner=viewerRank==='OWNER'||viewerRank==='DEVELOPER';
    const tableHead=instructor?'<tr><th>Account</th><th>Email</th><th>Approximate location</th></tr>':'<tr><th>Account / email</th><th>IP address</th><th>Approx. location</th><th>ISP / ASN / organization</th><th>Timezone / coordinates / host</th><th>Lookup status</th><th>Event / time</th>'+(owner?'<th>Browser</th><th>Login status</th>':'')+'</tr>';
    results.innerHTML=(instructor?'':sameIpSection+vpnSection)+'<div class="ip-inspection-table-wrap" style="margin-top:16px"><table class="ip-inspection-table"><thead>'+tableHead+'</thead><tbody>'+rowHtml+'</tbody></table></div><p class="muted">'+esc(d.geolocationNote||'IP location is approximate and may be unavailable.')+'</p>';
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
    if(state.view==="management") await loadStaff();
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
    if(state.view==="management")await loadStaff();
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


function isOwnerExempt(){
  // The server is authoritative for permission checks. Do not hard-code the owner username here:
  // OWNER_USERNAME may be configured differently in Render, which otherwise disables the UI toggle.
  const r=String(state.user?.rank||"").toUpperCase();
  return r==="DEVELOPER"||r==="OWNER";
}
function hideConstructionPanel(){
  if(constructionTimer)clearTimeout(constructionTimer);
  constructionTimer=null;
  document.getElementById("underConstructionOverlay")?.remove();
}
function showConstructionPanel(until,message=""){
  if(isOwnerExempt()){hideConstructionPanel();return;}
  let panel=document.getElementById("underConstructionOverlay");
  if(!panel){
    panel=document.createElement("div");
    panel.id="underConstructionOverlay";
    panel.className="under-construction-overlay";
    document.body.appendChild(panel);
    panel.innerHTML='<div class="under-construction-card"><div class="under-construction-icon">🚧</div><h1>THE SITE IS UNDER CONSTRUCTION</h1><p>We’ll be back when the work is complete.</p><div id="constructionManualMessage" class="construction-manual-message hidden" role="status"></div><form id="constructionShutdownForm" class="construction-owner-login"><h2>Reopen Maleficent Chat</h2><label for="constructionShutdownCode">Shutdown code</label><input id="constructionShutdownCode" name="code" type="password" autocomplete="current-password" required minlength="4" maxlength="128" placeholder="Enter your shutdown code"><button type="submit" id="constructionShutdownSubmit">Turn OFF maintenance</button><p id="constructionLoginMessage" role="status" aria-live="polite">Enter the code saved when maintenance was enabled.</p></form></div>';
    const form=panel.querySelector("#constructionShutdownForm");
    form?.addEventListener("submit",async event=>{
      event.preventDefault();
      const button=panel.querySelector("#constructionShutdownSubmit");
      const message=panel.querySelector("#constructionLoginMessage");
      const code=String(panel.querySelector("#constructionShutdownCode")?.value||"");
      if(button)button.disabled=true;
      if(message)message.textContent="Verifying shutdown code…";
      try{
        const result=await api("/api/under-construction/disable",{method:"POST",body:JSON.stringify({code})});
        if(result.enabled===false){
          if(message)message.textContent="Maintenance disabled. Reopening the site…";
          hideConstructionPanel();
          window.location.reload();
        }
      }catch(error){
        if(message)message.textContent=error?.message||"Could not disable maintenance.";
      }finally{
        if(button)button.disabled=false;
      }
    });
  }
  const manualMessage=panel.querySelector("#constructionManualMessage");
  const cleanMessage=String(message||"").trim();
  if(manualMessage){manualMessage.textContent=cleanMessage;manualMessage.classList.toggle("hidden",!cleanMessage);}
  if(constructionTimer){clearTimeout(constructionTimer);constructionTimer=null;}
  panel.classList.remove("hidden");
}
async function checkUnderConstruction(){
  try{
    const status=await api("/api/under-construction/status");
    // A status poll can finish after a switch write began; never let it overwrite
    // the more recent state while the save is still in progress.
    if(constructionWriteInFlight)return;
    const configured=Boolean(status.configuredEnabled??status.enabled);
    if(status.enabled&&!status.exempt)showConstructionPanel(status.until,status.message||"");
    else hideConstructionPanel();
    const toggle=$("staffUnderConstructionToggle");
    if(toggle&&isOwnerExempt()){
      toggle.checked=configured;
      toggle.setAttribute("aria-checked",configured?"true":"false");
    }
    const label=$("staffConstructionStatus");
    if(label){
      label.textContent=configured?"ON · Maintenance enabled":"OFF · Site open";
      label.classList.toggle("is-on",configured);
    }
    const codeInput=$("staffConstructionCode");
    const codeLabel=$("staffConstructionCodeLabel");
    const codeHelp=$("staffConstructionCodeHelp");
    if(codeInput){
      codeInput.placeholder=configured?"Enter the code to switch OFF":"Create a code to switch ON";
      codeInput.autocomplete=configured?"current-password":"new-password";
    }
    if(codeLabel)codeLabel.firstChild.textContent=configured?"Code required to turn OFF":"Create shutdown code";
    if(codeHelp)codeHelp.textContent=configured?"Enter the exact code used when you enabled maintenance mode.":"Use 4–128 characters. You will need this exact code to turn maintenance mode OFF.";
    const result=$("staffConstructionResult");
    if(result)result.textContent="Server status verified: "+(configured?"ON · regular users are blocked; shutdown code required":"OFF · site is open")+" · "+new Date().toLocaleTimeString();
  }catch(error){
    console.warn("Under Construction status check failed:",error?.message||error);
    const label=$("staffConstructionStatus");if(label)label.textContent="Status unavailable";
    const result=$("staffConstructionResult");if(result)result.textContent="Could not read the saved status: "+(error?.message||"Unknown server error");
  }
}
async function toggleUnderConstruction(requestedEnabled){
  if(constructionWriteInFlight)return;
  const toggle=$("staffUnderConstructionToggle");
  const codeInput=$("staffConstructionCode");
  const enabled=Boolean(requestedEnabled);
  const code=String(codeInput?.value||"");
  const manualMessage=String($("staffConstructionMessage")?.value||"").trim();
  if(code.length<1 || (enabled&&code.length<4) || code.length>128){
    if(toggle)toggle.checked=!enabled;
    if(toggle)toggle.setAttribute("aria-checked",enabled?"false":"true");
    toast(enabled?"Create a shutdown code with at least 4 characters first.":"Enter the shutdown code before switching maintenance OFF.");
    codeInput?.focus();
    return;
  }
  constructionWriteInFlight=true;
  if(toggle)toggle.disabled=true;
  if(codeInput)codeInput.disabled=true;
  try{
    const result=await api("/api/staff/under-construction",{method:"POST",body:JSON.stringify({enabled,code,message:manualMessage})});
    const active=Boolean(result.enabled);
    if(toggle){toggle.checked=active;toggle.setAttribute("aria-checked",active?"true":"false");}
    if(codeInput&&!result.codeConfigured)codeInput.value="";
    const resultLabel=$("staffConstructionResult");
    if(resultLabel)resultLabel.textContent=result.codeConfigured?"Legacy maintenance session secured. The code is ready; switch OFF again to confirm it.":active?"Server saved ON. A shutdown code is now required to turn it OFF. Verifying the persisted setting…":"Server saved OFF after code verification. Verifying the persisted setting…";
    const statusLabel=$("staffConstructionStatus");
    if(statusLabel){
      statusLabel.textContent=active?"ON · Maintenance enabled":"OFF · Site open";
      statusLabel.classList.toggle("is-on",active);
    }
    toast(result.codeConfigured?"Shutdown code saved. Toggle OFF again to finish.":active?"Under Construction enabled. Save your code securely; it is not displayed again.":"Shutdown code accepted. Under Construction disabled.");
  }catch(e){
    if(toggle)toggle.checked=!enabled;
    if(toggle)toggle.setAttribute("aria-checked",enabled?"false":"true");
    const resultLabel=$("staffConstructionResult");
    if(resultLabel)resultLabel.textContent="Save failed: "+(e.message||"Unknown server error");
    toast(e.message||"Could not change Under Construction mode.");
  }finally{
    constructionWriteInFlight=false;
    if(toggle)toggle.disabled=false;
    if(codeInput)codeInput.disabled=false;
    await checkUnderConstruction();
  }
}


async function loadGuide(){
  const host=$("guideContent");if(!host)return;
  host.innerHTML='<div class="card"><p class="muted">Loading your rank guide…</p></div>';
  try{
    const data=await api("/api/guide");
    const entries=Array.isArray(data.guides)?data.guides:[];
    host.innerHTML='<div class="card guide-intro"><h3>'+esc(rankIcon[state.user?.rank]||"📘")+' '+esc(state.user?.rank||"MEMBER")+' Guide</h3><p class="muted">Guidance published for your current rank.</p></div>'+
      (entries.length?entries.map(item=>'<article class="card guide-entry"><h3>'+esc(item.title||"Guide")+'</h3><div class="guide-entry-content">'+esc(item.content||"").replace(/\n/g,"<br>")+'</div></article>').join(""):'<div class="card"><p class="muted">No guide content has been published for your rank yet.</p></div>');
  }catch(e){host.innerHTML='<div class="card"><p class="muted">Could not load the guide: '+esc(e.message||"Request failed")+'</p></div>';}
}
async function loadOwnerGuideManagement(){
  const host=$("staffGuideManagement");if(!host)return;
  const guideRanks=["MEMBER","VIP","PREMIUM","ROYAL","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"];
  let selectedRank="MEMBER", guides=[];
  const render=()=>{
    const options=guideRanks.map(r=>'<option value="'+r+'" '+(r===selectedRank?"selected":"")+'>'+esc(rankIcon[r]||"📘")+' '+r+'</option>').join("");
    host.innerHTML='<div class="card"><h3>📘 Guide Management</h3><p class="muted">Choose the exact rank that should see the content. Members only receive guides assigned to their own current rank.</p><label for="ownerGuideRank">Target rank</label><select id="ownerGuideRank">'+options+'</select><form id="ownerGuideForm" class="stack"><label for="ownerGuideTitle">Guide title</label><input id="ownerGuideTitle" maxlength="100" placeholder="e.g. Getting started" required><label for="ownerGuideBody">Guide content</label><textarea id="ownerGuideBody" rows="6" maxlength="12000" placeholder="Write the instructions for this rank…" required></textarea><div class="toolbar"><button class="primary" type="submit">＋ Add guide content</button></div></form><div class="guide-management-list">'+(guides.length?guides.map((g,i)=>'<article class="guide-management-row"><div><b>'+esc(g.title)+'</b><p class="muted">'+esc((g.content||"").slice(0,180))+(String(g.content||"").length>180?"…":"")+'</p></div><div class="toolbar"><button class="mini" type="button" data-guide-edit="'+i+'">Edit</button><button class="mini danger" type="button" data-guide-delete="'+esc(g.id)+'">Delete</button></div></article>').join(""):'<p class="muted">No guide entries for this rank yet.</p>')+'</div></div>';
    $("ownerGuideRank").onchange=async e=>{selectedRank=e.target.value;await loadRank();render();};
    $("ownerGuideForm").onsubmit=async e=>{e.preventDefault();const title=$("ownerGuideTitle").value.trim(),content=$("ownerGuideBody").value.trim();if(!title||!content){toast("Enter a title and guide content.");return;}try{const out=await api("/api/owner/guide",{method:"POST",body:JSON.stringify({rank:selectedRank,title,content})});guides=out.guides||[];render();toast("Guide content added for "+selectedRank+".");}catch(err){toast(err.message||"Could not add guide content.");}};
    host.querySelectorAll("[data-guide-delete]").forEach(btn=>btn.onclick=async()=>{if(!confirm("Delete this guide entry?"))return;try{const out=await api("/api/owner/guide/"+encodeURIComponent(selectedRank)+"/"+encodeURIComponent(btn.dataset.guideDelete),{method:"DELETE"});guides=out.guides||[];render();toast("Guide entry deleted.");}catch(err){toast(err.message||"Could not delete guide entry.");}});
    host.querySelectorAll("[data-guide-edit]").forEach(btn=>btn.onclick=()=>{const g=guides[Number(btn.dataset.guideEdit)];if(!g)return;modal('<h2>✏️ Edit guide content</h2><label>Title<input id="editGuideTitle" maxlength="100" value="'+esc(g.title)+'"></label><label>Content<textarea id="editGuideBody" rows="7" maxlength="12000">'+esc(g.content)+'</textarea></label><div class="toolbar"><button class="primary" id="saveEditedGuide">Save changes</button><button class="mini" type="button" onclick="closeModal()">Cancel</button></div>');$("saveEditedGuide").onclick=async()=>{const title=$("editGuideTitle").value.trim(),content=$("editGuideBody").value.trim();if(!title||!content){toast("Enter a title and content.");return;}try{const out=await api("/api/owner/guide/"+encodeURIComponent(selectedRank)+"/"+encodeURIComponent(g.id),{method:"PUT",body:JSON.stringify({title,content})});guides=out.guides||[];closeModal();render();toast("Guide entry updated.");}catch(err){toast(err.message||"Could not update guide entry.");}};});
  };
  const loadRank=async()=>{try{const out=await api("/api/owner/guide/"+encodeURIComponent(selectedRank));guides=out.guides||[];}catch(e){guides=[];toast(e.message||"Could not load guide management.");}};
  await loadRank();render();
}

async function loadCommunityRules(){
 const host=$('communityRules');if(!host)return;
 const owner=['INSTRUCTOR','COMMISSOR','COOWNER','OWNER','DEVELOPER'].includes(String(state.user?.rank||'').toUpperCase());
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
    const premiumRequests = await api("/api/owner/premium-requests").catch(()=>({requests:[]}));

    $("owner").innerHTML = `
      <div class="card">

              

        <h3>
          ${String(state.user?.rank||"").toUpperCase()==="DEVELOPER"?"🛠️ Developer Controls":"👑 Owner Controls"}
        </h3>

        <p>
          ${String(state.user?.rank||"").toUpperCase()==="DEVELOPER"?"Developer-level system controls and authorized owner tools.":"Owner-level controls for users, ranks, gold, private-message inspection, rooms and settings."}
        </p>

        <div class="toolbar">
          <button class="primary" onclick="inspectDMs()">Inspect private messages</button>
        </div>
        <section class="card owner-message-refresh-card" style="margin-top:14px;border-color:var(--danger,#b84a68)">
          <h3>🧹 Refresh Site Messages</h3>
          <p class="muted">Permanently remove all current room chat messages and private messages for every user. Accounts, passwords, ranks, gold, settings, rooms, reports, and moderation/audit history are kept.</p>
          <button class="danger" type="button" id="ownerClearAllMessages">🧹 Clear all room & private messages</button>
          <p class="muted" id="ownerClearAllMessagesStatus" aria-live="polite"></p>
        </section>

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

    
    
    // Keep these management tools exclusively in Staff Dashboard, never Owner Space.
    const ownerRoot=$("owner");
    ownerRoot?.querySelectorAll("details").forEach(section=>{
      const heading=String(section.querySelector("summary")?.textContent||"").toLowerCase();
      if(heading.includes("guide management")||heading.includes("filter management"))section.remove();
    });
    ownerRoot?.querySelector(".owner-filter-management")?.remove();
    $("ownerClearAllMessages")?.addEventListener("click",async()=>{
      const confirmation="PERMANENTLY DELETE EVERY ROOM CHAT MESSAGE AND EVERY PRIVATE MESSAGE FOR ALL USERS?\n\nThis cannot be undone. Accounts, passwords, ranks, gold, settings, rooms, reports, and moderation/audit history will remain. Type CLEAR in the next prompt to continue.";
      if(!window.confirm(confirmation))return;
      if(window.prompt("Type CLEAR to permanently remove all room and private messages:")!=="CLEAR")return;
      const button=$("ownerClearAllMessages"),status=$("ownerClearAllMessagesStatus");
      if(button){button.disabled=true;button.textContent="⏳ Clearing messages…";}
      if(status)status.textContent="Deleting stored chat messages…";
      try{
        const result=await api("/api/owner/refresh-site-messages",{method:"POST"});
        state.messages=[];state.privateMessages=[];
        if($("messages"))$("messages").innerHTML="";
        if($("dmMessages"))$("dmMessages").innerHTML="";
        toast("Cleared "+Number(result.roomMessagesRemoved||0)+" room messages and "+Number(result.privateMessagesRemoved||0)+" private messages.");
        if(status)status.textContent="All room and private messages were permanently cleared.";
      }catch(error){
        if(status)status.textContent=error.message||"Could not clear messages.";
        toast(error.message||"Could not clear messages.");
      }finally{if(button){button.disabled=false;button.textContent="🧹 Clear all room & private messages";}}
    });

    // Owner controls are injected dynamically; sync the toggle with persisted server state after rendering.
    await checkUnderConstruction();
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
    if($('addBulkFilter')) $('addBulkFilter').onclick=async()=>{try{await api('/api/filter-words/bulk',{method:'POST',body:JSON.stringify({text:$('bulkFilterWords').value})});$('bulkFilterWords').value='';toast('Filter entries saved.');await loadOwner();}catch(e){toast(e.message)}};
    const addQuickFilterEntry=async(inputId,prefix,label)=>{const input=$(inputId),value=String(input?.value||'').trim();if(!value){toast('Enter a word or phrase first.');input?.focus();return;}const entry=prefix+value;const button=input?.parentElement?.nextElementSibling;try{if(button){button.disabled=true;button.textContent='Saving…';}await api('/api/filter-words/bulk',{method:'POST',body:JSON.stringify({text:entry})});toast(label+' saved.');await loadOwner();}catch(e){toast(e.message||'Could not save filter entry.');}finally{if(button){button.disabled=false;button.textContent=label;}}};
    if($('filterSearch')) $('filterSearch').oninput=()=>{const q=$('filterSearch').value.toLowerCase();const rows=[...document.querySelectorAll('.filter-table-row')];let showing=0;rows.forEach(r=>{const show=r.dataset.word.toLowerCase().includes(q);r.style.display=show?'':'none';if(show)showing++});$('filterCounts').textContent=`Total: ${rows.length} | Showing: ${showing}`};

    const commandKeys=["rose","bread","brain","welcome","ship","bank","steal","roast","aura","anonymous","abrakadabra","clear"],rankChoices=["MEMBER","VIP","PREMIUM","ROYAL","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"],commandLabels={rose:"Rose",bread:"Bread",brain:"Brain",welcome:"Welcome",ship:"Ship",bank:"Bank",steal:"Steal",roast:"Roast",aura:"Aura",anonymous:"Anonymous message",abrakadabra:"Abrakadabra",clear:"Clear room"};
    const commandData=(await api("/api/owner/command-management").catch(()=>({commands:{}}))).commands||{},commandHost=$("ownerCommandManagementRows");
    if(commandHost)commandHost.innerHTML=commandKeys.map(key=>{const item=commandData[key]||{name:key,ranks:rankChoices},chosen=Array.isArray(item.ranks)?item.ranks:rankChoices;return '<div class="card" style="margin:8px 0"><b>'+esc(commandLabels[key]||key)+'</b><label>Command name<input data-command-name="'+key+'" maxlength="24" value="'+esc(item.name||key)+'"></label><div class="rank-check-grid">'+rankChoices.map(rank=>'<label><input type="checkbox" data-command-rank="'+key+'" value="'+rank+'" '+(chosen.includes(rank)?'checked':'')+'> '+rank+'</label>').join('')+'</div></div>';}).join('');
    $("saveOwnerCommandManagement")?.addEventListener("click",async()=>{const commands={};commandKeys.forEach(key=>commands[key]={name:$('[data-command-name="'+key+'"]')?.value||key,ranks:[...document.querySelectorAll('[data-command-rank="'+key+'"]:checked')].map(x=>x.value)});const status=$("ownerCommandManagementStatus");try{await api("/api/owner/settings",{method:"PATCH",body:JSON.stringify({commandManagement:commands})});if(status)status.textContent="Saved.";toast("Command settings saved.");}catch(e){if(status)status.textContent=e.message;toast(e.message);}});
    const modeData=(await api("/api/owner/mode-management").catch(()=>({modes:{}}))).modes||{},modeLabels={ghost:"👻 Ghost Mode",dead:"💀 Dead Mode",invisible:"😈 Invisible Mode"},modeHost=$("ownerModeManagementRows");
    if(modeHost)modeHost.innerHTML=Object.keys(modeLabels).map(key=>{const chosen=Array.isArray(modeData[key])?modeData[key]:(key==="invisible"?["OWNER"]:["OWNER"]);return '<div class="card" style="margin:8px 0"><b>'+modeLabels[key]+'</b><div class="rank-check-grid">'+rankChoices.map(rank=>'<label><input type="checkbox" data-mode-rank="'+key+'" value="'+rank+'" '+(chosen.includes(rank)?'checked':'')+'> '+rank+'</label>').join('')+'</div></div>';}).join('');
    $("saveOwnerModeManagement")?.addEventListener("click",async()=>{const modes={};Object.keys(modeLabels).forEach(key=>{modes[key]=[...document.querySelectorAll('[data-mode-rank="'+key+'"]:checked')].map(x=>x.value);});const status=$("ownerModeManagementStatus");try{await api("/api/owner/settings",{method:"PATCH",body:JSON.stringify({modeManagement:modes})});if(status)status.textContent="Saved.";toast("Mode settings saved.");}catch(e){if(status)status.textContent=e.message;toast(e.message);}});
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
    {title:"🪄 Gold",items:[
      ["/Abrakadabra","Randomly changes your Gold balance, within the site's balance limits."],
      ["/welcome @username","Post a glowing WELCOME BACK bubble for the named user."],
      ["/bank [username]","Show a Bot bank card with the account XP, level, and Gold. Leave username blank to check your own."],
      ["/steal username","Try to steal Gold. Outcomes can be a successful heist, a bail fee, or reverse loot."],
      ["/ship @username","Show Bot’s compatibility score and glowing percentage bar for you and that user."]
    ]},
    {title:"🛡️ Room controls",items:[
      ["/clear","Clear messages from the current room (subject to your configured rank permission)."]
    ]}
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
      manage_staff_accounts:'Edit staff account details.',staff_rank_assignment:'Assign eligible staff ranks.',manage_gold:'Adjust user gold.',profile_like:'Like user profiles.',enter_private_club:'Enter private clubs.',
      account_register:'Register accounts',account_login:'Log in',account_settings:'Access account settings',change_own_password:'Change own password',change_own_email:'Change own email',account_export:'Export account data',manage_sessions:'Manage all sessions',view_login_history:'View login history',manage_device_sessions:'Manage device sessions',manage_push_notifications:'Manage push notifications',
      search_users:'Search users',view_profiles:'View profiles',friend_requests:'Send and manage friend requests',manage_friends:'Manage friends',block_users:'Block users',nickname_users:'Set user nicknames',profile_status:'Set profile status',profile_frames:'Use profile frames',profile_backgrounds:'Use profile backgrounds',profile_colors:'Customize profile colors',profile_pronouns:'Set profile pronouns',profile_showcase:'Customize profile showcase',presence_modes:'Change presence mode',ghost_mode:'Use Ghost Mode',dead_mode:'Use Dead Mode',
      search_rooms:'Search rooms',leave_rooms:'Leave rooms',room_passwords:'Use room passwords',room_member_limits:'Configure room member limits',room_rank_restrictions:'Restrict rooms by rank',room_friends_only:'Use friends-only rooms',room_topics:'Edit room topics',room_rules:'View room rules',room_staff_list:'View room staff list',room_mute_users:'Mute users in rooms',room_kick_users:'Kick users from rooms',room_block_users:'Block users from rooms',room_edit_rules:'Edit room rules',room_persistence:'Use persistent rooms',room_themes:'Apply room themes',room_message_search:'Search room messages',
      reply_messages:'Reply to messages',quote_messages:'Quote messages',delete_own_messages:'Delete own messages',copy_messages:'Copy messages',hide_messages:'Hide messages',mention_users:'Mention users',chat_unread_counts:'View chat unread counts',chat_attachments:'Send chat attachments',chat_image_upload:'Upload chat images',chat_video_upload:'Upload chat videos',chat_audio_upload:'Upload chat audio',chat_youtube_music:'Share YouTube Music',chat_message_search:'Search chat messages',chat_message_expiry:'Use expiring messages',chat_scheduled_messages:'Schedule messages',chat_doodle_share:'Share doodles',chat_doodle_save:'Save doodles',chat_aurora_announcements:'Post Aurora announcements',
      dm_search:'Search private conversations',dm_unread_counts:'View private-message unread counts',dm_previews:'View private-message previews',dm_reply:'Reply to private messages',dm_pin:'Pin private conversations',dm_mute:'Mute private conversations',dm_archive:'Archive private conversations',dm_filters:'Filter private conversations',dm_nicknames:'Set private nicknames',dm_preferences:'Manage private-message preferences',dm_report:'Report private messages',inspect_private_messages:'Inspect private messages',manage_dm_reports:'Manage private-message reports',
      news_read:'Read news',news_comment:'Comment on news',news_react:'React to news',news_report:'Report news',news_pin:'Pin news',wall_read:'Read Friends Wall',wall_comment:'Comment on wall posts',wall_react:'React to wall posts',wall_report:'Report wall posts',wall_pin:'Pin wall posts',suggestions_submit:'Submit suggestions',suggestions_review:'Review suggestions',suggestions_set_status:'Set suggestion status',suggestions_notify_submitter:'Notify suggestion submitter',
      games_access:'Access games',gravity_run:'Play Gravity Run',doodle_studio_save:'Save Doodle Studio drawings',doodle_studio_share:'Share Doodle Studio drawings',gif_search:'Search GIF library',media_embeds:'Use media embeds',
      premium_access:'Access Premium features',vip_access:'Access VIP features',gold_wallet:'View gold wallet',gold_catalogue:'Browse gold catalogue',gold_purchase:'Purchase catalogue items',gold_equip:'Equip owned items',gold_transaction_history:'View gold transaction history',daily_rewards:'Claim daily rewards',achievement_access:'View achievements',premium_requests:'Submit Premium requests',grant_premium:'Grant Premium status',
      view_rules:'View site rules',submit_reports:'Submit reports',manage_reports:'Manage reports',report_assign:'Assign reports',report_resolve:'Resolve reports',edit_site_rules:'Edit site rules',edit_room_rules:'Edit room rules',leaderboard_access:'View leaderboards',saved_messages:'Access saved messages',advanced_search:'Use advanced search',staff_application_submit:'Submit staff applications',staff_application_review:'Review staff applications',staff_dashboard_access:'Access staff dashboard',staff_notifications:'Manage staff notifications',system_notifications:'Send system notifications',audit_log_access:'View audit logs',audit_log_settings:'Configure audit logs',under_construction_control:'Toggle Under Construction mode',site_hard_refresh:'Use staff site refresh',
      inspect_ip_details:'Inspect IP details',inspect_similar_ips:'Inspect similar-IP insights',view_user_history:'View user history',view_username_history:'View username history',manage_profile_notes:'Manage profile notes',manage_account_locks:'Manage account locks',manage_avatar:'Manage user avatars',delete_accounts:'Delete user accounts',manage_bans:'Ban and unban users',manage_mutes:'Mute and unmute users',manage_kicks:'Kick users',manage_warnings:'Warn users',manage_automated_filters:'Manage automated filters',manage_vpn_proxy_rules:'Manage VPN/proxy rules',manage_multi_account_rules:'Manage multi-account rules',manage_spam_flood_rules:'Manage spam/flood rules',manage_user_feature_exceptions:'Manage individual-user permissions',manage_rank_feature_grants:'Manage rank-based feature grants',manage_individual_feature_grants:'Manage individual feature grants',manage_owner_space:'Access Owner Space',manage_site_refresh:'Manage site refresh',view_system_diagnostics:'View system diagnostics',manage_site_themes:'Manage site themes',manage_economy_settings:'Manage economy settings',manage_premium_settings:'Manage Premium settings',manage_notifications_settings:'Manage notification settings',manage_room_permissions:'Manage room permissions',manage_room_themes:'Manage room themes',manage_room_staff:'Manage room staff',manage_suggestions_settings:'Manage suggestion settings',manage_feature_granting:'Manage Feature Granting'
    };
    const categoryFor={
      send_messages:'Chat & media',emojis_stickers:'Chat & media',chat_file_upload:'Chat & media',gif_sending:'Chat & media',private_messages:'Chat & media',edit_message:'Chat & media',pin_message:'Chat & media',save_message:'Chat & media',react_message:'Chat & media',use_youtube:'Chat & media',
      create_rooms:'Rooms',edit_rooms:'Rooms',delete_rooms:'Rooms',join_rooms:'Rooms',delete_own_room:'Rooms',clear_room:'Rooms',room_announcement:'Rooms',view_pinned:'Rooms',
      friend_wall_posting:'Social & community',wall_post:'Social & community',wall_commenting:'Social & community',wall_liking:'Social & community',wall_upload:'Social & community',profile_like:'Social & community',manage_clubs:'Social & community',enter_private_club:'Social & community',share_gold:'Gold & rewards',
      news_posting:'News & content',manage_news:'News & content',delete_news:'News & content',
      change_avatar:'Accounts & profiles',change_bio:'Accounts & profiles',account_modifications:'Accounts & profiles',change_password:'Accounts & profiles',edit_email:'Accounts & profiles',profile_note:'Accounts & profiles',view_emails:'Accounts & profiles',
      view_online_users:'Staff & moderation',manage_filter_words:'Staff & moderation',manage_filters:'Staff & moderation',premium_granting:'Staff & moderation',reports_management:'Staff & moderation',moderate_users:'Staff & moderation',moderate_user:'Staff & moderation',bypass_filter_words:'Staff & moderation',bypass_mute:'Staff & moderation',delete_message:'Staff & moderation',view_ips:'Staff & moderation',manage_staff_accounts:'Staff & moderation',staff_rank_assignment:'Staff & moderation',invisible_mode:'Staff & moderation',
      manage_xp_level:'Owner tools',manage_ranks:'Owner tools',manage_settings:'Owner tools',manage_gold:'Owner tools',manage_bots:'Owner tools',manage_mal_ai:'Owner tools',manage_aurora:'Owner tools',manage_feature_lab:'Owner tools',clear_history_button:'Owner tools',
       account_register:'Accounts & profiles',account_login:'Accounts & profiles',account_settings:'Accounts & profiles',change_own_password:'Accounts & profiles',change_own_email:'Accounts & profiles',account_export:'Accounts & profiles',manage_sessions:'Security & privacy',view_login_history:'Security & privacy',manage_device_sessions:'Security & privacy',manage_push_notifications:'Notifications',search_users:'Social & community',view_profiles:'Social & community',friend_requests:'Social & community',manage_friends:'Social & community',block_users:'Social & community',nickname_users:'Social & community',profile_status:'Accounts & profiles',profile_frames:'Accounts & profiles',profile_backgrounds:'Accounts & profiles',profile_colors:'Accounts & profiles',profile_pronouns:'Accounts & profiles',profile_showcase:'Accounts & profiles',presence_modes:'Accounts & profiles',ghost_mode:'Accounts & profiles',dead_mode:'Accounts & profiles',
       search_rooms:'Rooms',leave_rooms:'Rooms',room_passwords:'Rooms',room_member_limits:'Rooms',room_rank_restrictions:'Rooms',room_friends_only:'Rooms',room_topics:'Rooms',room_rules:'Rooms',room_staff_list:'Rooms',room_mute_users:'Room staff & moderation',room_kick_users:'Room staff & moderation',room_block_users:'Room staff & moderation',room_edit_rules:'Room staff & moderation',room_persistence:'Rooms',room_themes:'Rooms',room_message_search:'Chat & media',reply_messages:'Chat & media',quote_messages:'Chat & media',delete_own_messages:'Chat & media',copy_messages:'Chat & media',hide_messages:'Chat & media',mention_users:'Chat & media',chat_unread_counts:'Chat & media',chat_attachments:'Chat & media',chat_image_upload:'Chat & media',chat_video_upload:'Chat & media',chat_audio_upload:'Chat & media',chat_youtube_music:'Chat & media',chat_message_search:'Chat & media',chat_message_expiry:'Chat & media',chat_scheduled_messages:'Chat & media',chat_doodle_share:'Games & media',chat_doodle_save:'Games & media',chat_aurora_announcements:'Rooms',
       dm_search:'Private messages',dm_unread_counts:'Private messages',dm_previews:'Private messages',dm_reply:'Private messages',dm_pin:'Private messages',dm_mute:'Private messages',dm_archive:'Private messages',dm_filters:'Private messages',dm_nicknames:'Private messages',dm_preferences:'Private messages',dm_report:'Private messages',inspect_private_messages:'Private messages',manage_dm_reports:'Private messages',
       news_read:'News & content',news_comment:'News & content',news_react:'News & content',news_report:'News & content',news_pin:'News & content',wall_read:'Social & community',wall_comment:'Social & community',wall_react:'Social & community',wall_report:'Social & community',wall_pin:'Social & community',suggestions_submit:'Suggestions & community',suggestions_review:'Suggestions & community',suggestions_set_status:'Suggestions & community',suggestions_notify_submitter:'Suggestions & community',
       games_access:'Games & media',gravity_run:'Games & media',doodle_studio_save:'Games & media',doodle_studio_share:'Games & media',gif_search:'Games & media',media_embeds:'Games & media',premium_access:'Gold & rewards',vip_access:'Gold & rewards',gold_wallet:'Gold & rewards',gold_catalogue:'Gold & rewards',gold_purchase:'Gold & rewards',gold_equip:'Gold & rewards',gold_transaction_history:'Gold & rewards',daily_rewards:'Gold & rewards',achievement_access:'Gold & rewards',premium_requests:'Gold & rewards',grant_premium:'Staff & moderation',view_rules:'Safety & reports',submit_reports:'Safety & reports',manage_reports:'Safety & reports',report_assign:'Safety & reports',report_resolve:'Safety & reports',edit_site_rules:'Safety & reports',edit_room_rules:'Safety & reports',leaderboard_access:'Social & community',saved_messages:'Chat & media',advanced_search:'Social & community',staff_application_submit:'Staff & moderation',staff_application_review:'Staff & moderation',staff_dashboard_access:'Staff & moderation',staff_notifications:'Notifications',system_notifications:'Notifications',audit_log_access:'Staff & moderation',audit_log_settings:'Owner tools',under_construction_control:'Owner tools',site_hard_refresh:'Staff & moderation',
       inspect_ip_details:'Security & privacy',inspect_similar_ips:'Security & privacy',view_user_history:'Security & privacy',view_username_history:'Security & privacy',manage_profile_notes:'Staff & moderation',manage_account_locks:'Security & privacy',manage_avatar:'Accounts & profiles',delete_accounts:'Owner tools',manage_bans:'Staff & moderation',manage_mutes:'Staff & moderation',manage_kicks:'Staff & moderation',manage_warnings:'Staff & moderation',manage_automated_filters:'Staff & moderation',manage_vpn_proxy_rules:'Security & privacy',manage_multi_account_rules:'Security & privacy',manage_spam_flood_rules:'Staff & moderation',manage_user_feature_exceptions:'Owner tools',manage_rank_feature_grants:'Owner tools',manage_individual_feature_grants:'Owner tools',manage_owner_space:'Owner tools',manage_site_refresh:'Owner tools',view_system_diagnostics:'Owner tools',manage_site_themes:'Owner tools',manage_economy_settings:'Owner tools',manage_premium_settings:'Owner tools',manage_notifications_settings:'Owner tools',manage_room_permissions:'Owner tools',manage_room_themes:'Owner tools',manage_room_staff:'Owner tools',manage_suggestions_settings:'Owner tools',manage_feature_granting:'Owner tools'
    };
    const ranks=d.ranks||['MEMBER','VIP','PREMIUM','MOD','ADMIN','SUPER_ADMIN','COMMISSOR','COOWNER','OWNER'];
    const rankLabels={MEMBER:'Member',VIP:'VIP',PREMIUM:'Premium',ROYAL:'Royal',MOD:'Moderator',ADMIN:'Admin',SUPER_ADMIN:'Super Admin',COMMISSOR:'Commissor',INSTRUCTOR:'Instructor',COOWNER:'Co-owner',OWNER:'Owner'};
    const keys=Object.keys(d.features||{}).filter(key=>!['schedule_message','expire_message'].includes(key)), categories={};
    keys.forEach(key=>{const category=categoryFor[key]||'Other site features';if(!categories[category])categories[category]=[];categories[category].push(key);});
    function renderRow(key){
      const allowed=d.grants?.[key]||[];
      const name=labels[key]||key.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
      const description=descriptions[key]||'Select exactly which ranks can use this feature.';
      return '<div class="feature-grant-row" data-feature-row="'+esc(key)+'" data-feature-search="'+esc((name+' '+key+' '+description).toLowerCase())+'"><div><b>'+esc(name)+'</b><small>'+esc(description)+'</small></div><div class="feature-grant-rank-checks">'+ranks.map(rank=>'<label><input type="checkbox" data-grant-rank="'+esc(key)+'" value="'+rank+'" '+(allowed.includes(rank)?'checked':'')+'> '+esc(rankLabels[rank]||rank)+'</label>').join('')+'</div></div>';
    }
    const grouped=Object.entries(categories).map(([name,items])=>'<details class="grant-category" '+(name==='Chat & media'?'open':'')+'><summary>'+esc(name)+' <span class="muted">('+items.length+')</span></summary>'+items.map(renderRow).join('')+'</details>').join('');
    modal('<div class="feature-grant-modal feature-grant-simple"><h2>🧩 Feature Access</h2><p class="muted">Choose the exact ranks allowed to use each feature. Select multiple ranks when needed. Developer and the protected owner account keep built-in access.</p><label class="feature-grant-search-label">🔎 Find a feature<input id="featureGrantSearch" type="search" placeholder="Search messages, rooms, gold, reports…"></label><div class="feature-grant-summary">'+keys.length+' feature controls · Changes are saved together</div><div id="featureGrantCategories">'+(grouped||'<p class="muted">No feature controls are available.</p>')+'</div><div class="toolbar feature-grant-footer"><button class="primary" id="saveAllFeatureGrants">Save all changes</button><button class="mini" id="closeFeatureGrants">Close</button></div><p class="muted feature-grant-note">These are exact rank permissions. Individual account exceptions are managed separately in User Permissions.</p></div>');
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
        const grants={};keys.forEach(key=>{grants[key]=[...document.querySelectorAll('[data-grant-rank="'+key+'"]:checked')].map(input=>input.value);});
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
    const allReports=d.reports||[];
    const openCount=allReports.filter(r=>String(r.status||"OPEN").toUpperCase()==="OPEN").length;
    const renderReports=(query="",status="OPEN")=>{
      const q=String(query||"").trim().toLowerCase();
      const filtered=allReports.filter(r=>{
        const st=String(r.status||"OPEN").toUpperCase();
        if(status!=="ALL"&&st!==status)return false;
        const snap=r.messageSnapshot||{};
        const hay=[r.category,r.reporterUsername,r.reportedUserUsername,r.reason,r.messagePreview,snap.text,r.assignedToUsername].join(" ").toLowerCase();
        return !q||hay.includes(q);
      }).slice(0,100);
      const rows=filtered.map(r=>{
        const snap=r.messageSnapshot||{};
        const who=r.reportedUserUsername||snap.username||"Unknown";
        const category=r.category||(r.conversationUserId?"Private message":r.messageId?"Message":"Profile");
        const st=String(r.status||"OPEN").toUpperCase();
        return `<article class="report-dropdown-item report-manager-item">
          <div class="report-dropdown-copy"><b>${esc(category)} · @${esc(who)}</b><span>${esc(snap.text||r.messagePreview||r.reason||"No report text supplied")}</span>
          ${snap.attachment?.type?.startsWith("image/")&&snap.attachment?.url?`<a href="${esc(snap.attachment.url)}" target="_blank" rel="noopener"><img class="reported-image" src="${esc(snap.attachment.url)}" alt="Reported image"></a>`:snap.attachment?.url?`<a href="${esc(snap.attachment.url)}" target="_blank" rel="noopener">Open reported attachment</a>`:""}
          <small>Reported by @${esc(r.reporterUsername||"Unknown")} · ${fmt(r.time)} · ${esc(st)}</small>
          <small>Reason: ${esc(r.reason||"No reason supplied")}${r.assignedToUsername?' · Assigned to @'+esc(r.assignedToUsername):''}</small>
          ${r.conversationUserId?'<small class="report-evidence-hint">🔒 Private-message evidence available</small>':""}</div>
          <div class="toolbar report-manager-actions">
          ${r.conversationUserId?`<button class="mini" data-report-evidence="${esc(r.id)}">View messages</button>`:""}
          ${r.reportedUserId?`<button class="mini" data-report-moderate="${esc(r.reportedUserId)}">Moderate</button>`:""}
          <button class="mini" data-report-assign="${esc(r.id)}">Assign staff</button>
          ${r.messageId?`<button class="mini danger" data-report-delete-message="${esc(r.messageId)}">Delete reported message</button>`:""}
          ${st!=="RESOLVED"?`<button class="mini primary" data-report-resolve="${esc(r.id)}">Resolve</button>`:""}
          </div></article>`;
      }).join("");
      const list=box.querySelector("#reportManagerList");
      if(list)list.innerHTML=rows||'<p class="muted notification-empty">No reports match these filters.</p>';
      const count=box.querySelector("#reportManagerCount");
      if(count)count.textContent=`Showing ${filtered.length} of ${allReports.length} reports`;
      box.querySelectorAll("[data-report-moderate]").forEach(b=>b.onclick=()=>{box.classList.add("hidden");moderate(b.dataset.reportModerate);});
      box.querySelectorAll("[data-report-evidence]").forEach(b=>b.onclick=()=>{box.classList.add("hidden");viewPrivateMessageReport(b.dataset.reportEvidence);});
      box.querySelectorAll("[data-report-resolve]").forEach(b=>b.onclick=async()=>{await resolveReport(b.dataset.reportResolve);await toggleReportDropdown(true);});
      box.querySelectorAll("[data-report-assign]").forEach(b=>b.onclick=async()=>{await assignReport(b.dataset.reportAssign);await toggleReportDropdown(true);});
      box.querySelectorAll("[data-report-delete-message]").forEach(b=>b.onclick=async()=>{box.classList.add("hidden");await deleteReportedMessage(b.dataset.reportDeleteMessage);await toggleReportDropdown(true);});
    };
    box.innerHTML=`<div class="notification-dropdown-head"><div><b>⚑ Report Management</b><small class="notification-unread-summary">${openCount} open · ${allReports.length} total</small></div><button class="mini" id="refreshReportManager">↻ Refresh</button></div>
      <div class="report-manager-tools"><input type="search" id="reportManagerSearch" placeholder="Search reports, users, reasons…" aria-label="Search reports"><select id="reportManagerStatus" aria-label="Filter report status"><option value="OPEN">Open reports</option><option value="ALL">All reports</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></select><small id="reportManagerCount"></small></div>
      <div id="reportManagerList" class="report-manager-list"></div>`;
    box.classList.remove("hidden");
    box.querySelector("#reportManagerSearch")?.addEventListener("input",e=>renderReports(e.target.value,box.querySelector("#reportManagerStatus")?.value||"OPEN"));
    box.querySelector("#reportManagerStatus")?.addEventListener("change",e=>renderReports(box.querySelector("#reportManagerSearch")?.value||"",e.target.value));
    box.querySelector("#refreshReportManager")?.addEventListener("click",()=>toggleReportDropdown(true));
    renderReports();
  }catch(e){box.innerHTML=`<div class="notification-dropdown-head"><b>⚑ Report Management</b></div><p class="muted">${esc(e.message||"Reports are available to authorized staff only.")}</p>`;box.classList.remove("hidden");}
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

let topDMUnreadRefreshBusy=false;
async function refreshTopDMUnreadBadge(){
  if(!state.user||topDMUnreadRefreshBusy)return;
  topDMUnreadRefreshBusy=true;
  try{
    // The conversations endpoint already powers the inbox dropdown; use its
    // per-conversation unread counts so the header badge matches what users see.
    const data=await api("/api/dm/conversations");
    const conversations=Array.isArray(data.conversations)?data.conversations:[];
    const count=conversations.reduce((total,conversation)=>total+Math.max(0,Number(conversation.unreadCount)||0),0);
    for(const id of ["topDmDot","dmDot"]){
      const el=$(id);if(!el)continue;
      el.textContent=count>99?"99+":String(count);
      el.classList.toggle("count-badge",count>0);
      el.style.setProperty("display",count>0?"inline-flex":"none","important");
      el.setAttribute("aria-label",count+" unread private messages");
    }
  }catch(error){console.warn("Private-message badge refresh failed:",error?.message||error);}
  finally{topDMUnreadRefreshBusy=false;}
}
let notificationRefreshPromise=null;
async function loadNotifications() {
  // This runs on a timer and socket reconnects. Do not hit authenticated APIs
  // while the login screen is active, or start duplicate sets of requests.
  if (!state.user) return;
  if(notificationRefreshPromise)return notificationRefreshPromise;
  notificationRefreshPromise=(async()=>{
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
  } finally {
    notificationRefreshPromise=null;
  }
  })();
  return notificationRefreshPromise;
}
// Notification counters are a background convenience, not a live chat
// transport. Polling five APIs every 5 seconds was creating needless load.
// Opening notification views and socket reconnects refresh immediately.
setInterval(()=>{if(state.user)loadNotifications();},15000);
setInterval(()=>{if(state.user)refreshTopDMUnreadBadge();},5000);
setTimeout(()=>{if(state.user){loadNotifications();refreshTopDMUnreadBadge();}},1200);

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
  try{ const data=await api(`/api/rooms/${encodeURIComponent(state.currentRoom)}/pinned`); const pinned=data.messages||[]; modal(`<h2>📌 Pinned messages</h2><p class="muted">Pinned messages in ${esc(state.rooms.find(r=>String(r.id)===String(state.currentRoom))?.name||'this room')}.</p><div class="pinned-list">${pinned.map(m=>`<button class="pinned-result" onclick="closeModal();jumpToMessage('${esc(m.id)}')"><b>${esc(m.displayName||m.username)}</b><small>${fmt(m.time)}</small><span>${esc(m.text||'📎 Attachment')}</span></button>`).join('')||'<p class="muted">No pinned messages in this room.</p>'}</div>`); }catch(e){toast(e.message)}
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

/* ---------------- ROOM MENU ---------------- */

$("roomMenu").onclick = () => {
  const room =
    state.rooms.find(
      r => String(r.id) === String(state.currentRoom)
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
      ${["ghost","dead","invisible"].some(canUsePresenceMode)?`
        <div style="flex-basis:100%;border-top:1px solid var(--border-color,#393244);padding-top:8px;margin-top:4px"><b style="display:block;margin-bottom:7px">🕶️ Presence modes</b><div class="toolbar" style="display:flex;flex-wrap:wrap;gap:6px">${canUsePresenceMode("ghost")?'<button type="button" class="mini" onclick="togglePresenceMode(&quot;ghost&quot;)">👻 Ghost Mode</button>':""}${canUsePresenceMode("dead")?'<button type="button" class="mini" onclick="togglePresenceMode(&quot;dead&quot;)">💀 Dead Mode</button>':""}${canUsePresenceMode("invisible")?'<button type="button" class="mini" onclick="togglePresenceMode(&quot;invisible&quot;)">😈 Invisible Mode</button>':""}</div><button type="button" class="mini" style="margin-top:7px" onclick="openPresenceModes()">⚙️ Open mode settings</button></div>
      `:""}
      ${canUsePartyMode()?'<div style="flex-basis:100%;border-top:1px solid var(--border-color,#393244);padding-top:8px;margin-top:4px"><b style="display:block;margin-bottom:7px">🎉 Party Mode</b><button type="button" class="mini" onclick="setPartyMode(!isPartyModeActive())">'+(isPartyModeActive()?"🎉 Turn Party Mode Off":"🎉 Turn Party Mode On")+"</button></div>":""}

    </div>
  `);
};



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
  const room=state.rooms.find(r=>String(r.id)===String(state.currentRoom));
  if(!room)return;
  if(room.isDefault || /^main room$/i.test(String(room.name||"").trim())){toast("Main Room is protected.");return;}
  const ranks=["MEMBER","VIP","PREMIUM","ROYAL","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"];
  const rankLabels={MEMBER:"Member",VIP:"VIP",PREMIUM:"Premium",MOD:"Moderator",ADMIN:"Admin",SUPER_ADMIN:"Super Admin",COMMISSOR:"Commissor",COOWNER:"Co-owner",OWNER:"Owner",ROYAL:"Legacy rank — Royal",INSTRUCTOR:"Legacy rank — Instructor"};
  const savedRequiredRank=String(room.rankRequired||"MEMBER").toUpperCase();
  const rankChoices=ranks.includes(savedRequiredRank)?ranks:[savedRequiredRank,...ranks];
  modal(`
    <div class="room-editor room-editor-edit">
      <header class="room-editor-hero"><span class="room-editor-hero-icon">✏️</span><div><p class="room-editor-eyebrow">ROOM CONTROL</p><h2>Edit room</h2><p>Update this room’s look, access and limits.</p></div></header>
      <section class="room-editor-section"><h3>✨ Identity</h3><div class="room-editor-grid room-editor-identity">
        <label>Room name<input id="rn" maxlength="50" required value="${esc(room.name||"")}" placeholder="e.g. Midnight Lounge"></label>
        <label>Room icon<input id="ri" maxlength="8" value="${esc(room.icon||"💬")}" placeholder="💬"></label>
        <label class="room-editor-wide">Description<textarea id="rd" maxlength="300" rows="3" placeholder="What is this room for?">${esc(room.description||"")}</textarea></label>
        <label>Topic / category<input id="rc" maxlength="40" value="${esc(room.category||"Community")}" placeholder="Community"></label>
        <label>Banner image URL <span class="room-editor-optional">optional</span><input id="rBanner" type="url" value="${esc(room.banner||"")}" placeholder="https://…"></label>
      </div></section>
      <section class="room-editor-section"><h3>🔐 Access & privacy</h3>
        <label>Who can discover this room<select id="rPublic"><option value="true" ${room.public!==false?"selected":""}>Public — listed for everyone</option><option value="false" ${room.public===false?"selected":""}>Private — not publicly listed</option></select></label>
        <label>Minimum rank to join<select id="rRankRequired">${rankChoices.map(r=>'<option value="'+r+'" '+(savedRequiredRank===r?'selected':'')+'>'+(rankLabels[r]||r.replaceAll("_"," "))+'</option>').join("")}</select></label>
        <label>Member access<select id="rFriendsOnly"><option value="false" ${room.friendsOnly?'':'selected'}>Anyone who meets the rank requirement</option><option value="true" ${room.friendsOnly?'selected':''}>Accepted friends only</option></select></label>
        <label>Change room password <span class="room-editor-optional">leave blank to remove it</span><input id="rp" type="password" autocomplete="new-password" placeholder="Enter a new password"></label>
      </section>
      <section class="room-editor-section"><h3>⚙️ Room limits</h3><div class="room-editor-grid">
        <label>Member limit<input id="rLimit" type="number" min="2" max="500" value="${Math.max(2,Math.min(500,Number(room.limit||100)))}"></label>
        <label>Slow mode (seconds)<input id="rs" type="number" min="0" max="3600" value="${Math.max(0,Number(room.slowMode||0))}"></label>
      </div><p class="room-editor-help">Slow mode sets the minimum delay between messages from the same user. Use 0 to turn it off.</p></section>
      <footer class="room-editor-footer"><span class="room-editor-owner">Owner: @${esc(room.creator||"Unknown")}</span><button type="button" class="mini" onclick="closeModal()">Cancel</button><button type="button" class="primary" id="saveRoomChanges">Save changes</button></footer>
    </div>`);
  $("saveRoomChanges").onclick=saveRoom;
}

async function saveRoom() {
  try {
    await api(
      `/api/rooms/${state.currentRoom}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: $("rn").value,
          icon: $("ri").value,
          description: $("rd").value,
          category: $("rc").value.trim() || "Community",
          slowMode: Number($("rs").value || 0),
          limit: Math.max(2, Math.min(500, Number($("rLimit").value || 100))),
          banner: $("rBanner").value.trim(),
          public: $("rPublic").value === "true",
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

async function showInvite(roomOrId=state.currentRoom) {
  const room = roomOrId&&typeof roomOrId==="object"
    ? roomOrId
    : state.rooms.find(r => String(r.id) === String(roomOrId));

  if (!room) return;

  let inviteToken="",expiresAt=null;
  if(room.public===false){
    try{const result=await api(`/api/rooms/${encodeURIComponent(room.id)}/invites`,{method:"POST",body:JSON.stringify({})});inviteToken=String(result.inviteToken||"");expiresAt=result.expiresAt||null;}
    catch(error){toast(error.message||"Could not create this room invitation.");return;}
    if(!inviteToken){toast("Could not create this room invitation.");return;}
  }
  const inviteUrl=`${location.origin}/#room=${encodeURIComponent(room.id)}${inviteToken?`&invite=${encodeURIComponent(inviteToken)}`:""}`;

  modal(`
    <h2>Room invite</h2>
    ${expiresAt?`<p class="muted">This private-room invite expires ${esc(new Date(expiresAt).toLocaleString())}.</p>`:""}

    <input id="roomInviteUrl"
      value="${esc(inviteUrl)}"
      readonly
    >
    <div class="toolbar"><button type="button" class="primary" id="copyRoomInvite">Copy invite link</button></div>
  `);
  $("copyRoomInvite")?.addEventListener("click",async()=>{
    try{await navigator.clipboard.writeText(inviteUrl);toast("Invite link copied.");}
    catch{const field=$("roomInviteUrl");field?.select();toast("Invite link selected. Copy it from the field.");}
  });
}

/* ---------------- CREATE ROOM ---------------- */

function openRoomCreationModal() {
  const ranks=["MEMBER","VIP","PREMIUM","ROYAL","MOD","ADMIN","SUPER_ADMIN","COMMISSOR","INSTRUCTOR","COOWNER","OWNER","DEVELOPER"];
  const rankLabels={MEMBER:"Member",VIP:"VIP",PREMIUM:"Premium",ROYAL:"Royal",MOD:"Moderator",ADMIN:"Admin",SUPER_ADMIN:"Super Admin",COMMISSOR:"Commissor",INSTRUCTOR:"Instructor",COOWNER:"Co-owner",OWNER:"Owner",DEVELOPER:"Developer"};
  modal(`
    <div class="room-editor room-editor-create">
      <header class="room-editor-hero"><span class="room-editor-hero-icon">🌙</span><div><p class="room-editor-eyebrow">MAKE YOUR SPACE</p><h2>Create a room</h2><p>Set up a new corner of Maleficent Chat.</p></div></header>
      <form id="roomForm">
        <section class="room-editor-section"><h3>✨ The basics</h3><div class="room-editor-grid room-editor-identity">
          <label>Room name<input id="rn" maxlength="50" required placeholder="e.g. Midnight Lounge"></label>
          <label>Room icon<input id="ri" maxlength="8" value="💬" placeholder="💬"></label>
          <label class="room-editor-wide">Description<textarea id="rd" maxlength="300" rows="3" placeholder="What will people chat about?"></textarea></label>
          <label>Topic / category<input id="rc" maxlength="40" value="Community" placeholder="Community"></label>
        </div></section>
        <section class="room-editor-section"><h3>🔐 Who can join?</h3>
          <label>Room visibility<select id="rVisibility"><option value="public">Public — listed for everyone</option><option value="secret">Secret — hidden, invite link required</option></select></label>
          <label>Minimum rank<select id="rr">${ranks.map(r=>'<option value="'+r+'" '+(r==="MEMBER"?"selected":"")+'>'+rankLabels[r]+'</option>').join("")}</select></label>
          <label>Member access<select id="rFriendsOnlyCreate"><option value="false">Anyone who meets the rank requirement</option><option value="true">Accepted friends only</option></select></label>
          <label>Room password <span class="room-editor-optional">optional</span><input id="rp" type="password" autocomplete="new-password" placeholder="Leave blank for no password"></label>
        </section>
        <section class="room-editor-section"><h3>⚙️ Room capacity</h3><div class="room-editor-grid">
          <label>Member limit<input id="rl" type="number" min="2" max="500" value="100" required></label>
          <label>Slow mode (seconds)<input id="rs" type="number" min="0" max="3600" value="0" required></label>
        </div><p class="room-editor-help">Slow mode sets the minimum delay between messages from the same user. Use 0 to turn it off.</p></section>
        <footer class="room-editor-footer"><button type="button" class="mini" onclick="closeModal()">Cancel</button><button class="primary" type="submit">＋ Create room</button></footer>
      </form>
    </div>`);
  $("roomForm").onsubmit=async e=>{
    e.preventDefault();
    const submit=e.currentTarget.querySelector('[type="submit"]');
    if(submit){submit.disabled=true;submit.textContent="Creating…";}
    try{
      const created=await api("/api/rooms",{method:"POST",body:JSON.stringify({
        name:$("rn").value.trim(),icon:$("ri").value.trim()||"💬",description:$("rd").value.trim(),
        category:$("rc").value.trim()||"Community",password:$("rp").value,public:$("rVisibility").value!=="secret",
        rankRequired:$("rr").value,friendsOnly:$("rFriendsOnlyCreate").value==="true",
        limit:Math.max(2,Math.min(500,Number($("rl").value)||100)),
        slowMode:Math.max(0,Math.min(3600,Number($("rs").value)||0))
      })});
      await loadRooms();closeModal();renderRooms();toast("Room created.");
      if(created.room?.public===false&&created.room?.id)await showInvite(created.room);
    }catch(error){toast(error.message);if(submit){submit.disabled=false;submit.textContent="＋ Create room";}}
  };
}

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
  const canUsePartyModeForSettings=canUsePartyMode();
  $('settings').innerHTML=`
    <section class="settings-hero"><div class="settings-hero-glow"></div><div class="settings-hero-copy"><span class="settings-eyebrow">MALEFICENT CHAT · CONTROL CENTER</span><h2>Account settings</h2><p>Your account, your privacy, your aesthetic. Make this space yours.</p><div class="settings-hero-tags"><span>✦ Personalize</span><span>♢ Stay secure</span><span>♡ Your choices</span></div></div><div class="settings-hero-emblem">✧</div></section>
    ${canUsePartyModeForSettings ? `<div class="panel party-mode-settings-panel"><h3>🎉 Party Mode <small class="muted">SUPER_ADMIN+</small></h3><p class="muted">Add rainbow username glow, spinning GIFs and party music to this browser. This does not change what other users see.</p><button type="button" class="primary" id="settingsPartyMode">${isPartyModeActive()?'🎉 Turn Party Mode Off':'🎉 Turn Party Mode On'}</button></div>` : ''}
    <div class="grid2">
      <div class="panel"><h3>👤 Account</h3><p class="muted">Manage the information connected to your account.</p><div class="settings-list">
        <button class="settings-row" onclick="editProfileInfo()"><span>🪪</span><b>Profile information</b><small>Display name, pronouns and basic details</small><strong>›</strong></button>
        <button class="settings-row" onclick="editAboutMe()"><span>💬</span><b>About Me</b><small>Update your profile description</small><strong>›</strong></button>
        <button class="settings-row" onclick="editEmail()"><span>✉</span><b>Email</b><small>Optional recovery/contact email</small><strong>›</strong></button>
        <button class="settings-row" onclick="changePasswordModal()"><span>🔑</span><b>Change password</b><small>Update your login password</small><strong>›</strong></button>
      </div></div>
      <div class="panel"><h3>🔒 Privacy & visibility</h3><label><input type="checkbox" id="setLastSeen" ${s.lastSeen!==false?'checked':''}> Show last seen</label><label><input type="checkbox" id="setOnline" ${s.online!==false?'checked':''}> Show online status</label><button class="primary" id="savePrivacy">Save privacy</button></div>
    </div>
    <div class="panel"><h3>🔔 Notifications</h3><p class="muted">Turn off notification types you do not want to receive.</p><label><input type="checkbox" id="nMessages" ${np.messages!==false?'checked':''}> Private messages</label><label><input type="checkbox" id="nMentions" ${np.mentions!==false?'checked':''}> Mentions</label><label><input type="checkbox" id="nReplies" ${np.replies!==false?'checked':''}> Replies</label><label><input type="checkbox" id="nSecurity" ${np.security!==false?'checked':''}> Security alerts</label><label><input type="checkbox" id="nStaff" ${np.staff!==false?'checked':''}> Staff / reports</label><label><input type="checkbox" id="nGamification" ${np.gamification!==false?'checked':''}> Gold / level / achievements</label><label><input type="checkbox" id="nOther" ${np.other!==false?'checked':''}> Other notifications</label><button class="primary" id="saveNotifications">Save notifications</button></div>
    <div class="panel"><h3>🛡️ Security & sessions</h3><p class="muted">${sessions.length} active session record${sessions.length===1?'':'s'}.</p><button class="mini" id="viewLoginHistory">View login history</button><button class="mini danger" id="logoutAllDevices">Log out all other devices</button></div>
<div class="panel danger-panel"><h3>⚠️ Account actions</h3><p class="muted">Deleting your account removes your account and personal conversations permanently.</p><button class="mini danger" onclick="deleteAccount()">Delete my account</button></div>
`;
  applyTheme(s.theme||'obsidian');
  const partyButton=$('settingsPartyMode');
  if(partyButton)partyButton.onclick=()=>{if(!canUsePartyMode()){toast('Party Mode is available to SUPER_ADMIN and higher ranks.');return;}setPartyMode(!isPartyModeActive());partyButton.textContent=isPartyModeActive()?'🎉 Turn Party Mode Off':'🎉 Turn Party Mode On';};
   $('savePrivacy').onclick=async()=>{try{await api('/api/profile',{method:'PUT',body:JSON.stringify({privacy:{lastSeen:$('setLastSeen').checked,online:$('setOnline').checked}})});toast('Privacy saved.');}catch(e){toast(e.message)}};
  $('saveNotifications').onclick=async()=>{await api('/api/notifications/preferences',{method:'PUT',body:JSON.stringify({messages:$('nMessages').checked,mentions:$('nMentions').checked,replies:$('nReplies').checked,security:$('nSecurity').checked,staff:$('nStaff').checked,gamification:$('nGamification').checked,other:$('nOther').checked})});toast('Notification preferences saved.');};
  $('viewLoginHistory').onclick=async()=>{const h=await api('/api/security/login-history');modal(`<h2>Login history</h2>${(h.history||[]).map(x=>`<div class="card"><b>${fmt(x.time)}</b><div class="muted">${esc(x.ip||'Unknown device')}</div></div>`).join('')||'<p class="muted">No login history.</p>'}`);};
  $('logoutAllDevices').onclick=async()=>{if(!confirm('Log out all sessions?'))return;try{await api('/api/security/logout-all',{method:'POST'});location.reload();}catch(e){toast(e.message)}};
}



// Check maintenance mode before login as well as after authentication, so visitors see the construction panel.
checkUnderConstruction();
if(constructionPoll)clearInterval(constructionPoll);
constructionPoll=setInterval(checkUnderConstruction,15000);

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/service-worker.js").catch(()=>{}));}

function toggleReactionPicker(id){document.getElementById("reactionPicker-"+id)?.classList.toggle("hidden");}

// Restore an existing authenticated session on ordinary refreshes and new visits.
// The saved token is sent by api() as X-Auth-Token; if it is valid, bootstrap()
// restores the user and starts the app without asking them to log in again.
bootstrap();
