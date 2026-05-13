import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";
import TelegramBot from "node-telegram-bot-api";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cors());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: true
});

bot.on("polling_error", (error) => {
  console.log("❌ POLLING ERROR:", error);
});

process.on("uncaughtException", (err) => {
  console.log("💥 UNCUGHT ERROR:", err);
});

process.on("unhandledRejection", (err) => {
  console.log("💥 PROMISE ERROR:", err);
});


const AUTH_PASSWORD = process.env.BOT_PASSWORD;

// المستخدمين
let allowedUsers = new Set();
let telegramUsers = new Set();
let userState = {};
let activeChats = {};
let employees = {};
let pendingEmployees = {};


// تحميل المستخدمين
try {
  const data = fs.readFileSync("./allowed_users.json", "utf8");
  allowedUsers = new Set(JSON.parse(data));
} catch {
  allowedUsers = new Set();
}

try {
  const data = fs.readFileSync("./telegram_users.json", "utf8");
  telegramUsers = new Set(JSON.parse(data));
} catch {
  telegramUsers = new Set();
}

// حفظ المستخدمين
function saveAllowedUsers() {
  fs.writeFileSync(
    "./allowed_users.json",
    JSON.stringify([...allowedUsers], null, 2)
  );
}

function saveUsers() {
  fs.writeFileSync(
    "./telegram_users.json",
    JSON.stringify([...telegramUsers], null, 2)
  );
}


// =========================
// MENU
// =========================

function sendMenu(chatId) {

  bot.sendMessage(chatId, "أهلاً بك 👋 داخل النظام", {

    reply_markup: {

      inline_keyboard: [

        [{ text: "🚪 خروج", callback_data: "logout" }]

      ]

    }

  });

}

// =========================
// LOGOUT
// =========================

bot.on("callback_query", (q) => {

  const data = q.data;

  // =========================
  // JOIN CHAT
  // =========================
  if (data.startsWith("join_")) {

  const userId = data.split("_")[1];
  const empId = q.from.id;
  const empName = employees[empId]?.name || "موظف";

  if (activeChats[userId]) {
    bot.answerCallbackQuery(q.id, { text: "مستلم من موظف آخر" });
    return;
  }

  activeChats[userId] = empId;
  userState[userId] = "human_mode";

  sessions[userId] = {
    mode: "human",
    employeeId: empId
  };

  liveSupportSessions[userId] = {
    employeeId: empId,
    employeeName: empName
  };

  liveMessages[userId] =
`👨‍💼 معك موظف خدمة العملاء (${empName})
كيف أقدر أخدمك؟`;

  bot.sendMessage(empId,
`تم ربطك بالعميل ${userId}`, {
  reply_markup: {
    inline_keyboard: [[
      { text: "❌ إنهاء المحادثة", callback_data: `close_${userId}` }
    ]]
  }
});

  bot.answerCallbackQuery(q.id);
}

  // =========================
  // CLOSE CHAT
  // =========================
  if (data.startsWith("close_")) {

  const userId = data.split("_")[1];
  const empId = q.from.id;

  delete activeChats[userId];
  userState[userId] = "bot";

  if (sessions[userId]) {
    sessions[userId].mode = "ai";
    sessions[userId].employeeId = null;
  }

  delete liveSupportSessions[userId];

  liveMessages[userId] = "تم إنهاء المحادثة 👋";

  bot.sendMessage(empId, "تم الإنهاء");

  bot.answerCallbackQuery(q.id);
}

  // =========================
  // LOGOUT FIX 
  // =========================
  if (data === "logout") {

    const chatId = q.message.chat.id;

    allowedUsers.delete(chatId);
    telegramUsers.delete(chatId);

    saveAllowedUsers();
    saveUsers();

    bot.sendMessage(chatId, "تم تسجيل الخروج");
    bot.answerCallbackQuery(q.id);
  }

});

 function notifyAllEmployees(chatId, message) {

  if (activeChats[chatId]) return;

  telegramUsers.forEach(empId => {

    bot.sendMessage(empId,
`🚨 عميل يحتاج خدمة العملاء
ID: ${chatId}
💬 ${message}`,

{
  reply_markup: {
    inline_keyboard: [[
      { text: "📩 استلام", callback_data: `join_${chatId}` }
    ]]
  }
});
  });
}

// =========================
// MESSAGE HANDLER
// =========================

bot.on("message", (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text || "";
  const userId = msg.from.id;
  
  // =========================
  // 🔐 تسجيل الموظف (كلمة سر)
  // =========================
  if (!employees[userId] && text === AUTH_PASSWORD) {

    pendingEmployees[userId] = true;
    bot.sendMessage(userId, "اكتب اسمك الآن 👨‍💼");
    return;
  }

  // =========================
  // 🧑‍💼 حفظ اسم الموظف
  // =========================
  if (pendingEmployees[userId]) {

    employees[userId] = {
      name: text
    };

    telegramUsers.add(userId); // 👈 مهم جدًا

    delete pendingEmployees[userId];

    bot.sendMessage(userId, `تم تسجيلك 👨‍💼: ${text}`);
    return;
  }
  

  // =========================
  // 💬 لو العميل داخل مع موظف
  // =========================
  if (userState[chatId] === "human_mode") {

  const empId = activeChats[chatId];

  if (!empId) return;

 // =========================
// 👨‍💼 EMPLOYEE REPLY
// =========================

if (employees[userId]) {

  const clientId = Object.keys(activeChats)
    .find(id => activeChats[id] == userId);

  if (clientId) {

    if (sessions[clientId]) {

      sessions[clientId].history.push({
        role: "assistant",
        content: text
      });

    }

    return;
  }

}
  // لو عميل → يرسل للموظف
  bot.sendMessage(empId, `💬 عميل ${chatId}\n${text}`);

  return;
}

  // =========================
  // 📩 رد الموظف على عميل (/reply)
  // =========================
  if (text.startsWith("/reply")) {

    const parts = text.split(" ");
    const targetUserId = parts[1];
    const msgText = parts.slice(2).join(" ");

    if (employees[userId] && sessions[clientId]?.mode === "human") {

  const clientId = Object.keys(sessions)
    .find(id => sessions[id].employeeId === userId);

  bot.sendMessage(clientId, text);

  return;
}
    
    if (targetUserId && msgText) {
      bot.sendMessage(targetUserId, msgText);
    }

    return;
  }

  // =========================
  // 🔒 fallback (لو مو مسجل)
  // =========================
  if (!allowedUsers.has(chatId)) {
    bot.sendMessage(chatId, "🔐 اكتب كلمة الدخول للمتابعة");
    return;
  }

});

// =========================
// 🔑 OPENAI
// =========================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// =========================
// 📦 PRODUCTS
// =========================
let products = [];


// =========================
// 💬 SESSIONS
// =========================
let sessions = {};
let liveSupportSessions = {};
let liveMessages = {};

// =========================
// 🏪 STORE INFO
// =========================
let storeKnowledge = "";

try {

  storeKnowledge =
    fs.readFileSync(
      "./store_knowledge.txt",
      "utf8"
    );

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
function loadProducts() {

  try {

    const file =
      xlsx.readFile(
        "./products.xlsx"
      );

    const sheet =
      file.Sheets[
        file.SheetNames[0]
      ];

    const data =
      xlsx.utils.sheet_to_json(
        sheet
      );

    products =
      data.map(function (p, i) {

        let image =
          String(
            p.image || ""
          ).split(",")[0].trim();

        return {

          id: i,

          title:
            p.name || "",

          description:
            p.description || "",

          price:
            p.price || "",

          image:
            image,

          url:
            p.url || ""

        };

      });

    console.log(
      "✅ PRODUCTS:",
      products.length
    );

  } catch (err) {

    console.log(
      "❌ EXCEL ERROR:",
      err
    );

  }

}

loadProducts();


// =========================
// 🧠 SAFE JSON
// =========================
function safeJson(text) {

  try {

    return JSON.parse(
      text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim()
    );

  } catch {

    return null;

  }

}


// =========================
// ❤️ ROOT
// =========================
app.get("/", function (req, res) {

  res.send(
    "🌸 Yasmin AI Running"
  );

});


// =========================
// 💬 CHAT
// =========================
app.post("/chat", async function (req, res) {
  
  try {

    const sessionId =
  req.body.sessionId ||
  "guest";

const message =
  req.body.message || "";

    if (!sessions[sessionId]) {
  sessions[sessionId] = {
    mode: "ai",
    employeeId: null,
    history: []
  };
}

// =========================
// 💬 HUMAN MODE
// =========================
if (sessions[sessionId]?.mode === "human") {

  const emp = sessions[sessionId].employeeId;

  if (emp) {
    bot.sendMessage(emp, `💬 العميل: ${message}`);
  }

  return res.json({
    reply: "👨‍💼 يتم الرد عليك من موظف خدمة العملاء حالياً",
    support: true
  });
}

// =========================
// 🚨 LIVE MESSAGE FROM EMPLOYEE
// =========================
if (liveMessages[sessionId]) {

  const msg = liveMessages[sessionId];

  delete liveMessages[sessionId];

  return res.json({
    reply: msg,
    support: true
  });
}

// =========================
// 🚨 REQUEST SUPPORT
// =========================
if (/خدمة العملاء|موظف|موظفة|دعم|دعم فني|اتكلم مع موظف|ابي موظف|ابغى موظف|بشر|انسان/.test(message)) {

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      mode: "ai",
      employeeId: null,
      history: []
    };
  }

  sessions[sessionId].mode = "waiting";

  notifyAllEmployees(sessionId, message);

  return res.json({
    reply: "تم تحويلك لخدمة العملاء ⏳",
    support: true
  });
}
  // =========================
// 💬 LIVE SUPPORT MODE
// =========================

if (liveSupportSessions[sessionId]) {

  const employee =
    liveSupportSessions[sessionId];

  bot.sendMessage(
    employee.employeeId,

`💬 العميل:
${message}`
  );

  return res.json({
    reply: "✔️ تم إرسال رسالتك لخدمة العملاء",
    support: true
  });
  
}
    
    if (!sessions[sessionId]) {

      sessions[sessionId] = {

        history: []

      };

    }

    const session =
      sessions[sessionId];

    session.history.push({

      role: "user",

      content: message

    });

    const catalog =
      products.map(function (p) {

        return `

ID:${p.id}

الاسم:
${p.title}

الوصف:
${p.description}

السعر:
${p.price}

`;

      }).join("\n");

    if (sessions[sessionId]?.mode === "human") {

  return res.json({
    reply: "👨‍💼 يتم الرد عليك من موظف خدمة العملاء حالياً",
    support: true
  });
}

    const ai =
      await openai.chat.completions.create({

        model:
          "gpt-4.1-mini",

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
- الإجابة عن أسئلة المتجر فقط

إذا احتجتِ ترشيح منتجات:

أرجعي JSON فقط:

{
 "reply":"ردك",
 "recommend":true,
 "product_query":"وصف العميل"
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

`

          },

          ...session.history

        ]

      });

    const content =
      ai.choices[0]
      .message.content || "";

    session.history.push({

      role: "assistant",

      content: content

    });

    const parsed =
      safeJson(content);

    if (!parsed) {

      return res.json({

        reply:
          "🌸 ممكن توضّح لي أكثر؟",

        recommend: false

      });

    }

    // =========================
    // 🛍 RECOMMEND
    // =========================
    if (parsed.recommend) {

      const recAI =
        await openai.chat.completions.create({

          model:
            "gpt-4.1-mini",

          temperature: 0.2,

          messages: [

            {

              role: "system",

              content: `

اختر أفضل 3 منتجات مناسبة فقط.

أرجع JSON فقط:

{
 "products":[1,2,3]
}

القائمة:

${catalog}

`

            },

            {

              role: "user",

              content:
                parsed.product_query

            }

          ]

        });

      const recParsed =
        safeJson(
          recAI.choices[0]
          .message.content || ""
        );

      let selected = [];

      if (
        recParsed &&
        recParsed.products
      ) {

        selected =
          products.filter(
            p =>
              recParsed.products.includes(
                p.id
              )
          );

      }

      if (
        selected.length === 0
      ) {

        selected =
          products.slice(0, 3);

      }

      return res.json({

        reply:
          parsed.reply,

        recommend: true,

        products:
          selected

      });

    }

    return res.json({

      reply:
        parsed.reply,

      recommend: false

    });

  } catch (err) {

    console.log(
      "❌ CHAT ERROR:",
      err
    );

    return res.json({

      reply:
        "🌸 ياسمين لديها خلل تقني مؤقت",

      recommend: false

    });

  }

});


// =========================
// 📡 TELEGRAM (ADDED ONLY - NO CHANGES ELSEWHERE)
// =========================

async function sendTelegramMessage(text) {
  try {

    telegramUsers.forEach((id) => {
      bot.sendMessage(id, text);
    });

  } catch (err) {
    console.log("❌ TELEGRAM ERROR:", err.message);
  }
}

// =========================
// ⭐ REVIEW (ONLY ADD TELEGRAM CALL)
// =========================
app.post("/review", async function (req, res) {

  try {

    const review = {
  rating: req.body.rating || 0,

  wrap: req.body.wrap || "no",
  wrapColor: req.body.wrapColor || null,
  note: req.body.note || "",

  date: new Date().toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour12: true
  })
};
  

    let reviews = [];

    try {

      reviews =
        JSON.parse(
          fs.readFileSync(
            "./reviews.json",
            "utf8"
          )
        );

    } catch {}

    reviews.push(review);

    fs.writeFileSync(

      "./reviews.json",

      JSON.stringify(
        reviews,
        null,
        2
      )

    );

    // =========================
    // NEW: GET CHAT HISTORY
    // =========================
    
    const history = sessions[sessionId]?.history || [];

    const chatText = history.map(h => `${h.role}: ${h.content}`).join("\n");

    // =========================
    // NEW: TELEGRAM SEND
    // =========================
    
    function formatWrapColor(color) {
      
      if (color === "blue") return "🔵 أزرق";
      if (color === "pink") return "🩷 وردي";

return "لا يوجد";

}
    
    await sendTelegramMessage(
      `⭐ تقييم جديد
🎁 التغليف: ${review.wrap === "yes" ? "نعم" : "لا"}
🎨 لون التغليف: ${review.wrapColor || "لا يوجد"}
📝 ملاحظات: ${review.note || "لا يوجد"}
⭐ التقييم: ${review.rating}/5
📅 التاريخ: ${review.date}

💬 المحادثة:
${chatText}`
    );

    res.json({
      success: true
    });

  } catch (err) {

    console.log(
      "❌ REVIEW ERROR:",
      err
    );

    res.json({
      success: false
    });

  }

});


// =========================
// 🚀 START
// =========================
const PORT =
  process.env.PORT || 3000;

app.listen(PORT, function () {

  console.log(
    "🌸 SERVER RUNNING:",
    PORT
  );

});
