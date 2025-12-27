/**
 * OxyTalk Frontend – FINAL STABLE VERSION
 * ✔ Persistent Chats (below Invitations)
 * ✔ Works after refresh / logout
 * ✔ Search / Invite / Open Chat untouched
 */

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
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  },

  async get(url) {
    const token = localStorage.getItem("token") || "";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  },

  async del(url) {
    const token = localStorage.getItem("token") || "";
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }
};

/* ================= CHAT PAGE ================= */
const messagesEl = document.getElementById("messages");
if (messagesEl) {
  const me = JSON.parse(localStorage.getItem("user") || "{}");
  const token = localStorage.getItem("token") || "";

  /* ---- UI refs ---- */
  const meAvatar = document.getElementById("meAvatar");
  const meName = document.getElementById("meName");
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");
  const searchResults = document.getElementById("searchResults");
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
  const lockBtn = document.getElementById("lockBtn");
  const onceViewToggle = document.getElementById("onceViewToggle");
  const logoutBtn = document.getElementById("logoutBtn");

  meAvatar.src = me.avatarUrl || "";
  meName.textContent = me.username || "Me";

  logoutBtn.onclick = () => {
    localStorage.clear();
    location.href = "login.html";
  };

  let currentChatId = "";
  let currentOtherUserId = "";
  let onlineMap = {};
  let typingTimer = null;

  /* ================= PERSISTENT CONTACTS ================= */
  async function loadContacts() {
    if (!chatListEl) return;

    chatListEl.innerHTML = "";
    const res = await API.get("/api/contacts");
    if (!res.ok) return;

    res.data.contacts.forEach(c => {
      const div = document.createElement("div");
      div.className = "chat-item";

      div.innerHTML = `
        <img class="avatar" src="${c.avatarUrl || meAvatar.src}">
        <div class="meta">
          <div class="title">${c.username}</div>
          <div class="sub">${onlineMap[c.userId] ? "🟢 Online" : "🔴 Offline"}</div>
        </div>
      `;

      div.onclick = async () => {
        const check = await API.get(`/api/contact/check/${c.userId}`);
        if (check.ok && check.data.isContact) {
          startChat(check.data.chatId, c.userId);
        }
      };

      chatListEl.appendChild(div);
    });
  }

  /* ================= SEARCH ================= */
  async function doSearch() {
    const q = searchInput.value.trim();
    searchResults.innerHTML = "";
    if (!q) return;

    const res = await API.get(`/api/search?username=${encodeURIComponent(q)}`);
    if (!res.ok) return;

    for (const u of res.data.results) {
      const check = await API.get(`/api/contact/check/${u.id}`);
      const div = document.createElement("div");
      div.className = "item";

      const buttonText = check.data.isContact ? "Open Chat" : "Send Invite";

      div.innerHTML = `
        <div class="meta">
          <div class="title">${u.username}</div>
          <div class="sub">${onlineMap[u.id] ? "🟢 Online" : "🔴 Offline"}</div>
        </div>
        <button>${buttonText}</button>
      `;

      div.querySelector("button").onclick = async () => {
        if (check.data.isContact) {
          startChat(check.data.chatId, u.id);
        } else {
          await API.post("/api/invite/send", { toUserId: u.id });
          alert("Invite sent ✅");
        }
      };

      searchResults.appendChild(div);
    }
  }

  searchBtn.onclick = doSearch;

  /* ================= INVITES ================= */
  async function loadInvites() {
    invitesEl.innerHTML = "";
    const res = await API.get("/api/invite/list");
    if (!res.ok) return;

    res.data.incoming.forEach(inv => {
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
          startChat(out.data.chatId, out.data.otherUserId);
          loadInvites();
          loadContacts(); // 🔥 important
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
    if (userId === currentOtherUserId) {
      presenceText.textContent = online ? "🟢 Online" : "🔴 Offline";
    }
    loadContacts(); // update online dots
  });

  socket.on("typing", ({ userId, isTyping }) => {
    if (userId === currentOtherUserId) {
      typingText.textContent = isTyping ? "Typing…" : "";
    }
  });

  socket.on("new_message", (msg) => {
    if (msg.chatId !== currentChatId) return;
    addMessage(msg);
  });

  /* ================= CHAT ================= */
  async function startChat(chatId, otherUserId) {
    currentChatId = chatId;
    currentOtherUserId = otherUserId;

    sendBtn.disabled = false;
    messageInput.disabled = false;
    clearChatBtn.disabled = false;
    lockBtn.disabled = false;

    messagesEl.innerHTML = "";
    socket.emit("join_chat", { chatId });

    const hist = await API.get(`/api/chat/${chatId}`);
    if (hist.ok) hist.data.messages.forEach(addMessage);
  }

  function addMessage(msg) {
    const div = document.createElement("div");
    div.className = "bubble" + (msg.fromUserId === me.id ? " me" : "");
    div.innerHTML = `
      <div class="top">
        <span>${msg.fromUsername}</span>
        <span>${msg.time}</span>
      </div>
      <div class="text">${msg.text}</div>
    `;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  sendForm.onsubmit = (e) => {
    e.preventDefault();
    if (!currentChatId) return;

    const text = messageInput.value.trim();
    if (!text) return;

    socket.emit("send_message", {
      chatId: currentChatId,
      text,
      ephemeral: localStorage.getItem("onceView") === "1"
    });

    messageInput.value = "";
  };

  /* ================= INIT ================= */
  loadInvites();
  loadContacts(); // 🔥 persistent chats
}
