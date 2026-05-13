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

// let
let allowedUsers = new Set();
let telegramUsers = new Set();
let userState = {};
let employees = {};
let pendingEmployees = {};
let sessions = {};
let liveSupportSessions = {};
let liveMessages = {};
let bridge = {

  telegramToWeb: {},   // telegramId → sessionId

  webToTelegram: {}    // sessionId → telegramId

};


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
    
   {
    bot.answerCallbackQuery(q.id, { text: "مستلم من موظف آخر" });
    return;
  }

    const sessionId = userId;
bridge.telegramToWeb[empId] = sessionId;
bridge.webToTelegram[sessionId] = empId;


  sessions[userId] = {
    mode: "human",
    employeeId: empId,
    history: sessions[userId]?.history || []
  };

    // 👇 مهم: إرسال زر الإنهاء للموظف
  bot.sendMessage(empId,
    `👨‍💼 أنت الآن تتحدث مع العميل ${userId}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ إنهاء المحادثة", callback_data: `close_${userId}` }]
        ]
      }
    }
  );

  bot.sendMessage(userId,
    `👨‍💼 تم تحويلك لموظف خدمة العملاء`
  );

  bot.answerCallbackQuery(q.id);
}
  // =========================
  // CLOSE CHAT
  // =========================
if (data.startsWith("close_")) {

  const sessionId = data.split("_")[1];
  const empId = q.from.id;

  delete bridge.telegramToWeb[empId];
  delete bridge.webToTelegram[sessionId];

  if (sessions[sessionId]) {
    sessions[sessionId].mode = "ai";
    sessions[sessionId].employeeId = null;
  }

  liveMessages[sessionId] =
    "👋 تم إنهاء المحادثة مع خدمة العملاء";

  bot.sendMessage(empId, "✅ تم إنهاء المحادثة");

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

// 🔐 تسجيل الموظف
  if (!employees[userId] && text === AUTH_PASSWORD) {
    pendingEmployees[userId] = true;
    bot.sendMessage(userId, "اكتب اسمك الآن 👨‍💼");
    return;
  }


  // 🧑‍💼 حفظ اسم الموظف
  if (pendingEmployees[userId]) {
    employees[userId] = { name: text };
    telegramUsers.add(userId);
    delete pendingEmployees[userId];
    bot.sendMessage(userId, `تم تسجيلك 👨‍💼: ${text}`);
    return;
  }

  // 👨‍💼 موظف يرد على عميل (إذا كان مرتبط)
if (employees[userId]) {

  const sessionId =
    bridge.telegramToWeb[userId];

  if (!sessionId) {
    bot.sendMessage(
      userId,
      "❌ ما فيه عميل مربوط حالياً"
    );
    return;
  }

  liveMessages[sessionId] =
    `👨‍💼 ${employees[userId].name}:\n${text}`;

  bot.sendMessage(
    userId,
    "✔️ تم إرسال الرسالة"
  );

  return;
}
  
  // 🔥 إرسال للعميل في الشات API (مو Telegram)
// نخزن الرسالة عشان /chat يلتقطها
if (!liveMessages) liveMessages = {};

// 👤 لو عميل يرسل → للموظف
  

if (empId) {
  bot.sendMessage(empId, `💬 عميل ${chatId}\n${text}`);

  liveMessages[sessionId] = text;
  
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

const telegramId =
  bridge.webToTelegram[sessionId];

if (
  sessions[sessionId].mode === "human"
  && telegramId
) {

  bot.sendMessage(
    telegramId,
    `💬 العميل:\n${message}`
  );

  return res.json({
    reply: "👨‍💼 تم إرسال رسالتك للموظف",
    support: true
  });
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
    reply: "👨‍💼 معك موظف خدمة العملاء الآن",
    support: true
  });
}
    
// =========================
// 🚨 REQUEST SUPPORT
// =========================
if (/خدمة العملاء|موظف|دعم|انسان/.test(message)) {

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      mode: "bot",
      employeeId: null,
      history: []
    };
  }

  sessions[sessionId].mode = "human";

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

    if (liveMessages[sessionId]) {

  const msg = liveMessages[sessionId];
  delete liveMessages[sessionId];

  return res.json({
    reply: msg,
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

function formatWrapColor(color) {
      
      if (color === "blue") return "🔵 أزرق";
      if (color === "pink") return "🩷 وردي";

return "لا يوجد";

}

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
