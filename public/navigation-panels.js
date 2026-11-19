/* Navigation panels: switch between destinations without losing the room behind them. */
(function () {
  "use strict";
  if (window.__mcNavigationPanelsInstalled) return;
  window.__mcNavigationPanelsInstalled = true;

  var active = null;
  var suppressNextRoomsClick = false;
  var staffTabs = new Set(["management"]);
  var style = document.createElement("style");
  style.textContent = `
    .mc-nav-panel-overlay{position:fixed;inset:var(--header-h,52px) 0 0 0;z-index:1200;display:flex;justify-content:flex-end;background:rgba(4,5,12,.56);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);animation:mcNavFade .16s ease-out}
    .mc-nav-panel{width:min(900px,calc(100vw - 76px));height:100%;display:flex;flex-direction:column;min-width:0;overflow:hidden;background:var(--panel-bg,var(--card-bg,#171522));border-left:1px solid var(--border,rgba(255,255,255,.12));box-shadow:-18px 0 55px rgba(0,0,0,.32);animation:mcNavSlide .2s ease-out}
    .mc-nav-panel-head{height:58px;flex:0 0 58px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 18px;border-bottom:1px solid var(--border,rgba(255,255,255,.1));background:var(--panel-head-bg,rgba(255,255,255,.035));position:relative;z-index:2}
    .mc-nav-panel-title{font-size:16px;font-weight:750;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text,#fff)}
    .mc-nav-panel-close{width:38px;height:38px;flex:0 0 38px;border:1px solid var(--border,rgba(255,255,255,.2));border-radius:11px;background:var(--card-bg,rgba(255,255,255,.09));color:var(--text,#fff);font-size:25px;line-height:1;cursor:pointer;display:grid;place-items:center;visibility:visible;opacity:1}
    .mc-nav-panel-close:hover{background:rgba(255,255,255,.16)}
    .mc-nav-panel-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;position:relative;-webkit-overflow-scrolling:touch}
    .mc-nav-panel-loading{padding:24px;color:var(--muted,#aaa);font-size:14px}
    .mc-nav-panel-body>.view{display:block!important;height:100%!important;min-height:100%;overflow:auto}
    /* Keep the hamburger/sidebar above the panel so another destination can be selected. */
    body.mc-nav-panel-open #sidebar.open{z-index:1301!important}
    /* The original Games and Leaderboard scrollers need a constrained flex parent. */
    .mc-nav-panel-body>#viewGames{display:flex!important;flex-direction:column!important;height:100%!important;min-height:0!important;overflow:hidden!important}
    .mc-nav-panel-body>#viewGames>.games-root{flex:1 1 auto!important;min-height:0!important;height:auto!important;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
    .mc-nav-panel-body>#viewLeaderboard{display:flex!important;flex-direction:column!important;height:100%!important;min-height:0!important;overflow:hidden!important}
    .mc-nav-panel-body>#viewLeaderboard>#leaderboard{flex:1 1 auto!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;align-content:start}
    @keyframes mcNavFade{from{opacity:0}to{opacity:1}}
    @keyframes mcNavSlide{from{transform:translateX(22px);opacity:.7}to{transform:translateX(0);opacity:1}}
    @media(max-width:700px){.mc-nav-panel-overlay{inset:var(--header-h,52px) 0 0 0}.mc-nav-panel{width:100vw;border-left:0}.mc-nav-panel-head{padding:0 14px}.mc-nav-panel-body>.view{height:100%!important}}
    @media(prefers-reduced-motion:reduce){.mc-nav-panel-overlay,.mc-nav-panel{animation:none}}
  `;
  document.head.appendChild(style);

  function getView(name) {
    if (name === "users") return document.getElementById("onlinePanel");
    var id = name === "wallFriends" ? "viewWall" : "view" + name.charAt(0).toUpperCase() + name.slice(1);
    return document.getElementById(id);
  }

  function restoreView(panelState) {
    if (panelState.view && panelState.placeholder && panelState.placeholder.parentNode) {
      panelState.placeholder.parentNode.replaceChild(panelState.view, panelState.placeholder);
      panelState.view.classList.add("hidden");
    }
    panelState.view = null;
    panelState.placeholder = null;
  }

  function closePanel(resetToRooms) {
    if (!active) return;
    var old = active;
    active = null;
    old.requestId++;
    restoreView(old);
    old.overlay.remove();
    document.body.classList.remove("mc-nav-panel-open");
    if (resetToRooms !== false) {
      // Full-page navigation panels temporarily move their view out of the
      // room screen. On close, reveal the already-joined chat in place.
      // Do not click the Rooms navigation item here: that reloads the room
      // directory and can leave the chat area blank on mobile.
      var joinedRoom = old.name !== "users" && typeof state !== "undefined" &&
        state.user && state.currentRoom;
      if (joinedRoom) {
        state.view = "rooms";
        document.querySelectorAll(".nav[data-view]").forEach(function(button){
          button.classList.toggle("active", button.dataset.view === "rooms");
        });
        var roomsView = document.getElementById("viewRooms");
        if (roomsView) {
          roomsView.classList.remove("hidden");
          roomsView.classList.add("chatting");
        }
        var chat = document.getElementById("chatWrap");
        if (chat) chat.classList.remove("hidden");
      } else {
        var rooms = document.querySelector('.nav[data-view="rooms"]');
        if (rooms) {
          suppressNextRoomsClick = true;
          rooms.click();
          setTimeout(function(){ suppressNextRoomsClick = false; }, 0);
        }
      }
    }
  }

  function createPanel(button) {
    var overlay = document.createElement("div");
    overlay.className = "mc-nav-panel-overlay";
    var panel = document.createElement("section");
    panel.className = "mc-nav-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    var head = document.createElement("header");
    head.className = "mc-nav-panel-head";
    var title = document.createElement("div");
    title.className = "mc-nav-panel-title";
    var close = document.createElement("button");
    close.type = "button";
    close.className = "mc-nav-panel-close";
    close.setAttribute("aria-label", "Close panel");
    close.title = "Close";
    close.textContent = "×";
    head.append(title, close);
    var body = document.createElement("div");
    body.className = "mc-nav-panel-body";
    panel.append(head, body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    var panelState = {overlay:overlay,title:title,body:body,close:close,view:null,placeholder:null,requestId:0};
    close.addEventListener("click", function(){closePanel(true);});
    overlay.addEventListener("click", function(e){if(e.target===overlay)closePanel(true);});
    document.addEventListener("keydown", function onKey(e){
      if(active!==panelState){document.removeEventListener("keydown",onKey);return;}
      if(e.key==="Escape"){document.removeEventListener("keydown",onKey);closePanel(true);}
    });
    active=panelState;
    document.body.classList.add("mc-nav-panel-open");
    return panelState;
  }

  async function openRoomsList(button,event) {
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    var original=button.onclick;
    if(active)closePanel(false);
    if(typeof original==="function")await original.call(button,event);
    var open=document.getElementById("openRoomsPanel");
    if(open)open.click();
  }

  async function openPanel(button,event) {
    var name=button.dataset.view;
    if(!name||staffTabs.has(name))return;
    if(name==="rooms")return openRoomsList(button,event);
    var original=button.onclick;
    if(typeof original!=="function")return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();

    if(active && active.name===name){closePanel(true);return;}
    var panelState=active;
    if(!panelState)panelState=createPanel(button);
    else restoreView(panelState);
    panelState.name=name;
    var requestId=++panelState.requestId;
    panelState.title.textContent=button.textContent.trim();
    panelState.body.innerHTML='<div class="mc-nav-panel-loading" role="status">Loading…</div>';
    panelState.close.focus({preventScroll:true});

    try { await original.call(button,event); }
    catch(error){
      console.error("Navigation panel could not load:",error);
      if(active===panelState&&panelState.requestId===requestId)panelState.body.innerHTML='<div class="mc-nav-panel-loading" role="alert">This section could not be loaded. Close this panel and try again.</div>';
      return;
    }
    if(active!==panelState||panelState.requestId!==requestId)return;
    var view=getView(name);
    if(!view||!view.parentNode){
      panelState.body.innerHTML='<div class="mc-nav-panel-loading" role="alert">This section is unavailable in this version.</div>';
      return;
    }
    var placeholder=document.createComment("navigation-panel-view-"+name);
    view.parentNode.insertBefore(placeholder,view);
    panelState.view=view;
    panelState.placeholder=placeholder;
    panelState.body.innerHTML="";
    panelState.body.appendChild(view);
    view.classList.remove("hidden");
  }

  document.addEventListener("click",function(event){
    var button=event.target&&event.target.closest?event.target.closest(".nav[data-view]"):null;
    if(!button)return;
    if(button.dataset.view==="rooms"&&suppressNextRoomsClick)return;
    if(staffTabs.has(button.dataset.view))return;
    openPanel(button,event);
  },true);
})();
