import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🛍 المنتجات
let products = [];

// 📊 تحميل Excel
function loadExcel() {

  const path = "./products.xlsx";

  if (!fs.existsSync(path)) {
    console.log("❌ products.xlsx not found");
    return;
  }

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
    clicks: 0,
    views: 0
  }));

  console.log("✅ Products loaded:", products.length);
}

loadExcel();


// 🌸 AI "ياسمين"
async function yasminAI(text) {

  try {

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنتِ "ياسمين" 🌸 موظفة متجر ذكية.

ارجعي JSON فقط:

{
  "category": "ولد | فتاة | مولود | غير محدد",
  "intent": "هدية | استخدام شخصي | غير محدد",
  "mood": "كيوت | فخم | رياضي | عادي",
  "keywords": ["..."]
}
`
        },
        { role: "user", content: text }
      ]
    });

    return JSON.parse(ai.choices[0].message.content);

  } catch (e) {

    return {
      category: "غير محدد",
      intent: "غير محدد",
      mood: "غير محدد",
      keywords: []
    };

  }

}


// 🧠 Recommendation Engine
app.post("/recommend", async (req, res) => {

  try {

    const text = (req.body.message || "").toLowerCase();

    if (!text) {
      return res.json({
        reply: "🌸 اكتب طلبك وأنا أساعدك أختار الأفضل لك",
        products: []
      });
    }

    const parsed = await yasminAI(text);

    console.log("🌸 Yasmin AI:", parsed);

    let scored = products.map(p => {

      let score = 0;
      let reasons = [];

      const tags = p.tags || [];

      // 🎯 category
      if (parsed.category === "ولد" && tags.includes("ولد")) score += 70;
      if (parsed.category === "فتاة" && tags.includes("فتاة")) score += 70;
      if (parsed.category === "مولود" && tags.includes("مولود")) score += 70;

      // 🎁 intent
      if (parsed.intent === "هدية" && tags.includes("هدية")) score += 30;

      // 🎨 mood
      if (parsed.mood === "كيوت" && tags.includes("وردي")) score += 25;
      if (parsed.mood === "فخم" && tags.includes("فاخر")) score += 25;
      if (parsed.mood === "رياضي" && tags.includes("رياضة")) score += 25;

      // 🔍 keywords
      (parsed.keywords || []).forEach(k => {
        if (tags.includes(k.toLowerCase())) score += 35;
      });

      // 🔥 popularity
      score += (p.clicks || 0) * 4;
      score += (p.views || 0) * 1;

      return {
        id: p.id,
        title: p.title,
        image: p.image,
        url: p.url,
        price: p.price,
        score,
        reasons
      };

    });

    scored.sort((a, b) => b.score - a.score);

    scored = scored.filter(p => p.score > 0);

    if (scored.length === 0) {
      scored = products.slice(0, 3);
    }

    const top = scored.slice(0, 3);

    res.json({
      reply: "🌸 ياسمين اختارت لك أفضل المنتجات بعناية:",
      products: top,
      ai: parsed
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      reply: "ياسمين لديها خلل تقني",
      products: []
    });

  }

});


// 👀 view tracking
app.post("/view", (req, res) => {

  const p = products.find(x => x.id === req.body.id);
  if (p) p.views++;

  res.json({ ok: true });

});


// 👆 click tracking
app.post("/click", (req, res) => {

  const p = products.find(x => x.id === req.body.id);
  if (p) p.clicks++;

  res.json({ ok: true });

});


// 🚀 تشغيل السيرفر
app.listen(process.env.PORT || 3000, () => {
  console.log("🌸 Yasmin AI Store Running...");
});
