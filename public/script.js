/**
 * OxyTalk Frontend — FINAL RENDER-STABLE VERSION ✅
 */

window.addEventListener("DOMContentLoaded", () => {
  /* ================= AVATAR FALLBACK ================= */
  function getAvatar(url, username) {
    if (url && url.trim() !== "" && url !== "default-avatar.png") return url;
    
    // If no URL, return a generated initial avatar
    const name = encodeURIComponent(username || "User");
    return `https://ui-avatars.com/api/?name=${name}&background=random&color=fff&size=128`;
  }

  /* ================= API HELPER ================= */
  const API = {
    async post(url, body, isForm = false) {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(url, {
        method: "POST",
        headers: isForm
          ? { Authorization: `Bearer ${token}` }
          : {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            },
        body: isForm ? body : JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    },

    async get(url) {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    },

    async del(url) {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    }
  };

  /* ================= REGISTER PAGE ================= */
  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("msg");
      if (msg) msg.textContent = "";
      const fd = new FormData(registerForm);
      const res = await API.post("/api/register", fd, true);
      if (!res.ok) {
        const err = res.data?.error || "Register failed";
        if (msg) msg.textContent = err; else alert(err);
        return;
      }
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      location.href = "chat.html";
    });
    return;
  }

  /* ================= LOGIN PAGE ================= */
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("msg");
      if (msg) msg.textContent = "";
      const form = new FormData(loginForm);
      const body = { email: form.get("email"), password: form.get("password") };
      const res = await API.post("/api/login", body);
      if (!res.ok) {
        const err = res.data?.error || "Login failed";
        if (msg) msg.textContent = err; else alert(err);
        return;
      }
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      location.href = "chat.html";
    });
    return;
  }

  /* ================= CHAT PAGE ================= */
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return;

  const token = localStorage.getItem("token") || "";
  const me = JSON.parse(localStorage.getItem("user") || "{}");
  if (!token) {
    location.href = "login.html";
    return;
  }

  /* ---- UI refs ---- */
  const sidebar = document.getElementById("sidebar");
  const menuBtn = document.getElementById("menuBtn");
  const meAvatar = document.getElementById("meAvatar");
  const meName = document.getElementById("meName");

  const searchInput = document.getElementById("searchInput"); 
  const searchBtn = document.getElementById("searchBtn");     
  const searchInputDesktop = document.getElementById("searchInputDesktop");
  const searchBtnDesktop = document.getElementById("searchBtnDesktop");
  const searchResults = document.getElementById("searchResults"); 
  const topSearchResults = document.getElementById("topSearchResults"); 

  const invitesEl = document.getElementById("invites");
  const chatListEl = document.getElementById("chatList");

  const otherAvatar = document.getElementById("otherAvatar");
  const otherName = document.getElementById("otherName");
  const presenceText = document.getElementById("presenceText");
  const typingText = document.getElementById("typingText");

  const sendForm = document.getElementById("sendForm");
  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");

  const clearChatBtn = document.getElementById("clearChatBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  // ================= INIT UI (FIXED FOR NO CHAT SELECTED) =================
  if (meAvatar) meAvatar.src = getAvatar(me.avatarUrl, me.username);
  if (meName) meName.textContent = me.username || "Me";
  
  // ✅ This fixes the broken image in your screenshot immediately
  if (otherAvatar) otherAvatar.src = getAvatar("", "Chat"); 

  if (logoutBtn) {
    logoutBtn.onclick = () => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      location.href = "login.html";
    };
  }

  let currentChatId = "";
  let currentOtherUserId = "";
  let onlineMap = {};
  let typingTimer = null;

  /* ================= SIDEBAR TOGGLE ================= */
  if (menuBtn && sidebar) {
    menuBtn.onclick = () => {
      sidebar.classList.toggle("active");
    };
  }

  /* ================= CONTACTS LIST ================= */
  async function loadContacts() {
    if (!chatListEl) return;
    chatListEl.innerHTML = "";
    const res = await API.get("/api/contacts");
    if (!res.ok || !Array.isArray(res.data.contacts)) return;

    res.data.contacts.forEach((c) => {
      const div = document.createElement("div");
      div.className = "chat-item";
      div.innerHTML = `
        <img class="avatar" src="${getAvatar(c.avatarUrl, c.username)}">
        <div class="meta">
          <div class="title">${c.username}</div>
          <div class="sub">${onlineMap[c.userId] ? "🟢 Online" : "🔴 Offline"}</div>
        </div>
      `;
      div.onclick = async () => {
        const check = await API.get(`/api/contact/check/${c.userId}`);
        if (check.ok && check.data.isContact) {
          startChat(check.data.chatId, c.userId, c.username, c.avatarUrl);
          if (window.innerWidth < 768) sidebar.classList.remove("active");
        }
      };
      chatListEl.appendChild(div);
    });
  }

  /* ================= SEARCH LOGIC ================= */
  async function doSearch(isDesktop = false) {
    const input = isDesktop ? searchInputDesktop : searchInput;
    const targetDiv = isDesktop ? searchResults : topSearchResults;
    const q = (input?.value || "").trim();

    if (!targetDiv) return;
    targetDiv.innerHTML = "";
    if (!q) return;

    const res = await API.get(`/api/search?username=${encodeURIComponent(q)}`);
    if (!res.ok || !Array.isArray(res.data.results)) return;

    for (const u of res.data.results) {
      const check = await API.get(`/api/contact/check/${u.id}`);
      const isContact = !!check.data?.isContact;
      const chatId = check.data?.chatId || "";

      const div = document.createElement("div");
      div.className = "chat-item";
      div.innerHTML = `
        <img class="avatar" src="${getAvatar(u.avatarUrl, u.username)}">
        <div class="meta">
          <div class="title">${u.username}</div>
        </div>
        <button class="btn sm">${isContact ? "Open" : "Invite"}</button>
      `;

      div.querySelector("button").onclick = async (e) => {
        e.stopPropagation();
        if (isContact) {
          startChat(chatId, u.id, u.username, u.avatarUrl);
          if (!isDesktop) {
            const topSearch = document.getElementById("topSearch");
            if(topSearch) topSearch.classList.add("hidden");
          }
          if (isDesktop && window.innerWidth < 768) sidebar.classList.remove("active");
        } else {
          const out = await API.post("/api/invite/send", { toUserId: u.id });
          if (!out.ok) alert(out.data?.error || "Invite failed");
          else alert("Invite sent ✅");
        }
      };
      targetDiv.appendChild(div);
    }
  }

  if (searchBtn) searchBtn.onclick = () => doSearch(false);
  if (searchBtnDesktop) searchBtnDesktop.onclick = () => doSearch(true);

  const searchToggle = document.getElementById("searchToggle");
  const topSearch = document.getElementById("topSearch");
  if (searchToggle && topSearch) {
    searchToggle.onclick = () => {
      topSearch.classList.toggle("hidden");
      if (!topSearch.classList.contains("hidden")) searchInput?.focus();
    };
  }

  /* ================= INVITES ================= */
  async function loadInvites() {
    if (!invitesEl) return;
    invitesEl.innerHTML = "";
    const res = await API.get("/api/invite/list");
    if (!res.ok || !Array.isArray(res.data.incoming)) return;

    res.data.incoming.forEach((inv) => {
      const div = document.createElement("div");
      div.className = "chat-item";
      div.innerHTML = `
        <img class="avatar" src="${getAvatar(inv.fromAvatarUrl, inv.fromUsername)}">
        <div class="meta">
          <div class="title">${inv.fromUsername}</div>
          <div class="sub">New Invitation</div>
        </div>
        <button class="btn sm">Accept</button>
      `;
      div.querySelector("button").onclick = async () => {
        const out = await API.post("/api/invite/respond", { inviteId: inv.id, action: "accept" });
        if (out.ok) {
          startChat(out.data.chatId, out.data.otherUserId, inv.fromUsername, inv.fromAvatarUrl);
          loadInvites();
          loadContacts();
        }
      };
      invitesEl.appendChild(div);
    });
  }

  /* ================= SOCKET ================= */
  const socket = io();
  socket.on("connect", () => socket.emit("auth", { token }));
  socket.on("presence", ({ userId, online }) => {
    onlineMap[userId] = online;
    if (userId === currentOtherUserId && presenceText) {
      presenceText.textContent = online ? "🟢 Online" : "🔴 Offline";
    }
    loadContacts();
  });
  socket.on("typing", ({ userId, isTyping }) => {
    if (userId === currentOtherUserId && typingText) {
      typingText.textContent = isTyping ? "Typing…" : "";
    }
  });
  socket.on("new_message", (msg) => {
    if (msg.chatId === currentChatId) addMessage(msg);
  });

  /* ================= CHAT CORE ================= */
  async function startChat(chatId, otherUserId, otherUsername, otherAvatarUrl) {
    currentChatId = chatId;
    currentOtherUserId = otherUserId;
    if (sendBtn) sendBtn.disabled = false;
    if (messageInput) messageInput.disabled = false;
    if (clearChatBtn) clearChatBtn.disabled = false;

    if (otherName) otherName.textContent = otherUsername;
    
    // ✅ HEADER IMAGE FALLBACK
    if (otherAvatar) {
        otherAvatar.src = getAvatar(otherAvatarUrl, otherUsername);
    }
    
    if (presenceText) presenceText.textContent = onlineMap[otherUserId] ? "🟢 Online" : "🔴 Offline";
    
    messagesEl.innerHTML = "";
    socket.emit("join_chat", { chatId });
    const hist = await API.get(`/api/chat/${chatId}`);
    if (hist.ok && Array.isArray(hist.data.messages)) hist.data.messages.forEach(addMessage);
  }

  function addMessage(msg) {
    const div = document.createElement("div");
    div.className = "bubble" + (msg.fromUserId === me.id ? " me" : "");
    div.innerHTML = `<div class="top"><span>${msg.fromUsername || ""}</span></div><div class="text"></div>`;
    div.querySelector(".text").textContent = msg.text || "";
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  if (clearChatBtn) {
    clearChatBtn.onclick = async () => {
      if (!currentChatId || !confirm("Clear chat?")) return;
      messagesEl.innerHTML = "";
      await API.del(`/api/chat/${currentChatId}`);
    };
  }

  if (sendForm) {
    sendForm.onsubmit = (e) => {
      e.preventDefault();
      const text = (messageInput?.value || "").trim();
      if (!text || !currentChatId) return;
      socket.emit("send_message", { chatId: currentChatId, text });
      messageInput.value = "";
    };
  }

  if (messageInput) {
    messageInput.oninput = () => {
      if (!currentChatId) return;
      socket.emit("typing", { chatId: currentChatId, isTyping: true });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => socket.emit("typing", { chatId: currentChatId, isTyping: false }), 1000);
    };
  }

  loadContacts();
  loadInvites();
});
