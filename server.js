import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";
import TelegramBot from "node-telegram-bot-api";
import http from "http";
import { Server } from "socket.io";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import rateLimit from "express-rate-limit";
import { GoogleGenerativeAI } from "@google/generative-ai";
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

let vectorStore = null;
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-small", // نموذج سريع ورخيص جداً من OpenAI لتحويل النصوص
});

function isWorkTime() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" }),
  );
  const day = now.getDay(); // 0 الأحد، 4 الخميس
  const hour = now.getHours();
  return day >= 0 && day <= 4 && hour >= 10 && hour < 23;
}
const ALLOWED_ORIGIN = "https://gifts-village.sa";
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGIN,
  },
});

app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: ALLOWED_ORIGIN }));
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    reply: "🌸 أرسلت كثيراً، انتظر دقيقة وحاول مجدداً",
    recommend: false,
  },
});

app.use("/chat", chatLimiter);

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: {
    autoStart: true,
    params: {
      timeout: 10,
    },
  },
});

bot.on("polling_error", (err) => {
  console.log("⚠️ POLLING ERROR:", err.message);
});

// 1. ضع هنا الـ Chat ID الخاص بك وبأي موظف آخر (أرقام بدون فواصل علوية)
const employeeList = (process.env.EMPLOYEES || "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

let allowedUsers = new Set(employeeList.map((e) => Number(e.split(":")[0])));
let telegramUsers = new Set(Array.from(allowedUsers));
let userNames = {};
employeeList.forEach((e) => {
  const [id, name] = e.split(":");
  userNames[Number(id)] = name;
});

// =========================
// 💬 SESSIONS
// =========================
let clientSockets = {};

// تحميل البيانات عند التشغيل
function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync("./state.json", "utf8"));
    return {
      sessions: data.sessions || {},
      supportMode: data.supportMode || {},
      employeeSessions: data.employeeSessions || {},
      pendingSupport: data.pendingSupport || {},
    };
  } catch {
    return {
      sessions: {},
      supportMode: {},
      employeeSessions: {},
      pendingSupport: {},
    };
  }
}

let { sessions, supportMode, employeeSessions, pendingSupport } = loadState();

// حفظ الحالة بشكل دوري كل دقيقتين
function saveState() {
  fs.writeFileSync(
    "./state.json",
    JSON.stringify(
      {
        sessions,
        supportMode,
        employeeSessions,
        pendingSupport,
      },
      null,
      2,
    ),
  );
}

setInterval(saveState, 2 * 60 * 1000);

// حفظ عند إغلاق السيرفر
process.on("SIGINT", () => {
  saveState();
  process.exit();
});
process.on("SIGTERM", () => {
  saveState();
  process.exit();
});

setInterval(
  () => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const id in sessions) {
      if (!sessions[id].lastActive || sessions[id].lastActive < cutoff) {
        delete sessions[id];
      }
    }
  },
  30 * 60 * 1000,
);

// حفظ المستخدمين
function saveAllowedUsers() {
  fs.writeFileSync(
    "./allowed_users.json",
    JSON.stringify(Array.from(allowedUsers), null, 2),
  );
}

function saveUsers() {
  fs.writeFileSync(
    "./telegram_users.json",
    JSON.stringify(Array.from(telegramUsers), null, 2),
  );
}

function saveUserNames() {
  fs.writeFileSync("./user_names.json", JSON.stringify(userNames, null, 2));
}

// =========================
// LOGOUT
// =========================

bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  console.log("BUTTON:", data);

  if (data.startsWith("take_")) {
    const sessionId = data.replace("take_", "");

    if (!allowedUsers.has(chatId)) {
      bot.answerCallbackQuery(query.id, { text: "❌ غير مصرح لك" });
      return;
    }

    if (employeeSessions[chatId]) {
      bot.answerCallbackQuery(query.id, {
        text: "⚠️ لا يمكنك استلام عميل جديد قبل إنهاء المحادثة الحالية! (أرسل /end أولاً)",
        show_alert: true, // ستظهر رسالة تنبيه للموظف في التليجرام
      });
      return;
    }

    if (!pendingSupport[sessionId]) {
      bot.answerCallbackQuery(query.id, {
        text: "❌ العميل تم استلامه بالفعل",
      });

      bot.editMessageText("⚠️ تم استلام هذا العميل بالفعل.", {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      return;
    }

    delete pendingSupport[sessionId];

    employeeSessions[chatId] = sessionId;
    supportMode[sessionId] = true;

    if (!sessions[sessionId]) sessions[sessionId] = { history: [] };
    sessions[sessionId].handledBy = userNames[chatId] || "موظف خدمة العملاء";

    saveUsers();
    saveAllowedUsers();
    saveUserNames();

    bot.sendMessage(
      chatId,

      `✅ تم استلام العميل

🆔 ${sessionId}

✍️ أي رسالة ترسلها ستصل للعميل مباشرة

⛔ لإنهاء المحادثة:
/end`,
    );

    bot.answerCallbackQuery(query.id, {
      text: "تم استلام العميل وعمل اتصال مباشر وبدء المحادثة",
    });
    return; // إنهاء الدالة هنا لمنع النزول للأسفل
  }
});

// =========================
// MESSAGE HANDLER
// =========================

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (text === "/start") {
    bot.sendMessage(
      chatId,
      `🌸 أهلاً بك في نظام قرية الهدايا\n\n🆔 الـ Chat ID الخاص بك:\n<code>${chatId}</code>`,
      { parse_mode: "HTML" },
    );
    return;
  }

  // إنهاء المحادثة
  if (text === "/end" && employeeSessions[chatId]) {
    const sessionId = employeeSessions[chatId];

    supportMode[sessionId] = false;

    delete employeeSessions[chatId];

    io.to(sessionId).emit("human_end", {
      message: "انتهت المحادثة مع خدمة العملاء 🌸",
    });

    bot.sendMessage(chatId, "✅ تم إنهاء المحادثة");

    return;
  }

  // إرسال صورة من الموظف للعميل عبر تليجرام
  if (msg.photo && allowedUsers.has(chatId) && employeeSessions[chatId]) {
    const sessionId = employeeSessions[chatId];
    const photo = msg.photo[msg.photo.length - 1]; // أكبر دقة
    bot
      .getFileLink(photo.file_id)
      .then((fileUrl) => {
        io.to(sessionId).emit("human_image_msg", { image: fileUrl });
      })
      .catch((err) => console.log("❌ PHOTO FORWARD ERROR:", err.message));
    return;
  }

  // إرسال الموظف للعميل
  if (
    allowedUsers.has(chatId) &&
    userNames[chatId] &&
    employeeSessions[chatId]
  ) {
    const sessionId = employeeSessions[chatId];

    if (!sessions[sessionId]) {
      sessions[sessionId] = { history: [] };
    }

    sessions[sessionId].history.push({
      role: "assistant",
      content: `(الموظف): ${text}`,
    });

    io.to(sessionId).emit("human_message", {
      message: text,
    });

    return;
  }
});

// =========================
// 🔑 OPENAI
// =========================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================
// 📦 PRODUCTS
// =========================
let products = [];
let stats = {
  totalSessions: 0,
  totalMessages: 0,
  transferredToSupport: 0,
  dailyMessages: {},
  productRequests: {},
};

try {
  stats = JSON.parse(fs.readFileSync("./stats.json", "utf8"));
} catch {}

function saveStats() {
  fs.writeFileSync("./stats.json", JSON.stringify(stats, null, 2));
}

function saveConversation(sessionId) {
  const session = sessions[sessionId];
  if (!session || !session.history || session.history.length === 0) return;

  let conversations = [];
  try {
    conversations = JSON.parse(fs.readFileSync("./conversations.json", "utf8"));
  } catch {}

  const existing = conversations.findIndex((c) => c.sessionId === sessionId);
  const entry = {
    sessionId: sessionId,
    date: new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
    history: session.history,
  };

  if (existing !== -1) {
    conversations[existing] = entry;
  } else {
    conversations.push(entry);
  }

  if (conversations.length > 200) conversations = conversations.slice(-200);

  fs.writeFileSync(
    "./conversations.json",
    JSON.stringify(conversations, null, 2),
  );
}

// =========================
// 🏪 STORE INFO
// =========================
let storeKnowledge = "";

try {
  storeKnowledge = fs.readFileSync("./store_knowledge.txt", "utf8");
} catch {
  storeKnowledge = `
اسم المتجر:
قرية الهدايا

الشحن:
2-5 أيام داخل السعودية.

الدفع:
مدى - فيزا - أبل باي.

الاستبدال:
خلال 3 أيام.

الاسترجاع:
خلال يوم واحد.

رقم جوال المتجر:
0558000539

رابط المتجر:
https://gifts-village.sa
`;
}

// =========================
// 📦 LOAD PRODUCTS
// =========================
async function loadProducts() {
  try {
    const file = xlsx.readFile("./products.xlsx");

    const sheet = file.Sheets[file.SheetNames[0]];

    const data = xlsx.utils.sheet_to_json(sheet);

    products = data.map(function (p, i) {
      let image = String(p.image || "")
        .split(",")[0]
        .trim();

      return {
        id: i,
        title: p.name || "",
        description: p.description || "",
        price: p.price || "",
        image: image,
        url: p.url || "",
        tags: String(p.tags || ""),
        gender: String(p.gender || "الكل"),
        age: String(p.age || ""),
      };
    });

    console.log("✅ PRODUCTS:", products.length);

    const documents = products.map((p) => {
      const pageContent = `الاسم: ${p.title}\nالوصف: ${p.description}\nالسعر: ${p.price}\nالتصنيف: ${p.tags}\nمناسب لـ: ${p.gender}\nالفئة العمرية: ${p.age}`;
      return new Document({
        pageContent: pageContent,
        metadata: { id: p.id },
      });
    });

    // إنشاء الـ Vector Store في الذاكرة
    console.log("⏳ جاري تهيئة نظام البحث الذكي لـ 500 منتج...");
    vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);
    console.log("🚀 نظام البحث الذكي (RAG) جاهز الآن لخدمة ياسمين والعملاء!");
  } catch (err) {
    console.log("❌ EXCEL ERROR:", err);
  }
}

loadProducts();

// =========================
// 🧠 SAFE JSON
// =========================
function sanitize(text) {
  return text.replace(/[<>&"]/g, "");
}

function safeJson(text) {
  try {
    return JSON.parse(
      text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim(),
    );
  } catch {
    return null;
  }
}

// =========================
// ❤️ ROOT
// =========================
app.get("/beep.wav", function (req, res) {
  res.sendFile(new URL("./beep.wav", import.meta.url).pathname);
});

app.get("/", function (req, res) {
  res.send("🌸 Yasmin AI Running");
});

app.post("/reload-products", async function (req, res) {
  if (req.query.pass !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: "غير مصرح" });
  }
  await loadProducts();
  res.json({ success: true, total: products.length });
});

app.get("/stats", function (req, res) {
  const pass = req.query.pass;
  if (pass !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: "غير مصرح" });
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(stats);
});

app.get("/gifts-village-dashboard", function (req, res) {
  const pass = req.query.pass;
  if (pass !== DASHBOARD_PASSWORD) {
    return res.send(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>لوحة تحكم ياسمين</title>
<link rel="icon" href="https://media.zid.store/f9acd5af-b553-4b35-a418-e791211b7c21/620a4cd4-19e3-4fcb-8e28-5bd3e472eed2.png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#FFF0F5;display:flex;align-items:center;justify-content:center;min-height:100vh;direction:rtl}
.box{background:#fff;border-radius:20px;padding:2.5rem 2rem;text-align:center;width:100%;max-width:360px;border:0.5px solid #f5c0d0}
.logo{font-size:36px;margin-bottom:0.5rem}
.title{font-size:18px;font-weight:500;color:#222;margin-bottom:4px}
.sub{font-size:13px;color:#aaa;margin-bottom:1.5rem}
button{width:100%;padding:12px;background:#D4537E;color:#fff;border:none;border-radius:12px;font-size:15px;cursor:pointer;font-weight:500}
button:hover{background:#c0476d}
</style>
</head>
<body>
<div class="box">
  <div class="logo">🌸</div>
  <div class="title">لوحة تحكم ياسمين</div>
  <div class="sub">أدخل الرقم السري للمتابعة</div>
  <form method="GET">
    <div style="position:relative;margin-bottom:12px;">
      <input id="passInput" name="pass" type="password" placeholder="الرقم السري" style="width:100%;padding:12px 44px 12px 16px;border-radius:12px;border:1px solid #f5c0d0;font-size:14px;outline:none;text-align:right;color:#222;background:#FFF8FB;" />
      <span onclick="togglePass()" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);cursor:pointer;color:#D4537E;">
        <i id="eyeIcon" class="ti ti-eye" style="font-size:18px;"></i>
      </span>
    </div>
    <button type="submit">دخول</button>
  </form>
  <script>
  function togglePass() {
    const input = document.getElementById('passInput');
    const icon = document.getElementById('eyeIcon');
    if (input.type === 'password') {
      input.type = 'text';
      icon.className = 'ti ti-eye-off';
    } else {
      input.type = 'password';
      icon.className = 'ti ti-eye';
    }
  }
  </script>
</div>
</body>
</html>`);
  }

  res.send(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>لوحة تحكم ياسمين الخاص بقرية الهدايا</title>
<link rel="icon" href="https://media.zid.store/f9acd5af-b553-4b35-a418-e791211b7c21/620a4cd4-19e3-4fcb-8e28-5bd3e472eed2.png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#FFF0F5;direction:rtl;padding:30px;color:#222}
.header{display:flex;align-items:center;gap:12px;margin-bottom:2rem}
.avatar{width:42px;height:42px;border-radius:50%;background:#FBEAF0;display:flex;align-items:center;justify-content:center;font-size:20px}
.title{font-size:18px;font-weight:500}
.subtitle{font-size:12px;color:#888;margin-top:2px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:1.5rem}
.stat{background:#fff;border:0.5px solid #eee;border-radius:12px;padding:1rem;text-align:center}
.stat i{font-size:22px;color:#D4537E}
.stat-val{font-size:28px;font-weight:500;color:#D4537E;margin:6px 0}
.stat-label{font-size:12px;color:#888}
.card{background:#fff;border:0.5px solid #eee;border-radius:14px;padding:1.25rem;margin-bottom:1rem}
.card-title{font-size:14px;font-weight:500;margin-bottom:1rem;display:flex;align-items:center;gap:6px;color:#222}
.row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:0.5px solid #f0f0f0;font-size:14px}
.row:last-child{border-bottom:none}
.badge{background:#FBEAF0;color:#993556;font-size:12px;padding:3px 12px;border-radius:20px;font-weight:500}
.refresh{display:inline-flex;align-items:center;gap:6px;margin-top:1rem;padding:7px 18px;border:0.5px solid #eee;border-radius:10px;background:#fff;cursor:pointer;font-size:13px;color:#D4537E;text-decoration:none}
.refresh:hover{background:#FBEAF0}
</style>
</head>
<body>

<div class="header">
  <div class="avatar">🌸</div>
  <div>
    <div class="title">لوحة تحكم ياسمين الخاص بقرية الهدايا</div>
    <div class="subtitle">إحصائيات المتجر</div>
  </div>
</div>

<div class="grid">
  <div class="stat">
    <i class="ti ti-users"></i>
    <div class="stat-val">${stats.totalSessions}</div>
    <div class="stat-label">إجمالي الجلسات</div>
  </div>
  <div class="stat">
    <i class="ti ti-message"></i>
    <div class="stat-val">${stats.totalMessages}</div>
    <div class="stat-label">إجمالي الرسائل</div>
  </div>
  <div class="stat">
    <i class="ti ti-headset"></i>
    <div class="stat-val">${stats.transferredToSupport}</div>
    <div class="stat-label">تحويل لخدمة العملاء</div>
  </div>
  <div class="stat">
    <i class="ti ti-star"></i>
    <div class="stat-val">${(function () {
      try {
        const reviews = JSON.parse(fs.readFileSync("./reviews.json", "utf8"));
        if (reviews.length === 0) return "—";
        const avg =
          reviews.reduce((sum, r) => sum + Number(r.rating), 0) /
          reviews.length;
        return avg.toFixed(1) + " ⭐";
      } catch {
        return "—";
      }
    })()}</div>
    <div class="stat-label">متوسط تقييم المتجر</div>
  </div>
  <div class="stat">
    <i class="ti ti-star-half"></i>
    <div class="stat-val">${(function () {
      try {
        const chatReviews = JSON.parse(
          fs.readFileSync("./chat_reviews.json", "utf8"),
        );
        if (chatReviews.length === 0) return "—";
        const avg =
          chatReviews.reduce((sum, r) => sum + Number(r.rating), 0) /
          chatReviews.length;
        return avg.toFixed(1) + " ⭐";
      } catch {
        return "—";
      }
    })()}</div>
    <div class="stat-label">متوسط تقييم خدمة العملاء</div>
  </div>
</div>

<div class="card">
  <div class="card-title"><i class="ti ti-calendar-stats"></i> آخر 7 أيام</div>
  ${
    Object.entries(stats.dailyMessages)
      .slice(-7)
      .reverse()
      .map(
        ([d, c]) =>
          `<div class="row"><span style="color:#888">${d}</span><span class="badge">${c} رسالة</span></div>`,
      )
      .join("") ||
    '<div style="color:#aaa;font-size:13px;text-align:center;padding:1rem">لا توجد بيانات بعد</div>'
  }
</div>

<div class="card">
  <div class="card-title"><i class="ti ti-shopping-bag"></i> أكثر المنتجات طلباً</div>
  ${
    Object.entries(stats.productRequests)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(
        ([name, count]) =>
          `<div class="row"><span>${name}</span><span class="badge">${count} طلب</span></div>`,
      )
      .join("") ||
    '<div style="color:#aaa;font-size:13px;text-align:center;padding:1rem">لا توجد بيانات بعد</div>'
  }
</div>

<div class="card">
  <div class="card-title"><i class="ti ti-messages"></i> آخر المحادثات</div>
  ${(function () {
    let convs = [];
    try {
      convs = JSON.parse(fs.readFileSync("./conversations.json", "utf8"));
    } catch {}
    if (convs.length === 0)
      return '<div style="color:#aaa;font-size:13px;text-align:center;padding:1rem">لا توجد محادثات بعد</div>';
    return convs
      .slice(-20)
      .reverse()
      .map((c) => {
        const msgs = c.history
          .map(
            (h) =>
              '<div style="margin:4px 0;padding:6px 10px;border-radius:10px;background:' +
              (h.role === "user" ? "#fff0f5" : "#f5f5f5") +
              ';font-size:12px;color:#444;">' +
              '<span style="color:' +
              (h.role === "user" ? "#D4537E" : "#888") +
              ';font-weight:500;">' +
              (h.role === "user" ? "العميل: " : "ياسمين: ") +
              "</span>" +
              (function () {
                try {
                  var parsed = JSON.parse(
                    h.content.replace(/\`\`\`json|\`\`\`/g, "").trim(),
                  );
                  return parsed.reply || "";
                } catch (e) {
                  return h.content
                    .replace(/\{[\s\S]*?\}/g, "")
                    .replace(
                      /\[([^\]]+)\]\(([^)]+)\)/g,
                      '<a href="$2" target="_blank" style="display:inline-block;margin-top:6px;padding:6px 14px;background:#D4537E;color:#fff;border-radius:20px;font-size:12px;text-decoration:none;">$1</a>',
                    )
                    .trim();
                }
              })() +
              "</div>",
          )
          .join("");
        return (
          '<details style="margin-bottom:10px;border:0.5px solid #f5c0d0;border-radius:12px;overflow:hidden;">' +
          '<summary style="padding:10px 14px;cursor:pointer;font-size:13px;font-weight:500;color:#222;background:#fff8fb;">' +
          '<span style="color:#D4537E;">' +
          c.sessionId +
          "</span>" +
          '<span style="color:#aaa;font-size:11px;margin-right:8px;">' +
          c.date +
          "</span>" +
          "</summary>" +
          '<div style="padding:10px;background:#fafafa;">' +
          msgs +
          "</div>" +
          "</details>"
        );
      })
      .join("");
  })()}
</div>

<div style="display:flex;gap:10px;justify-content:center;margin-top:1rem;">
  <a class="refresh" href="/gifts-village-dashboard?pass=${DASHBOARD_PASSWORD}">
    <i class="ti ti-refresh"></i> تحديث
  </a>
  <button onclick="reloadProducts()" class="refresh" style="border:none;cursor:pointer;">
    <i class="ti ti-package"></i> تحديث المنتجات
  </button>
</div>

<script>
async function reloadProducts() {
  const btn = event.target.closest('button');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> جاري التحديث...';
  try {
    const res = await fetch('/reload-products?pass=${DASHBOARD_PASSWORD}', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      btn.innerHTML = '<i class="ti ti-check"></i> تم! ' + data.total + ' منتج';
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-package"></i> تحديث المنتجات';
      }, 3000);
    }
  } catch {
    btn.innerHTML = '❌ فشل التحديث';
    btn.disabled = false;
  }
}
</script>

</body>
</html>`);
});

// =========================
// 📡 SOCKET.IO CONNECTION
// =========================
io.on("connection", (socket) => {
  socket.on("register", (sessionId) => {
    socket.join(sessionId);
    clientSockets[sessionId] = socket.id;
    console.log("✅ CLIENT CONNECTED:", sessionId);
  });

  // استقبال صورة من العميل وإرسالها للموظف في تليجرام
  socket.on("user_image", (data) => {
    const { sessionId, image } = data;
    if (!sessionId || !supportMode[sessionId]) return;

    const employeeId = Object.keys(employeeSessions).find(
      (id) => employeeSessions[id] === sessionId,
    );

    if (employeeId) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      bot
        .sendPhoto(Number(employeeId), buffer, {
          caption: `📸 صورة من العميل ${sessionId}`,
        })
        .catch((err) => console.log("❌ IMAGE SEND ERROR:", err.message));
    }
  });

  socket.on("disconnect", () => {
    for (const id in clientSockets) {
      if (clientSockets[id] === socket.id) {
        delete clientSockets[id];
        console.log("🔌 CLIENT DISCONNECTED:", id);
        break;
      }
    }
  });
});

// =========================
// 🏁 END SUPPORT ROUTE (هنا المكان الصحيح مستقلة)
// =========================
app.post("/end-support", async function (req, res) {
  try {
    const { sessionId } = req.body;

    if (supportMode[sessionId]) {
      // 1. إيقاف وضع الدعم للعميل
      supportMode[sessionId] = false;
      delete pendingSupport[sessionId];

      // 2. إبلاغ الموظف في تليجرام أن العميل أنهى المحادثة
      const employeeId = Object.keys(employeeSessions).find(
        (id) => employeeSessions[id] === sessionId,
      );
      if (employeeId) {
        bot.sendMessage(
          employeeId,
          `🏁 العميل ${sessionId} قام بإنهاء المحادثة.`,
        );
        delete employeeSessions[employeeId];
      }

      // 3. إرسال تأكيد للعميل عبر Socket ليعرف المتصفح أن الوضع تغير
      io.to(sessionId).emit("human_end", {
        message: "تم إنهاء المحادثة، ياسمين معكِ الآن لمساعدتك. 🌸",
      });

      return res.json({ success: true });
    }
    res.json({ success: false, message: "المحادثة غير فعالة" });
  } catch (err) {
    console.log("❌ END SUPPORT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

// =========================
// 💬 CHAT
// =========================

app.post("/chat", async function (req, res) {
  let matchedProducts = [];
  const message = req.body.message || "";
  try {
    const sessionId = req.body.sessionId || "guest";

    if (!/^[a-zA-Z0-9_-]{5,50}$/.test(sessionId)) {
      return res
        .status(400)
        .json({ reply: "🌸 طلب غير صحيح", recommend: false });
    }

    if (!message.trim()) {
      return res.json({ reply: "🌸 الرسالة فارغة", recommend: false });
    }

    if (message.length > 1000) {
      return res.json({
        reply: "🌸 رسالتك طويلة جداً، اختصر قليلاً",
        recommend: false,
      });
    }

    if (supportMode[sessionId]) {
      const employeeId = Object.keys(employeeSessions).find(
        (id) => employeeSessions[id] === sessionId,
      );

      if (!sessions[sessionId]) sessions[sessionId] = { history: [] };
      sessions[sessionId].history.push({ role: "user", content: message });

      if (employeeId) {
        bot.sendMessage(employeeId, `💬 ${sessionId}\n\n${sanitize(message)}`);

        return res.json({
          reply: "",
          recommend: false,
        });
      } else {
        // العميل طلب الخدمة لكن لم يستلمه موظف بعد
        return res.json({
          reply:
            "تم تحويلك لخدمة العملاء👨‍💼، انتظر قليلاً حتى يتصل بك أحد موظفينا.",
          recommend: false,
        });
      }
    }

    const lower = message.toLowerCase();
    if (
      lower.includes("خدمة العملاء") ||
      lower.includes("موظف") ||
      lower.includes("بشري") ||
      lower === "حولني"
    ) {
      if (!isWorkTime()) {
        return res.json({
          reply:
            "معذرة، ساعات عمل خدمة العملاء من الساعة 10 صباحاً وحتى 11 مساءً أيام الأسبوع (الأحد - الخميس). كيف يمكنني مساعدتك الآن؟",
          recommend: false,
        });
      }

      supportMode[sessionId] = true;
      pendingSupport[sessionId] = true;
      stats.transferredToSupport++;
      saveStats();

      telegramUsers.forEach((id) => {
        bot.sendMessage(
          id,
          `📞 عميل جديد يحتاج خدمة العملاء

🆔 ${sessionId}

💬 الرسالة:
${sanitize(message)}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ استلام العميل",
                    callback_data: `take_${sessionId}`,
                  },
                ],
              ],
            },
          },
        );
      }); // ✅ أضفنا إرجاع رسالة للمستخدم وإيقاف الكود هنا عشان ما يكمل للذكاء الاصطناعي

      io.to(sessionId).emit("human_mode", { status: true });
      return res.json({
        reply: "تم إبلاغ خدمة العملاء👨‍💼، سيتم الرد عليك في أقرب وقت.",
        recommend: false,
      });
    }

    if (!sessions[sessionId]) {
      sessions[sessionId] = { history: [] };
    }

    const session = sessions[sessionId];
    session.history.push({ role: "user", content: message });
    session.lastActive = Date.now();
    saveConversation(sessionId);
    const today = new Date().toLocaleDateString("ar-SA", {
      timeZone: "Asia/Riyadh",
    });
    if (!stats.dailyMessages[today]) stats.dailyMessages[today] = 0;
    stats.dailyMessages[today]++;
    stats.totalMessages++;
    if (!session.counted) {
      stats.totalSessions++;
      session.counted = true;
    }
    saveStats();

    if (vectorStore) {
      // البحث في الذاكرة عن أفضل 4 منتجات تناسب سياق رسالة العميل تماماً
      const searchResults = await vectorStore.similaritySearch(message, 4);

      // استخراج المنتجات كاملة من المصفوفة الرئيسية بناءً على الـ IDs الفائزة
      const matchedIds = searchResults.map((doc) => doc.metadata.id);
      matchedProducts = products.filter((p) => matchedIds.includes(p.id));
    }

    // إذا كان البحث فارغاً لأي سبب، نأخذ أول 3 منتجات كاحتياط
    if (matchedProducts.length === 0) {
      matchedProducts = products.slice(0, 3);
    }

    const catalog = matchedProducts
      .map(function (p) {
        return `ID:${p.id} | ${p.title} | ${p.price} ريال | مناسب لـ: ${p.gender} | العمر: ${p.age} | ${p.description}`;
      })
      .join("\n");

    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",

      temperature: 0.7,

      messages: [
        {
          role: "system",

          content: `

أنتِ ياسمين 🌸

موظفة ذكية داخل متجر قرية الهدايا.

مهمتك:
- فهم العميل
- التفاعل الطبيعي
- اقتراح منتجات مناسبة
- كوني لطيفة وودودة
- إذا ذكر العميل اسمه في أي رسالة، احفظيه وناديه باسمه في ردودك القادمة بشكل طبيعي.
- الإجابة عن أسئلة المتجر فقط
- إذا سأل العميل عن "خدمة العملاء" أو "موظف": أخبريه أنكِ تستطيعين المساعدة، ولكن إذا أصر، قولي له "هل تريد تحويلك لخدمة العملاء؟".
- إذا واجه العميل مشكلة فنية أو شكوى لا تستطيعين حلها: قولي "عذراً لا أستطيع حل هذه المشكلة، هل ترغب في التواصل مع خدمة العملاء؟ اكتب (حولني) للتحويل".
- لا تقومي بالتحويل تلقائياً، انتظري كلمة "حولني" من العميل.
- إذا وافق العميل، اطلبي منه كتابة "حولني" بوضوح.
- إذا طلب العميل رؤية المزيد من منتجات قسم معين، أضيفي في الـ JSON حقل "category_link" يحتوي label وurl. الأقسام:
  المواليد: https://gifts-village.sa/categories/1522449/قسم-المواليد
  أولاد: https://gifts-village.sa/categories/1522452/قسم-الاولاد
  بنات: https://gifts-village.sa/categories/1522453/قسم-البنات
  سيارات: https://gifts-village.sa/categories/1531910/مركبات-كهربائية
- category_link اختياري، أضيفيه فقط إذا طلب العميل مزيداً من قسم بعينه.
- إذا قال العميل "وريني" أو "اعرض" أو "ابغى أشوف" فهذا طلب مباشر لعرض منتجات، لا تسألي أكثر، اعرضي مباشرة.
- اذا سأل العميل عن الاسترجاع او الاتبدال عطيه المعلومات اللي عندك وايضا عطيه الرابط : https://gifts-village.sa/pages/refund-exchange-policy
- اذا سأل العميل عن صفحة او سياسة الخصوصية عطيه : https://gifts-village.sa/pages/privacy-policy
- إذا طلب العميل منتجات من قسم معين (مثل بنات، أولاد، سيارات، مواليد)، اعرض فقط منتجات من نفس القسم ولا تخلط بين الأقسام.
- كل منتج عنده حقل "مناسب لـ" يحدد الجنس (بنت / ولد / الكل) وحقل "العمر" يحدد الفئة العمرية. استخدميهم لتصفية المنتجات قبل الترشيح.
- إذا قال العميل "بنت" أو "بناتي" أو "هدية بنت": اعرضي فقط المنتجات التي gender = بنت أو الكل.
- إذا قال "ولد" أو "ابني": اعرضي فقط gender = ولد أو الكل.
- إذا ذكر عمراً مثل "عمره 3 سنوات": اختاري المنتجات التي تناسب هذا العمر من حقل العمر.
- لا تعرضي منتجاً جنسه "بنت" لعميل يبحث عن هدية ولد والعكس صحيح.

إذا احتجتِ ترشيح منتجات:

أرجعي JSON فقط:

{
 "reply":"ردك",
 "recommend":true,
 "product_query":"وصف العميل",
 "category_link":{"label":"اسم الزر","url":"رابط القسم"}
}

إذا تحتاجين سؤال العميل:

{
 "reply":"سؤالك",
 "recommend":false
}

معلومات المتجر:

${storeKnowledge}

المنتجات:

${catalog}

`,
        },

        ...session.history.slice(-20),
      ],
    });

    const content = ai.choices[0].message.content || "";

    session.history.push({
      role: "assistant",

      content: content,
    });

    const parsed = safeJson(content);

    if (!parsed) {
      return res.json({
        reply:
          content.replace(/\{.*\}/g, "").trim() || "ممكن توضّح لي أكثر؟ 🌸",
        recommend: false,
      });
    }

    // =========================
    // 🛍 RECOMMEND
    // =========================
    if (parsed.recommend) {
      const selected = matchedProducts;

      selected.forEach(function (p) {
        if (!stats.productRequests[p.title]) stats.productRequests[p.title] = 0;
        stats.productRequests[p.title]++;
      });
      saveStats();

      return res.json({
        reply: parsed.reply,

        recommend: true,

        products: selected,
        category_link: parsed.category_link || null,
      });
    }

    return res.json({
      reply: parsed.reply,

      recommend: false,
    });
  } catch (err) {
    console.log("❌ CHAT ERROR:", err);

    try {
      const catalog = matchedProducts
        .map((p) => `${p.title} | ${p.price} ريال | ${p.description}`)
        .join("\n");

      const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash-8b" });
      const result = await model.generateContent(
        `أنتِ ياسمين موظفة في متجر قرية الهدايا.
رد على رسالة العميل باختصار وبشكل طبيعي، واقترحي منتجات مناسبة من القائمة.

رسالة العميل: ${message}

المنتجات المتاحة:
${catalog}

أرجعي JSON فقط:
{
  "reply": "ردك",
  "recommend": true
}`,
      );

      const geminiParsed = safeJson(result.response.text());
      if (geminiParsed) {
        return res.json({
          reply: geminiParsed.reply,
          recommend: true,
          products: matchedProducts,
        });
      }
    } catch (geminiErr) {
      console.log("❌ GEMINI ERROR:", geminiErr);
    }

    return res.json({
      reply:
        "عذراً، ياسمين غير متاحة مؤقتاً 🌸 يمكنك التواصل مع خدمة العملاء بكتابة (حولني)",
      recommend: false,
    });
  }
});

// =========================
// 📡 TELEGRAM (ADDED ONLY - NO CHANGES ELSEWHERE)
// =========================

async function sendTelegramMessage(text) {
  try {
    await Promise.all(
      [...telegramUsers].map((id) => bot.sendMessage(id, text)),
    );
  } catch (err) {
    console.log("❌ TELEGRAM ERROR:", err.message);
  }
}

// =========================
// ⭐ REVIEW (STORE & CHAT SEPARATED WITH HISTORY)
// =========================
app.post("/review", async function (req, res) {
  try {
    const sessionId = req.body.sessionId || "guest";

    if (!/^[a-zA-Z0-9_-]{5,50}$/.test(sessionId)) {
      return res.status(400).json({ success: false });
    }

    const rating = req.body.rating || 0;
    const note = req.body.note || "";

    const dateStr = new Date().toLocaleString("ar-SA", {
      timeZone: "Asia/Riyadh",
      hour12: true,
    });

    // ✨ نقل وتجهيز سجل المحادثة هنا في الأعلى ليكون متاحاً للحالتين
    const history = sessions[sessionId]?.history || [];
    let chatText = history
      .map((h) => {
        if (h.role === "user") return `👤 العميل: ${h.content}`;
        if (h.role === "assistant") {
          const parsed = safeJson(h.content);
          if (parsed && parsed.reply) return `🌸 ياسمين: ${parsed.reply}`;
          if (h.content.startsWith("(الموظف):")) {
            const employeeName = sessions[sessionId]?.handledBy || "الموظف";
            const msgText = h.content.replace("(الموظف):", "").trim();
            return `👨‍💼 ${employeeName}: ${msgText}`;
          }
          return `🌸 ياسمين: ${h.content}`;
        }
        return "";
      })
      .join("\n");

    // تحديد حجم المحادثة لكي لا تتجاوز حدود تليجرام
    if (chatText.length > 2500) {
      chatText =
        chatText.substring(chatText.length - 2500) +
        "\n\n...(المحادثة طويلة جداً، تم عرض آخر الأسطر)...";
    }

    // إذا كان السجل فارغاً تماماً
    if (!chatText.trim()) {
      chatText = "لا يوجد سجل محادثة متاح لهذه الجلسة.";
    }

    // -------------------------------------------------------------
    // الحالة الأولى: تقييم محادثة خدمة العملاء المباشرة 👨‍💼
    // -------------------------------------------------------------
    if (note === "تقييم محادثة مباشرة") {
      let chatReviews = [];
      try {
        chatReviews = JSON.parse(
          fs.readFileSync("./chat_reviews.json", "utf8"),
        );
      } catch {}

      const employeeName =
        sessions[sessionId]?.handledBy || "موظف خدمة العملاء";

      const chatReviewObj = {
        sessionId: sessionId,
        employeeName: employeeName,
        rating: rating,
        note: note,
        date: dateStr,
      };

      chatReviews.push(chatReviewObj);
      fs.writeFileSync(
        "./chat_reviews.json",
        JSON.stringify(chatReviews, null, 2),
      );

      // إرسال تقرير تقييم الموظف لتليجرام مع السجل الآن بنجاح ✅
      const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID);
      bot.sendMessage(
        ADMIN_ID,
        `⭐️ تقييم خدمة عملاء جديد\n\n` +
          `👤 الموظف المسؤول: ${employeeName}\n` +
          `📊 التقييم: ${rating} من 5\n` +
          `📅 التاريخ: ${dateStr}\n\n` +
          `💬 سجل المحادثة:\n${chatText}`,
      );

      if (sessions[sessionId]) {
        sessions[sessionId].history = [];
      }

      return res.json({
        success: true,
        alreadyReviewed: false,
        supportMode: false,
      });
    }

    // -------------------------------------------------------------
    // الحالة الثانية: تقييم المتجر والتغليف عند إكمال الطلب 🎁
    // -------------------------------------------------------------
    let reviews = [];
    try {
      reviews = JSON.parse(fs.readFileSync("./reviews.json", "utf8"));
    } catch {}

    const hasAlreadyReviewedStore = reviews.some(
      (r) => r.sessionId === sessionId,
    );
    if (hasAlreadyReviewedStore) {
      return res.json({
        success: true,
        alreadyReviewed: true,
        message: "تم استقبال تقييمك لهذا الطلب مسبقاً!",
      });
    }

    const review = {
      rating: rating,
      wrap: req.body.wrap || "no",
      wrapColor: req.body.wrapColor || null,
      note: note,
      date: dateStr,
    };

    const employeeName =
      sessions[sessionId]?.handledBy || "ياسمين (الذكاء الاصطناعي)";

    reviews.push({ ...review, employee: employeeName, sessionId: sessionId });
    fs.writeFileSync("./reviews.json", JSON.stringify(reviews, null, 2));

    function formatWrapColor(color) {
      if (color === "blue" || color === "أزرق 🔵") return "أزرق 🔵";
      if (color === "pink" || color === "وردي 🩷") return " وردي 🩷";
      return "لا يوجد";
    }

    await sendTelegramMessage(
      `⭐ تقييم متجر جديد\n` +
        `⭐ التقييم: ${review.rating}/5\n` +
        `👤 المسؤول: ${employeeName}\n` +
        `🎁 التغليف: ${review.wrap === "yes" ? "نعم ✅" : "لا ❌"}\n` +
        `🎨 لون التغليف: ${formatWrapColor(review.wrapColor)}\n` +
        `📝 ملاحظات العميل: ${review.note || "لا يوجد"}\n` +
        `📅 التاريخ: ${review.date}\n\n` +
        `💬 سجل المحادثة:\n${chatText}`,
    );

    return res.json({
      success: true,
      alreadyReviewed: false,
    });
  } catch (err) {
    console.log("❌ REVIEW ERROR:", err);
    return res.json({ success: false });
  }
});

// =========================
// 🚀 START
// =========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, function () {
  console.log("🌸 SERVER RUNNING:", PORT);
});
