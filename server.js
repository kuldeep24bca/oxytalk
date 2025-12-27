/**
 * OxyTalk Backend (Beginner-Friendly) — FINAL UPDATED VERSION ✅
 * Features:
 * - Email + Password auth (hashed)
 * - Unique username search
 * - Invite once → then users become CONTACTS forever
 * - 1-to-1 chat via Socket.io
 * - Profile image upload
 * - Messages stored in database.json (unless "once-view" enabled = ephemeral)
 *
 * IMPORTANT:
 * Your database.json must include:
 * {
 *   "users": [],
 *   "invites": [],
 *   "contacts": [],
 *   "chats": {}
 * }
 */

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

const DB_PATH = path.join(__dirname, "database.json");

// -------------------- Simple JSON DB Helpers --------------------
function readDB() {
  // If database.json doesn't exist, create it (beginner-safe)
  if (!fs.existsSync(DB_PATH)) {
    const initial = { users: [], invites: [], contacts: [], chats: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
  }

  const raw = fs.readFileSync(DB_PATH, "utf-8");
  const db = JSON.parse(raw);

  // Ensure new keys exist even if user has old db
  if (!db.users) db.users = [];
  if (!db.invites) db.invites = [];
  if (!db.contacts) db.contacts = [];
  if (!db.chats) db.chats = {};

  return db;
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// -------------------- ID Helpers --------------------
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function chatIdFor(userA, userB) {
  // Deterministic id: same for both users
  const pair = [userA, userB].sort();
  return `${pair[0]}__${pair[1]}`;
}

// -------------------- Multer upload setup --------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "public/uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || ".png");
    cb(null, `${uid()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 } // 3MB limit
});

// -------------------- Very Simple Session Token --------------------
function makeToken() {
  return uid();
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "") || "";
  if (!token) return res.status(401).json({ error: "No token" });

  const db = readDB();
  const user = db.users.find(u => u.token === token);
  if (!user) return res.status(401).json({ error: "Invalid token" });

  req.user = user;
  next();
}

// -------------------- Helper: contact check --------------------
function areContacts(db, userId1, userId2) {
  return db.contacts.some(c =>
    (c.userA === userId1 && c.userB === userId2) ||
    (c.userA === userId2 && c.userB === userId1)
  );
}

// -------------------- ROUTES --------------------

// Register (with optional avatar)
app.post("/api/register", upload.single("avatar"), (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ error: "Email, password, username required" });
  }

  const db = readDB();

  // Unique checks
  if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: "Email already used" });
  }
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Username already taken" });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const token = makeToken();
  const avatarUrl = req.file ? `/uploads/${req.file.filename}` : "";

  const newUser = {
    id: uid(),
    email,
    username,
    passwordHash,
    avatarUrl,
    token,
    createdAt: Date.now()
  };

  db.users.push(newUser);
  writeDB(db);

  res.json({
    token,
    user: {
      id: newUser.id,
      email: newUser.email,
      username: newUser.username,
      avatarUrl: newUser.avatarUrl
    }
  });
});

// Login
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const db = readDB();

  const user = db.users.find(u => u.email.toLowerCase() === (email || "").toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid email/password" });

  const ok = bcrypt.compareSync(password || "", user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid email/password" });

  // refresh token
  user.token = makeToken();
  writeDB(db);

  res.json({
    token: user.token,
    user: { id: user.id, email: user.email, username: user.username, avatarUrl: user.avatarUrl }
  });
});

// Me
app.get("/api/me", authMiddleware, (req, res) => {
  const u = req.user;
  res.json({ user: { id: u.id, email: u.email, username: u.username, avatarUrl: u.avatarUrl } });
});

// Search by username
app.get("/api/search", authMiddleware, (req, res) => {
  const q = (req.query.username || "").toString().trim().toLowerCase();
  if (!q) return res.json({ results: [] });

  const db = readDB();
  const results = db.users
    .filter(u => u.username.toLowerCase().includes(q))
    .filter(u => u.id !== req.user.id)
    .slice(0, 10)
    .map(u => ({ id: u.id, username: u.username, avatarUrl: u.avatarUrl }));

  res.json({ results });
});
// Get my contacts (permanent)
app.get("/api/contacts", authMiddleware, (req, res) => {
  const db = readDB();

  const contacts = db.contacts
    .filter(c => c.userA === req.user.id || c.userB === req.user.id)
    .map(c => {
      const otherId = c.userA === req.user.id ? c.userB : c.userA;
      const user = db.users.find(u => u.id === otherId);
      return {
        userId: otherId,
        username: user?.username || "Unknown",
        avatarUrl: user?.avatarUrl || ""
      };
    });

  res.json({ contacts });
});

// ✅ NEW: check if you and another user are contacts
app.get("/api/contact/check/:userId", authMiddleware, (req, res) => {
  const otherId = req.params.userId;
  const db = readDB();

  const isContact = areContacts(db, req.user.id, otherId);

  if (isContact) {
    return res.json({
      isContact: true,
      chatId: chatIdFor(req.user.id, otherId)
    });
  }

  res.json({ isContact: false });
});

// Send invite (ONLY if not contacts already)
app.post("/api/invite/send", authMiddleware, (req, res) => {
  const { toUserId } = req.body;
  const db = readDB();

  const toUser = db.users.find(u => u.id === toUserId);
  if (!toUser) return res.status(404).json({ error: "User not found" });

  // If already contacts → do not allow invite again
  if (areContacts(db, req.user.id, toUserId)) {
    return res.status(409).json({ error: "You are already contacts. Open chat directly." });
  }

  // prevent duplicate pending invite (either direction)
  const already = db.invites.find(inv =>
    ((inv.fromUserId === req.user.id && inv.toUserId === toUserId) ||
      (inv.fromUserId === toUserId && inv.toUserId === req.user.id)) &&
    inv.status === "pending"
  );
  if (already) return res.status(409).json({ error: "Invite already pending" });

  db.invites.push({
    id: uid(),
    fromUserId: req.user.id,
    toUserId,
    status: "pending",
    createdAt: Date.now()
  });

  writeDB(db);
  res.json({ ok: true });
});

// List incoming invites
app.get("/api/invite/list", authMiddleware, (req, res) => {
  const db = readDB();

  const incoming = db.invites
    .filter(inv => inv.toUserId === req.user.id && inv.status === "pending")
    .map(inv => {
      const from = db.users.find(u => u.id === inv.fromUserId);
      return {
        id: inv.id,
        fromUserId: inv.fromUserId,
        fromUsername: from?.username || "Unknown",
        fromAvatarUrl: from?.avatarUrl || "",
        createdAt: inv.createdAt
      };
    });

  res.json({ incoming });
});

// Accept / reject invite
app.post("/api/invite/respond", authMiddleware, (req, res) => {
  const { inviteId, action } = req.body;
  const db = readDB();

  const inv = db.invites.find(i => i.id === inviteId && i.toUserId === req.user.id);
  if (!inv) return res.status(404).json({ error: "Invite not found" });

  if (action === "accept") {
    inv.status = "accepted";

    // ✅ SAVE CONTACT FOREVER
    if (!areContacts(db, inv.fromUserId, inv.toUserId)) {
      db.contacts.push({ userA: inv.fromUserId, userB: inv.toUserId });
    }

    // create chat store if missing
    const chatId = chatIdFor(inv.fromUserId, inv.toUserId);
    if (!db.chats[chatId]) db.chats[chatId] = { messages: [] };

    writeDB(db);
    return res.json({ ok: true, chatId, otherUserId: inv.fromUserId });
  }

  inv.status = "rejected";
  writeDB(db);
  res.json({ ok: true });
});

// Get chat history (only if stored)
app.get("/api/chat/:chatId", authMiddleware, (req, res) => {
  const chatId = req.params.chatId;
  const [a, b] = chatId.split("__");
  if (![a, b].includes(req.user.id)) return res.status(403).json({ error: "Not your chat" });

  const db = readDB();
  const chat = db.chats[chatId] || { messages: [] };
  res.json({ messages: chat.messages });
});

// Clear chat (deletes stored messages)
app.delete("/api/chat/:chatId", authMiddleware, (req, res) => {
  const chatId = req.params.chatId;
  const [a, b] = chatId.split("__");
  if (![a, b].includes(req.user.id)) return res.status(403).json({ error: "Not your chat" });

  const db = readDB();
  if (!db.chats[chatId]) db.chats[chatId] = { messages: [] };
  db.chats[chatId].messages = [];
  writeDB(db);

  res.json({ ok: true });
});

// -------------------- Socket.io Real-time --------------------
const onlineUsers = new Map(); // userId -> socketId

io.on("connection", (socket) => {
  // Client sends: socket.emit("auth", { token })
  socket.on("auth", ({ token }) => {
    const db = readDB();
    const user = db.users.find(u => u.token === token);
    if (!user) {
      socket.emit("auth_error", { error: "Invalid token" });
      return socket.disconnect(true);
    }

    socket.userId = user.id;
    socket.username = user.username;
    socket.avatarUrl = user.avatarUrl;

    onlineUsers.set(user.id, socket.id);

    // broadcast online status update
    io.emit("presence", { userId: user.id, online: true });
    socket.emit("auth_ok", { userId: user.id, username: user.username, avatarUrl: user.avatarUrl });
  });

  socket.on("join_chat", ({ chatId }) => {
    socket.join(chatId);
  });

  socket.on("typing", ({ chatId, isTyping }) => {
    if (!socket.userId) return;
    socket.to(chatId).emit("typing", { userId: socket.userId, isTyping });
  });

  /**
   * message payload: { chatId, text, ephemeral: boolean }
   */
  socket.on("send_message", ({ chatId, text, ephemeral }) => {
    if (!socket.userId) return;

    const safeText = (text || "").toString().trim();
    if (!safeText) return;

    const time = new Date();
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");

    const msg = {
      id: uid(),
      chatId,
      fromUserId: socket.userId,
      fromUsername: socket.username,
      fromAvatarUrl: socket.avatarUrl,
      text: safeText,
      time: `${hh}:${mm}`,
      createdAt: Date.now()
    };

    // Send instantly to both users in that chat room
    io.to(chatId).emit("new_message", msg);

    // Save only if NOT ephemeral (Once-view OFF)
    if (!ephemeral) {
      const db = readDB();
      if (!db.chats[chatId]) db.chats[chatId] = { messages: [] };
      db.chats[chatId].messages.push(msg);
      writeDB(db);
    }
  });

  socket.on("disconnect", () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit("presence", { userId: socket.userId, online: false });
    }
  });
});

// -------------------- Start server --------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("OxyTalk running on port", PORT);
});
