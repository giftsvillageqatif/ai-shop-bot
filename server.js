import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";
import TelegramBot from "node-telegram-bot-api";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.json({ limit: "10mb" }));
app.use(cors());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: true
});


const AUTH_PASSWORD = process.env.BOT_PASSWORD;

// المستخدمين
let allowedUsers = new Set();
let telegramUsers = new Set();


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

bot.on("callback_query", (query) => {

  const chatId = query.message.chat.id;
  const data = query.data;

  console.log("BUTTON:", data);

  if (data.startsWith("take_")) {

  const sessionId =
    data.replace("take_", "");

  if (!pendingSupport[sessionId]) {

    bot.answerCallbackQuery(
      query.id,
      {
        text:
          "❌ العميل تم استلامه بالفعل"
      }
    );

    return;
  }

  delete pendingSupport[sessionId];

  employeeSessions[chatId] =
    sessionId;

    supportMode[sessionId] = true;
pendingSupport[sessionId] = true;
    
  bot.sendMessage(
    chatId,

`✅ تم استلام العميل

🆔 ${sessionId}

✍️ أي رسالة ترسلها ستصل للعميل مباشرة

⛔ لإنهاء المحادثة:
/end`
  );

  bot.answerCallbackQuery(
    query.id

    
  );

  return;
}

  if (data === "logout") {

    // أول شيء أرسل الرسالة
    bot.sendMessage(chatId, "تم تسجيل خروجك 👋");
  }
    
    allowedUsers.delete(chatId);
    telegramUsers.delete(chatId);

    saveUsers();
    saveAllowedUsers();

  bot.answerCallbackQuery(query.id);
});

// =========================
// MESSAGE HANDLER
// =========================

bot.on("message", (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (
  text === "/end" &&
  employeeSessions[chatId]
) {

  const sessionId =
    employeeSessions[chatId];

  supportMode[sessionId] = false;

  delete employeeSessions[chatId];

  io.to(sessionId).emit(
    "human_end",
    {
      message:
        "🌸 انتهت المحادثة مع خدمة العملاء"
    }
  );

  bot.sendMessage(
    chatId,
    "✅ تم إنهاء المحادثة"
  );

  return;
}

  if (
  allowedUsers.has(chatId) &&
  employeeSessions[chatId]
) {

  const sessionId =
    employeeSessions[chatId];

  io.to(sessionId).emit(
    "human_message",
    {
      message: text
    }
  );

  return;
}

  // إذا المستخدم مسجل مسبقًا
  if (allowedUsers.has(chatId)) {
    console.log("User allowed:", chatId);
    return;
  }

  // إذا كتب كلمة السر الصحيحة
  if (text === AUTH_PASSWORD) {

    allowedUsers.add(chatId);
    telegramUsers.add(chatId);
    saveAllowedUsers();
    saveUsers();

    bot.sendMessage(chatId, "تم تسجيل الدخول بنجاح ✅");
    sendMenu(chatId);

    return;
  }

  // أي رسالة ثانية
  bot.sendMessage(chatId, "🔐 اكتب كلمة الدخول للمتابعة");
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
let supportMode = {};
let clientSockets = {};
let employeeSessions = {};
let pendingSupport = {};


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
const isHumanActive = supportMode[sessionId] = true;

io.on("connection", (socket) => {

  socket.on("register", (sessionId) => {

    socket.join(sessionId);

    clientSockets[sessionId] = socket.id;

    console.log("✅ CLIENT CONNECTED:", sessionId);

  });

});

app.post("/chat", async function (req, res) {

  try {

    const sessionId =
      req.body.sessionId ||
      "guest";


    const message =
      req.body.message || "";

    if (supportMode[sessionId]) {

  const employeeId = Object.keys(employeeSessions)
    .find(id => employeeSessions[id] === sessionId);

  if (employeeId) {
    bot.sendMessage(
      employeeId,
      `💬 ${sessionId}\n\n${message}`
    );
  }

  if (!supportMode[sessionId]) {
  return res.json({
    reply: "👨‍💼 تم تحويلك لخدمة العملاء، انتظر قليلاً",
    recommend: false
  });
}

return res.json({
  reply: "",
  recommend: false
});
}

    if (!sessions[sessionId]) {

      sessions[sessionId] = {

        history: []

      };

    }

    const lower =
  message.toLowerCase();

    if (
  lower.includes("خدمة العملاء") ||
  lower.includes("موظف") ||
  lower.includes("بشري")
) {

  supportMode[sessionId] = true;

      io.to(sessionId).emit("human_mode", {
  status: true
});

 pendingSupport[sessionId] = true;

telegramUsers.forEach((id) => {

  bot.sendMessage(
    id,

`📞 عميل جديد يحتاج خدمة العملاء

🆔 ${sessionId}

💬 الرسالة:
${message}`,

{
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: "✅ استلام العميل",
          callback_data: `take_${sessionId}`
        }
      ]
    ]
  }
}

  );

});

  return res.json({

    reply:
      "👨‍💼 تم تحويلك لخدمة العملاء، انتظر قليلًا.",

    recommend: false

  });

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
      rating:
        req.body.rating || 0,

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
    const sessionId = req.body.sessionId || "guest";
    const history = sessions[sessionId]?.history || [];

    const chatText = history.map(h => `${h.role}: ${h.content}`).join("\n");

    // =========================
    // NEW: TELEGRAM SEND
    // =========================
    
    
    await sendTelegramMessage(
      `⭐ تقييم جديد
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

server.listen(PORT, function () {

  console.log(
    "🌸 SERVER RUNNING:",
    PORT
  );

});
