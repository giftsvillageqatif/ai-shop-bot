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
// TELEGRAM BOT (NEW - ADDED ONLY)
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
// ROOT
// =========================
app.get("/", (req, res) => {
  res.send("🌸 Yasmin AI Running");
});

// =========================
// CHAT (UNCHANGED - NO TOUCH)
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
      `ID:${p.id} | ${p.title}`
    ).join("\n");

    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مساعد متجر.

أرجع JSON فقط:
{
 "reply":"رد",
 "recommend":true/false,
 "product_query":""
}

المنتجات:
${catalog}
`
        },
        ...session.history
      ]
    });

    const content = ai.choices[0].message.content;

    let parsed;
    try {
      parsed = JSON.parse(content.replace(/```json/g, "").replace(/```/g, ""));
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return res.json({
        reply: content,
        recommend: false
      });
    }

    if (parsed.recommend) {

      let filtered = products.slice(0, 3);

      return res.json({
        reply: parsed.reply,
        recommend: true,
        products: filtered
      });
    }

    return res.json({
      reply: parsed.reply,
      recommend: false
    });

  } catch (err) {
    return res.json({
      reply: "ياسمين لديها خلل تقني",
      recommend: false
    });
  }
});

// =========================
// REVIEW (ONLY MODIFIED SECTION)
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
    // ONLY ADDITION: TELEGRAM
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
