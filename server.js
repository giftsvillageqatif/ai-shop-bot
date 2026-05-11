import express from "express";
import cors from "cors";
import xlsx from "xlsx";
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
async function notifyTelegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text
      })
    });
  } catch (e) {
    console.log("TELEGRAM ERROR", e.message);
  }
}

// =========================
// DATA
// =========================
let products = [];
let sessions = {};

// =========================
// LOAD PRODUCTS
// =========================
function loadProducts() {
  const file = xlsx.readFile("./products.xlsx");
  const sheet = file.Sheets[file.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  products = data.map((p, i) => ({
    id: i,
    title: p.name || "",
    description: p.description || "",
    price: p.price || "",
    image: String(p.image || "").split(",")[0].trim(),
    url: p.url || ""
  }));

  console.log("✅ PRODUCTS LOADED:", products.length);
}

loadProducts();

// =========================
// SMART SEARCH ENGINE
// =========================
function searchProducts(query) {
  const q = (query || "").toLowerCase();

  return products.filter(p => {
    const text = (p.title + " " + (p.description || "")).toLowerCase();

    return q.split(" ").some(word => text.includes(word));
  }).filter(p => p.image && p.url);
}

// =========================
// MAIN CHAT
// =========================
app.post("/chat", async (req, res) => {
  try {

    const sessionId = req.body.sessionId || "guest";
    const message = req.body.message || "";

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        history: [],
        shown: []
      };
    }

    const session = sessions[sessionId];

    session.history.push({ role: "user", content: message });

    // =========================
    // AI UNDERSTANDING
    // =========================
    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
أنت مساعد متجر ذكي.

حلل نية العميل فقط.

أرجع JSON:

{
 "reply":"رد مختصر",
 "intent":"search | change | general",
 "keywords":"كلمات بحث"
}

- search = يحتاج منتجات
- change = غيّر الموضوع (أعد التوصيات)
- general = كلام عادي
`
        },
        ...session.history
      ]
    });

    let raw = ai.choices[0].message.content;

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json/g, "").replace(/```/g, ""));
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return res.json({
        reply: raw,
        recommend: false
      });
    }

    // =========================
    // RESET IF USER CHANGED TOPIC
    // =========================
    if (parsed.intent === "change") {
      session.shown = [];
    }

    // =========================
    // SEARCH PRODUCTS
    // =========================
    let results = searchProducts(parsed.keywords || message);

    // منع التكرار
    results = results.filter(p => !session.shown.includes(p.id));

    // لو خلصت نعيد التصفير
    if (results.length === 0) {
      session.shown = [];
      results = searchProducts(parsed.keywords || message);
    }

    const selected = results.slice(0, 3);

    selected.forEach(p => session.shown.push(p.id));

    return res.json({
      reply: parsed.reply,
      recommend: true,
      products: selected
    });

  } catch (err) {
    console.log("CHAT ERROR:", err);

    return res.json({
      reply: "خطأ مؤقت",
      recommend: false
    });
  }
});

// =========================
// REVIEW (TELEGRAM)
// =========================
app.post("/review", async (req, res) => {
  try {

    const rating = req.body.rating || 0;

    await notifyTelegram(
      `⭐ تقييم جديد\n⭐ ${rating}/5`
    );

    res.json({ success: true });

  } catch (e) {
    res.json({ success: false });
  }
});

// =========================
// START
// =========================
app.get("/", (req, res) => {
  res.send("AI STORE RUNNING");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("RUN:", PORT));
