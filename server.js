const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ================= BASIC MIDDLEWARE ================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ================= STATIC FRONTEND ================= */
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

/* ================= DEFAULT PAGE ================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

/* ================= DATABASE ================= */
const DB_PATH = path.join(__dirname, "database.json");

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

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function chatIdFor(a, b) {
  return [a, b].sort().join("__");
}

/* ================= UPLOAD ================= */
const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    const dir = path.join(__dirname, "public/uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_, file, cb) => {
    cb(null, uid() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

/* ================= AUTH ================= */
function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });

  const db = readDB();
  const user = db.users.find(u => u.token === token);
  if (!user) return res.status(401).json({ error: "Invalid token" });

  req.user = user;
  next();
}

/* ================= API ================= */

// REGISTER
app.post("/api/register", upload.single("avatar"), (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: "All fields required" });

  const db = readDB();
  if (db.users.some(u => u.email === email))
    return res.status(409).json({ error: "Email exists" });

  const user = {
    id: uid(),
    username,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    avatarUrl: req.file ? "/uploads/" + req.file.filename : "",
    token: uid()
  };

  db.users.push(user);
  writeDB(db);

  res.json({ token: user.token, user });
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash))
    return res.status(401).json({ error: "Invalid login" });

  user.token = uid();
  writeDB(db);

  res.json({ token: user.token, user });
});

// CONTACT CHECK
app.get("/api/contact/check/:id", auth, (req, res) => {
  const other = req.params.id;
  const db = readDB();
  const ok = db.contacts.some(
    c =>
      (c.a === req.user.id && c.b === other) ||
      (c.b === req.user.id && c.a === other)
  );
  res.json({ isContact: ok, chatId: ok ? chatIdFor(req.user.id, other) : null });
});

/* ================= SOCKET ================= */
io.on("connection", socket => {
  socket.on("auth", ({ token }) => {
    const db = readDB();
    const user = db.users.find(u => u.token === token);
    if (!user) return socket.disconnect();

    socket.user = user;
  });

  socket.on("join_chat", ({ chatId }) => socket.join(chatId));

  socket.on("send_message", ({ chatId, text }) => {
    if (!socket.user) return;
    const msg = {
      id: uid(),
      chatId,
      from: socket.user.username,
      text,
      time: new Date().toLocaleTimeString()
    };
    io.to(chatId).emit("new_message", msg);
  });
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("OxyTalk running on", PORT));
