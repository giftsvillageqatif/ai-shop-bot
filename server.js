import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());

// =========================
// OPENAI
// =========================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =========================
// TELEGRAM
// =========================
async function sendTelegramMessage(text) {
  try {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text
        })
      }
    );
  } catch (err) {
    console.log("❌ TELEGRAM ERROR:", err);
  }
}

// =========================
// DATA
// =========================
let products = [];
let sessions = {};

// =========================
// CATEGORY SYSTEM (BASIC TAGGING ONLY)
// =========================
function autoCategory(title = "", desc = "") {
  const text = (title + " " + (desc || "")).toLowerCase();

  if (/(بنات|باربي|مكياج|عطر|شنطة)/.test(text)) return "بنات";
  if (/(سيارة|روبوت|مسدس|اولاد|أولاد)/.test(text)) return "اولاد";
  if (/(مواليد|baby|newborn|رضيع)/.test(text)) return "مواليد";
  if (/(جماعي|board|لعبة|تحدي)/.test(text)) return "جماعي";

  return "عام";
}

// =========================
// LOAD PRODUCTS
// =========================
function loadProducts() {
  try {
    const file = xlsx.readFile("./products.xlsx");
    const sheet = file.Sheets[file.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);

    products = data.map((p, i) => ({
      id: i,
      title: p.name || "",
      description: p.description || "",
      price: p.price || "",
      image: String(p.image || "").split(",")[0].trim(),
      url: p.url || "",
      category: autoCategory(p.name || "", p.description || "")
    }));

    console.log("✅ PRODUCTS LOADED:", products.length);

  } catch (err) {
    console.log("❌ PRODUCTS ERROR:", err);
  }
}

loadProducts();

// =========================
// ROOT
// =========================
app.get("/", (req, res) => {
  res.send("🌸 Yasmin AI Running");
});

// =========================
// CHAT (FULL INTELLIGENCE)
// =========================
app.post("/chat", async (req, res) => {
  try {

    const sessionId = req.body.sessionId || "guest";
    const message = req.body.message || "";

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        history: [],
        shownProducts: []
      };
    }

    const session = sessions[sessionId];

    session.history.push({
      role: "user",
      content: message
    });

    const catalog = products.map(p =>
      `ID:${p.id} | ${p.title} | ${p.category}`
    ).join("\n");

    // =========================
    // 🔥 INTENT UNDERSTANDING (CORE FIX)
    // =========================
    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت نظام ذكي لمتجر.

افهم نية العميل فقط بدون كلمات ثابتة.

أرجع JSON فقط:

{
 "reply":"رد مختصر",
 "category":"بنات | اولاد | مواليد | جماعي | عام",
 "needRefresh": true/false
}

القواعد:
- إذا العميل غيّر الموضوع → needRefresh = true
- إذا نفس الطلب → false
- اختر category بناءً على المعنى وليس الكلمات

المنتجات:
${catalog}
`
        },
        ...session.history
      ]
    });

    const content = ai.choices[0].message.content || "";

    session.history.push({
      role: "assistant",
      content
    });

    let parsed;

    try {
      parsed = JSON.parse(content.replace(/```json/g, "").replace(/```/g, "").trim());
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return res.json({
        reply: content,
        recommend: false
      });
    }

    // =========================
    // SMART PRODUCT ENGINE (NO RULES, NO KEYWORDS)
    // =========================
    if (parsed.category) {

      const needRefresh = parsed.needRefresh || false;

      let used = needRefresh ? [] : (session.shownProducts || []);

      let filtered = products.filter(p =>
        p.category === parsed.category &&
        p.image &&
        p.url &&
        !used.includes(p.id)
      );

      // لو ما فيه → نعيد تعبئة بدون تكرار
      if (filtered.length === 0) {
        used = [];
        filtered = products.filter(p =>
          p.category === parsed.category &&
          p.image &&
          p.url
        );
      }

      const selected = filtered.slice(0, 3);

      selected.forEach(p => used.push(p.id));

      session.shownProducts = used;

      return res.json({
        reply: parsed.reply,
        recommend: true,
        products: selected
      });
    }

    return res.json({
      reply: parsed.reply,
      recommend: false
    });

  } catch (err) {
    console.log("❌ CHAT ERROR:", err);

   
