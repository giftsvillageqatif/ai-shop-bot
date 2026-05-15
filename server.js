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

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(express.json({ limit: "10mb" }));
app.use(cors());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: true,
});

const AUTH_PASSWORD = process.env.BOT_PASSWORD;

// 1. ضع هنا الـ Chat ID الخاص بك وبأي موظف آخر (أرقام بدون فواصل علوية)
let allowedUsers = new Set([
  769253012, // 👈 استبدل هذا الرقم بـ Chat ID الخاص بك
  //////////  // 👈 استبدل هذا الرقم بـ Chat ID الخاص بالموظف الثاني (إذا وجد)
]);

// 2. تفعيل الموظفين في التليجرام تلقائياً
let telegramUsers = new Set(Array.from(allowedUsers));

// 3. ربط كل رقم بالاسم الثنائي الصريح للموظف
let userNames = {
  769253012: "احمد محمد", // 👈 اكتب رقمك هنا وبجانبه اسمك
  "": "", // 👈 اكتب رقم الموظف الثاني واسمه
};

// =========================
// 💬 SESSIONS
// =========================
let sessions = {};
let supportMode = {};
let clientSockets = {};
let employeeSessions = {};
let pendingSupport = {};

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

  if (text === AUTH_PASSWORD) {
    allowedUsers.add(chatId);

    saveAllowedUsers();

    return;
  }
});

// =========================
// MENU
// =========================

function sendMenu(chatId) {
  const name = userNames[chatId] || "الموظف";

  bot.sendMessage(
    chatId,
    `✅ تم اعتماد الاسم: ${name}\nأهلاً بك في نظام قرية الهدايا 🌸`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚪 خروج",
              callback_data: "logout",
            },
          ],
        ],
      },
    },
  );
}

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
      };
    });

    console.log("✅ PRODUCTS:", products.length);

    const documents = products.map((p) => {
      const pageContent = `الاسم: ${p.title}\nالوصف: ${p.description}\nالسعر: ${p.price}`;
      return new Document({
        pageContent: pageContent,
        metadata: { id: p.id }, // نحتفظ بالـ ID لنجلب المنتج بالكامل لاحقاً
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
app.get("/", function (req, res) {
  res.send("🌸 Yasmin AI Running");
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
  try {
    const sessionId = req.body.sessionId || "guest";

    const message = req.body.message || "";

    if (supportMode[sessionId]) {
      const employeeId = Object.keys(employeeSessions).find(
        (id) => employeeSessions[id] === sessionId,
      );

      if (!sessions[sessionId]) sessions[sessionId] = { history: [] };
      sessions[sessionId].history.push({ role: "user", content: message });

      if (employeeId) {
        bot.sendMessage(employeeId, `💬 ${sessionId}\n\n${message}`);

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

    let matchedProducts = [];

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

    const catalog = products
      .map(function (p) {
        return `

ID:${p.id}

الاسم:
${p.title}

الوصف:
${p.description}

السعر:
${p.price}

`;
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
- الإجابة عن أسئلة المتجر فقط
- إذا سأل العميل عن "خدمة العملاء" أو "موظف": أخبريه أنكِ تستطيعين المساعدة، ولكن إذا أصر، قولي له "هل تريد تحويلك لخدمة العملاء؟".
- إذا واجه العميل مشكلة فنية أو شكوى لا تستطيعين حلها: قولي "عذراً لا أستطيع حل هذه المشكلة، هل ترغب في التواصل مع خدمة العملاء؟ اكتب (حولني) للتحويل".
- لا تقومي بالتحويل تلقائياً، انتظري كلمة "حولني" من العميل.
- إذا وافق العميل، اطلبي منه كتابة "حولني" بوضوح.

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

`,
        },

        ...session.history,
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
      const recAI = await openai.chat.completions.create({
        model: "gpt-4.1-mini",

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

`,
          },

          {
            role: "user",

            content: parsed.product_query,
          },
        ],
      });

      const recParsed = safeJson(recAI.choices[0].message.content || "");

      let selected = [];

      if (recParsed && recParsed.products) {
        selected = products.filter((p) => recParsed.products.includes(p.id));
      }

      if (selected.length === 0) {
        selected = products.slice(0, 3);
      }

      return res.json({
        reply: parsed.reply,

        recommend: true,

        products: selected,
      });
    }

    return res.json({
      reply: parsed.reply,

      recommend: false,
    });
  } catch (err) {
    console.log("❌ CHAT ERROR:", err);

    return res.json({
      reply: "ياسمين لديها خلل تقني مؤقت 🌸",

      recommend: false,
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
// ⭐ REVIEW (STORE & CHAT SEPARATED WITH HISTORY)
// =========================
app.post("/review", async function (req, res) {
  try {
    const sessionId = req.body.sessionId || "guest";
    const rating = req.body.rating || 0;
    const note = req.body.note || "";

    const dateStr = new Date().toLocaleString("ar-SA", {
      timeZone: "Asia/Riyadh",
      hour12: true,
    });

    // ✨ نقل وتجهيز سجل المحادثة هنا في الأعلى ليكون متاحاً للحالتين
    const history = sessions[sessionId]?.history || [];
    let chatText = history.map((h) => `${h.role}: ${h.content}`).join("\n");

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
      await sendTelegramMessage(
        `⭐️ *تقييم خدمة عملاء جديد* ⭐️\n\n` +
          `👤 *الموظف المسؤول:* ${employeeName}\n` +
          `📊 *التقييم الفعلي:* ${rating} من 5\n` +
          `📅 *التاريخ:* ${dateStr}\n` +
          `💬 *سجل المحادثة:*\n${chatText}`,
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
