import express from "express";
import OpenAI from "openai";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 OpenAI Key من Render Environment Variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🛍 المنتجات
let products = [];

// 📊 تحميل ملف Excel
function loadExcel() {

  const path = "./products.xlsx";

  if (!fs.existsSync(path)) {
    console.log("❌ products.xlsx not found");
    return;
  }

  const file = xlsx.readFile(path);
  const sheet = file.Sheets[file.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  products = data.map(function(p) {
    return {
      title: p.name || "",
      image: p.image || "",
      url: p.url || "",
      price: p.price || 0,
      tags: (p.tags || "").toString().toLowerCase()
    };
  });

  console.log("✅ Products loaded:", products.length);
}

// تشغيل عند بداية السيرفر
loadExcel();

// 🧠 API التوصيات (مثل أمازون)
app.post("/recommend", async (req, res) => {

  try {

    const msg = (req.body.message || "").toLowerCase();

    // 1. فهم العميل بالـ AI
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت نظام توصية منتجات مثل أمازون.
استخرج نية العميل (عيد، هدية، رخيص، فاخر، زوجة، طفل).
`
        },
        {
          role: "user",
          content: msg
        }
      ]
    });

    const analysis = ai.choices[0].message.content.toLowerCase();

    // 2. تقييم المنتجات (Ranking)
    let scored = products.map(function(p) {

      let score = 0;

      if (analysis.includes("عيد") && p.tags.includes("عيد")) score += 10;
      if (analysis.includes("رومانسي") && p.tags.includes("رومانسي")) score += 10;
      if (analysis.includes("طفل") && p.tags.includes("طفل")) score += 10;
      if (analysis.includes("رخيص") && Number(p.price) < 100) score += 10;
      if (analysis.includes("فاخر") && p.tags.includes("فاخر")) score += 10;

      return Object.assign({}, p, { score: score });

    });

    // 3. ترتيب مثل أمازون
    scored.sort(function(a, b) {
      return b.score - a.score;
    });

    // 4. أفضل 3 منتجات
    const top = scored.slice(0, 3).map(function(p) {
      return {
        title: p.title,
        image: p.image,
        url: p.url
      };
    });

    // 5. الرد النهائي
    res.json({
      reply: "تم اختيار أفضل المنتجات لك 👇",
      products: top
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      reply: "حدث خطأ في السيرفر",
      products: []
    });
  }

});

// 🔥 تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("🚀 Server running on port " + PORT);
});
