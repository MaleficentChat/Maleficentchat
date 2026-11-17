/* Navigation panels: ordinary destinations open over the active room.
   Staff management remains a full navigation destination. */
(function () {
  "use strict";
  if (window.__mcNavigationPanelsInstalled) return;
  window.__mcNavigationPanelsInstalled = true;

  var active = null;
  var staffTabs = new Set(["rooms", "management"]);
  var style = document.createElement("style");
  style.textContent = `
    .mc-nav-panel-overlay{position:fixed;inset:var(--header-h,52px) 0 0 0;z-index:1200;display:flex;justify-content:flex-end;background:rgba(4,5,12,.56);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);animation:mcNavFade .16s ease-out}
    .mc-nav-panel{width:min(900px,calc(100vw - 76px));height:100%;display:flex;flex-direction:column;min-width:0;overflow:hidden;background:var(--panel-bg,var(--card-bg,#171522));border-left:1px solid var(--border,rgba(255,255,255,.12));box-shadow:-18px 0 55px rgba(0,0,0,.32);animation:mcNavSlide .2s ease-out}
    .mc-nav-panel-head{height:58px;flex:0 0 58px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 18px;border-bottom:1px solid var(--border,rgba(255,255,255,.1));background:var(--panel-head-bg,rgba(255,255,255,.035))}
    .mc-nav-panel-title{font-size:16px;font-weight:750;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text,#fff)}
    .mc-nav-panel-close{width:36px;height:36px;flex:0 0 36px;border:1px solid var(--border,rgba(255,255,255,.16));border-radius:10px;background:rgba(255,255,255,.06);color:var(--text,#fff);font-size:23px;line-height:1;cursor:pointer}
    .mc-nav-panel-close:hover{background:rgba(255,255,255,.14)}
    .mc-nav-panel-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
    .mc-nav-panel-body>.view{display:block!important;height:100%!important;min-height:100%;overflow:auto}
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

  function closePanel() {
    if (!active) return;
    var old = active;
    active = null;
    if (old.view && old.placeholder && old.placeholder.parentNode) {
      old.placeholder.parentNode.replaceChild(old.view, old.placeholder);
      old.view.classList.add("hidden");
    }
    old.overlay.remove();
    document.body.classList.remove("mc-nav-panel-open");
    var rooms = document.querySelector('.nav[data-view="rooms"]');
    if (rooms) rooms.click();
  }

  async function openPanel(button, event) {
    var name = button.dataset.view;
    if (!name || staffTabs.has(name)) return;
    var original = button.onclick;
    if (typeof original !== "function") return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (active) closePanel();

    // Run the existing destination handler unchanged so its data loaders and
    // permission checks continue to work. Only its presentation is changed.
    try {
      await original.call(button, event);
    } catch (error) {
      console.error("Navigation panel could not load:", error);
      return;
    }

    var view = getView(name);
    if (!view || !view.parentNode) return;

    var placeholder = document.createComment("navigation-panel-view-" + name);
    view.parentNode.insertBefore(placeholder, view);

    var overlay = document.createElement("div");
    overlay.className = "mc-nav-panel-overlay";
    overlay.setAttribute("role", "presentation");
    var panel = document.createElement("section");
    panel.className = "mc-nav-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", button.textContent.trim() || "Navigation panel");

    var head = document.createElement("header");
    head.className = "mc-nav-panel-head";
    var title = document.createElement("div");
    title.className = "mc-nav-panel-title";
    title.textContent = button.textContent.trim();
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
    body.appendChild(view);
    view.classList.remove("hidden");
    document.body.classList.add("mc-nav-panel-open");

    active = { overlay: overlay, view: view, placeholder: placeholder };
    close.addEventListener("click", closePanel);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closePanel();
    });
    document.addEventListener("keydown", function onKey(e) {
      if (!active || active.overlay !== overlay) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (e.key === "Escape") {
        document.removeEventListener("keydown", onKey);
        closePanel();
      }
    });
    close.focus({ preventScroll: true });
  }

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest
      ? event.target.closest(".nav[data-view]")
      : null;
    if (!button || staffTabs.has(button.dataset.view)) return;
    openPanel(button, event);
  }, true);
})();