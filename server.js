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
// TELEGRAM (ADDED ONLY)
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
          text: text
        })
      }
    );
  } catch (err) {
    console.log("❌ TELEGRAM ERROR:", err.message);
  }
}

// =========================
// DATA
// =========================
let products = [];
let sessions = {};

// =========================
// AUTO CATEGORY (بدون وصف)
// =========================
function autoCategory(title, desc) {
  const text = (title + " " + (desc || "")).toLowerCase();

  if (/(دمية|باربي|مكياج|اكسسوارات|بنات)/.test(text)) return "بنات";
  if (/(سيارة|روبوت|مسدس|اولاد|أولاد)/.test(text)) return "أولاد";
  if (/(lego|تعليمي|ألغاز|أطفال)/.test(text)) return "أطفال";

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
// CHAT
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
      `ID:${p.id} | ${p.title} | ${p.category} | ${p.price}`
    ).join("\n");

    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: `
أنتِ ياسمين 🌸 متجر قرية الهدايا

إذا احتاج العميل منتجات → أرجعي JSON:
{
 "reply":"...",
 "recommend":true,
 "product_query":"بنات / أولاد / أطفال"
}

غير كذا رد طبيعي.

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

    let parsed = null;

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
    // PRODUCTS FILTER
    // =========================
    if (parsed.recommend) {

      const query = (parsed.product_query || "").toLowerCase();

      let filtered = products.filter(p => {

        const text = (
          p.title +
          " " +
          (p.description || "") +
          " " +
          p.category
        ).toLowerCase();

        if (query.includes("بنات")) return text.includes("بنات");
        if (query.includes("اولاد") || query.includes("أولاد")) return text.includes("أولاد");
        if (query.includes("أطفال")) return text.includes("أطفال");

        return true;
      });

      const used = session.shownProducts;
      session.shownProducts = used;

      filtered = filtered.filter(p =>
        !used.includes(p.id) && p.image && p.url
      );

      if (filtered.length === 0) {
        filtered = products.filter(p => p.image && p.url);
      }

      const selected = filtered.slice(0, 3);

      selected.forEach(p => used.push(p.id));

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
// REVIEW (TELEGRAM ONLY)
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

    // =========================
    // TELEGRAM NOTIFICATION
    // =========================
    await sendTelegramMessage(
      `⭐ تقييم جديد
📦 الطلب: ${review.orderId}
👤 العميل: ${review.customer}
⭐ التقييم: ${review.rating}/5
📅 التاريخ: ${review.date}`
    );

    res.json({ success: true });

  } catch (err) {
    console.log("❌ REVIEW ERROR:", err);

    res.json({
      success: false,
      error: err.message
    });
  }
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌸 SERVER RUNNING:", PORT);
});
