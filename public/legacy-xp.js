(function(){
  "use strict";
  const milestones = [
    { xp: 0, title: "Newcomer", crest: "✦" },
    { xp: 250, title: "Wayfinder", crest: "❖" },
    { xp: 1000, title: "Nightwalker", crest: "☾" },
    { xp: 5000, title: "Luminary", crest: "✧" },
    { xp: 15000, title: "Vanguard", crest: "⚔" },
    { xp: 35000, title: "Mythic", crest: "♜" },
    { xp: 75000, title: "Eternal", crest: "♛" },
    { xp: 150000, title: "Legend", crest: "✺" },
    { xp: 300000, title: "Immortal", crest: "✹" }
  ];

  function removeDuplicateProfileTabs(){
    document.querySelectorAll(".profile-modal .profile-tabs").forEach(strip=>{
      const seen=new Set();
      strip.querySelectorAll(".profile-tab[data-tab]").forEach(tab=>{
        const key=tab.dataset.tab;
        if(seen.has(key)) tab.remove(); else seen.add(key);
      });
    });
  }

  function decorateProfile(){
    removeDuplicateProfileTabs();
    const panel = document.getElementById("profileTabContent");
    const profile = panel?.closest(".profile-modal");
    const tabs = profile?.querySelector(".profile-tabs");
    if (!panel || !profile || !tabs || profile.querySelector(".legacy-xp-card")) return;
    const rows = Array.from(panel.querySelectorAll(".profile-info-row"));
    const levelRow = rows.find(row => /level/i.test(row.querySelector("b")?.textContent || ""));
    if (!levelRow) return;
    const raw = levelRow.querySelector("span")?.textContent || "";
    const match = raw.match(/[\d,]+\s*[·•-]\s*([\d,]+)\s*XP/i);
    if (!match) return;
    const xp = Math.max(0, Number(match[1].replace(/,/g, "")) || 0);
    let current = milestones[0], next = null;
    for (let i = 0; i < milestones.length; i++) {
      if (xp >= milestones[i].xp) current = milestones[i];
      else { next = milestones[i]; break; }
    }
    const maxed = !next;
    const progress = maxed ? 100 : Math.max(0, Math.min(100,
      ((xp - current.xp) / Math.max(1, next.xp - current.xp)) * 100
    ));
    const card = document.createElement("section");
    card.className = "legacy-xp-card";
    card.setAttribute("aria-label", "Lifetime Legacy XP progression");
    const head = document.createElement("div");
    head.className = "legacy-xp-head";
    const left = document.createElement("div");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = "LIFETIME JOURNEY";
    const title = document.createElement("strong");
    title.textContent = current.crest + " " + current.title;
    left.append(eyebrow, title);
    const total = document.createElement("b");
    total.className = "legacy-xp-total";
    total.textContent = xp.toLocaleString() + " XP";
    head.append(left, total);
    const track = document.createElement("div");
    track.className = "legacy-xp-track";
    const fill = document.createElement("span");
    fill.style.width = progress.toFixed(1) + "%";
    track.append(fill);
    const foot = document.createElement("div");
    foot.className = "legacy-xp-foot";
    foot.textContent = maxed ? "✹ Maximum legacy title reached" :
      (next.xp - xp).toLocaleString() + " XP to " + next.title;
    card.append(head, track, foot);
    const content = document.getElementById("profileTabContent");
    if (content && tabs.parentElement === content.parentElement) content.insertAdjacentElement("beforebegin", card);
    else tabs.insertAdjacentElement("afterend", card);
  }

  const observer = new MutationObserver(decorateProfile);
  function start(){
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    decorateProfile();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  document.addEventListener("click", event => {
    if (event.target.closest(".profile-tab")) queueMicrotask(decorateProfile);
  }, true);
})();