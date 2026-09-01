require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { Telegraf, Markup } = require("telegraf");

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const APP_URL = process.env.APP_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-password";

if (!BOT_TOKEN) console.warn("BOT_TOKEN is missing. The web app can still start, but the bot cannot.");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const db = new Database("data.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  balance REAL DEFAULT 0,
  referrals INTEGER DEFAULT 0,
  referred_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  reward REAL NOT NULL DEFAULT 0,
  url TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL,
  account TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function upsertUser(u, ref) {
  const existing = db.prepare("SELECT * FROM users WHERE telegram_id=?").get(String(u.id));
  if (existing) {
    db.prepare("UPDATE users SET username=?, first_name=? WHERE telegram_id=?")
      .run(u.username || null, u.first_name || "", String(u.id));
    return existing;
  }

  let referredBy = null;
  if (ref && String(ref) !== String(u.id)) {
    const refUser = db.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").get(String(ref));
    if (refUser) referredBy = String(ref);
  }

  const info = db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, referred_by)
    VALUES (?, ?, ?, ?)
  `).run(String(u.id), u.username || null, u.first_name || "", referredBy);

  if (referredBy) {
    db.prepare("UPDATE users SET referrals=referrals+1, balance=balance+1 WHERE telegram_id=?")
      .run(referredBy);
  }

  return db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
}

// Telegram Mini App initData validation.
// Never trust initDataUnsafe on the server.
function validateTelegramInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculated = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

function requireMiniApp(req, res, next) {
  const user = validateTelegramInitData(req.headers["x-telegram-init-data"]);
  if (!user) return res.status(401).json({ error: "Telegram authorization failed" });
  req.tgUser = user;
  next();
}

function requireAdmin(req, res, next) {
  const password = req.headers["x-admin-password"] || req.body.password;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Admin login failed" });
  next();
}

app.get("/api/me", requireMiniApp, (req, res) => {
  const user = upsertUser(req.tgUser, null);
  const tasks = db.prepare("SELECT id,title,reward,url FROM tasks WHERE active=1 ORDER BY id DESC").all();
  res.json({ user, tasks, botUsername: BOT_USERNAME });
});

app.post("/api/referral", requireMiniApp, (req, res) => {
  const user = upsertUser(req.tgUser, req.body.ref);
  res.json({ ok: true, user });
});

app.post("/api/claim-task", requireMiniApp, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id=? AND active=1").get(Number(req.body.taskId));
  if (!task) return res.status(404).json({ error: "Task not found" });

  // MVP: reward once per browser/session is NOT enough for production.
  // Add a task_claims table before real money is enabled.
  db.prepare("UPDATE users SET balance=balance+? WHERE telegram_id=?")
    .run(task.reward, String(req.tgUser.id));

  res.json({ ok: true, reward: task.reward });
});

app.post("/api/withdraw", requireMiniApp, (req, res) => {
  const amount = Number(req.body.amount);
  const method = String(req.body.method || "").trim();
  const account = String(req.body.account || "").trim();

  if (!amount || amount <= 0 || !method || !account)
    return res.status(400).json({ error: "Invalid withdrawal request" });

  const user = db.prepare("SELECT balance FROM users WHERE telegram_id=?").get(String(req.tgUser.id));
  if (!user || user.balance < amount)
    return res.status(400).json({ error: "Insufficient balance" });

  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET balance=balance-? WHERE telegram_id=?")
      .run(amount, String(req.tgUser.id));
    db.prepare(`
      INSERT INTO withdrawals (telegram_id,amount,method,account)
      VALUES (?,?,?,?)
    `).run(String(req.tgUser.id), amount, method, account);
  });
  tx();

  res.json({ ok: true });
});

// Admin API
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'").get().c;
  const balance = db.prepare("SELECT COALESCE(SUM(balance),0) s FROM users").get().s;
  res.json({ users, pending, balance });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM users ORDER BY id DESC LIMIT 500").all());
});

app.get("/api/admin/withdrawals", requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM withdrawals ORDER BY id DESC LIMIT 500").all());
});

app.post("/api/admin/task", requireAdmin, (req, res) => {
  const title = String(req.body.title || "").trim();
  const reward = Number(req.body.reward);
  const url = String(req.body.url || "").trim();
  if (!title || !reward) return res.status(400).json({ error: "Title and reward required" });

  const info = db.prepare("INSERT INTO tasks(title,reward,url) VALUES (?,?,?)")
    .run(title, reward, url);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.post("/api/admin/withdrawal-status", requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const status = String(req.body.status);
  if (!["approved", "rejected"].includes(status))
    return res.status(400).json({ error: "Invalid status" });

  const row = db.prepare("SELECT * FROM withdrawals WHERE id=?").get(id);
  if (!row) return res.status(404).json({ error: "Withdrawal not found" });

  const tx = db.transaction(() => {
    if (status === "rejected") {
      db.prepare("UPDATE users SET balance=balance+? WHERE telegram_id=?")
        .run(row.amount, row.telegram_id);
    }
    db.prepare("UPDATE withdrawals SET status=? WHERE id=?").run(status, id);
  });
  tx();

  res.json({ ok: true });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Bot
if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  bot.start(async (ctx) => {
    const payload = ctx.startPayload || "";
    const ref = payload.startsWith("ref_") ? payload.slice(4) : null;
    upsertUser(ctx.from, ref);

    const text =
      `👋 Welcome ${ctx.from.first_name || ""}!\\n\\n` +
      `💰 Earn rewards, complete tasks and invite friends.\\n\\n` +
      `Tap the button below to open the app.`;

    if (APP_URL) {
      await ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.webApp("🚀 Open Earning App", APP_URL)]
      ]));
    } else {
      await ctx.reply(text);
    }
  });

  bot.command("balance", (ctx) => {
    const user = db.prepare("SELECT balance FROM users WHERE telegram_id=?").get(String(ctx.from.id));
    ctx.reply(`💰 Your balance: ${user ? user.balance : 0}`);
  });

  bot.command("ref", (ctx) => {
    if (!BOT_USERNAME) return ctx.reply("BOT_USERNAME is not configured.");
    ctx.reply(`🔗 Your referral link:\\nhttps://t.me/${BOT_USERNAME}?start=ref_${ctx.from.id}`);
  });

  // Webhook route
  app.use(bot.webhookCallback("/telegram/webhook"));

  if (APP_URL) {
    bot.telegram.setWebhook(`${APP_URL.replace(/\\/$/, "")}/telegram/webhook`)
      .then(() => console.log("Telegram webhook configured"))
      .catch(console.error);
  } else {
    bot.launch().then(() => console.log("Bot polling started")).catch(console.error);
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
