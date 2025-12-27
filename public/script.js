/**
 * OxyTalk Frontend — FINAL RENDER-STABLE VERSION ✅
 * ✅ Register / Login / Chat all in one file
 * ✅ Does NOT crash if some endpoints are missing
 * ✅ Contacts list persistent (from /api/contacts)
 * ✅ Search / Invite / Open Chat works
 */

window.addEventListener("DOMContentLoaded", () => {
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
        if (msg) msg.textContent = err;
        else alert(err);
        return;
      }

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      location.href = "chat.html";
    });

    return; // ✅ Stop here (register page code only)
  }

  /* ================= LOGIN PAGE ================= */
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const msg = document.getElementById("msg");
      if (msg) msg.textContent = "";

      const form = new FormData(loginForm);
      const body = {
        email: form.get("email"),
        password: form.get("password")
      };

      const res = await API.post("/api/login", body);

      if (!res.ok) {
        const err = res.data?.error || "Login failed";
        if (msg) msg.textContent = err;
        else alert(err);
        return;
      }

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      location.href = "chat.html";
    });

    return; // ✅ Stop here (login page code only)
  }

  /* ================= CHAT PAGE ================= */
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return; // not chat page

  // If token missing → go login
  const token = localStorage.getItem("token") || "";
  const me = JSON.parse(localStorage.getItem("user") || "{}");
  if (!token) {
    location.href = "login.html";
    return;
  }

  /* ---- UI refs ---- */
  const meAvatar = document.getElementById("meAvatar");
  const meName = document.getElementById("meName");

  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");
  const searchResults = document.getElementById("searchResults");

  const invitesEl = document.getElementById("invites");     // optional
  const chatListEl = document.getElementById("chatList");   // required for contacts list

  const otherAvatar = document.getElementById("otherAvatar");
  const otherName = document.getElementById("otherName");
  const presenceText = document.getElementById("presenceText");
  const typingText = document.getElementById("typingText");

  const sendForm = document.getElementById("sendForm");
  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");

  const clearChatBtn = document.getElementById("clearChatBtn");
  const lockBtn = document.getElementById("lockBtn");
  const onceViewToggle = document.getElementById("onceViewToggle");
  const logoutBtn = document.getElementById("logoutBtn");

  // Me UI
  if (meAvatar) meAvatar.src = me.avatarUrl || "";
  if (meName) meName.textContent = me.username || "Me";

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

  // Once view
  if (onceViewToggle) {
    onceViewToggle.checked = localStorage.getItem("onceView") === "1";
    onceViewToggle.onchange = () => {
      localStorage.setItem("onceView", onceViewToggle.checked ? "1" : "0");
    };
  }

  /* ================= CONTACTS LIST (PERSISTENT) ================= */
  async function loadContacts() {
    if (!chatListEl) return;
    chatListEl.innerHTML = "";

    const res = await API.get("/api/contacts");
    if (!res.ok || !Array.isArray(res.data.contacts)) return;

    res.data.contacts.forEach((c) => {
      const div = document.createElement("div");
      div.className = "chat-item";

      div.innerHTML = `
        <img class="avatar" src="${c.avatarUrl || (meAvatar?.src || "")}">
        <div class="meta">
          <div class="title">${c.username}</div>
          <div class="sub">${onlineMap[c.userId] ? "🟢 Online" : "🔴 Offline"}</div>
        </div>
      `;

      div.onclick = async () => {
        const check = await API.get(`/api/contact/check/${c.userId}`);
        if (check.ok && check.data.isContact) {
          startChat(check.data.chatId, c.userId, c.username, c.avatarUrl);
        }
      };

      chatListEl.appendChild(div);
    });
  }

  /* ================= SEARCH ================= */
  async function doSearch() {
    const q = (searchInput?.value || "").trim();
    if (!searchResults) return;

    searchResults.innerHTML = "";
    if (!q) return;

    const res = await API.get(`/api/search?username=${encodeURIComponent(q)}`);
    if (!res.ok || !Array.isArray(res.data.results)) return;

    for (const u of res.data.results) {
      const check = await API.get(`/api/contact/check/${u.id}`);
      const isContact = !!check.data?.isContact;
      const chatId = check.data?.chatId || "";

      const div = document.createElement("div");
      div.className = "item";

      div.innerHTML = `
        <div class="meta">
          <div class="title">${u.username}</div>
          <div class="sub">${onlineMap[u.id] ? "🟢 Online" : "🔴 Offline"}</div>
        </div>
        <button>${isContact ? "Open Chat" : "Send Invite"}</button>
      `;

      div.querySelector("button").onclick = async () => {
        if (isContact) {
          startChat(chatId, u.id, u.username, u.avatarUrl);
        } else {
          const out = await API.post("/api/invite/send", { toUserId: u.id });
          if (!out.ok) alert(out.data?.error || "Invite failed");
          else alert("Invite sent ✅");
        }
      };

      searchResults.appendChild(div);
    }
  }

  if (searchBtn) searchBtn.onclick = doSearch;

  /* ================= INVITES (SAFE) ================= */
  async function loadInvites() {
    if (!invitesEl) return;

    invitesEl.innerHTML = "";

    // ✅ this endpoint may not exist in your server → don't crash
    const res = await API.get("/api/invite/list");
    if (!res.ok || !Array.isArray(res.data.incoming)) return;

    res.data.incoming.forEach((inv) => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="meta">
          <div class="title">${inv.fromUsername}</div>
          <div class="sub">wants to chat</div>
        </div>
        <button>Accept</button>
      `;

      div.querySelector("button").onclick = async () => {
        const out = await API.post("/api/invite/respond", {
          inviteId: inv.id,
          action: "accept"
        });

        if (out.ok) {
          startChat(out.data.chatId, out.data.otherUserId, inv.fromUsername, inv.fromAvatarUrl);
          loadInvites();
          loadContacts();
        } else {
          alert(out.data?.error || "Failed to accept");
        }
      };

      invitesEl.appendChild(div);
    });
  }

  /* ================= SOCKET ================= */
  const socket = io();

  socket.on("connect", () => {
    socket.emit("auth", { token });
  });

  socket.on("presence", ({ userId, online }) => {
    onlineMap[userId] = online;
    if (userId === currentOtherUserId && presenceText) {
      presenceText.textContent = online ? "🟢 Online" : "🔴 Offline";
    }
    loadContacts(); // update dots
  });

  socket.on("typing", ({ userId, isTyping }) => {
    if (userId === currentOtherUserId && typingText) {
      typingText.textContent = isTyping ? "Typing…" : "";
    }
  });

  socket.on("new_message", (msg) => {
    if (msg.chatId !== currentChatId) return;
    addMessage(msg);
  });

  /* ================= CHAT ================= */
  async function startChat(chatId, otherUserId, otherUsername = "Chat", otherAvatarUrl = "") {
    currentChatId = chatId;
    currentOtherUserId = otherUserId;

    if (sendBtn) sendBtn.disabled = false;
    if (messageInput) messageInput.disabled = false;
    if (clearChatBtn) clearChatBtn.disabled = false;
    if (lockBtn) lockBtn.disabled = false;

    if (otherName) otherName.textContent = otherUsername;
    if (otherAvatar) otherAvatar.src = otherAvatarUrl || (meAvatar?.src || "");
    if (presenceText) presenceText.textContent = onlineMap[otherUserId] ? "🟢 Online" : "🔴 Offline";
    if (typingText) typingText.textContent = "";

    messagesEl.innerHTML = "";
    socket.emit("join_chat", { chatId });

    const hist = await API.get(`/api/chat/${chatId}`);
    if (hist.ok && Array.isArray(hist.data.messages)) {
      hist.data.messages.forEach(addMessage);
    }
  }

  function addMessage(msg) {
    const div = document.createElement("div");
    div.className = "bubble" + (msg.fromUserId === me.id ? " me" : "");

    // safe text
    const safeText = (msg.text || "").toString();

    div.innerHTML = `
      <div class="top">
        <span>${msg.fromUsername || ""}</span>
        <span>${msg.time || ""}</span>
      </div>
      <div class="text"></div>
    `;
    div.querySelector(".text").textContent = safeText;

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /* ================= SEND ================= */
  if (sendForm) {
    sendForm.onsubmit = (e) => {
      e.preventDefault();
      if (!currentChatId) return;

      const text = (messageInput?.value || "").trim();
      if (!text) return;

      socket.emit("send_message", {
        chatId: currentChatId,
        text,
        ephemeral: localStorage.getItem("onceView") === "1"
      });

      if (messageInput) messageInput.value = "";
      socket.emit("typing", { chatId: currentChatId, isTyping: false });
    };
  }

  /* ================= TYPING ================= */
  if (messageInput) {
    messageInput.oninput = () => {
      if (!currentChatId) return;
      socket.emit("typing", { chatId: currentChatId, isTyping: true });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        socket.emit("typing", { chatId: currentChatId, isTyping: false });
      }, 800);
    };
  }

  /* ================= INIT ================= */
  loadContacts();
  loadInvites();
});
