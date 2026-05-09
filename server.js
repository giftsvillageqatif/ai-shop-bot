import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🛍 المنتجات
let products = [];

// 👤 بيانات سلوك المستخدمين (TikTok concept)
const userBehavior = {}; 
// شكلها:
// { sessionId: { views: [], clicks: [] } }

// 📊 تحميل Excel
function loadExcel() {

  const path = "./products.xlsx";

  if (!fs.existsSync(path)) return;

  const file = xlsx.readFile(path);
  const sheet = file.Sheets[file.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  products = data.map((p, i) => ({
    id: i,
    title: p.name || "",
    image: p.image || "",
    url: p.url || "",
    price: Number(p.price || 0),

    tags: (p.tags || "")
      .toString()
      .toLowerCase()
      .split(",")
      .map(t => t.trim()),

    views: 0,
    clicks: 0
  }));

  console.log("✅ Products loaded:", products.length);
}

loadExcel();


// 🧠 AI فهم النية (خفيف فقط)
async function analyze(text) {

  try {

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
حول الطلب إلى:
{
 "intent": "هدية | شراء | استكشاف | غير محدد",
 "keywords": ["..."]
}
`
        },
        { role: "user", content: text }
      ]
    });

    return JSON.parse(ai.choices[0].message.content);

  } catch {

    return {
      intent: "غير محدد",
      keywords: []
    };

  }

}


// 🧠 TikTok Recommendation Engine
app.post("/recommend", async (req, res) => {

  try {

    const sessionId = req.body.sessionId || "guest";
    const message = (req.body.message || "").toLowerCase();

    if (!userBehavior[sessionId]) {
      userBehavior[sessionId] = { views: {}, clicks: {} };
    }

    const behavior = userBehavior[sessionId];

    // 🧠 AI analysis
    const parsed = await analyze(message);

    console.log("🧠 AI:", parsed);

    // 🧠 ranking engine (TikTok logic)
    let scored = products.map(p => {

      let score = 0;

      const tags = p.tags || [];

      // 🔥 1. Trending boost (global popularity)
      score += (p.clicks || 0) * 4;
      score += (p.views || 0) * 1;

      // 👤 2. Personal behavior (VERY important TikTok factor)
      if (behavior.clicks[p.id]) {
        score += 40;
      }

      if (behavior.views[p.id]) {
        score += 10;
      }

      // 🎯 3. Intent boost
      if (parsed.intent === "هدية" && tags.includes("هدية")) {
        score += 20;
      }

      // 🔍 4. keyword match
      (parsed.keywords || []).forEach(k => {
        if (tags.includes(k.toLowerCase())) {
          score += 30;
        }
      });

      // 💰 5. price engagement bias
      if (p.price < 100) score += 5;

      return {
        id: p.id,
        title: p.title,
        image: p.image,
        url: p.url,
        score
      };

    });

    // 📊 sort like TikTok feed
    scored.sort((a, b) => b.score - a.score);

    const top = scored.slice(0, 3);

    res.json({
      reply: "هذه أفضل اقتراحات لك حسب ذوقك 👇",
      products: top
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      reply: "ياسمين لديها خلل تقني",
      products: []
    });

  }

});


// 👀 view tracking (TikTok learning)
app.post("/view", (req, res) => {

  const { sessionId, id } = req.body;

  if (!userBehavior[sessionId]) {
    userBehavior[sessionId] = { views: {}, clicks: {} };
  }

  userBehavior[sessionId].views[id] =
    (userBehavior[sessionId].views[id] || 0) + 1;

  const product = products.find(p => p.id === id);

  if (product) product.views++;

  res.json({ ok: true });

});


// 👆 click tracking (strong signal)
app.post("/click", (req, res) => {

  const { sessionId, id } = req.body;

  if (!userBehavior[sessionId]) {
    userBehavior[sessionId] = { views: {}, clicks: {} };
  }

  userBehavior[sessionId].clicks[id] =
    (userBehavior[sessionId].clicks[id] || 0) + 1;

  const product = products.find(p => p.id === id);

  if (product) product.clicks++;

  res.json({ ok: true });

});


// 🚀 server start
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 TikTok AI Engine running on port " + PORT);
});
