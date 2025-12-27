/**
 * OxyTalk Backend (Beginner-Friendly) — FINAL WORKING VERSION ✅
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

// ✅ STATIC FILES
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// ✅ ROOT ROUTE (IMPORTANT)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

const DB_PATH = path.join(__dirname, "database.json");

// -------------------- DB HELPERS --------------------
function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({ users: [], invites: [], contacts: [], chats: {} }, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// -------------------- HELPERS --------------------
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function chatIdFor(a, b) {
  return [a, b].sort().join("__");
}

function makeToken() {
  return uid();
}

function areContacts(db, a, b) {
  return db.contacts.some(
    c =>
      (c.userA === a && c.userB === b) ||
      (c.userA === b && c.userB === a)
  );
}

// -------------------- AUTH --------------------
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });

  const db = readDB();
  const user = db.users.find(u => u.token === token);
  if (!user) return res.status(401).json({ error: "Invalid token" });

  req.user = user;
  next();
}

// -------------------- MULTER --------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "public/uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uid() + path.extname(file.originalname || ".png"));
  }
});
const upload = multer({ storage });

// -------------------- ROUTES --------------------

// REGISTER
app.post("/api/register", upload.single("avatar"), (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username)
    return res.status(400).json({ error: "All fields required" });

  const db = readDB();
  if (db.users.some(u => u.email === email))
    return res.status(409).json({ error: "Email already used" });
  if (db.users.some(u => u.username === username))
    return res.status(409).json({ error: "Username taken" });

  const user = {
    id: uid(),
    email,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    avatarUrl: req.file ? `/uploads/${req.file.filename}` : "",
    token: makeToken()
  };

  db.users.push(user);
  writeDB(db);

  res.json({
    token: user.token,
    user: { id: user.id, email, username, avatarUrl: user.avatarUrl }
  });
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash))
    return res.status(401).json({ error: "Invalid login" });

  user.token = makeToken();
  writeDB(db);

  res.json({
    token: user.token,
    user: { id: user.id, email, username: user.username, avatarUrl: user.avatarUrl }
  });
});

// SEARCH
app.get("/api/search", authMiddleware, (req, res) => {
  const q = (req.query.username || "").toLowerCase();
  const db = readDB();
  const results = db.users
    .filter(u => u.username.toLowerCase().includes(q) && u.id !== req.user.id)
    .map(u => ({ id: u.id, username: u.username, avatarUrl: u.avatarUrl }));
  res.json({ results });
});

// CONTACT CHECK
app.get("/api/contact/check/:id", authMiddleware, (req, res) => {
  const db = readDB();
  const ok = areContacts(db, req.user.id, req.params.id);
  res.json(ok ? { isContact: true, chatId: chatIdFor(req.user.id, req.params.id) } : { isContact: false });
});

// INVITES
app.post("/api/invite/send", authMiddleware, (req, res) => {
  const db = readDB();
  if (areContacts(db, req.user.id, req.body.toUserId))
    return res.status(409).json({ error: "Already contacts" });

  db.invites.push({
    id: uid(),
    fromUserId: req.user.id,
    toUserId: req.body.toUserId,
    status: "pending"
  });

  writeDB(db);
  res.json({ ok: true });
});

// ACCEPT INVITE
app.post("/api/invite/respond", authMiddleware, (req, res) => {
  const db = readDB();
  const inv = db.invites.find(i => i.id === req.body.inviteId);
  if (!inv) return res.status(404).json({ error: "Invite not found" });

  inv.status = "accepted";
  db.contacts.push({ userA: inv.fromUserId, userB: inv.toUserId });

  const chatId = chatIdFor(inv.fromUserId, inv.toUserId);
  if (!db.chats[chatId]) db.chats[chatId] = { messages: [] };

  writeDB(db);
  res.json({ chatId, otherUserId: inv.fromUserId });
});

// CHAT HISTORY
app.get("/api/chat/:id", authMiddleware, (req, res) => {
  const db = readDB();
  res.json({ messages: db.chats[req.params.id]?.messages || [] });
});

// -------------------- SOCKET --------------------
io.on("connection", socket => {
  socket.on("auth", ({ token }) => {
    const db = readDB();
    const user = db.users.find(u => u.token === token);
    if (!user) return socket.disconnect();

    socket.userId = user.id;
    socket.username = user.username;
    io.emit("presence", { userId: user.id, online: true });
  });

  socket.on("join_chat", ({ chatId }) => socket.join(chatId));

  socket.on("send_message", ({ chatId, text, ephemeral }) => {
    const msg = {
      id: uid(),
      chatId,
      fromUserId: socket.userId,
      fromUsername: socket.username,
      text,
      time: new Date().toLocaleTimeString().slice(0, 5)
    };
    io.to(chatId).emit("new_message", msg);

    if (!ephemeral) {
      const db = readDB();
      db.chats[chatId].messages.push(msg);
      writeDB(db);
    }
  });
});

// -------------------- START --------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("OxyTalk running on", PORT));
