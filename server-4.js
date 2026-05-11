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
// SMART CATEGORY (AI FRIENDLY)
// =========================
function autoCategory(title = "", desc = "") {

  const text = (title + " " + (desc || "")).toLowerCase();

  if (/(بنات|باربي|مكياج|اكسسوارات|عطر|شنطة)/.test(text)) return "بنات";
  if (/(سيارة|روبوت|مسدس|طائرة|اولاد|أولاد)/.test(text)) return "اولاد";
  if (/(مواليد|baby|newborn|infant|رضيع)/.test(text)) return "مواليد";
  if (/(جماعي|board|لعبة جماعية|تحدي)/.test(text)) return "جماعي";

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
// CHAT (SMART INTENT AI)
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
    // 🔥 AI UNDERSTANDING INTENT
    // =========================
    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `
أنت نظام تصنيف منتجات لمتجر.

حلل طلب العميل وأرجع JSON فقط بهذا الشكل:

{
 "reply":"رد مختصر",
 "category":"بنات | اولاد | مواليد | جماعي | عام",
 "recommend":true
}

اختَر CATEGORY واحدة فقط حسب النية وليس الكلمات فقط.

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
    // SMART FILTER (NO CHAOS)
    // =========================
    if (parsed.recommend) {

      const category = parsed.category || "عام";

      let used = session.shownProducts || [];

      let filtered = products.filter(p =>
        p.category === category &&
        p.image &&
        p.url &&
        !used.includes(p.id)
      );

      // إذا خلصت المنتجات نعيد الدورة
      if (filtered.length === 0) {
        used = [];
        session.shownProducts = [];

        filtered = products.filter(p =>
          p.category === category &&
          p.image &&
          p.url
        );
      }

      // بدون عشوائية مزعجة (اختيار ذكي ثابت)
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

    return res.json({
      reply: "يوجد خطأ مؤقت",
      recommend: false
    });
  }
});

// =========================
// REVIEW (TELEGRAM)
// =========================
app.post("/review", async (req, res) => {
  try {

    const review = {
      orderId: req.body.orderId || "غير معروف",
      customer: req.body.customer || "عميل",
      rating: req.body.rating || 0,
      date: new Date().toISOString()
    };

    let reviews = [];

    try {
      reviews = JSON.parse(fs.readFileSync("./reviews.json", "utf8"));
    } catch {}

    reviews.push(review);

    fs.writeFileSync("./reviews.json", JSON.stringify(reviews, null, 2));

    await sendTelegramMessage(`
⭐ تقييم جديد

📦 الطلب: ${review.orderId}
👤 العميل: ${review.customer}
⭐ التقييم: ${review.rating}/5
📅 التاريخ: ${review.date}
`);

    res.json({ success: true });

  } catch (err) {
    console.log("❌ REVIEW ERROR:", err);

    res.json({ success: false });
  }
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌸 SERVER RUNNING:", PORT);
});
