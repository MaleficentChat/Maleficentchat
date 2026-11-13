(() => {
  const root = () => document.getElementById("aiCompanionRoot");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const token = () => { try { return localStorage.getItem("mc_token") || ""; } catch { return ""; } };
  async function api(url, options = {}) {
    const headers = {"Content-Type":"application/json"};
    if (token()) headers["x-auth-token"] = token();
    const response = await fetch(url, {...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  function fail(error) { root().insertAdjacentHTML("afterbegin", '<p class="ai-error">' + esc(error.message) + '</p>'); }
  function create() {
    root().innerHTML = '<form id="aiCreateForm" class="ai-create-card"><h3>Meet your companion</h3><p class="muted">One companion per account. Personality edits will not erase memories or relationship progress.</p><label>Name<input name="name" maxlength="60" required></label><label>Personality<select name="personalityType"><option value="preset">Premade</option><option value="custom">Custom</option></select></label><label>Preset<select name="personalityPreset"><option value="gentle-anime-friend">Gentle anime friend</option><option value="cheerful-adventurer">Cheerful adventurer</option><option value="calm-and-wise">Calm and wise</option><option value="playful-rival">Playful rival</option></select></label><label>Anime avatar URL<input name="avatarUrl" type="url" placeholder="https://…"></label><label>Bio<textarea name="bio" maxlength="500"></textarea></label><label>Backstory<textarea name="backstory" maxlength="2500"></textarea></label><label>Speaking style<textarea name="speakingStyle" maxlength="800"></textarea></label><label>Likes<input name="likes" placeholder="Comma-separated"></label><label>Dislikes<input name="dislikes" placeholder="Comma-separated"></label><button class="primary">Create my companion</button></form>';
    root().querySelector("form").onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
      data.likes = String(data.likes || "").split(",").map(x => x.trim()).filter(Boolean);
      data.dislikes = String(data.dislikes || "").split(",").map(x => x.trim()).filter(Boolean);
      try { await api("/api/ai-companion", {method:"POST", body:data}); await load(); } catch (error) { fail(error); }
    };
  }
  function render(data) {
    const c = data.companion, messages = data.messages || [], memories = data.memories || [];
    root().innerHTML =
      '<section class="ai-profile-card"><div class="ai-avatar">' + (c.avatarUrl ? '<img src="' + esc(c.avatarUrl) + '" alt="' + esc(c.name) + ' avatar" loading="lazy">' : '✦') + '</div><div><h3>' + esc(c.name) + ' <small class="ai-tag">AI COMPANION</small></h3><p>' + esc(c.bio) + '</p><small>Relationship: ' + esc(c.relationship.replace(/_/g," ")) + '</small></div></section>' +
      '<form id="aiEdit" class="ai-create-card"><h3>Edit personality</h3><label>Name<input name="name" value="' + esc(c.name) + '" required></label><label>Anime avatar URL<input name="avatarUrl" type="url" value="' + esc(c.avatarUrl) + '"></label><label>Bio<textarea name="bio">' + esc(c.bio) + '</textarea></label><label>Backstory<textarea name="backstory">' + esc(c.backstory) + '</textarea></label><label>Speaking style<textarea name="speakingStyle">' + esc(c.speakingStyle) + '</textarea></label><label>Likes<input name="likes" value="' + esc(c.likes.join(", ")) + '"></label><label>Dislikes<input name="dislikes" value="' + esc(c.dislikes.join(", ")) + '"></label><button class="primary">Save personality</button></form>' +
      '<section class="ai-chat-card"><h3>Private conversation</h3><div class="ai-messages" id="aiMessages">' +
      (messages.map(m => '<article class="ai-message ' + (m.sender_type === "owner" ? "owner" : "companion") + '"><b>' + (m.sender_type === "owner" ? "You" : esc(c.name)) + '</b><p>' + esc(m.message_content) + '</p></article>').join("") || '<p class="muted">Say hello to begin.</p>') +
      '</div><form id="aiChat"><textarea name="message" maxlength="1200" required placeholder="Say something…"></textarea><button class="primary">Send</button></form><button id="aiClearHistory" class="ai-secondary">Clear chat history</button><small class="muted">Voice and image generation are planned for a later phase.</small></section>' +
      '<section class="ai-memory-card"><h3>Memories</h3><form id="aiMemory"><input name="content" maxlength="1000" required placeholder="Add a memory…"><button class="primary">Save memory</button></form>' +
      (memories.map(m => '<article class="ai-memory"><p>' + esc(m.memory_content) + '</p><small>Importance ' + m.importance + '/5</small><button type="button" data-edit="' + m.id + '">Edit</button> <button type="button" data-delete="' + m.id + '">Delete</button></article>').join("") || '<p class="muted">No memories saved.</p>') +
      '<button id="aiClearMemories" class="ai-secondary">Clear all memories</button></section>';
    root().querySelector("#aiEdit").onsubmit = async event => {
      event.preventDefault(); const d = Object.fromEntries(new FormData(event.currentTarget));
      d.likes = String(d.likes || "").split(",").map(x=>x.trim()).filter(Boolean);
      d.dislikes = String(d.dislikes || "").split(",").map(x=>x.trim()).filter(Boolean);
      try { await api("/api/ai-companion",{method:"PATCH",body:d}); await load(); } catch(error) { fail(error); }
    };
    root().querySelector("#aiChat").onsubmit = async event => {
      event.preventDefault(); const form=event.currentTarget, message=form.elements.message.value.trim(); if(!message)return;
      form.elements.message.value="";
      try { await api("/api/ai-companion/chat",{method:"POST",body:{message}}); await load(); } catch(error) { fail(error); }
    };
    root().querySelector("#aiMemory").onsubmit = async event => {
      event.preventDefault(); const form=event.currentTarget;
      try { await api("/api/ai-companion/memories",{method:"POST",body:{content:form.elements.content.value}}); await load(); } catch(error) { fail(error); }
    };
    root().querySelector("#aiClearHistory").onclick = async () => {
      if(confirm("Clear chat history? Memories will remain.")) try { await api("/api/ai-companion/history",{method:"DELETE",body:{}}); await load(); } catch(error) { fail(error); }
    };
    root().querySelector("#aiClearMemories").onclick = async () => {
      if(confirm("Delete all memories? Chat history will remain.")) try { await api("/api/ai-companion/memories",{method:"DELETE",body:{}}); await load(); } catch(error) { fail(error); }
    };
    root().querySelectorAll("[data-delete]").forEach(button => button.onclick = async () => {
      try { await api("/api/ai-companion/memories/" + button.dataset.delete,{method:"DELETE",body:{}}); await load(); } catch(error) { fail(error); }
    });
    root().querySelectorAll("[data-edit]").forEach(button => button.onclick = async () => {
      const old=memories.find(m=>String(m.id)===button.dataset.edit), value=prompt("Edit memory",old.memory_content); if(value===null)return;
      try { await api("/api/ai-companion/memories/" + button.dataset.edit,{method:"PATCH",body:{content:value,importance:old.importance,sensitivity:old.sensitivity}}); await load(); } catch(error) { fail(error); }
    });
    const box=root().querySelector("#aiMessages"); if(box)box.scrollTop=box.scrollHeight;
  }
  async function load() {
    if(!root())return; root().innerHTML='<p class="muted">Loading companion…</p>';
    try { const data=await api("/api/ai-companion"); if(data.companion)render(data); else create(); }
    catch(error) { root().innerHTML='<div class="ai-unavailable"><h3>AI Companion</h3><p>'+esc(error.message)+'</p><p class="muted">MC access begins at Premium rank. Database migration and dedicated provider configuration are also required.</p></div>'; }
  }
  // Load on the navigation event and also whenever the view becomes visible.
  // The observer covers first-load timing races where navigation happened before
  // this file finished loading.
  let loadInProgress = false;
  async function loadWhenVisible() {
    if (loadInProgress) return;
    loadInProgress = true;
    try { await load(); }
    finally { loadInProgress = false; }
  }
  document.addEventListener("mc:open-ai-companion", loadWhenVisible);
  const companionView = document.getElementById("viewAiCompanion");
  if (companionView && typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(() => {
      if (!companionView.classList.contains("hidden")) loadWhenVisible();
    });
    observer.observe(companionView, {attributes:true, attributeFilter:["class"]});
    if (!companionView.classList.contains("hidden")) loadWhenVisible();
  } else if (companionView && !companionView.classList.contains("hidden")) {
    loadWhenVisible();
  }
})();